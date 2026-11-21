import type { ShopDb } from "./shop-scope";

/** SPEC-065의 접속기록 보관. 기준 시각이 미래여도 DB의 실제 시각으로 두 해를 지킨다(A24). */
export async function purgeExpiredAccessLogs(db: ShopDb, now: Date, limit = 100): Promise<number> {
  if (Number.isNaN(now.getTime()) || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new RangeError("invalid purge cutoff or batch size");
  }
  const result = await db.run(
    `WITH expired AS (
       SELECT id FROM access_logs
        WHERE shop_id = $1 AND accessed_at <= least($2::timestamptz, now()) - interval '2 years'
        ORDER BY accessed_at, id LIMIT $3 FOR UPDATE SKIP LOCKED
     )
     DELETE FROM access_logs t USING expired e WHERE t.shop_id = $1 AND t.id = e.id`,
    [now, limit],
  );
  return result.rowCount;
}
