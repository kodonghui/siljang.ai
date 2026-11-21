import type { ShopDb } from "./shop-scope";

/** SPEC-065 #1. 주문 하나를 잡은 호출자의 트랜잭션 안에서 보관 기록과 삭제 대기를 함께 쓴다. */
export async function purgeOrder(db: ShopDb, orderId: string, now: Date): Promise<number> {
  if (Number.isNaN(now.getTime())) throw new RangeError("invalid purge cutoff");
  const eligible = await db.run<{ draft_id: string | null }>(
    `SELECT draft_id FROM orders WHERE shop_id = $1 AND id = $2
       AND finished_at <= $3::timestamptz - interval '30 days' AND personal_data_purged_at IS NULL
     FOR UPDATE SKIP LOCKED`,
    [orderId, now],
  );
  const order = eligible.rows[0];
  if (order === undefined) return 0;

  await db.run(
    `INSERT INTO kept_records (shop_id, order_id, customer_name, finished_at, contract_keep_until, issue_keep_until, created_at)
     SELECT $1, o.id,
       (SELECT d.customer_name FROM order_details d WHERE d.shop_id = $1 AND d.order_id = $2
          AND d.customer_name IS NOT NULL ORDER BY d.version DESC LIMIT 1),
       o.finished_at, o.finished_at + interval '5 years',
       CASE WHEN EXISTS (SELECT 1 FROM issue_reports ir WHERE ir.shop_id = $1 AND ir.order_id = $2)
            THEN o.finished_at + interval '3 years' END, $3
       FROM orders o WHERE o.shop_id = $1 AND o.id = $2`,
    [orderId, now],
  );
  await db.run(
    `UPDATE order_details SET customer_name = NULL, customer_phone = NULL, allergy_answer = NULL,
       excluded_ingredients = NULL, lettering = NULL, design_notes = NULL WHERE shop_id = $1 AND order_id = $2`,
    [orderId],
  );
  await db.run(
    `UPDATE order_drafts SET customer_name = NULL, customer_phone = NULL, allergy_answer = NULL,
       excluded_ingredients = NULL, lettering = NULL, design_notes = NULL, updated_at = $3
     WHERE shop_id = $1 AND id = $2`,
    [order.draft_id, now],
  );
  await db.run(
    `WITH gone AS (
       DELETE FROM reference_photos WHERE shop_id = $1 AND draft_id = $2 RETURNING storage_key
     )
     INSERT INTO file_deletions (shop_id, storage_key, source, queued_at)
     SELECT $1, storage_key, 'reference_photo', $3 FROM gone ON CONFLICT (storage_key) DO NOTHING`,
    [order.draft_id, now],
  );
  await db.run(
    `UPDATE payment_requests SET depositor_name = NULL, version = version + 1
     WHERE shop_id = $1 AND order_id = $2 AND depositor_name IS NOT NULL`,
    [orderId],
  );
  await db.run(
    `UPDATE refunds SET refund_bank_name = NULL, refund_account_enc = NULL, refund_account_last4 = NULL, refund_holder_name = NULL
     WHERE shop_id = $1 AND order_id = $2
       AND num_nonnulls(refund_bank_name, refund_account_enc, refund_account_last4, refund_holder_name) > 0`,
    [orderId],
  );
  await db.run(
    `UPDATE confirm_cards SET payload = '{}' WHERE shop_id = $1 AND payload <> '{}'
       AND (order_id = $2 OR draft_id = $3)`,
    [orderId, order.draft_id],
  );
  await db.run(
    `UPDATE change_requests SET changes = '{}', lock_version = lock_version + 1
     WHERE shop_id = $1 AND order_id = $2 AND changes <> '{}'`,
    [orderId],
  );
  await db.run(
    `UPDATE owner_tasks t SET detail = NULL WHERE t.shop_id = $1 AND t.detail IS NOT NULL
       AND (t.order_id = $2
         OR t.change_request_id IN (SELECT c.id FROM change_requests c WHERE c.shop_id = $1 AND c.order_id = $2)
         OR t.issue_report_id IN (SELECT i.id FROM issue_reports i WHERE i.shop_id = $1 AND i.order_id = $2)
         OR t.payment_request_id IN (SELECT p.id FROM payment_requests p WHERE p.shop_id = $1 AND p.order_id = $2)
         OR t.refund_id IN (SELECT r.id FROM refunds r WHERE r.shop_id = $1 AND r.order_id = $2))`,
    [orderId],
  );
  await db.run("DELETE FROM notifications WHERE shop_id = $1 AND order_id = $2", [orderId]);
  const result = await db.run(
    `UPDATE orders SET personal_data_purged_at = $3, lock_version = lock_version + 1, updated_at = $3
     WHERE shop_id = $1 AND id = $2`,
    [orderId, now],
  );
  return result.rowCount;
}
