import type { ShopDb } from "./shop-scope";

/** SPEC-065: 3년 지난 신고의 개인정보만 지우고 신고·보상·금액과 5년 보관 이름은 남긴다. */
export async function purgeKeptIssue(db: ShopDb, id: string, now: Date): Promise<number> {
  if (Number.isNaN(now.getTime())) throw new RangeError("invalid purge cutoff");
  const eligible = await db.run<{ order_id: string }>(
    `SELECT order_id FROM kept_records WHERE shop_id = $1 AND id = $2
       AND issue_keep_until <= $3 AND issue_purged_at IS NULL FOR UPDATE SKIP LOCKED`,
    [id, now],
  );
  const kept = eligible.rows[0];
  if (kept === undefined) return 0;
  await db.run(
    `WITH gone AS (DELETE FROM issue_photos WHERE shop_id = $1 AND issue_details_id IN (
       SELECT i.id FROM issue_details i WHERE i.shop_id = $1 AND i.order_id = $2 AND i.status = 'reported')
       RETURNING storage_key)
     INSERT INTO file_deletions (shop_id, storage_key, source, queued_at)
     SELECT $1, storage_key, 'issue_photo', $3 FROM gone ON CONFLICT (storage_key) DO NOTHING`,
    [kept.order_id, now],
  );
  await db.run(
    `UPDATE issue_details SET description = NULL, content_purged_at = $3, updated_at = $3
     WHERE shop_id = $1 AND order_id = $2 AND status = 'reported'`,
    [kept.order_id, now],
  );
  await db.run(
    `UPDATE issue_reports SET no_compensation_reason = NULL, other_compensation_note = NULL, notes_purged_at = $3
     WHERE shop_id = $1 AND order_id = $2 AND notes_purged_at IS NULL`,
    [kept.order_id, now],
  );
  const result = await db.run("UPDATE kept_records SET issue_purged_at = $3 WHERE shop_id = $1 AND id = $2", [id, now]);
  return result.rowCount;
}

/** 신고 기한의 처리를 마친 뒤 5년 지난 이름을 지운다. 신고 기한 표시는 앞 차례가 지키게 한다. */
export async function purgeKeptContract(db: ShopDb, id: string, now: Date): Promise<number> {
  if (Number.isNaN(now.getTime())) throw new RangeError("invalid purge cutoff");
  const eligible = await db.run(
    `SELECT id FROM kept_records WHERE shop_id = $1 AND id = $2 AND contract_keep_until <= $3
       AND (issue_keep_until IS NULL OR issue_purged_at IS NOT NULL) FOR UPDATE SKIP LOCKED`,
    [id, now],
  );
  if (eligible.rowCount === 0) return 0;
  const result = await db.run(
    `DELETE FROM kept_records WHERE shop_id = $1 AND id = $2 AND contract_keep_until <= $3
       AND (issue_keep_until IS NULL OR issue_purged_at IS NOT NULL)`,
    [id, now],
  );
  return result.rowCount;
}
