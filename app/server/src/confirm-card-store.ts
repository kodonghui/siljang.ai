/** TASK-081: 카드 생성·검증·한 번 실행을 같은 가게 트랜잭션에 묶습니다. 업무 명령은 각 담당 모듈이 연결합니다. */
import { cardExpiresAt, judgeCardPress } from "./confirm-card";
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
  readonly cardKey: string;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly blockId: string;
}
export interface ConfirmCardCommandResult {
  readonly outcome: string;
  readonly text: string;
}
export interface ConfirmCardAnswer extends ConfirmCardCommandResult {
  readonly card?: ConfirmCardView;
  readonly firstResult?: ConfirmCardCommandResult;
}
export interface ConfirmCardCommandInput extends Identity {
  readonly id: string;
  readonly kind: CustomerCommandKind;
  readonly orderId: string | null;
  readonly draftId: string | null;
}
/** 실행기는 지금 주문 상태와 잠금 번호를 다시 확인하고 조건에 맞는 쓰기만 합니다. 실패하면 사용 표시까지 함께 취소합니다. 외부 발신은 하지 않습니다. 주문 요청의 order_id 연결 권한·시험은 실제 실행기를 등록하는 TASK-083에서 추가합니다. */
export type ConfirmCardCommand = (db: ShopDb, input: ConfirmCardCommandInput) => Promise<ConfirmCardCommandResult>;
interface Source {
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
    ...(result === undefined ? {} : { firstResult: { outcome: result.outcome, text: result.text } }),
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
    return row
      ? {
          orderId: null,
          orderVersion: null,
          draftId: row.id,
          draftRevision: row.revision,
          description: "주문 요청 내용을 확인해 주세요",
          blockId,
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
      }
    : null;
}
async function insertCard(db: ShopDb, input: ShowConfirmCard, source: Source): Promise<ConfirmCardView> {
  const card: ConfirmCardView = {
    cardKey: `ck_${crypto.randomUUID().replaceAll("-", "")}`,
    title: `${LABELS[input.kind]} 확인`,
    description: source.description,
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
        presentation: card,
        ...(input.sourceMessageId === undefined ? {} : { sourceMessageId: pathId(input.sourceMessageId) }),
      }),
      input.now,
      cardExpiresAt(input.now),
    ],
  );
  return card;
}
export async function showConfirmCardInTransaction(db: ShopDb, input: ShowConfirmCard): Promise<ConfirmCardView> {
  validNow(input.now);
  if (!(await identityAvailable(db, input))) throw new Error("card recipient unavailable");
  const source = await readSource(db, input);
  if (source === null) throw new Error("card source unavailable");
  return insertCard(db, input, source);
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
async function processVerifiedCard(
  tx: ShopDb,
  input: PressConfirmCard,
  execute?: ConfirmCardCommand,
  knownBlockId?: string,
): Promise<ConfirmCardAnswer> {
  const initial = (
    await tx.run<CardRow>(
      "SELECT * FROM confirm_cards WHERE shop_id=$1 AND card_key=$2 AND customer_id=$3 AND consultation_id=$4",
      [input.cardKey, input.customerId, input.consultationId],
    )
  ).rows[0];
  if (!initial || initial.created_at > input.now) return NOT_YOURS;
  if (!CUSTOMER_COMMAND_KINDS.includes(initial.kind))
    return { outcome: "retry_needed", text: "잠시 뒤 다시 눌러 주세요" };
  if (initial.used_at !== null) return usedAnswer(initial);
  if (input.choice === "decline") return DECLINED;
  const target: ShowConfirmCard = {
    ...input,
    kind: initial.kind,
    ...(initial.order_id === null ? {} : { orderId: initial.order_id }),
    ...(initial.draft_id === null ? {} : { draftId: initial.draft_id }),
    ...(initial.payload.sourceMessageId === undefined ? {} : { sourceMessageId: initial.payload.sourceMessageId }),
  };
  const source = await readSource(tx, target, knownBlockId);
  if (source === null) return RETRY_NEEDED;
  const card = await tx.found<CardRow>("SELECT * FROM confirm_cards WHERE shop_id=$1 AND id=$2 FOR UPDATE", [
    initial.id,
  ]);
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
  if (verdict === "stale" || verdict === "expired") {
    return replaceCard(tx, card, target, source, verdict);
  }

  if (execute === undefined) return RETRY_NEEDED;
  const result = await execute(tx, {
    customerId: input.customerId,
    consultationId: input.consultationId,
    id: card.id,
    kind: card.kind,
    orderId: card.order_id,
    draftId: card.draft_id,
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
  return { outcome: result.outcome, text: result.text };
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
  if (initial.used_at !== null) return { text: "이미 처리했어요" };
  const target: ShowConfirmCard = {
    ...input,
    kind: initial.kind,
    ...(initial.order_id === null ? {} : { orderId: initial.order_id }),
    ...(initial.draft_id === null ? {} : { draftId: initial.draft_id }),
  };
  const source = await readSource(db, target);
  if (source === null) return unavailable;
  const card = await db.found<CardRow>("SELECT * FROM confirm_cards WHERE shop_id=$1 AND id=$2 FOR UPDATE", [
    initial.id,
  ]);
  if (card.used_at !== null) return { text: "이미 처리했어요" };
  const expired = input.now.getTime() >= card.expires_at.getTime();
  const stale = card.order_version !== source.orderVersion || card.draft_revision !== source.draftRevision;
  const presentation =
    expired || stale
      ? (await replaceCard(db, card, target, source, expired ? "expired" : "stale")).card
      : card.payload.presentation;
  return presentation === undefined ? unavailable : { text: presentation.title, card: presentation };
}

export interface KakaoCardIdentityInput extends Pick<PressConfirmCard, "cardKey" | "choice" | "now"> {
  readonly channelId: string;
  readonly userId: string;
  readonly blockId: string;
}
/** 인증된 채널 사용자와 현재 상담을 같은 트랜잭션에서 한 번만 잠급니다. */
export async function pressKakaoConfirmCardInTransaction(
  db: ShopDb,
  input: KakaoCardIdentityInput,
  execute?: ConfirmCardCommand,
): Promise<ConfirmCardAnswer | null> {
  validatePress(input);
  const channel = (
    await db.run<{ card_block_id: string }>(
      "SELECT card_block_id FROM kakao_channels WHERE shop_id=$1 AND id=$2 AND status='linked' FOR SHARE",
      [input.channelId],
    )
  ).rows[0];
  if (channel === undefined) return null;
  if (channel.card_block_id !== input.blockId) return NOT_YOURS;
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
  );
}
