/** TASK-081: 카드 생성·검증·한 번 실행을 같은 가게 트랜잭션에 묶습니다. 업무 명령은 각 담당 모듈이 연결합니다. */
import { cardExpiresAt, judgeCardPress } from "./confirm-card";
import type { KakaoChangeRequestCard } from "./kakao-change-request-message";
import type { KakaoOrderCardContext } from "./kakao-order-request-content";
import type { KakaoPaymentClaimCard } from "./kakao-payment-claim-message";
import type { KakaoPaymentAmountView } from "./kakao-payment-message";
import type { ClauseInput } from "./operating-rules-input";
import { orderCardDeadline, readPreparedOrderSummary } from "./order-card-presentation";
import {
  type PaymentClaimBinding,
  type PaymentClaimSource,
  readPaymentClaimSource,
} from "./payment-claim-presentation";
import { fieldError } from "./problem";
import { pathId, type ShopDb, type ShopRequestDb } from "./shop-scope";

export const CUSTOMER_COMMAND_KINDS = [
  "order_request",
  "payment_claim",
  "change_request",
  "cancel",
  "issue_report",
  "consent_withdrawal",
] as const;
export type CustomerCommandKind = (typeof CUSTOMER_COMMAND_KINDS)[number];
interface Identity {
  readonly customerId: string;
  readonly consultationId: string;
}
export interface ShowConfirmCard extends Identity {
  readonly kind: CustomerCommandKind;
  readonly orderId?: string;
  readonly draftId?: string;
  readonly now: Date;
  /** 서버 수신 메시지와 보낼 카드의 연결. AI 출력이나 clientExtra에서는 받지 않습니다. */
  readonly sourceMessageId?: string;
}
export interface ConfirmCardView {
  readonly kind?: CustomerCommandKind;
  /** 서버에서 준비한 변경 표시. 업무 명령의 입력으로 사용하지 않는다. */
  readonly changeRequest?: KakaoChangeRequestCard;
  readonly orderRequest?: KakaoOrderCardContext;
  /** 전송 직전 자료. 카드 payload/메시지/AI 입력에는 저장하지 않는다. */
  readonly paymentClaim?: KakaoPaymentClaimCard;
  /** 저장된 금액 카드의 전송 직전 표시. 이 값을 payload에 저장하지 않는다. */
  readonly amountConfirmation?: KakaoPaymentAmountView;
  readonly cardKey: string;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly blockId: string;
}
export interface UnavailableConfirmCard {
  readonly unavailable: true;
  readonly text: string;
}
export interface ConfirmCardCommandResult {
  readonly outcome: string;
  readonly text: string;
}
export interface ConfirmCardAnswer extends ConfirmCardCommandResult {
  readonly kind?: CustomerCommandKind;
  readonly card?: ConfirmCardView;
  readonly firstResult?: ConfirmCardCommandResult;
  /** 전용 입력 블록에만 돌려주는 재입력 버튼. 이름 원문을 포함하지 않는다. */
  readonly depositorInput?: Pick<KakaoPaymentClaimCard, "cardKey" | "depositorBlockId">;
}
export interface ConfirmCardCommandInput extends Identity {
  /** 인증된 입금자 전용 블록에서만 검증한 값. payload/메시지에는 저장하지 않는다. */
  readonly depositorName?: string;
  readonly id: string;
  readonly kind: CustomerCommandKind;
  readonly orderId: string | null;
  readonly draftId: string | null;
}
/** 실행기는 지금 주문 상태와 잠금 번호를 다시 확인하고 조건에 맞는 쓰기만 합니다. 실패하면 사용 표시까지 함께 취소합니다. 외부 발신은 하지 않습니다. 주문 요청의 order_id 연결 권한·시험은 실제 실행기를 등록하는 TASK-083에서 추가합니다. */
export type ConfirmCardCommand = (db: ShopDb, input: ConfirmCardCommandInput) => Promise<ConfirmCardCommandResult>;
interface Source {
  paymentClaim?: PaymentClaimSource;
  orderRequest?: KakaoOrderCardContext;
  orderRequestTimeZone?: string;
  orderId: string | null;
  orderVersion: number | null;
  draftId: string | null;
  draftRevision: number | null;
  description: string;
  blockId: string;
}
interface CardRow {
  id: string;
  kind: CustomerCommandKind;
  customer_id: string;
  consultation_id: string;
  order_id: string | null;
  order_version: number | null;
  draft_id: string | null;
  draft_revision: number | null;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
  payload: {
    presentation?: ConfirmCardView;
    sourceMessageId?: string;
    result?: ConfirmCardCommandResult;
    replacedBy?: { cardKey: string };
    paymentClaimBinding?: PaymentClaimBinding;
  };
  outcome: "done" | "stale" | "expired" | null;
}
const LABELS: Record<CustomerCommandKind, string> = {
  order_request: "주문 요청",
  payment_claim: "결제 확인 요청",
  change_request: "변경 요청",
  cancel: "주문 취소",
  issue_report: "문제 신고",
  consent_withdrawal: "동의 철회",
};
export const NOT_YOURS = { outcome: "card_not_yours", text: "이 버튼은 카드를 받은 분만 누를 수 있어요" } as const;
export const RETRY_NEEDED = { outcome: "retry_needed", text: "다시 눌러 주세요" } as const;
const DECLINED = { outcome: "declined", text: "알겠어요. 더 궁금한 것이 있으면 말씀해 주세요" } as const;
function usedAnswer(card: CardRow): ConfirmCardAnswer {
  const result = card.payload.result;
  return {
    outcome: "card_used",
    text: "이미 처리했어요",
    ...(["payment_claim", "change_request"].includes(card.kind) ? { kind: card.kind } : {}),
    ...(result === undefined ? {} : { firstResult: { outcome: result.outcome, text: result.text } }),
  };
}
function usedDelivery(card: CardRow) {
  return {
    text:
      ((card.kind === "payment_claim" && card.payload.result?.outcome === "payment_claimed") ||
        (card.kind === "change_request" && card.payload.result?.outcome === "change_requested")) &&
      card.payload.result !== undefined
        ? card.payload.result.text
        : "이미 처리했어요",
  };
}
const SUCCESS_OUTCOMES: Record<CustomerCommandKind, string> = {
  order_request: "order_requested",
  payment_claim: "payment_claimed",
  change_request: "change_requested",
  cancel: "order_cancelled",
  issue_report: "issue_reported",
  consent_withdrawal: "consent_withdrawn",
};

function validNow(now: Date) {
  if (!Number.isFinite(now.getTime())) throw new RangeError("invalid card time");
}
async function identityAvailable(db: ShopDb, identity: Identity): Promise<boolean> {
  const customer = await db.run("SELECT id FROM customers WHERE shop_id=$1 AND id=$2 FOR UPDATE", [
    pathId(identity.customerId),
  ]);
  if (!customer.rowCount) return false;
  const consultation = await db.run(
    "SELECT id FROM consultations WHERE shop_id=$1 AND id=$2 AND customer_id=$3 AND status NOT IN ('ended','deleted','dropped') FOR UPDATE",
    [pathId(identity.consultationId), identity.customerId],
  );
  return consultation.rowCount === 1;
}
async function readSource(db: ShopDb, input: ShowConfirmCard, knownBlockId?: string): Promise<Source | null> {
  if (!CUSTOMER_COMMAND_KINDS.includes(input.kind)) throw new TypeError("unsupported card kind");
  const blockId =
    knownBlockId ??
    (
      await db.run<{ card_block_id: string }>(
        "SELECT k.card_block_id FROM kakao_channels k JOIN customers c ON c.shop_id=$1 AND c.kakao_channel_id=k.id WHERE k.shop_id=$1 AND c.id=$2 AND k.status='linked'",
        [input.customerId],
      )
    ).rows[0]?.card_block_id;
  if (!blockId) return null;
  if (input.kind === "order_request") {
    if (input.draftId === undefined || input.orderId !== undefined) return null;
    const draft = await db.run<{ id: string; revision: number }>(
      "SELECT id,revision FROM order_drafts WHERE shop_id=$1 AND id=$2 AND consultation_id=$3 AND status='active' FOR UPDATE",
      [pathId(input.draftId), input.consultationId],
    );
    const row = draft.rows[0];
    const orderRequest = row === undefined ? null : await readOrderCardContext(db, input, row.revision);
    return row && orderRequest
      ? {
          orderId: null,
          orderVersion: null,
          draftId: row.id,
          draftRevision: row.revision,
          description: orderRequest.summary.text,
          blockId,
          orderRequest: orderRequest.context,
          orderRequestTimeZone: orderRequest.summary.timeZone,
        }
      : null;
  }
  if (input.orderId === undefined || input.draftId !== undefined) return null;
  const order = await db.run<{ id: string; version: number; order_no: string; amount: number; pickup_day: string }>(
    "SELECT id,version,order_no,amount,pickup_day::text FROM orders WHERE shop_id=$1 AND id=$2 AND customer_id=$3 AND (consultation_id=$4 OR $5::boolean) AND personal_data_purged_at IS NULL FOR UPDATE",
    [
      pathId(input.orderId),
      input.customerId,
      input.consultationId,
      ["issue_report", "consent_withdrawal"].includes(input.kind),
    ],
  );
  const row = order.rows[0];
  return row
    ? {
        orderId: row.id,
        orderVersion: row.version,
        draftId: null,
        draftRevision: null,
        description: `주문번호 ${row.order_no}\n픽업 날짜 ${row.pickup_day}\n주문 금액 ${row.amount.toLocaleString("ko-KR")}원`,
        blockId,
        ...(input.kind === "payment_claim"
          ? { paymentClaim: await readPaymentClaimSource(db, { ...input, orderId: row.id }) }
          : {}),
      }
    : null;
}
async function readOrderCardContext(
  db: ShopDb,
  input: ShowConfirmCard,
  revision: number,
): Promise<{ context: KakaoOrderCardContext; summary: { text: string; timeZone: string } } | null> {
  const selected = (
    await db.run<{
      quote_id: string;
      operating_rules_id: string;
      version: number;
      channel_friend: boolean;
      price_list_id: string;
      amount: number;
      amount_max: number | null;
      display_kind: "fixed" | "from" | "range";
      order_kind: "standard" | "custom";
    }>(
      `SELECT q.id AS quote_id,r.id AS operating_rules_id,r.version,c.channel_friend,q.price_list_id,q.amount,q.amount_max,q.display_kind,q.order_kind FROM quotes q
      JOIN operating_rules r ON r.shop_id=$1 AND r.id=q.operating_rules_id AND r.superseded_at IS NULL
      JOIN price_lists p ON p.shop_id=$1 AND p.id=q.price_list_id AND p.superseded_at IS NULL
      JOIN customers c ON c.shop_id=$1 AND c.id=$2
      WHERE q.shop_id=$1 AND q.draft_id=$3 AND q.draft_revision=$4 AND q.quoted_at<=$5 AND q.valid_until>$5
      ORDER BY q.quoted_at DESC,q.id DESC LIMIT 1 FOR SHARE OF r,p`,
      [input.customerId, input.draftId ?? null, revision, input.now],
    )
  ).rows[0];
  if (!selected) return null;
  const summary = await readPreparedOrderSummary(db, {
    draftId: input.draftId ?? "",
    consultationId: input.consultationId,
    quote: {
      priceListId: selected.price_list_id,
      amount: selected.amount,
      amountMax: selected.amount_max,
      displayKind: selected.display_kind,
      orderKind: selected.order_kind,
    },
    expiresAt: cardExpiresAt(input.now),
  });
  if (!summary) return null;
  const clauses = (
    await db.run<{
      clause_key: ClauseInput["key"];
      position: number;
      title: string;
      condition_text: string;
      effect_text: string;
    }>(
      "SELECT clause_key,position,title,condition_text,effect_text FROM rule_clauses WHERE shop_id=$1 AND operating_rules_id=$2 ORDER BY position",
      [selected.operating_rules_id],
    )
  ).rows;
  if (clauses.length === 0) return null;
  return {
    summary,
    context: {
      quoteId: selected.quote_id,
      isFriend: selected.channel_friend,
      policy: {
        version: selected.version,
        clauses: clauses.map((c) => ({
          key: c.clause_key,
          position: c.position,
          title: c.title,
          condition: c.condition_text,
          effect: c.effect_text,
        })),
      },
    },
  };
}
function orderCardChanged(card: CardRow, source: Source): boolean {
  return (
    card.kind === "order_request" &&
    (card.payload.presentation?.orderRequest?.quoteId !== source.orderRequest?.quoteId ||
      card.payload.presentation?.orderRequest?.policy.version !== source.orderRequest?.policy.version)
  );
}
function paymentClaimChanged(card: CardRow, source: Source): boolean {
  if (card.kind !== "payment_claim" || source.paymentClaim?.available !== true) return false;
  const previous = card.payload.paymentClaimBinding;
  const current = source.paymentClaim.binding;
  return (
    previous?.paymentRequestId !== current.paymentRequestId ||
    previous.version !== current.version ||
    previous.amount !== current.amount ||
    previous.dueAt !== current.dueAt
  );
}
/** 첫 실제 전달로 시작된 시계만 같은 카드에 반영한다. 사장님의 버전 변경은 계속 새 카드로 판정한다. */
async function refreshPaymentClaimClock(db: ShopDb, card: CardRow, source: Source, persist = true) {
  if (
    card.kind !== "payment_claim" ||
    card.used_at !== null ||
    card.order_version !== source.orderVersion ||
    source.paymentClaim?.available !== true
  )
    return;
  const previous = card.payload.paymentClaimBinding;
  const current = source.paymentClaim.binding;
  if (
    previous?.awaitingDelivery !== true ||
    current.awaitingDelivery ||
    previous.paymentRequestId !== current.paymentRequestId ||
    previous.version !== current.version ||
    previous.amount !== current.amount ||
    Date.parse(current.dueAt) > Date.parse(previous.dueAt)
  )
    return;
  if (persist) {
    const saved = await db.run(
      "UPDATE confirm_cards SET payload=jsonb_set(payload,'{paymentClaimBinding}',$4::jsonb) WHERE shop_id=$1 AND id=$2 AND customer_id=$3 AND used_at IS NULL",
      [card.id, card.customer_id, JSON.stringify(current)],
    );
    if (saved.rowCount !== 1) throw new Error("card changed after clock lock");
  }
  card.payload.paymentClaimBinding = current;
}
function withPaymentClaim(card: ConfirmCardView, source: Source, expiresAt: Date): ConfirmCardView {
  if (source.paymentClaim?.available === false && source.paymentClaim.amountConfirmation !== undefined)
    return { ...card, amountConfirmation: source.paymentClaim.amountConfirmation };
  return source.paymentClaim?.available === true
    ? {
        ...card,
        paymentClaim: {
          ...source.paymentClaim.presentation,
          cardKey: card.cardKey,
          cardBlockId: card.blockId,
          expiresAt: expiresAt.toISOString(),
        },
      }
    : card;
}
async function insertCard(db: ShopDb, input: ShowConfirmCard, source: Source): Promise<ConfirmCardView> {
  const card: ConfirmCardView = {
    kind: input.kind,
    ...(source.orderRequest === undefined ? {} : { orderRequest: source.orderRequest }),
    cardKey: `ck_${crypto.randomUUID().replaceAll("-", "")}`,
    title: `${LABELS[input.kind]} 확인`,
    description:
      source.orderRequestTimeZone === undefined
        ? source.description
        : orderCardDeadline(source.description, source.orderRequestTimeZone, cardExpiresAt(input.now)),
    confirmLabel: input.kind === "order_request" ? "규정에 동의하고 주문 요청" : LABELS[input.kind],
    blockId: source.blockId,
  };
  await db.run(
    "INSERT INTO confirm_cards (shop_id,consultation_id,customer_id,card_key,kind,order_id,order_version,draft_id,draft_revision,payload,created_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)",
    [
      input.consultationId,
      input.customerId,
      card.cardKey,
      input.kind,
      source.orderId,
      source.orderVersion,
      source.draftId,
      source.draftRevision,
      JSON.stringify({
        presentation: input.kind === "order_request" ? { ...card, description: "주문 요청 확인" } : card,
        ...(input.sourceMessageId === undefined ? {} : { sourceMessageId: pathId(input.sourceMessageId) }),
        ...(source.paymentClaim?.available === true ? { paymentClaimBinding: source.paymentClaim.binding } : {}),
      }),
      input.now,
      cardExpiresAt(input.now),
    ],
  );
  return withPaymentClaim(card, source, cardExpiresAt(input.now));
}
export async function prepareConfirmCardInTransaction(
  db: ShopDb,
  input: ShowConfirmCard,
): Promise<ConfirmCardView | UnavailableConfirmCard> {
  validNow(input.now);
  if (!(await identityAvailable(db, input))) throw new Error("card recipient unavailable");
  const source = await readSource(db, input);
  if (source === null) throw new Error("card source unavailable");
  if (source.paymentClaim?.available === false && source.paymentClaim.amountConfirmation === undefined)
    return { unavailable: true, text: source.paymentClaim.text };
  return insertCard(db, input, source);
}
/** 원본이 준비된 내부 호출자용. AI 제안은 prepare의 예상 가능한 상태 결과를 받는다. */
export async function showConfirmCardInTransaction(db: ShopDb, input: ShowConfirmCard): Promise<ConfirmCardView> {
  const prepared = await prepareConfirmCardInTransaction(db, input);
  if ("unavailable" in prepared) throw new Error("card source unavailable");
  return prepared;
}
export function showConfirmCard(db: ShopRequestDb, input: ShowConfirmCard): Promise<ConfirmCardView> {
  return db.transaction((tx) => showConfirmCardInTransaction(tx, input));
}
export interface PressConfirmCard extends Identity {
  readonly cardKey: string;
  readonly choice: "confirm" | "decline";
  readonly now: Date;
}
export function pressConfirmCard(
  db: ShopRequestDb,
  input: PressConfirmCard,
  execute?: ConfirmCardCommand,
): Promise<ConfirmCardAnswer> {
  return db.transaction((tx) => pressConfirmCardInTransaction(tx, input, execute));
}
function validatePress(input: Pick<PressConfirmCard, "now" | "cardKey" | "choice">): void {
  validNow(input.now);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(input.cardKey)) throw fieldError("/action/clientExtra/cardKey", "bad_format");
  if (!["confirm", "decline"].includes(input.choice)) throw fieldError("/action/clientExtra/choice", "bad_format");
}
export async function pressConfirmCardInTransaction(
  tx: ShopDb,
  input: PressConfirmCard,
  execute?: ConfirmCardCommand,
): Promise<ConfirmCardAnswer> {
  validatePress(input);
  if (!(await identityAvailable(tx, input))) return NOT_YOURS;
  return processVerifiedCard(tx, input, execute);
}
const ORDER_NOT_READY = {
  outcome: "not_allowed_now",
  text: "지금은 할 수 없어요: 주문 내용과 견적을 다시 확인해야 해요. 채널 대화에서 주문 내용을 다시 말씀해 주세요",
} as const;
async function processVerifiedCard(
  tx: ShopDb,
  input: PressConfirmCard,
  execute?: ConfirmCardCommand,
  knownBlockId?: string,
  depositor?: { readonly value: unknown; readonly blockId: string },
): Promise<ConfirmCardAnswer> {
  const initial = (
    await tx.run<CardRow>(
      "SELECT * FROM confirm_cards WHERE shop_id=$1 AND card_key=$2 AND customer_id=$3 AND consultation_id=$4",
      [input.cardKey, input.customerId, input.consultationId],
    )
  ).rows[0];
  if (!initial || initial.created_at > input.now) return NOT_YOURS;
  if (!CUSTOMER_COMMAND_KINDS.includes(initial.kind)) return RETRY_NEEDED;
  if (depositor !== undefined && initial.kind !== "payment_claim") return NOT_YOURS;
  const depositorName =
    depositor !== undefined &&
    typeof depositor.value === "string" &&
    depositor.value.trim() &&
    [...depositor.value].length <= 30 &&
    !depositor.value.includes("\0")
      ? depositor.value
      : undefined;
  const invalidDepositor = depositor !== undefined && depositorName === undefined;
  if (initial.used_at !== null) return usedAnswer(initial);
  if (input.choice === "decline")
    return initial.kind === "payment_claim" ? { ...DECLINED, kind: initial.kind } : DECLINED;
  const target: ShowConfirmCard = {
    ...input,
    kind: initial.kind,
    ...(initial.order_id === null ? {} : { orderId: initial.order_id }),
    ...(initial.draft_id === null ? {} : { draftId: initial.draft_id }),
    ...(initial.payload.sourceMessageId === undefined ? {} : { sourceMessageId: initial.payload.sourceMessageId }),
  };
  const source = await readSource(tx, target, knownBlockId);
  if (source === null) return initial.kind === "order_request" ? ORDER_NOT_READY : RETRY_NEEDED;
  if (source.paymentClaim?.available === false)
    return {
      outcome: "not_allowed_now",
      text: source.paymentClaim.text,
      ...(initial.payload.presentation === undefined || source.paymentClaim.amountConfirmation === undefined
        ? {}
        : { card: withPaymentClaim(initial.payload.presentation, source, initial.expires_at) }),
    };
  const card = await tx.found<CardRow>("SELECT * FROM confirm_cards WHERE shop_id=$1 AND id=$2 FOR UPDATE", [
    initial.id,
  ]);
  await refreshPaymentClaimClock(tx, card, source, !invalidDepositor);
  const verdict = judgeCardPress(
    {
      customerId: card.customer_id,
      consultationId: card.consultation_id,
      orderId: card.order_id,
      orderVersion: card.order_version,
      draftId: card.draft_id,
      draftRevision: card.draft_revision,
      expiresAt: card.expires_at,
      usedAt: card.used_at,
    },
    { ...input, currentOrderVersion: source.orderVersion, currentDraftRevision: source.draftRevision },
  );
  if (verdict === "not_recipient") return NOT_YOURS;
  if (verdict === "used") return usedAnswer(card);
  if (
    verdict === "stale" ||
    verdict === "expired" ||
    orderCardChanged(card, source) ||
    paymentClaimChanged(card, source)
  ) {
    return replaceCard(tx, card, target, source, verdict === "expired" ? "expired" : "stale");
  }

  if (invalidDepositor && depositor !== undefined)
    return {
      outcome: "input_invalid",
      text: "입금자 이름은 1~30자로 넣어 주세요",
      kind: "payment_claim",
      depositorInput: { cardKey: input.cardKey, depositorBlockId: depositor.blockId },
    };
  if (execute === undefined) return RETRY_NEEDED;
  const result = await execute(tx, {
    customerId: input.customerId,
    consultationId: input.consultationId,
    id: card.id,
    kind: card.kind,
    orderId: card.order_id,
    draftId: card.draft_id,
    ...(depositorName === undefined ? {} : { depositorName }),
  });
  if (
    (result.outcome !== SUCCESS_OUTCOMES[card.kind] &&
      !(card.kind === "order_request" && ["day_full", "order_limit_reached"].includes(result.outcome))) ||
    !result.text ||
    result.text.includes("\0") ||
    [...result.text].length > 1000
  )
    throw new Error("invalid card command result");
  await tx.run(
    "UPDATE confirm_cards SET used_at=$3,outcome='done',payload=jsonb_set(payload,'{result}',$4::jsonb) WHERE shop_id=$1 AND id=$2",
    [card.id, input.now, JSON.stringify({ outcome: result.outcome, text: result.text })],
  );
  return {
    outcome: result.outcome,
    text: result.text,
    ...(["payment_claim", "change_request"].includes(card.kind) ? { kind: card.kind } : {}),
  };
}

async function replaceCard(
  tx: ShopDb,
  card: CardRow,
  target: ShowConfirmCard,
  source: Source,
  verdict: "stale" | "expired",
) {
  const replacement = await insertCard(tx, target, source);
  const result = {
    outcome: `card_${verdict}`,
    text:
      verdict === "stale" ? "내용이 바뀌었어요. 새 카드에서 눌러 주세요" : "시간이 지났어요. 새 카드에서 눌러 주세요",
  };
  await tx.run(
    "UPDATE confirm_cards SET used_at=$3,outcome=$4,payload=jsonb_set(jsonb_set(payload,'{result}',$5::jsonb),'{replacedBy}',$6::jsonb) WHERE shop_id=$1 AND id=$2",
    [card.id, target.now, verdict, JSON.stringify(result), JSON.stringify({ cardKey: replacement.cardKey })],
  );
  return { ...result, card: replacement };
}

/** 저장한 수신의 카드를 재전달합니다. 읽기·갱신뿐이며 업무 명령을 실행하지 않습니다. */
export async function readConfirmCardDelivery(
  db: ShopDb,
  input: Identity & { readonly sourceMessageId: string; readonly now: Date },
): Promise<{ readonly text: string; readonly card?: ConfirmCardView }> {
  const unavailable = { text: "내용을 다시 확인해 주세요" };
  if (!(await identityAvailable(db, input))) return unavailable;
  const rows = await db.run<CardRow>(
    `SELECT * FROM confirm_cards WHERE shop_id=$1 AND consultation_id=$2 AND customer_id=$3
      AND payload->>'sourceMessageId'=$4 AND NOT (payload ? 'replacedBy') LIMIT 2`,
    [input.consultationId, input.customerId, pathId(input.sourceMessageId)],
  );
  const initial = rows.rows[0];
  if (rows.rows.length !== 1 || initial === undefined || initial.created_at > input.now) return unavailable;
  if (initial.used_at !== null) return usedDelivery(initial);
  const target: ShowConfirmCard = {
    ...input,
    kind: initial.kind,
    ...(initial.order_id === null ? {} : { orderId: initial.order_id }),
    ...(initial.draft_id === null ? {} : { draftId: initial.draft_id }),
  };
  const source = await readSource(db, target);
  if (source === null) return initial.kind === "order_request" ? { text: ORDER_NOT_READY.text } : unavailable;
  if (source.paymentClaim?.available === false)
    return {
      text: source.paymentClaim.text,
      ...(initial.payload.presentation === undefined || source.paymentClaim.amountConfirmation === undefined
        ? {}
        : { card: withPaymentClaim(initial.payload.presentation, source, initial.expires_at) }),
    };
  const card = await db.found<CardRow>("SELECT * FROM confirm_cards WHERE shop_id=$1 AND id=$2 FOR UPDATE", [
    initial.id,
  ]);
  if (card.used_at !== null) return usedDelivery(card);
  await refreshPaymentClaimClock(db, card, source);
  const expired = input.now.getTime() >= card.expires_at.getTime();
  const stale =
    card.order_version !== source.orderVersion ||
    card.draft_revision !== source.draftRevision ||
    orderCardChanged(card, source) ||
    paymentClaimChanged(card, source);
  const presentation =
    expired || stale
      ? (await replaceCard(db, card, target, source, expired ? "expired" : "stale")).card
      : card.payload.presentation;
  return presentation === undefined
    ? unavailable
    : {
        text: presentation.title,
        card: withPaymentClaim(
          {
            ...presentation,
            kind: initial.kind,
            ...(!expired && !stale && source.orderRequestTimeZone !== undefined
              ? { description: orderCardDeadline(source.description, source.orderRequestTimeZone, card.expires_at) }
              : {}),
            ...(source.orderRequest === undefined ? {} : { orderRequest: source.orderRequest }),
          },
          source,
          expired || stale ? cardExpiresAt(input.now) : card.expires_at,
        ),
      };
}

export interface KakaoCardIdentityInput extends Pick<PressConfirmCard, "cardKey" | "choice" | "now"> {
  readonly channelId: string;
  readonly userId: string;
  readonly blockId: string;
  readonly depositorName?: unknown;
}
/** 인증된 채널 사용자와 현재 상담을 같은 트랜잭션에서 한 번만 잠급니다. */
export async function pressKakaoConfirmCardInTransaction(
  db: ShopDb,
  input: KakaoCardIdentityInput,
  execute?: ConfirmCardCommand,
): Promise<ConfirmCardAnswer | null> {
  validatePress(input);
  const channel = (
    await db.run<{ card_block_id: string; depositor_block_id: string | null }>(
      "SELECT card_block_id,depositor_block_id FROM kakao_channels WHERE shop_id=$1 AND id=$2 AND status='linked' FOR SHARE",
      [input.channelId],
    )
  ).rows[0];
  if (channel === undefined) return null;
  const isDepositor = channel.card_block_id !== input.blockId && channel.depositor_block_id === input.blockId;
  if (channel.card_block_id !== input.blockId && !isDepositor) return NOT_YOURS;
  const customer = (
    await db.run<{ id: string }>(
      "SELECT id FROM customers WHERE shop_id=$1 AND kakao_channel_id=$2 AND kakao_user_key=$3 FOR UPDATE",
      [input.channelId, input.userId],
    )
  ).rows[0];
  if (customer === undefined) return NOT_YOURS;
  const consultation = (
    await db.run<{ id: string }>(
      "SELECT id FROM consultations WHERE shop_id=$1 AND customer_id=$2 AND status NOT IN ('ended','deleted','dropped') ORDER BY opened_at DESC,id DESC LIMIT 1 FOR UPDATE",
      [customer.id],
    )
  ).rows[0];
  if (consultation === undefined) return NOT_YOURS;
  return processVerifiedCard(
    db,
    {
      cardKey: input.cardKey,
      choice: input.choice,
      now: input.now,
      customerId: customer.id,
      consultationId: consultation.id,
    },
    execute,
    channel.card_block_id,
    isDepositor ? { value: input.depositorName, blockId: input.blockId } : undefined,
  );
}
