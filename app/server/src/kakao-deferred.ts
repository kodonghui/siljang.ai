import { type ConfirmCardView, readConfirmCardDelivery } from "./confirm-card-store";
import {
  CUSTOMER_NOTICE_WHITESPACE,
  CustomerNoticeTemporarilyUnavailable,
  customerNoticeContents,
  DIFFERENCE_NOTICE_SELECT_SQL,
  READABLE_CUSTOMER_NOTICE_KINDS,
} from "./customer-notice-content";
import { scheduledNoticeMeaningSql, scheduledNoticeReadySql } from "./customer-notice-lifecycle";
import { recordPaymentNoticeDelivery } from "./customer-notice-store";
import { refreshDeferredDayBeforeNotices } from "./day-before-notice";
import type { FieldCrypto } from "./field-crypto";
import {
  inlineKakaoDisclosure,
  type KakaoDisclosurePolicy,
  markKakaoAiDisclosure,
  prependKakaoDisclosure,
} from "./kakao-ai-disclosure";
import { SKILL_CALLBACK_MS } from "./kakao-callback";
import {
  createKakaoAmountConfirmationMerger,
  type KakaoMessageContent,
  kakaoMessageTemplate,
  mergeKakaoAmountConfirmations,
} from "./kakao-message-content";
import { isUuid, type ShopDb, type ShopRequestDb } from "./shop-scope";

/** 새 답 하나의 자리를 남기고 카카오 outputs 세 개 한도 안에서 이전 답을 먼저 전한다. */
export const DEFERRED_REPLY_BATCH = 2;
/** 손님 잠금을 가진 한 응답에서 읽는 메시지 수. 나머지는 전달 표시하지 않는다. */
const MAX_DEFERRED_MESSAGES_SCANNED = 24;

export interface DeferredKakaoMessage {
  readonly id: string;
  readonly text: string;
  readonly source: "message" | "notification";
  readonly card?: ConfirmCardView;
  readonly contents?: readonly KakaoMessageContent[];
  readonly callbackClaim?: DeferredKakaoCallbackClaim;
}

/** 실제 콜백 소비자만 만드는 전송 기한 안의 임시 소유 표지. 손님/AI 입력으로 받지 않는다. */
export interface DeferredKakaoCallbackClaim {
  readonly id: string;
  readonly until: Date;
}

/** 안내 하나는 모두 보낸 뒤에만 전함으로 표시한다. Unicode 글자를 중간에서 자르지 않는다. */
export function deferredKakaoTexts(previous: readonly DeferredKakaoMessage[]): KakaoMessageContent[] {
  return mergeKakaoAmountConfirmations([], previous.flatMap(deferredContents));
}
function deferredContents({ text, card, contents }: DeferredKakaoMessage): readonly KakaoMessageContent[] {
  if (contents !== undefined) return contents;
  if (card !== undefined) return [card];
  const chars = [...text];
  return chars.length <= 1000 ? [text] : [chars.slice(0, 1000).join(""), chars.slice(1000).join("")];
}

/** 손님 행 잠금 또는 그 손님의 콜백 선점을 가진 호출자만 사용한다. */
export interface DeferredKakaoBatch {
  readonly messages: readonly DeferredKakaoMessage[];
  /** 앞선 안내가 남은 출력 수에 들어가지 않아 현재 답도 다음 대화로 남겨야 한다. */
  readonly currentBlocked: boolean;
}
export async function deferredKakaoBatch(
  db: ShopDb,
  customerId: string,
  options: {
    readonly disclosureConsultationId?: string | undefined;
    readonly now?: Date;
    readonly excludeMessageId?: string | undefined;
    /** 현재 결과를 따로 보존할 수 있는 호출자만 세 칸의 주문 카드를 통째로 소비한다. */
    readonly allowFullOrderCard?: boolean;
    readonly fields?: (() => FieldCrypto) | undefined;
    readonly callbackClaim?: DeferredKakaoCallbackClaim;
  } = {},
): Promise<DeferredKakaoBatch> {
  if ((await db.run("SELECT id FROM customers WHERE shop_id=$1 AND id=$2 FOR UPDATE", [customerId])).rowCount === 0)
    return { messages: [], currentBlocked: false };
  const readAt = options.now ?? new Date();
  if (
    options.callbackClaim !== undefined &&
    (!isUuid(options.callbackClaim.id) ||
      !Number.isFinite(options.callbackClaim.until.getTime()) ||
      options.callbackClaim.until <= readAt ||
      options.callbackClaim.until.getTime() > readAt.getTime() + SKILL_CALLBACK_MS)
  )
    throw new RangeError("invalid deferred callback claim");
  if (
    (
      await db.run(
        `SELECT id FROM notifications WHERE shop_id=$1 AND customer_id=$2 AND status='deferred'
    AND sent_at IS NULL AND reply_claim_until>$3 LIMIT 1`,
        [customerId, readAt],
      )
    ).rowCount > 0
  )
    return { messages: [], currentBlocked: true };
  interface MessageRow {
    id: string;
    body_masked: string;
    created_order: string;
    cursor_created_at: string;
    blocked: boolean;
    kind: string;
    trace_id: string | null;
    consultation_id: string;
  }
  const messages: (DeferredKakaoMessage & { readonly at: bigint; readonly blocked: boolean })[] = [];
  let cursor: { createdAt: string; id: string } | undefined;
  let disclosureBlocked = false;
  let scanned = 0,
    scanLimited = false;
  const merger = createKakaoAmountConfirmationMerger();
  // 목록과 참조가 같은 후보 조건을 쓴다. 별칭은 정해진 이름만 받는다.
  const candidateConditions = (
    message: "m" | "candidate_message",
    consultation: "c" | "candidate_consultation",
  ) => `${message}.shop_id = $1 AND ${consultation}.customer_id = $2 AND ${message}.direction = 'outbound'
          AND ${message}.delivery = 'deferred' AND ${message}.sent_at IS NULL AND char_length(${message}.body_masked) BETWEEN 1 AND 1000
          AND (${message}.trace_id IS NULL OR ${message}.trace_id NOT LIKE 'ai-disclosure:%')
          AND ($5::uuid IS NULL OR ${message}.id <> $5)
          AND ($6::timestamptz IS NULL OR (${message}.created_at,${message}.id) > ($6::timestamptz,$7::uuid))
          AND NOT ((${message}.author='ai' OR ${message}.kind='card') AND ${consultation}.ai_disclosed_at IS NULL AND ${consultation}.status IN ('ended','deleted','dropped'))`;
  // 같은 주문의 차액 문맥은 참조 메시지마다 다시 읽지 않는다. 권한·상태·기한은 같은 조회 시점에 대조한다.
  // LATERAL의 OFFSET 0은 후보별 참조 조건을 먼저 적용해, 과거 카드 전체를 앞서 읽는 재배치를 막는다.
  const unreadableDifferenceOrders = `WITH blocked_difference_orders AS MATERIALIZED (
        SELECT oo.shop_id,oo.id,oo.customer_id,oo.consultation_id
        FROM orders oo
        JOIN payment_requests pp ON pp.shop_id=$1 AND pp.order_id=oo.id
        JOIN change_requests cr ON cr.shop_id=$1 AND cr.id=pp.change_request_id AND cr.order_id=oo.id AND cr.status='awaiting_difference'
        JOIN confirm_cards a ON a.shop_id=$1 AND a.id=pp.amount_card_id AND a.order_id=oo.id
          AND a.customer_id=oo.customer_id AND a.order_version=oo.version AND a.kind='amount_confirm'
          AND a.created_at<=$8 AND a.expires_at>$8 AND a.used_at IS NULL
        JOIN customers u ON u.shop_id=$1 AND u.id=oo.customer_id
        JOIN kakao_channels ch ON ch.shop_id=$1 AND ch.id=u.kakao_channel_id AND ch.status='linked' AND nullif(ch.card_block_id,'') IS NOT NULL
        WHERE oo.shop_id=$1 AND oo.customer_id=$2 AND oo.personal_data_purged_at IS NULL AND oo.status='confirmed'
          AND NOT ${DIFFERENCE_NOTICE_SELECT_SQL}
          AND pp.kind='difference' AND pp.status='open' AND pp.needs_amount_confirm AND pp.amount_confirmed_at IS NULL
          AND pp.requested_amount IS NULL AND pp.issued_at<=$8 AND pp.due_cap_at>$8
          AND pp.id=(SELECT latest.id FROM payment_requests latest WHERE latest.shop_id=$1 AND latest.order_id=oo.id
            ORDER BY latest.issued_at DESC,latest.id DESC LIMIT 1)
          AND EXISTS(SELECT 1 FROM notifications n
            WHERE n.shop_id=$1 AND n.order_id=oo.id AND n.customer_id=oo.customer_id
              AND n.consultation_id=oo.consultation_id AND n.kind='payment_request' AND n.status<>'dropped'
              AND n.event_key='notice:'||pp.id::text||':payment_request')
      ), blocked_payment_claims AS MATERIALIZED (
        SELECT matched.customer_id,matched.consultation_id,matched.source_message_id
        FROM messages candidate_message
        JOIN consultations candidate_consultation ON candidate_consultation.shop_id=$1 AND candidate_consultation.id=candidate_message.consultation_id
        CROSS JOIN LATERAL (
          SELECT cc.customer_id,cc.consultation_id,cc.order_id,cc.payload->>'sourceMessageId' AS source_message_id
          FROM confirm_cards cc WHERE cc.shop_id=$1 AND cc.customer_id=$2 AND cc.kind='payment_claim'
            AND cc.consultation_id=candidate_message.consultation_id AND cc.payload->>'sourceMessageId'=candidate_message.trace_id
            AND cc.used_at IS NULL AND cc.created_at<=$8 OFFSET 0
        ) matched
        JOIN blocked_difference_orders bo ON bo.shop_id=$1 AND bo.id=matched.order_id
          AND bo.customer_id=matched.customer_id AND bo.consultation_id=matched.consultation_id
        WHERE candidate_message.shop_id=$1 AND candidate_message.kind='card'
          AND ${candidateConditions("candidate_message", "candidate_consultation")}
      )`;
  // 조회와 한도 뒤 존재 확인이 같은 수신·권한·고지 조건을 쓴다.
  const messageFrom = `FROM messages m
        JOIN consultations c ON c.shop_id = $1 AND c.id = m.consultation_id
        WHERE ${candidateConditions("m", "c")}
          AND (m.kind<>'card' OR c.ai_disclosed_at IS NULL AND c.id IS DISTINCT FROM $4::uuid
            OR ${DIFFERENCE_NOTICE_SELECT_SQL} OR NOT EXISTS (
              SELECT 1 FROM blocked_payment_claims br
              WHERE br.consultation_id=m.consultation_id AND br.customer_id=c.customer_id AND br.source_message_id=m.trace_id
            ))`;
  const messageParams = (limit: number) => [
    customerId,
    limit,
    options.disclosureConsultationId ?? null,
    options.excludeMessageId ?? null,
    cursor?.createdAt ?? null,
    cursor?.id ?? null,
    readAt,
  ];
  // 권한 부족인 참조만 남기고, 출력 예산 뒤의 셋째 정상 메시지까지 읽는다.
  while (
    !disclosureBlocked &&
    merger.contents.length < DEFERRED_REPLY_BATCH + 1 &&
    scanned < MAX_DEFERRED_MESSAGES_SCANNED
  ) {
    const limit = Math.min(DEFERRED_REPLY_BATCH + 1, MAX_DEFERRED_MESSAGES_SCANNED - scanned);
    const result = await db.run<MessageRow>(
      `${unreadableDifferenceOrders} SELECT m.id, m.body_masked, m.kind, m.trace_id, m.consultation_id, m.created_at::text AS cursor_created_at,
        (extract(epoch FROM m.created_at) * 1000000)::bigint::text AS created_order,
        ((m.author='ai' OR m.kind='card') AND c.ai_disclosed_at IS NULL AND c.id IS DISTINCT FROM $4::uuid) AS blocked ${messageFrom}
        ORDER BY m.created_at, m.id LIMIT $3 FOR UPDATE OF m`,
      messageParams(limit),
    );
    const last = result.rows.at(-1);
    if (last === undefined) break;
    cursor = { createdAt: last.cursor_created_at, id: last.id };
    for (const row of result.rows) {
      scanned++;
      if (row.blocked) {
        messages.push({
          id: row.id,
          text: row.body_masked,
          source: "message",
          at: BigInt(row.created_order),
          blocked: true,
        });
        disclosureBlocked = true;
        break;
      }
      let content: Awaited<ReturnType<typeof readConfirmCardDelivery>> | undefined;
      try {
        content =
          row.kind !== "card"
            ? undefined
            : row.trace_id === null
              ? { text: "내용을 다시 확인해 주세요" }
              : await readConfirmCardDelivery(db, {
                  customerId,
                  consultationId: row.consultation_id,
                  sourceMessageId: row.trace_id,
                  now: readAt,
                });
      } catch (error) {
        if (error instanceof CustomerNoticeTemporarilyUnavailable) continue;
        throw error;
      }
      messages.push({
        id: row.id,
        text: content?.text ?? row.body_masked,
        ...(content?.card === undefined ? {} : { card: content.card }),
        ...(content?.contents === undefined ? {} : { contents: content.contents }),
        source: "message",
        at: BigInt(row.created_order),
        blocked: row.blocked,
      });
      const message = messages.at(-1);
      if (message !== undefined) merger.append(deferredContents(message));
      if (merger.contents.length >= DEFERRED_REPLY_BATCH + 1) break;
    }
    scanLimited = scanned >= MAX_DEFERRED_MESSAGES_SCANNED && result.rows.length === limit;
    if (result.rows.length < limit) break;
  }
  if (scanLimited && !disclosureBlocked && merger.contents.length < DEFERRED_REPLY_BATCH + 1) {
    // 다음 카드의 본문/표시는 읽지 않고 다음 대상 행의 존재만 확인한다.
    const next = await db.run<{ pending: boolean }>(
      `${unreadableDifferenceOrders} SELECT EXISTS(SELECT 1 ${messageFrom} LIMIT $3) AS pending`,
      messageParams(1),
    );
    scanLimited = next.rows[0]?.pending === true;
  }
  // 결제 안내는 표시 자료를 늦게 만들고 실제 전달 표시와 같은 트랜잭션에서 시계를 시작한다.
  await db.run(
    `UPDATE notifications n SET status='dropped',next_attempt_at=NULL,reply_claim_id=NULL,reply_claim_until=NULL FROM orders o
      WHERE n.shop_id=$1 AND n.customer_id=$2 AND n.status='deferred' AND n.kind='order_confirmed'
        AND o.shop_id=$1 AND o.id=n.order_id
        AND (n.reply_claim_until IS NULL OR n.reply_claim_until<=$3)
        AND (o.status NOT IN ('confirmed','received','no_pickup') OR o.customer_id<>n.customer_id OR o.personal_data_purged_at IS NOT NULL)`,
    [customerId, readAt],
  );
  // 선점 때문에 캘린더 저장 때 건너뛴 미발송 안내를 현재 설정으로 복구한 뒤 폐기 여부를 본다.
  await refreshDeferredDayBeforeNotices(db, customerId, readAt);
  // 현재 의미가 없어진 예약만 닫는다. 미래 예약이나 보낼 시간 밖의 유효한 예약은 보존한다.
  await db.run(
    `UPDATE notifications n SET status='dropped',next_attempt_at=NULL,reply_claim_id=NULL,reply_claim_until=NULL FROM shops s
      WHERE n.shop_id=$1 AND n.customer_id=$2 AND n.status='deferred' AND n.sent_at IS NULL
        AND n.kind IN ('day_before','review_request') AND s.id=$1
        AND (n.reply_claim_until IS NULL OR n.reply_claim_until<=$3)
        AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.shop_id=$1 AND o.id=n.order_id
          AND o.personal_data_purged_at IS NULL AND ${scheduledNoticeMeaningSql(3)})`,
    [customerId, options.now ?? new Date()],
  );
  // 표시할 본문이 없는 일반 안내는 닫는다. 결제 안내는 표시 자료를 따로 읽으므로 본문으로 판단하지 않는다.
  await db.run(
    `UPDATE notifications SET status='dropped',next_attempt_at=NULL,reply_claim_id=NULL,reply_claim_until=NULL
      WHERE shop_id=$1 AND customer_id=$2 AND status='deferred' AND sent_at IS NULL
        AND kind=ANY($3::text[]) AND kind<>'payment_request' AND btrim(body,$4::text)=''
        AND (reply_claim_until IS NULL OR reply_claim_until<=$5)`,
    [customerId, READABLE_CUSTOMER_NOTICE_KINDS, CUSTOMER_NOTICE_WHITESPACE, readAt],
  );
  // 새 열이 필요한 유효한 차액만 뒤로 두어 정상 안내의 셋째 행까지 읽는다.
  const notices = await db.run<{ id: string; body: string; kind: string; created_order: string }>(
    `SELECT n.id, n.body,n.kind, (extract(epoch FROM n.created_at) * 1000000)::bigint::text AS created_order FROM notifications n
      JOIN consultations c ON c.shop_id=$1 AND c.id=n.consultation_id AND c.customer_id=n.customer_id
      JOIN shops s ON s.id=$1
      LEFT JOIN orders o ON o.shop_id=$1 AND o.id=n.order_id
      WHERE n.shop_id = $1 AND n.customer_id = $2 AND n.status = 'deferred' AND n.sent_at IS NULL
        AND (n.reply_claim_until IS NULL OR n.reply_claim_until<=$5)
        AND n.kind=ANY($4::text[]) AND c.status<>'deleted' AND o.personal_data_purged_at IS NULL
        AND (n.scheduled_for IS NULL OR n.scheduled_for<=$5)
        AND (n.order_id IS NULL OR o.customer_id=n.customer_id)
        AND (n.kind<>'order_confirmed' OR o.status IN ('confirmed','received','no_pickup'))
        AND ${scheduledNoticeMeaningSql(5)} AND ${scheduledNoticeReadySql(5)}
      ORDER BY CASE WHEN ${DIFFERENCE_NOTICE_SELECT_SQL} THEN false ELSE (n.kind='payment_request' AND EXISTS(
        SELECT 1 FROM payment_requests pp
        JOIN change_requests cr ON cr.shop_id=$1 AND cr.id=pp.change_request_id AND cr.order_id=pp.order_id
        JOIN confirm_cards k ON k.shop_id=$1 AND k.id=pp.amount_card_id AND k.order_id=pp.order_id
          AND k.customer_id=n.customer_id AND k.order_version=o.version AND k.kind='amount_confirm'
        JOIN customers u ON u.shop_id=$1 AND u.id=k.customer_id
        JOIN kakao_channels ch ON ch.shop_id=$1 AND ch.id=u.kakao_channel_id AND ch.status='linked'
        WHERE pp.shop_id=$1 AND pp.order_id=n.order_id AND n.event_key='notice:'||pp.id::text||':payment_request'
          AND pp.kind='difference' AND pp.status='open' AND pp.needs_amount_confirm AND pp.amount_confirmed_at IS NULL
          AND pp.issued_at<=$5 AND pp.due_cap_at>$5 AND o.status='confirmed' AND cr.status='awaiting_difference'
          AND k.created_at<=$5 AND k.expires_at>$5 AND k.used_at IS NULL AND nullif(ch.card_block_id,'') IS NOT NULL
      )) END, n.created_at, n.id LIMIT $3 FOR UPDATE OF n`,
    [customerId, DEFERRED_REPLY_BATCH + 1, READABLE_CUSTOMER_NOTICE_KINDS, options.now ?? new Date()],
  );
  for (const row of notices.rows) {
    let contents: readonly KakaoMessageContent[] | null;
    try {
      contents = await customerNoticeContents(
        db,
        { id: row.id, customerId, kind: row.kind, body: row.body },
        options.now ?? new Date(),
        options.fields,
      );
    } catch (error) {
      if (!(error instanceof CustomerNoticeTemporarilyUnavailable)) throw error;
      // 이 안내는 전달 표시하지 않는다. 다른 주문의 정상 안내는 계속 고른다.
      continue;
    }
    messages.push({
      id: row.id,
      text: row.body,
      source: "notification",
      at: BigInt(row.created_order),
      blocked: contents === null,
      ...(contents === null ? {} : { contents }),
    });
  }
  const candidates = messages.sort(
    (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0) || a.id.localeCompare(b.id) || a.source.localeCompare(b.source),
  );
  const selected: DeferredKakaoMessage[] = [];
  merger.reset();
  let remaining = DEFERRED_REPLY_BATCH;
  for (const row of candidates) {
    if (row.blocked) break;
    const before = merger.contents.length;
    const slots = merger.append(deferredContents(row)) - before;
    if (slots === 3 && selected.length === 0 && options.allowFullOrderCard && !options.disclosureConsultationId)
      remaining = 3;
    if (slots > remaining) break;
    if (row.source === "notification" && options.callbackClaim !== undefined) {
      const claimed = await db.run(
        `UPDATE notifications SET reply_claim_id=$4,reply_claim_until=$5
        WHERE shop_id=$1 AND id=$2 AND customer_id=$3 AND status='deferred' AND sent_at IS NULL
          AND (reply_claim_until IS NULL OR reply_claim_until<=$6)`,
        [row.id, customerId, options.callbackClaim.id, options.callbackClaim.until, readAt],
      );
      if (claimed.rowCount !== 1) throw new Error("deferred notification claim changed");
    }
    selected.push({
      id: row.id,
      text: row.text,
      source: row.source,
      ...(row.source === "notification" && options.callbackClaim !== undefined
        ? { callbackClaim: options.callbackClaim }
        : {}),
      ...("card" in row && row.card !== undefined ? { card: row.card } : {}),
      ...(row.contents === undefined ? {} : { contents: row.contents }),
    });
    remaining -= slots;
  }
  // 출력 영역을 모두 쓴 뒤에도 앞선 안내가 남았는지 확인해 새 답의 순서 역전을 막는다.
  const next = candidates[selected.length];
  return { messages: selected, currentBlocked: scanLimited || (next !== undefined && !next.blocked) };
}

/** 기존 조회 호출자는 선택한 메시지 배열만 받는다. 발신 호출자는 batch의 대기 표시도 사용한다. */
export async function deferredKakaoMessages(
  db: ShopDb,
  customerId: string,
  options: Parameters<typeof deferredKakaoBatch>[2] = {},
): Promise<readonly DeferredKakaoMessage[]> {
  return (await deferredKakaoBatch(db, customerId, options)).messages;
}

/** 자기 임시 선점만 해제한다. 본문이나 전달 결과는 고치지 않는다. */
export async function releaseDeferredKakaoClaim(
  db: ShopDb,
  customerId: string,
  claim: DeferredKakaoCallbackClaim,
): Promise<void> {
  await db.run(
    `UPDATE notifications SET reply_claim_id=NULL,reply_claim_until=NULL
    WHERE shop_id=$1 AND customer_id=$2 AND reply_claim_id=$3 AND reply_claim_until=$4`,
    [customerId, claim.id, claim.until],
  );
}

/** 매 HTTP 시도 직전에 동일 선점·본문과 현재 예약 의미를 다시 확인한다. 실패하면 발신하지 않는다. */
export async function validateDeferredKakaoCallback(
  db: ShopDb,
  customerId: string,
  previous: readonly DeferredKakaoMessage[],
  claim: DeferredKakaoCallbackClaim,
  at: Date,
): Promise<boolean> {
  if (claim.until <= at) return false;
  for (const row of previous) {
    if (row.source !== "notification") continue;
    if (row.callbackClaim?.id !== claim.id || row.callbackClaim.until.getTime() !== claim.until.getTime()) return false;
    const valid = await db.run(
      `SELECT n.id FROM notifications n
      JOIN consultations c ON c.shop_id=$1 AND c.id=n.consultation_id AND c.customer_id=n.customer_id
      JOIN shops s ON s.id=$1 LEFT JOIN orders o ON o.shop_id=$1 AND o.id=n.order_id
      WHERE n.shop_id=$1 AND n.customer_id=$2 AND n.id=$3 AND n.body=$4 AND n.status='deferred' AND n.sent_at IS NULL
        AND n.reply_claim_id=$6 AND n.reply_claim_until=$7 AND n.reply_claim_until>$5
        AND n.kind=ANY($8::text[]) AND c.status<>'deleted' AND o.personal_data_purged_at IS NULL
        AND (n.order_id IS NULL OR o.customer_id=n.customer_id)
        AND (n.kind<>'order_confirmed' OR o.status IN ('confirmed','received','no_pickup'))
        AND (n.scheduled_for IS NULL OR n.scheduled_for<=$5)
        AND ${scheduledNoticeMeaningSql(5)} AND ${scheduledNoticeReadySql(5)}`,
      [customerId, row.id, row.text, at, claim.id, claim.until, READABLE_CUSTOMER_NOTICE_KINDS],
    );
    if (valid.rowCount !== 1) return false;
  }
  return true;
}

/** 발신 성공/응답 생성의 트랜잭션 안에서만 이전 답의 전달 표시를 바꾼다. */
export async function markDeferredKakaoMessages(
  db: ShopDb,
  customerId: string,
  previous: readonly DeferredKakaoMessage[],
  at: Date,
): Promise<void> {
  for (const row of previous) {
    if (row.source === "notification") {
      const marked = await db.run(
        `UPDATE notifications SET status = 'delivered_on_reply', sent_at = $4,reply_claim_id=NULL,reply_claim_until=NULL
          WHERE shop_id = $1 AND id = $2 AND customer_id = $3 AND status = 'deferred' AND sent_at IS NULL
            AND body = $5 AND kind=ANY($6::text[])
            AND (($7::uuid IS NULL AND (reply_claim_until IS NULL OR reply_claim_until<=$4))
              OR (reply_claim_id=$7 AND reply_claim_until=$8 AND reply_claim_until>$4))`,
        [
          row.id,
          customerId,
          at,
          row.text,
          READABLE_CUSTOMER_NOTICE_KINDS,
          row.callbackClaim?.id ?? null,
          row.callbackClaim?.until ?? null,
        ],
      );
      if (marked.rowCount !== 1) throw new Error("deferred notification changed before delivery");
      await recordPaymentNoticeDelivery(db, row.id, customerId, at);
      continue;
    }
    await db.run(
      `UPDATE messages m SET delivery = 'delivered_later', sent_at = $4
        FROM consultations c
        WHERE m.shop_id = $1 AND c.shop_id = $1 AND m.consultation_id = c.id
          AND m.id = $2 AND c.customer_id = $3 AND m.delivery = 'deferred'`,
      [row.id, customerId, at],
    );
  }
}

/** 세 칸의 규정/카드는 원자적으로 먼저 전하고 현재 안내의 전달 여부를 돌려준다. */
export function renderDeferredKakaoReply(
  texts: readonly KakaoMessageContent[],
  render: (previous: readonly KakaoMessageContent[]) => Response,
  currentBlocked = false,
): { response: Response; currentIncluded: boolean } {
  if (texts.length !== 3 && !currentBlocked) return { response: render(texts), currentIncluded: true };
  const base = render([]);
  return {
    response: new Response(
      JSON.stringify({ version: "2.0", template: kakaoMessageTemplate(texts.length ? texts : ["다시 눌러 주세요"]) }),
      {
        status: base.status,
        headers: base.headers,
      },
    ),
    currentIncluded: false,
  };
}
/** HTTP 응답 생성과 전달 표시를 같은 트랜잭션으로 묶는다. 바깥 서비스는 이 안에서 부르지 않는다. */
export async function replyWithDeferredKakaoMessages(
  db: ShopRequestDb,
  customerId: string,
  now: Date,
  render: (previous: readonly KakaoMessageContent[]) => Response,
  consultationId?: string,
  policy?: KakaoDisclosurePolicy,
  fields?: () => FieldCrypto,
): Promise<Response> {
  return db.transaction(async (tx) => {
    const customer = await tx.run("SELECT id FROM customers WHERE shop_id = $1 AND id = $2 FOR UPDATE", [customerId]);
    if (customer.rowCount === 0) return render([]);
    const active = await tx.run(
      `SELECT m.id FROM messages m
        JOIN consultations c ON c.shop_id = $1 AND c.id = m.consultation_id
        WHERE m.shop_id = $1 AND c.customer_id = $2 AND m.kakao_callback_claim_until > $3 LIMIT 1`,
      [customerId, now],
    );
    if (active.rowCount > 0) return render([]);
    const disclosure =
      consultationId === undefined ? undefined : await inlineKakaoDisclosure(tx, consultationId, customerId, policy);
    const pending = await deferredKakaoBatch(tx, customerId, {
      disclosureConsultationId: disclosure?.consultationId,
      now,
      allowFullOrderCard: true,
      fields,
    });
    const texts = deferredKakaoTexts(pending.messages);
    const rendered = renderDeferredKakaoReply(texts, render, pending.currentBlocked);
    const { response } = await prependKakaoDisclosure(rendered.response, disclosure);
    if (disclosure !== undefined)
      await markKakaoAiDisclosure(
        tx,
        { consultation_id: disclosure.consultationId, customer_id: customerId },
        disclosure,
        now,
        "skill_response",
      );
    await markDeferredKakaoMessages(tx, customerId, pending.messages, now);
    return response;
  });
}
