import type { RequestDb } from "./db";
import { errorFields } from "./error-name";
import { DEFAULT_LIMITS, type JobLog, type JobTally, type RunLimits } from "./job-runner";
import { recordOpsEvent } from "./ops-events";
import { purgeExpiredAccessLogs } from "./purge-access-logs";
import { purgeExpiredAiToolCalls } from "./purge-ai-tools";
import { purgeConsultation } from "./purge-consultation";
import { purgeCustomerKey } from "./purge-customer";
import { deleteQueuedFile } from "./purge-files";
import { purgeKeptContract, purgeKeptIssue } from "./purge-kept";
import { purgeOrder } from "./purge-order";
import { purgeExpiredRequestKeys } from "./purge-request-keys";
import { isPurgeFindSql, PURGE_PENDING_FILES, PURGE_SOURCES, type PurgeSourceName } from "./purge-sources";
import { purgeUnusedUploads } from "./purge-uploads";
import { createShopScope, type ShopDb, shopRequestDb } from "./shop-scope";
import type { ObjectStore } from "./storage";

export interface PurgeOptions {
  readonly now: Date;
  readonly storage: () => ObjectStore;
  readonly log: JobLog;
  readonly limits?: Partial<RunLimits>;
  readonly shouldStop?: () => boolean;
}

interface Candidate {
  readonly shop_id: string;
  readonly id: string;
  readonly due_at: Date;
}
const phases: readonly (readonly PurgeSourceName[])[] = [
  ["orders"],
  ["ended", "dropped"],
  ["issue", "contract"],
  ["customers"],
  ["access"],
  [],
  ["tools"],
  ["files"],
];
const work: Readonly<Partial<Record<PurgeSourceName, (tx: ShopDb, id: string, now: Date) => Promise<number>>>> = {
  orders: purgeOrder,
  ended: purgeConsultation,
  dropped: purgeConsultation,
  issue: purgeKeptIssue,
  contract: purgeKeptContract,
  customers: purgeCustomerKey,
  access: (tx, _id, now) => purgeExpiredAccessLogs(tx, now, 1),
  tools: (tx, _id, now) => purgeExpiredAiToolCalls(tx, now, 1),
};

/**
 * SPEC-065의 여덟 차례. 한 바퀴에 차례마다 한 배치씩 처리해 첫 차례가 나머지 시간을 다 쓰지 않게 한다.
 * 후보는 ID·시각만, 내용은 해당 가게의 짧은 트랜잭션에서 다시 확인한다. 파일 호출은 커밋 뒤에만 한다.
 */
export async function runPurge(db: RequestDb, options: PurgeOptions): Promise<JobTally> {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  if (
    Number.isNaN(options.now.getTime()) ||
    !Number.isSafeInteger(limits.batch) ||
    limits.batch < 1 ||
    limits.batch > 1000 ||
    !Number.isSafeInteger(limits.rounds) ||
    limits.rounds < 1 ||
    limits.rounds > 100
  )
    throw new RangeError("invalid purge limits");
  const dbNow = (await db.query<{ now: Date }>("SELECT statement_timestamp() AS now")).rows[0]?.now;
  if (!(dbNow instanceof Date) || Number.isNaN(dbNow.getTime()))
    throw new RangeError("database purge clock is unavailable");
  const now = new Date(Math.min(options.now.getTime(), dbNow.getTime()));
  const shouldStop = options.shouldStop ?? (() => false);
  const total: JobTally = { found: 0, done: 0, skipped: 0, failed: 0 };
  const seen = new Map<PurgeSourceName, Set<string>>();
  let uploadsDone = false;
  const failure = (err: unknown, code: string, id?: string) => {
    options.log("error", {
      event: "purge_failed",
      job: "purge",
      code,
      ...errorFields(err),
      ...(id !== undefined ? { itemId: id } : {}),
    });
  };
  for (let round = 0; round < limits.rounds && !shouldStop(); round += 1) {
    let more = false;
    for (let phase = 1; phase <= 8; phase += 1) {
      if (shouldStop()) break;
      const tally: JobTally = { found: 0, done: 0, skipped: 0, failed: 0 };
      for (const name of phases[phase - 1] ?? []) {
        if (shouldStop()) break;
        const source = PURGE_SOURCES[name];
        if (!isPurgeFindSql(source.sql)) throw new TypeError("unexpected purge finder");
        const prior = seen.get(name) ?? new Set<string>();
        seen.set(name, prior);
        let candidates: readonly Candidate[];
        try {
          candidates = (await db.query<Candidate>(source.sql, [now, limits.batch, [...prior]])).rows;
        } catch (err) {
          tally.failed += 1;
          failure(err, name);
          continue;
        }
        if (candidates.length === limits.batch) more = true;
        for (const item of candidates) {
          if (shouldStop()) break;
          tally.found += 1;
          prior.add(item.id);
          const scoped = shopRequestDb(createShopScope(item.shop_id, { kind: "job", job: "purge" }), db);
          try {
            if (name === "files") {
              const result = await deleteQueuedFile(scoped, options.storage(), item.id, now);
              if (result === "deleted") tally.done += 1;
              else if (result === "failed") {
                tally.failed += 1;
                options.log("warn", { event: "purge_file_failed", job: "purge", itemId: item.id });
              } else tally.skipped += 1;
            } else {
              const handler = work[name];
              if (handler === undefined) throw new TypeError("unknown purge work");
              const count = await scoped.transaction((tx) => handler(tx, item.id, now));
              tally.done += count;
              if (count === 0) tally.skipped += 1;
            }
          } catch (err) {
            tally.failed += 1;
            failure(err, name, item.id);
          }
        }
      }
      if (phase === 6 && !shouldStop()) {
        try {
          const count = (
            await db.query<{ n: number }>("SELECT public.purge_expired_masked_value_erasures($1) AS n", [limits.batch])
          ).rows[0]?.n;
          if (count === undefined) throw new Error("erasure count missing");
          tally.found += count;
          tally.done += count;
          if (count === limits.batch) more = true;
        } catch (err) {
          tally.failed += 1;
          failure(err, "masked_value_erasures");
        }
        try {
          const count = await purgeExpiredRequestKeys(db, now, limits.batch);
          tally.found += count;
          tally.done += count;
          if (count === limits.batch) more = true;
        } catch (err) {
          tally.failed += 1;
          failure(err, "request_keys");
        }
      }
      if (phase === 8 && !uploadsDone && !shouldStop()) {
        try {
          const result = await purgeUnusedUploads(options.storage(), now, {
            batch: limits.batch,
            pages: 1,
            shouldStop,
          });
          tally.found += result.scanned;
          tally.done += result.deleted;
          tally.failed += result.failed;
          tally.skipped += result.scanned - result.deleted - result.failed;
          uploadsDone = result.complete;
          if (!result.complete) more = true;
        } catch (err) {
          tally.failed += 1;
          uploadsDone = true;
          failure(err, "temporary_uploads");
        }
      }
      total.found += tally.found;
      total.done += tally.done;
      total.skipped += tally.skipped;
      total.failed += tally.failed;
      if (round === 0 || tally.found > 0 || tally.failed > 0) {
        try {
          const pending = (await db.query<{ count: number }>(PURGE_PENDING_FILES)).rows[0]?.count;
          if (pending === undefined) throw new Error("pending file count missing");
          await recordOpsEvent(db, {
            kind: "purge_run",
            at: now,
            count: tally.done,
            detail: { phase, round, ...tally, pending_files: pending, budget_reached: shouldStop() ? 1 : 0 },
          });
        } catch (err) {
          total.failed += 1;
          failure(err, "result_record");
        }
      }
    }
    if (!more) break;
  }
  return total;
}
