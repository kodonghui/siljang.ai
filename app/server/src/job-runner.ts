/**
 * 서버 안의 일 실행기(TASK-023, 06 README 10절의 13개가 쓸 바탕). 1분마다 scheduled 처리기(scheduled.ts)가 부른다.
 *
 * - 기다리는 일은 데이터베이스의 행이다(due-sources.ts). 실행기는 일마다 그 곳에서 때가 된 행을 찾고(가게 범위 밖, ID만),
 *   행마다 짧은 트랜잭션에서 그 가게 범위 연결로 다시 잡는다(FOR UPDATE SKIP LOCKED). 그래서 서버를 다시 띄워도 기다리던
 *   일은 그대로 이어지고, 두 실행기가 겹쳐 돌아도(앞 실행이 끝나기 전에 다음 분) 한 행을 두 번 처리하지 않는다.
 * - 처리 둘(issue 4):
 *   · transaction: 데이터베이스 안의 일만. 잡은 트랜잭션 안에서 처리하고, 던지면 되돌려 다음 실행에서 다시 한다.
 *   · leased: 바깥 호출(카카오 Event API 따위)이 있는 일. 짧은 트랜잭션으로 잡으며 행의 때를 임대 끝까지 미루고(lease),
 *     트랜잭션 밖에서 부르고(act, 데이터베이스 연결을 받지 않음), 결과를 새 짧은 트랜잭션으로 쓴다(record). 중간에 멈추면
 *     임대가 끝난 뒤 다시 찾힌다. 바깥 호출을 트랜잭션 안에서 하지 않아 연결을 오래 쥐지 않는다.
 * - 같은 일은 한 번만(A33)은 이벤트 키로 지킨다(event-keys.ts의 insertOnce). 실행기는 행을 한 번씩 잡아 줄 뿐이다.
 * - 한도(issue 7): 곳마다 한 번에 찾는 수(batch)와 이 실행의 시간 한도(budgetMs). 넘으면 남은 것은 다음 분에. 일의 순서는
 *   분마다 돌려 한 일이 늘 뒤로 밀리지 않게 한다.
 * - 하루 한 번 일(지난 기록 지우기 03:00, SPEC-065): 짧은 트랜잭션에서 트랜잭션 잠금(pg_advisory_xact_lock, 트랜잭션 풀링에서도
 *   지켜짐)을 잡고 운영 기록(ops_events)의 표시로 그날 시작했는지 본 뒤, 아니면 표시를 남기고 시작한다. 그날 멈추면 다음 날
 *   다시(SPEC-065). 세션 잠금은 Hyperdrive의 트랜잭션 풀링에서 지켜지지 않아 쓰지 않는다.
 * - 실패는 ID만 실은 로그(04 G6, tech-stack.md의 '큐 메시지와 로그에는 ID만'). 운영자 알림은 맡을 작업(TASK-016 바깥 감시)이
 *   이 로그로 한다.
 * - 업무 코드는 env·ctx·Cron을 직접 부르지 않는다(tech-stack.md 180행). Workers와 잇는 것은 scheduled.ts.
 */
import { type Queryable, type RequestDb, sqlStateOf } from "./db";
import { DUE_SOURCES, type DueSource, type DueSourceName, FIND_SHAPE, LAST_DAILY_RUN } from "./due-sources";
import type { LogFields, LogLevel } from "./log";
import { type OpsEventKind, recordOpsEvent } from "./ops-events";
import { createShopScope, type ShopDb, shopDb } from "./shop-scope";
import { isTimeZone, shopLocalToUtc, toShopLocal } from "./time";

export type JobLog = (level: LogLevel, fields: LogFields) => void;

/** 때가 된 행 하나(가게 ID·행 ID·때만. 내용은 그 가게 범위 연결로 읽음). */
export interface DueItem {
  readonly source: DueSourceName;
  readonly shopId: string;
  readonly id: string;
  readonly dueAt: Date;
}

export interface JobContext {
  /** 일의 이름(등록부). */
  readonly job: string;
  /** 이 실행의 기준 시각(scheduled 이벤트의 시각). SQL에 now() 대신 넘긴다. */
  readonly now: Date;
}

export interface LeaseContext extends JobContext {
  /** 임대가 끝나는 때. lease()는 행의 때를 이때(나 그 뒤)로 미루거나 상태를 바꿔 그 사이 다시 찾히지 않게 한다. */
  readonly leaseUntil: Date;
}

/** 데이터베이스 안의 일만 하는 처리. 잡은 트랜잭션 안에서 하고, 던지면 되돌린다(다음 실행에서 다시). */
export interface TransactionHandler {
  readonly mode: "transaction";
  run(db: ShopDb, item: DueItem, ctx: JobContext): Promise<void>;
}

/** 바깥 호출의 결과. 실패는 오류 이름만(내용·응답 본문은 싣지 않음). */
export type ActOutcome<O> =
  | { readonly ok: true; readonly value: O }
  | { readonly ok: false; readonly errorName: string };

/** 바깥 호출이 있는 처리(잡으며 임대 → 트랜잭션 밖에서 부름 → 결과를 새 트랜잭션으로 씀). */
export interface LeasedHandler<P = unknown, O = unknown> {
  readonly mode: "leased";
  /**
   * 잡은 트랜잭션 안. 행의 때를 ctx.leaseUntil로 미루고(시도 수를 셈) 바깥 호출에 넘길 것(ID·정해진 글)을 돌려준다.
   * 할 일이 없으면 null(그대로 끝).
   */
  lease(db: ShopDb, item: DueItem, ctx: LeaseContext): Promise<P | null>;
  /** 트랜잭션 밖의 바깥 호출. 데이터베이스 연결을 받지 않는다. 시간 한도(actTimeoutMs)를 넘기면 실패로 친다. */
  act(prepared: P, ctx: LeaseContext): Promise<O>;
  /**
   * 새 트랜잭션. 결과를 쓴다(다음 때·상태). 임대가 끝나 다른 실행기가 다시 잡았을 수 있으니 임대한 그대로인지
   * (때 = ctx.leaseUntil 따위) 보고 쓴다. 던지면 되돌리고, 행은 임대가 끝난 뒤 다시 찾힌다.
   */
  record(db: ShopDb, item: DueItem, prepared: P, outcome: ActOutcome<O>, ctx: LeaseContext): Promise<void>;
}

export type ItemHandler = TransactionHandler | LeasedHandler;

interface JobBase {
  /** 등록부의 이름(소문자·숫자·_). 로그와 가게 범위의 출처에 쓴다. */
  readonly name: string;
  /** 찾을 곳(due-sources.ts). */
  readonly sources: readonly DueSourceName[];
  /** 곳마다 기준 시각(지난 시간으로 세는 곳, 예: 남긴 지 7일이면 지금 − 7일). 없으면 지금. */
  readonly cutoff?: (source: DueSourceName, now: Date) => Date;
  readonly handler: ItemHandler;
}

/** 1분마다 찾는 일. */
export interface MinuteJob extends JobBase {
  readonly every: "minute";
}

/** 하루 한 번 일. at(HH:MM, timeZone의 벽시계)부터 windowMs 안의 첫 실행에서 한 번 시작한다. */
export interface DailyJob extends JobBase {
  readonly every: "day";
  readonly at: string;
  readonly timeZone: string;
  /** 그날 시작했다는 표시를 남길 운영 기록 종류(05 ops_events.kind). */
  readonly marker: OpsEventKind;
}

export type RunnableJob = MinuteJob | DailyJob;

export interface RunLimits {
  /** 곳마다 한 번에 찾는 행 수. */
  readonly batch: number;
  /** 이 실행에서 새 행을 잡기 시작하는 시간 한도(ms). 넘으면 남은 것은 다음 실행에. Cron 한 번은 CPU 30초(tech-stack.md 134행). */
  readonly budgetMs: number;
  /** 하루 한 번 일이 곳마다 찾기를 되풀이하는 수(한 번에 batch씩). */
  readonly dailyRounds: number;
  /** 하루 한 번 일을 그날 시작할 수 있는 때(at부터). 놓치면 다음 날. */
  readonly dailyWindowMs: number;
  /** leased 처리의 임대 길이. 바깥 호출 시간 한도보다 길어야 한다. */
  readonly leaseMs: number;
  /** 바깥 호출 시간 한도. */
  readonly actTimeoutMs: number;
}

export const DEFAULT_LIMITS: RunLimits = {
  batch: 50,
  budgetMs: 45_000,
  dailyRounds: 20,
  dailyWindowMs: 3 * 3_600_000,
  leaseMs: 120_000,
  actTimeoutMs: 20_000,
};

export interface RunOptions {
  /** 이 실행의 연결 하나(찾기와 행마다의 짧은 트랜잭션이 차례로 씀). */
  readonly db: RequestDb;
  readonly now: Date;
  readonly jobs: readonly RunnableJob[];
  readonly log: JobLog;
  readonly limits?: Partial<RunLimits>;
  /** 걸린 시간을 재는 시계(ms). 기본 Date.now. 시험만 바꾼다. */
  readonly clock?: () => number;
}

export interface JobTally {
  /** 찾은 행(이 실행에서 처음 본 것). */
  found: number;
  /** 처리를 끝냄(leased는 바깥 호출이 성공하고 결과를 씀). */
  done: number;
  /** 잡지 못함(다른 실행기가 잡고 있거나 그 사이 처리됨). */
  skipped: number;
  /** 실패(되돌렸거나 바깥 호출이 실패함). 행은 다음 실행에서 다시 찾힌다. */
  failed: number;
}

export interface RunSummary {
  readonly jobs: Readonly<Record<string, Readonly<JobTally>>>;
  /** 시간 한도로 멈췄는지(남은 것은 다음 실행에). */
  readonly stoppedByBudget: boolean;
  /** 이번 실행에서 그날 시작한 하루 한 번 일. */
  readonly dailyStarted: readonly string[];
}

/** 실행기 설정이 틀림(코드의 잘못). 이름·값은 메시지에 싣지 않는다. */
export class JobConfigError extends Error {
  override readonly name = "JobConfigError";
}

/** 바깥 호출이 시간 한도를 넘김. */
export class JobActTimeoutError extends Error {
  override readonly name = "JobActTimeoutError";
}

const JOB_NAME = /^[a-z][a-z0-9_]{0,59}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_MS = 86_400_000;
/** 하루 한 번 일의 트랜잭션 잠금 이름 공간(pg_advisory_xact_lock의 첫 키). TASK-023. */
const LOCK_SPACE = 23_023;

function checkLimits(limits: RunLimits): void {
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new JobConfigError("limits must be positive integers");
  }
  if (limits.leaseMs <= limits.actTimeoutMs) throw new JobConfigError("lease must be longer than the act timeout");
}

function checkJobs(jobs: readonly RunnableJob[]): void {
  const names = new Set<string>();
  for (const job of jobs) {
    if (!JOB_NAME.test(job.name) || names.has(job.name)) throw new JobConfigError("job names must be unique names");
    names.add(job.name);
    for (const s of job.sources) {
      if (!Object.hasOwn(DUE_SOURCES, s)) throw new JobConfigError("unknown due source");
    }
    if (job.every === "day" && (!HHMM.test(job.at) || !isTimeZone(job.timeZone))) {
      throw new JobConfigError("daily job needs HH:MM and an IANA time zone");
    }
  }
}

/** YYYY-MM-DD의 하루 앞. */
function previousDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) - DAY_MS).toISOString().slice(0, 10);
}

/** now에서 가장 가까운 지난 '그날의 at'(timeZone의 벽시계, 04 G8). now가 정확히 그때면 그때. */
export function dailySlot(now: Date, at: string, timeZone: string): Date {
  const local = toShopLocal(now, timeZone);
  const today = shopLocalToUtc(local.date, at, timeZone);
  if (today.getTime() <= now.getTime()) return today;
  return shopLocalToUtc(previousDate(local.date), at, timeZone);
}

/**
 * 하루 한 번 일을 지금 시작할지: 그날의 at부터 windowMs 안이고, 그 뒤에 시작한 표시(lastStartedAt)가 없으면 시작.
 * 그 시간을 놓치면(서버가 멈춰 있었음) 그날은 건너뛰고 다음 날(SPEC-065 '멈추면 다음 날 다시').
 */
export function dailyDue(
  now: Date,
  lastStartedAt: Date | null,
  at: string,
  timeZone: string,
  windowMs: number,
): boolean {
  const slot = dailySlot(now, at, timeZone).getTime();
  if (now.getTime() >= slot + windowMs) return false;
  return lastStartedAt === null || lastStartedAt.getTime() < slot;
}

/** 이름의 32비트 해시(FNV-1a). 트랜잭션 잠금의 둘째 키. */
function lockKey(name: string): number {
  let h = 0x811c9dc5;
  for (const ch of new TextEncoder().encode(name)) {
    h ^= ch;
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

function errorNameOf(err: unknown): string {
  if (sqlStateOf(err) !== undefined) return "DatabaseError";
  return err instanceof Error ? err.name : "Error";
}

function logFailure(log: JobLog, event: string, job: string, err: unknown, itemId?: string): void {
  const dbCode = sqlStateOf(err);
  log("error", {
    event,
    job,
    errorName: errorNameOf(err),
    ...(itemId !== undefined ? { itemId } : {}),
    ...(dbCode !== undefined ? { dbCode } : {}),
  });
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new JobActTimeoutError("external call timed out")), ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/** 여러 가게에서 때가 된 행을 찾는다(가게 ID·행 ID·때만). */
async function findDue(
  q: Queryable,
  name: DueSourceName,
  source: DueSource,
  cutoff: Date,
  limit: number,
): Promise<DueItem[]> {
  if (!FIND_SHAPE.test(source.find)) throw new JobConfigError("due source find SQL is not in the find shape");
  const r = await q.query<{ shop_id: string; id: string; due_at: Date }>(source.find, [cutoff, limit]);
  return r.rows.map((row) => ({ source: name, shopId: row.shop_id, id: row.id, dueAt: row.due_at }));
}

/**
 * 하루 한 번 일을 그날 시작할지 정하고, 시작하면 표시를 남긴다(한 트랜잭션). 트랜잭션 잠금으로 두 실행기가 같은 분에
 * 와도 하나만 시작한다.
 */
async function startDaily(db: RequestDb, job: DailyJob, now: Date, windowMs: number): Promise<boolean> {
  const slot = dailySlot(now, job.at, job.timeZone);
  if (now.getTime() >= slot.getTime() + windowMs) return false;
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock($1::int, $2::int)", [LOCK_SPACE, lockKey(job.name)]);
    const r = await tx.query<{ last_at: Date | null }>(LAST_DAILY_RUN, [job.marker, now]);
    if (!dailyDue(now, r.rows[0]?.last_at ?? null, job.at, job.timeZone, windowMs)) return false;
    await recordOpsEvent(tx, { kind: job.marker, count: 0, detail: { started: 1 }, at: now });
    return true;
  });
}

type ItemResult = "done" | "skipped" | "failed";

async function processItem(
  db: RequestDb,
  job: RunnableJob,
  source: DueSource,
  item: DueItem,
  cutoff: Date,
  now: Date,
  limits: RunLimits,
  log: JobLog,
): Promise<ItemResult> {
  const scope = createShopScope(item.shopId, { kind: "job", job: job.name });
  const handler = job.handler;
  if (handler.mode === "transaction") {
    const ctx: JobContext = { job: job.name, now };
    try {
      const claimed = await db.transaction(async (tx) => {
        const sdb = shopDb(scope, tx);
        const r = await sdb.run(source.claim, [item.id, cutoff]);
        if (r.rowCount === 0) return false;
        await handler.run(sdb, item, ctx);
        return true;
      });
      return claimed ? "done" : "skipped";
    } catch (err) {
      logFailure(log, "job_item_failed", job.name, err, item.id);
      return "failed";
    }
  }

  const ctx: LeaseContext = { job: job.name, now, leaseUntil: new Date(now.getTime() + limits.leaseMs) };
  let held: { readonly value: unknown } | null;
  try {
    held = await db.transaction(async (tx) => {
      const sdb = shopDb(scope, tx);
      const r = await sdb.run(source.claim, [item.id, cutoff]);
      if (r.rowCount === 0) return null;
      return { value: await handler.lease(sdb, item, ctx) };
    });
  } catch (err) {
    logFailure(log, "job_item_failed", job.name, err, item.id);
    return "failed";
  }
  if (held === null) return "skipped";
  const prepared = held.value;
  if (prepared === null) return "done";
  let outcome: ActOutcome<unknown>;
  try {
    outcome = { ok: true, value: await withTimeout(handler.act(prepared, ctx), limits.actTimeoutMs) };
  } catch (err) {
    outcome = { ok: false, errorName: errorNameOf(err) };
    log("warn", { event: "job_act_failed", job: job.name, itemId: item.id, errorName: outcome.errorName });
  }
  try {
    await db.transaction((tx) => handler.record(shopDb(scope, tx), item, prepared, outcome, ctx));
  } catch (err) {
    logFailure(log, "job_item_failed", job.name, err, item.id);
    return "failed";
  }
  return outcome.ok ? "done" : "failed";
}

/**
 * 때가 된 일을 한 번 돈다. 일마다 찾고 행마다 잡아 처리하며, 실패한 행은 로그만 남기고 다음 행으로 간다(다음 실행에서 다시).
 * 던지는 것은 설정이 틀렸을 때(JobConfigError)뿐이다.
 */
export async function runDueJobs(options: RunOptions): Promise<RunSummary> {
  const limits: RunLimits = { ...DEFAULT_LIMITS, ...options.limits };
  checkLimits(limits);
  checkJobs(options.jobs);
  const now = options.now;
  if (Number.isNaN(now.getTime())) throw new JobConfigError("now must be a valid date");
  const clock = options.clock ?? Date.now;
  const log = options.log;
  const started = clock();
  const overBudget = () => clock() - started >= limits.budgetMs;

  const tallies: Record<string, JobTally> = {};
  const dailyStarted: string[] = [];
  let stoppedByBudget = false;

  const jobs = options.jobs;
  const shift = jobs.length === 0 ? 0 : Math.floor(now.getTime() / 60_000) % jobs.length;
  const order = [...jobs.slice(shift), ...jobs.slice(0, shift)];

  for (const job of order) {
    const tally: JobTally = { found: 0, done: 0, skipped: 0, failed: 0 };
    tallies[job.name] = tally;
    if (overBudget()) {
      stoppedByBudget = true;
      continue;
    }
    if (job.every === "day") {
      let begun: boolean;
      try {
        begun = await startDaily(options.db, job, now, limits.dailyWindowMs);
      } catch (err) {
        logFailure(log, "job_start_failed", job.name, err);
        tally.failed += 1;
        continue;
      }
      if (!begun) continue;
      dailyStarted.push(job.name);
      log("info", { event: "job_daily_started", job: job.name });
    }
    const rounds = job.every === "day" ? limits.dailyRounds : 1;
    for (const name of job.sources) {
      const source = DUE_SOURCES[name];
      const cutoff = job.cutoff?.(name, now) ?? now;
      const seen = new Set<string>();
      for (let round = 0; round < rounds; round += 1) {
        if (overBudget()) {
          stoppedByBudget = true;
          break;
        }
        let items: DueItem[];
        try {
          items = await findDue(options.db, name, source, cutoff, limits.batch);
        } catch (err) {
          if (err instanceof JobConfigError) throw err;
          logFailure(log, "job_find_failed", job.name, err);
          tally.failed += 1;
          break;
        }
        const fresh = items.filter((i) => !seen.has(i.id));
        tally.found += fresh.length;
        for (const item of fresh) {
          if (overBudget()) {
            stoppedByBudget = true;
            break;
          }
          seen.add(item.id);
          const result = await processItem(options.db, job, source, item, cutoff, now, limits, log);
          tally[result] += 1;
        }
        if (stoppedByBudget || items.length < limits.batch || fresh.length === 0) break;
      }
    }
    if (tally.found > 0 || tally.failed > 0) {
      log(tally.failed > 0 ? "warn" : "info", { event: "job_run", job: job.name, count: tally.done });
    }
  }
  if (stoppedByBudget) log("warn", { event: "job_run_budget_reached" });
  return { jobs: tallies, stoppedByBudget, dailyStarted };
}
