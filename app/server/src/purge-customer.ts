import type { ShopDb } from "./shop-scope";

/** SPEC-065·REQ-190: 상담이 모두 지워지고 모든 주문이 보관된 손님의 채널 키만 비운다. */
export async function purgeCustomerKey(db: ShopDb, id: string, now: Date): Promise<number> {
  if (Number.isNaN(now.getTime())) throw new RangeError("invalid purge cutoff");
  const eligible = await db.run(
    `SELECT u.id FROM customers u WHERE u.shop_id = $1 AND u.id = $2 AND u.kakao_user_key IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM consultations c
         WHERE c.shop_id = $1 AND c.customer_id = u.id AND c.status <> 'deleted')
       AND NOT EXISTS (SELECT 1 FROM orders o
         WHERE o.shop_id = $1 AND o.customer_id = u.id AND o.personal_data_purged_at IS NULL)
     FOR UPDATE SKIP LOCKED`,
    [id],
  );
  if (eligible.rowCount === 0) return 0;
  const result = await db.run(
    "UPDATE customers SET kakao_user_key = NULL, purged_at = $3 WHERE shop_id = $1 AND id = $2 AND kakao_user_key IS NOT NULL",
    [id, now],
  );
  return result.rowCount;
}
