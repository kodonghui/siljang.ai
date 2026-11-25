import { type ConfirmCardView, readConfirmCardDelivery } from "./confirm-card-store";
import { customerNoticeContents, READABLE_CUSTOMER_NOTICE_KINDS } from "./customer-notice-content";
import { recordPaymentNoticeDelivery } from "./customer-notice-store";
import type { FieldCrypto } from "./field-crypto";
import {
  inlineKakaoDisclosure,
  type KakaoDisclosurePolicy,
  markKakaoAiDisclosure,
  prependKakaoDisclosure,
} from "./kakao-ai-disclosure";
import { expandKakaoMessageContents, type KakaoMessageContent, kakaoMessageOutputs } from "./kakao-message-content";
import type { ShopDb, ShopRequestDb } from "./shop-scope";

/** 새 답 하나의 자리를 남기고 카카오 outputs 세 개 한도 안에서 이전 답을 먼저 전한다. */
export const DEFERRED_REPLY_BATCH = 2;

export interface DeferredKakaoMessage {
  readonly id: string;
  readonly text: string;
  readonly source: "message" | "notification";
  readonly card?: ConfirmCardView;
  readonly contents?: readonly KakaoMessageContent[];
}

/** 안내 하나는 모두 보낸 뒤에만 전함으로 표시한다. Unicode 글자를 중간에서 자르지 않는다. */
export function deferredKakaoTexts(previous: readonly DeferredKakaoMessage[]): KakaoMessageContent[] {
  return previous.flatMap<KakaoMessageContent>(({ text, card, contents }) => {
    if (contents !== undefined) return expandKakaoMessageContents(contents);
    if (card !== undefined) return expandKakaoMessageContents([card]);
    const chars = [...text];
    return chars.length <= 1000 ? [text] : [chars.slice(0, 1000).join(""), chars.slice(1000).join("")];
  });
}

/** 손님 행 잠금 또는 그 손님의 콜백 선점을 가진 호출자만 사용한다. */
export async function deferredKakaoMessages(
  db: ShopDb,
  customerId: string,
  options: {
    readonly disclosureConsultationId?: string | undefined;
    readonly now?: Date;
    readonly excludeMessageId?: string | undefined;
    /** 현재 결과를 따로 보존할 수 있는 호출자만 세 칸의 주문 카드를 통째로 소비한다. */
    readonly allowFullOrderCard?: boolean;
    readonly fields?: (() => FieldCrypto) | undefined;
  } = {},
): Promise<readonly DeferredKakaoMessage[]> {
  if ((await db.run("SELECT id FROM customers WHERE shop_id=$1 AND id=$2 FOR UPDATE", [customerId])).rowCount === 0)
    return [];
  const result = await db.run<{
    id: string;
    body_masked: string;
    created_order: string;
    blocked: boolean;
    kind: string;
    trace_id: string | null;
    consultation_id: string;
  }>(
    `SELECT m.id, m.body_masked, m.kind, m.trace_id, m.consultation_id, (extract(epoch FROM m.created_at) * 1000000)::bigint::text AS created_order,
      ((m.author='ai' OR m.kind='card') AND c.ai_disclosed_at IS NULL AND c.id IS DISTINCT FROM $4::uuid) AS blocked FROM messages m
      JOIN consultations c ON c.shop_id = $1 AND c.id = m.consultation_id
      WHERE m.shop_id = $1 AND c.customer_id = $2 AND m.direction = 'outbound'
        AND m.delivery = 'deferred' AND m.sent_at IS NULL AND char_length(m.body_masked) BETWEEN 1 AND 1000
        AND (m.trace_id IS NULL OR m.trace_id NOT LIKE 'ai-disclosure:%')
        AND ($5::uuid IS NULL OR m.id <> $5)
        AND NOT ((m.author='ai' OR m.kind='card') AND c.ai_disclosed_at IS NULL AND c.status IN ('ended','deleted','dropped'))
      ORDER BY m.created_at, m.id LIMIT $3 FOR UPDATE OF m`,
    [customerId, DEFERRED_REPLY_BATCH, options.disclosureConsultationId ?? null, options.excludeMessageId ?? null],
  );
  const messages: (DeferredKakaoMessage & { readonly at: bigint; readonly blocked: boolean })[] = [];
  for (const row of result.rows) {
    const content =
      row.kind !== "card"
        ? undefined
        : row.trace_id === null
          ? { text: "내용을 다시 확인해 주세요" }
          : await readConfirmCardDelivery(db, {
              customerId,
              consultationId: row.consultation_id,
              sourceMessageId: row.trace_id,
              now: options.now ?? new Date(),
            });
    messages.push({
      id: row.id,
      text: content?.text ?? row.body_masked,
      ...(content?.card === undefined ? {} : { card: content.card }),
      source: "message",
      at: BigInt(row.created_order),
      blocked: row.blocked,
    });
  }
  // 결제 안내는 표시 자료를 늦게 만들고 실제 전달 표시와 같은 트랜잭션에서 시계를 시작한다.
  await db.run(
    `UPDATE notifications n SET status='dropped',next_attempt_at=NULL FROM orders o
      WHERE n.shop_id=$1 AND n.customer_id=$2 AND n.status='deferred' AND n.kind='order_confirmed'
        AND o.shop_id=$1 AND o.id=n.order_id
        AND (o.status NOT IN ('confirmed','received','no_pickup') OR o.customer_id<>n.customer_id OR o.personal_data_purged_at IS NOT NULL)`,
    [customerId],
  );
  const notices = await db.run<{ id: string; body: string; kind: string; created_order: string }>(
    `SELECT n.id, n.body,n.kind, (extract(epoch FROM n.created_at) * 1000000)::bigint::text AS created_order FROM notifications n
      JOIN consultations c ON c.shop_id=$1 AND c.id=n.consultation_id AND c.customer_id=n.customer_id
      LEFT JOIN orders o ON o.shop_id=$1 AND o.id=n.order_id
      WHERE n.shop_id = $1 AND n.customer_id = $2 AND n.status = 'deferred' AND n.sent_at IS NULL
        AND n.kind=ANY($4::text[]) AND c.status<>'deleted' AND o.personal_data_purged_at IS NULL
        AND (n.scheduled_for IS NULL OR n.scheduled_for<=$5)
        AND (n.order_id IS NULL OR o.customer_id=n.customer_id)
        AND (n.kind<>'order_confirmed' OR o.status IN ('confirmed','received','no_pickup'))
      ORDER BY n.created_at, n.id LIMIT $3 FOR UPDATE OF n`,
    [customerId, DEFERRED_REPLY_BATCH, READABLE_CUSTOMER_NOTICE_KINDS, options.now ?? new Date()],
  );
  for (const row of notices.rows) {
    const contents = await customerNoticeContents(
      db,
      { id: row.id, customerId, kind: row.kind, body: row.body },
      options.now ?? new Date(),
      options.fields,
    );
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
  let remaining = DEFERRED_REPLY_BATCH;
  for (const row of candidates) {
    if (row.blocked) break;
    const slots =
      row.contents !== undefined
        ? expandKakaoMessageContents(row.contents).length
        : row.card !== undefined
          ? expandKakaoMessageContents([row.card]).length
          : Math.ceil([...row.text].length / 1000);
    if (slots === 3 && selected.length === 0 && options.allowFullOrderCard && !options.disclosureConsultationId)
      remaining = 3;
    if (slots > remaining) break;
    selected.push({
      id: row.id,
      text: row.text,
      source: row.source,
      ...("card" in row && row.card !== undefined ? { card: row.card } : {}),
      ...(row.contents === undefined ? {} : { contents: row.contents }),
    });
    remaining -= slots;
    if (remaining === 0) break;
  }
  return selected;
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
        `UPDATE notifications SET status = 'delivered_on_reply', sent_at = $4
          WHERE shop_id = $1 AND id = $2 AND customer_id = $3 AND status = 'deferred' AND sent_at IS NULL
            AND body = $5 AND kind=ANY($6::text[])`,
        [row.id, customerId, at, row.text, READABLE_CUSTOMER_NOTICE_KINDS],
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
): { response: Response; currentIncluded: boolean } {
  if (texts.length !== 3) return { response: render(texts), currentIncluded: true };
  const base = render([]);
  return {
    response: new Response(JSON.stringify({ version: "2.0", template: { outputs: kakaoMessageOutputs(texts) } }), {
      status: base.status,
      headers: base.headers,
    }),
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
    const pending = await deferredKakaoMessages(tx, customerId, {
      disclosureConsultationId: disclosure?.consultationId,
      now,
      allowFullOrderCard: true,
      fields,
    });
    const texts = deferredKakaoTexts(pending);
    const rendered = renderDeferredKakaoReply(texts, render);
    const { response } = await prependKakaoDisclosure(rendered.response, disclosure);
    if (disclosure !== undefined)
      await markKakaoAiDisclosure(
        tx,
        { consultation_id: disclosure.consultationId, customer_id: customerId },
        disclosure,
        now,
        "skill_response",
      );
    await markDeferredKakaoMessages(tx, customerId, pending, now);
    return response;
  });
}
