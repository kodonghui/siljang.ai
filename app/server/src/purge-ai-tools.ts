import type { ShopDb } from "./shop-scope";

/** SPEC-065의 일곱 번째 차례. 열린 상담도 인자는 30일 뒤 지우고 토큰·비용 행은 남긴다. */
export async function purgeExpiredAiToolCalls(db: ShopDb, now: Date, limit = 100): Promise<number> {
  if (Number.isNaN(now.getTime()) || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new RangeError("invalid purge cutoff or batch size");
  }
  const result = await db.run(
    `WITH expired AS (
       SELECT id FROM ai_tool_calls WHERE shop_id = $1 AND called_at <= $2::timestamptz - interval '30 days'
        ORDER BY called_at, id LIMIT $3 FOR UPDATE SKIP LOCKED
     )
     DELETE FROM ai_tool_calls t USING expired e WHERE t.shop_id = $1 AND t.id = e.id`,
    [now, limit],
  );
  return result.rowCount;
}
