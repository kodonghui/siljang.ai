import type { ShopRequestDb } from "./shop-scope";
import { assertStorageKey, type ObjectStore } from "./storage";

export type FilePurgeResult = "deleted" | "failed" | "busy" | "gone";

interface FileClaim {
  storage_key: string;
  attempts: number;
  last_tried_at: Date;
}

/**
 * SPEC-065 #10: 삭제 시도는 먼저 커밋하고, 저장소가 확인한 뒤에만 대기 행을 지운다.
 * 실패·시간 초과는 서울 날짜가 바뀐 뒤 다시 시도한다. 저장소를 기다리며 DB 잠금을 잡지 않는다.
 */
export async function deleteQueuedFile(
  db: ShopRequestDb,
  store: ObjectStore,
  id: string,
  now: Date,
  options: { readonly timeoutMs?: number } = {},
): Promise<FilePurgeResult> {
  const timeoutMs = options.timeoutMs ?? 4000;
  if (Number.isNaN(now.getTime()) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) {
    throw new RangeError("invalid file purge deadline");
  }
  const claim = await db.transaction(async (tx) => {
    const selected = await tx.run<{ storage_key: string }>(
      `SELECT storage_key FROM file_deletions WHERE shop_id = $1 AND id = $2 AND queued_at <= $3
         AND (last_tried_at IS NULL OR (last_tried_at AT TIME ZONE 'Asia/Seoul')::date
              < ($3::timestamptz AT TIME ZONE 'Asia/Seoul')::date)
       FOR UPDATE SKIP LOCKED`,
      [id, now],
    );
    if (selected.rowCount === 0) return undefined;
    const updated = await tx.run<FileClaim>(
      `UPDATE file_deletions SET attempts = least(attempts + 1, 10000), last_tried_at = $3
       WHERE shop_id = $1 AND id = $2 RETURNING storage_key, attempts, last_tried_at`,
      [id, now],
    );
    return updated.rows[0];
  });
  if (claim === undefined) {
    const existing = await db.run("SELECT id FROM file_deletions WHERE shop_id = $1 AND id = $2", [id]);
    return existing.rowCount === 0 ? "gone" : "busy";
  }
  try {
    assertStorageKey(claim.storage_key);
    if (!claim.storage_key.startsWith(`shops/${db.scope.shopId}/`)) return "failed";
  } catch {
    return "failed";
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deleted = await Promise.race([
      Promise.resolve()
        .then(() => store.delete(claim.storage_key))
        .then(
          () => true,
          () => false,
        ),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
    if (!deleted) return "failed";
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  // 늦게 온 결과가 다른 시도의 기록을 지우지 않도록 시도 횟수와 시각을 대조한다.
  const removed = await db.run(
    `DELETE FROM file_deletions WHERE shop_id = $1 AND id = $2 AND storage_key = $3
       AND attempts = $4 AND last_tried_at = $5`,
    [id, claim.storage_key, claim.attempts, claim.last_tried_at],
  );
  return removed.rowCount === 1 ? "deleted" : "busy";
}
