import type { ShopDb, ShopRequestDb } from "./shop-scope";

/** 새 답 하나의 자리를 남기고 카카오 outputs 세 개 한도 안에서 이전 답을 먼저 전한다. */
export const DEFERRED_REPLY_BATCH = 2;

export interface DeferredKakaoMessage {
  readonly id: string;
  readonly text: string;
}

/** 손님 행 잠금 또는 그 손님의 콜백 선점을 가진 호출자만 사용한다. */
export async function deferredKakaoMessages(db: ShopDb, customerId: string): Promise<readonly DeferredKakaoMessage[]> {
  const result = await db.run<{ id: string; body_masked: string }>(
    `SELECT m.id, m.body_masked FROM messages m
      JOIN consultations c ON c.shop_id = $1 AND c.id = m.consultation_id
      WHERE m.shop_id = $1 AND c.customer_id = $2 AND m.direction = 'outbound'
        AND m.delivery = 'deferred' AND m.sent_at IS NULL AND char_length(m.body_masked) BETWEEN 1 AND 1000
      ORDER BY m.created_at, m.id LIMIT $3 FOR UPDATE OF m`,
    [customerId, DEFERRED_REPLY_BATCH],
  );
  return result.rows.map((row) => ({ id: row.id, text: row.body_masked }));
}

/** 발신 성공/응답 생성의 트랜잭션 안에서만 이전 답의 전달 표시를 바꾼다. */
export async function markDeferredKakaoMessages(
  db: ShopDb,
  customerId: string,
  previous: readonly DeferredKakaoMessage[],
  at: Date,
): Promise<void> {
  for (const row of previous)
    await db.run(
      `UPDATE messages m SET delivery = 'delivered_later', sent_at = $4
        FROM consultations c
        WHERE m.shop_id = $1 AND c.shop_id = $1 AND m.consultation_id = c.id
          AND m.id = $2 AND c.customer_id = $3 AND m.delivery = 'deferred'`,
      [row.id, customerId, at],
    );
}

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
    const pending = await deferredKakaoMessages(tx, customerId);
    const response = render(pending.map((row) => row.text));
    await markDeferredKakaoMessages(tx, customerId, pending, now);
    return response;
  });
}
