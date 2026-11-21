import type { ShopRequestDb } from "./shop-scope";

/** 새 답 하나의 자리를 남기고 카카오 outputs 세 개 한도 안에서 이전 답을 먼저 전한다. */
export const DEFERRED_REPLY_BATCH = 2;

/** HTTP 응답 생성과 전달 표시를 같은 트랜잭션으로 묶는다. 바깥 서비스는 이 안에서 부르지 않는다. */
export async function replyWithDeferredKakaoMessages(
  db: ShopRequestDb,
  customerId: string,
  now: Date,
  render: (previous: readonly string[]) => Response,
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
    const pending = await tx.run<{ id: string; body_masked: string }>(
      `SELECT m.id, m.body_masked FROM messages m
        JOIN consultations c ON c.shop_id = $1 AND c.id = m.consultation_id
        WHERE m.shop_id = $1 AND c.customer_id = $2 AND m.direction = 'outbound'
          AND m.delivery = 'deferred' AND m.sent_at IS NULL AND char_length(m.body_masked) BETWEEN 1 AND 1000
        ORDER BY m.created_at, m.id LIMIT $3 FOR UPDATE OF m`,
      [customerId, DEFERRED_REPLY_BATCH],
    );
    const response = render(pending.rows.map((row) => row.body_masked));
    for (const row of pending.rows)
      await tx.run(
        "UPDATE messages SET delivery = 'delivered_later', sent_at = $3 WHERE shop_id = $1 AND id = $2 AND delivery = 'deferred'",
        [row.id, now],
      );
    return response;
  });
}
