import type { Queryable } from "./db";

/**
 * SPEC-065의 여섯 번째 차례. 요청 지문·처음 결과의 참조만 있는 공통 표라 가게 조건을 두지 않는다.
 * 오래된 키를 이어받아 처리 중인 요청은 유효한 임대까지 보호하고, 다른 트랜잭션의 잠금은 건너뛴다.
 */
export async function purgeExpiredRequestKeys(db: Queryable, now: Date, limit = 100): Promise<number> {
  if (Number.isNaN(now.getTime()) || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new RangeError("invalid purge cutoff or batch size");
  }
  const result = await db.query(
    `WITH expired AS (
       SELECT actor_kind, actor_id, request_key FROM request_keys
        WHERE created_at <= $1::timestamptz - interval '24 hours'
          AND (state = 'done' OR processing_expires_at <= $1)
        ORDER BY created_at, actor_kind, actor_id, request_key LIMIT $2 FOR UPDATE SKIP LOCKED
     )
     DELETE FROM request_keys r USING expired e
      WHERE r.actor_kind = e.actor_kind AND r.actor_id = e.actor_id AND r.request_key = e.request_key`,
    [now, limit],
  );
  return result.rowCount;
}
