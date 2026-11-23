import {
  inlineKakaoDisclosure,
  type KakaoDisclosurePolicy,
  markKakaoAiDisclosure,
  prependKakaoDisclosure,
} from "./kakao-ai-disclosure";
import type { ShopDb, ShopRequestDb } from "./shop-scope";

/** 새 답 하나의 자리를 남기고 카카오 outputs 세 개 한도 안에서 이전 답을 먼저 전한다. */
export const DEFERRED_REPLY_BATCH = 2;

export interface DeferredKakaoMessage {
  readonly id: string;
  readonly text: string;
  readonly source: "message" | "notification";
}

/** 안내 하나는 모두 보낸 뒤에만 전함으로 표시한다. Unicode 글자를 중간에서 자르지 않는다. */
export function deferredKakaoTexts(previous: readonly DeferredKakaoMessage[]): string[] {
  return previous.flatMap(({ text }) => {
    const chars = [...text];
    return chars.length <= 1000 ? [text] : [chars.slice(0, 1000).join(""), chars.slice(1000).join("")];
  });
}

/** 손님 행 잠금 또는 그 손님의 콜백 선점을 가진 호출자만 사용한다. */
export async function deferredKakaoMessages(
  db: ShopDb,
  customerId: string,
  options: { readonly disclosureConsultationId?: string | undefined } = {},
): Promise<readonly DeferredKakaoMessage[]> {
  const result = await db.run<{ id: string; body_masked: string; created_order: string; blocked: boolean }>(
    `SELECT m.id, m.body_masked, (extract(epoch FROM m.created_at) * 1000000)::bigint::text AS created_order,
      (m.author='ai' AND c.ai_disclosed_at IS NULL AND c.id IS DISTINCT FROM $4::uuid) AS blocked FROM messages m
      JOIN consultations c ON c.shop_id = $1 AND c.id = m.consultation_id
      WHERE m.shop_id = $1 AND c.customer_id = $2 AND m.direction = 'outbound'
        AND m.delivery = 'deferred' AND m.sent_at IS NULL AND char_length(m.body_masked) BETWEEN 1 AND 1000
        AND (m.trace_id IS NULL OR m.trace_id NOT LIKE 'ai-disclosure:%')
        AND NOT (m.author='ai' AND c.ai_disclosed_at IS NULL AND c.status IN ('ended','deleted'))
      ORDER BY m.created_at, m.id LIMIT $3 FOR UPDATE OF m`,
    [customerId, DEFERRED_REPLY_BATCH, options.disclosureConsultationId ?? null],
  );
  // 결제/버튼/사진 안내는 업무 렌더러가 전해진 시각 등도 함께 기록해야 하므로 이 공통 글 경로에서 소비하지 않는다.
  const notices = await db.run<{ id: string; body: string; created_order: string }>(
    `SELECT n.id, n.body, (extract(epoch FROM n.created_at) * 1000000)::bigint::text AS created_order FROM notifications n
      WHERE n.shop_id = $1 AND n.customer_id = $2 AND n.status = 'deferred' AND n.sent_at IS NULL
        AND n.kind IN ('owner_reply', 'delay_notice', 'custom_rejected', 'no_answer_closed')
      ORDER BY n.created_at, n.id LIMIT $3 FOR UPDATE OF n`,
    [customerId, DEFERRED_REPLY_BATCH],
  );
  const candidates = [
    ...result.rows.map((row) => ({
      id: row.id,
      text: row.body_masked,
      source: "message" as const,
      at: BigInt(row.created_order),
      blocked: row.blocked,
    })),
    ...notices.rows.map((row) => ({
      id: row.id,
      text: row.body,
      source: "notification" as const,
      at: BigInt(row.created_order),
      blocked: false,
    })),
  ].sort(
    (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0) || a.id.localeCompare(b.id) || a.source.localeCompare(b.source),
  );
  const selected: DeferredKakaoMessage[] = [];
  let remaining = DEFERRED_REPLY_BATCH;
  for (const row of candidates) {
    if (row.blocked) break;
    const slots = Math.ceil([...row.text].length / 1000);
    if (slots > remaining) break;
    selected.push({ id: row.id, text: row.text, source: row.source });
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
            AND body = $5 AND kind IN ('owner_reply', 'delay_notice', 'custom_rejected', 'no_answer_closed')`,
        [row.id, customerId, at, row.text],
      );
      if (marked.rowCount !== 1) throw new Error("deferred notification changed before delivery");
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

/** HTTP 응답 생성과 전달 표시를 같은 트랜잭션으로 묶는다. 바깥 서비스는 이 안에서 부르지 않는다. */
export async function replyWithDeferredKakaoMessages(
  db: ShopRequestDb,
  customerId: string,
  now: Date,
  render: (previous: readonly string[]) => Response,
  consultationId?: string,
  policy?: KakaoDisclosurePolicy,
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
    });
    const { response } = await prependKakaoDisclosure(render(deferredKakaoTexts(pending)), disclosure);
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
