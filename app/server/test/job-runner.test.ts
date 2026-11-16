import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Queryable, RequestDb } from "../src/db";
import { eventKeys, insertOnce, type Once } from "../src/event-keys";
import {
  type DueItem,
  dailyDue,
  dailySlot,
  JobConfigError,
  type LeasedHandler,
  type RunnableJob,
  type RunOptions,
  runDueJobs,
} from "../src/job-runner";
import { nextKakaoAttemptAt } from "../src/retry";
import { createShopScope, type ShopDb, shopDb } from "../src/shop-scope";
import { collectLogs, describeDb, newUuid, testDb } from "./support/db";
import { createShop, type ShopFixture } from "./support/shops";

// 서버 안의 일 실행기(TASK-023)의 끝난 조건 시험:
// (가) 같은 이벤트 키를 두 번 넣어도(차례로·동시에) 한 번만 돈다.
// (나) 처리 중간에 멈춘 실행기(던짐·트랜잭션 되돌림·연결 끊김) 뒤 새 실행기가 남은 일과 되돌린 일을 이어서 한 번씩 한다.

const MIN = 60_000;
const quiet = () => {};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function plus(d: Date, ms: number): Date {
  return new Date(d.getTime() + ms);
}

/** 다른 시험·앞 실행의 행과 겹치지 않게 시험마다 먼 지난 시각(2001~2008년)의 한 분을 고른다. */
function pastMinute(): Date {
  const start = Date.UTC(2001, 0, 1);
  const span = Date.UTC(2009, 0, 1) - start;
  return new Date(start + Math.floor((Math.random() * span) / MIN) * MIN);
}

/**
 * 하루 한 번 일 시험의 때(03:00 Asia/Seoul): 그때부터 days일 안에 시작 표시(purge_run)가 없는 날을 고른다. 시작 표시는
 * 지우지 않고 쌓이므로(로컬 시험 데이터베이스는 실행을 거듭함) 앞 실행이 남긴 표시와 같은 날을 고르면 시작하지 않는다.
 */
async function freeSlot(q: Queryable, days = 1): Promise<Date> {
  for (let i = 0; i < 50; i += 1) {
    const slot = dailySlot(pastMinute(), "03:00", "Asia/Seoul");
    const r = await q.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM ops_events WHERE kind = 'purge_run' AND shop_id IS NULL AND created_at >= $1 AND created_at < $2",
      [slot, plus(slot, days * 24 * 60 * MIN)],
    );
    if (r.rows[0]?.n === 0) return slot;
  }
  throw new Error("no free daily slot");
}

function scoped(q: Queryable, shopId: string): ShopDb {
  return shopDb(createShopScope(shopId, { kind: "job", job: "runner_test" }), q);
}

const ALERT_SQL =
  "INSERT INTO owner_alerts (shop_id, event_key, kind, next_attempt_at) VALUES ($1, $2, 'new_task', $3) ON CONFLICT (shop_id, event_key) DO NOTHING RETURNING id";

/** 보낼 사장님 알림 하나(이벤트 키로 한 번만). */
function addAlert(
  q: Queryable,
  shopId: string,
  due: Date,
  key = eventKeys.alert("new_task", newUuid()),
): Promise<Once> {
  return insertOnce(scoped(q, shopId), "owner_alerts", ALERT_SQL, [key, due]);
}

interface AlertState {
  readonly id: string;
  readonly attempts: number;
  readonly status: string;
  readonly next_attempt_at: Date | null;
  readonly kakao_task_id: string | null;
}

async function states(q: Queryable, ids: readonly string[]): Promise<Map<string, AlertState>> {
  const r = await q.query<AlertState>(
    "SELECT id, attempts, status, next_attempt_at, kakao_task_id FROM owner_alerts WHERE id = ANY($1::uuid[])",
    [ids],
  );
  return new Map(r.rows.map((row) => [row.id, row]));
}

/**
 * 시험용 일(데이터베이스 안의 일만): 이 시험의 행만 처리하고(다른 시험의 행은 건드리지 않음), 처리하면 attempts를 하나 올리고
 * 끝난 상태로 둔다. hook은 그 뒤에 부른다(던지기·멈추기 시험).
 */
function txJob(
  name: string,
  mine: ReadonlySet<string>,
  calls: string[],
  hook?: (item: DueItem, db: ShopDb) => Promise<void>,
): RunnableJob {
  return {
    name,
    every: "minute",
    sources: ["owner_alert_send"],
    handler: {
      mode: "transaction",
      async run(db, item) {
        if (!mine.has(item.id)) return;
        calls.push(item.id);
        await db.run(
          "UPDATE owner_alerts t SET attempts = t.attempts + 1, status = 'failed', fail_code = 'kakao_error' WHERE t.shop_id = $1 AND t.id = $2",
          [item.id],
        );
        if (hook !== undefined) await hook(item, db);
      },
    },
  };
}

/** 이 연결의 서버 프로세스 번호($1은 ShopDb가 채우는 가게 ID라 받기만 함). */
async function backendPid(db: ShopDb): Promise<number> {
  const r = await db.run<{ pid: number }>("SELECT pg_backend_pid() AS pid WHERE $1::uuid IS NOT NULL");
  return r.rows[0]?.pid as number;
}

function gate(): { readonly wait: Promise<void>; readonly open: () => void } {
  let open: () => void = () => {};
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

describe("하루 한 번 일의 때(가게 시간대, G8)", () => {
  it("03:00 Asia/Seoul은 UTC 전날 18:00이고, 그 전이면 하루 앞의 때", () => {
    expect(dailySlot(new Date("2026-11-16T18:00:00Z"), "03:00", "Asia/Seoul").toISOString()).toBe(
      "2026-11-16T18:00:00.000Z",
    );
    expect(dailySlot(new Date("2026-11-16T17:59:59Z"), "03:00", "Asia/Seoul").toISOString()).toBe(
      "2026-11-15T18:00:00.000Z",
    );
    expect(dailySlot(new Date("2026-11-17T09:00:00Z"), "03:00", "Asia/Seoul").toISOString()).toBe(
      "2026-11-16T18:00:00.000Z",
    );
  });

  it("그날 때부터 시간 안이고 그 뒤 시작 표시가 없을 때만 시작", () => {
    const slot = new Date("2026-11-16T18:00:00Z");
    const window = 3 * 3_600_000;
    expect(dailyDue(plus(slot, MIN), null, "03:00", "Asia/Seoul", window)).toBe(true);
    expect(dailyDue(plus(slot, MIN), plus(slot, -MIN), "03:00", "Asia/Seoul", window)).toBe(true);
    expect(dailyDue(plus(slot, 2 * MIN), plus(slot, MIN), "03:00", "Asia/Seoul", window)).toBe(false);
    // 그 시간을 놓치면(서버가 멈춰 있었음) 그날은 건너뛰고 다음 날.
    expect(dailyDue(plus(slot, window), null, "03:00", "Asia/Seoul", window)).toBe(false);
    expect(dailyDue(plus(slot, -MIN), null, "03:00", "Asia/Seoul", window)).toBe(false);
  });
});

describe("실행기 설정(코드의 잘못은 JobConfigError)", () => {
  const noDb = {} as RunOptions["db"];
  const handler = { mode: "transaction", run: async () => {} } as const;
  const base: RunnableJob = { name: "a_job", every: "minute", sources: ["owner_alert_send"], handler };
  const run = (jobs: RunnableJob[], limits?: RunOptions["limits"]) =>
    runDueJobs({ db: noDb, now: new Date(), jobs, log: quiet, ...(limits !== undefined ? { limits } : {}) });

  it("이름이 겹치거나 꼴이 틀림, 없는 곳, 틀린 하루 한 번 때·한도", async () => {
    await expect(run([base, base])).rejects.toThrow(JobConfigError);
    await expect(run([{ ...base, name: "Bad Name" }])).rejects.toThrow(JobConfigError);
    await expect(run([{ ...base, sources: ["nope" as "owner_alert_send"] }])).rejects.toThrow(JobConfigError);
    await expect(
      run([{ ...base, every: "day", at: "3:00", timeZone: "Asia/Seoul", marker: "purge_run" }]),
    ).rejects.toThrow(JobConfigError);
    await expect(
      run([{ ...base, every: "day", at: "03:00", timeZone: "Mars/Base", marker: "purge_run" }]),
    ).rejects.toThrow(JobConfigError);
    await expect(run([base], { batch: 0 })).rejects.toThrow(JobConfigError);
    await expect(run([base], { leaseMs: 1000, actTimeoutMs: 1000 })).rejects.toThrow(JobConfigError);
    await expect(runDueJobs({ db: noDb, now: new Date(Number.NaN), jobs: [base], log: quiet })).rejects.toThrow(
      JobConfigError,
    );
  });

  it("일이 없으면 데이터베이스를 보지 않고 빈 결과", async () => {
    expect(await run([])).toEqual({ jobs: {}, stoppedByBudget: false, dailyStarted: [] });
  });
});

describeDb("실행기(데이터베이스)", () => {
  let db: RequestDb;
  let other: RequestDb;
  let a: ShopFixture;
  let b: ShopFixture;

  beforeAll(async () => {
    db = testDb();
    other = testDb();
    a = await createShop(db, "실행기 가게 A");
    b = await createShop(db, "실행기 가게 B");
  });

  afterAll(async () => {
    await db.close();
    await other.close();
  });

  it("(가) 같은 이벤트 키를 차례로·동시에 두 번 넣어도 한 행이고, 실행기는 그 일을 한 번만 함", async () => {
    const now = pastMinute();
    const seqKey = eventKeys.alert("new_task", newUuid());
    const s1 = await addAlert(db, a.shopId, plus(now, -2 * MIN), seqKey);
    const s2 = await addAlert(db, a.shopId, plus(now, -2 * MIN), seqKey);
    expect(s1.created).toBe(true);
    expect(s2).toEqual({ id: s1.id, created: false });

    const conKey = eventKeys.alert("new_task", newUuid());
    const c1db = testDb();
    const c2db = testDb();
    try {
      const [c1, c2] = await Promise.all([
        addAlert(c1db, a.shopId, plus(now, -MIN), conKey),
        addAlert(c2db, a.shopId, plus(now, -MIN), conKey),
      ]);
      expect([c1.created, c2.created].sort()).toEqual([false, true]);
      expect(c1.id).toBe(c2.id);

      // 뒤따르는 일(처리)은 새로 넣었을 때만: 넣기 넷에서 새 행은 둘.
      const created = [s1, s2, c1, c2].filter((o) => o.created).map((o) => o.id);
      expect(created.sort()).toEqual([s1.id, c1.id].sort());

      const mine = new Set(created);
      const calls: string[] = [];
      const job = txJob("once_test", mine, calls);
      await runDueJobs({ db, now, jobs: [job], log: quiet });
      // 다음 분에 다른 연결(다시 띄운 서버)의 실행기가 돌아도 다시 하지 않음.
      await runDueJobs({ db: other, now: plus(now, MIN), jobs: [job], log: quiet });
      expect([...calls].sort()).toEqual([...mine].sort());
      const st = await states(db, [...mine]);
      for (const id of mine) expect(st.get(id)?.attempts).toBe(1);
    } finally {
      await c1db.close();
      await c2db.close();
    }
  });

  it("(가) 두 실행기가 겹쳐 돌아도(SKIP LOCKED) 행마다 한 번", async () => {
    const now = pastMinute();
    const ids: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      const shop = i % 2 === 0 ? a : b;
      ids.push((await addAlert(db, shop.shopId, plus(now, -(i + 1) * 1000))).id);
    }
    const mine = new Set(ids);
    const calls: string[] = [];
    const job = txJob("overlap_test", mine, calls, () => sleep(3));
    const [r1, r2] = await Promise.all([
      runDueJobs({ db, now, jobs: [job], log: quiet }),
      runDueJobs({ db: other, now, jobs: [job], log: quiet }),
    ]);
    expect(calls).toHaveLength(20);
    expect(new Set(calls).size).toBe(20);
    const st = await states(db, ids);
    for (const id of ids) expect(st.get(id)?.attempts).toBe(1);
    const done = (r1.jobs.overlap_test?.done ?? 0) + (r2.jobs.overlap_test?.done ?? 0);
    expect(done).toBeGreaterThanOrEqual(20);
  });

  it("(나) 처리가 던지면 그 행만 되돌리고, 새 실행기가 되돌린 행을 한 번 함(로그에는 ID만)", async () => {
    const now = pastMinute();
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) ids.push((await addAlert(db, a.shopId, plus(now, -(4 - i) * 1000))).id);
    const mine = new Set(ids);
    const calls: string[] = [];
    const failing = ids[1] as string;
    let thrown = false;
    const job = txJob("throw_test", mine, calls, async (item) => {
      if (item.id === failing && !thrown) {
        thrown = true;
        throw new Error("customer note: do not log this");
      }
    });
    const logs = collectLogs();
    const sink = (level: string, fields: object) => logs.sink(JSON.stringify({ level, ...fields }));
    await runDueJobs({ db, now, jobs: [job], log: sink });
    let st = await states(db, ids);
    expect(st.get(failing)).toMatchObject({ attempts: 0, status: "pending" });
    for (const id of ids.filter((i) => i !== failing)) expect(st.get(id)?.attempts).toBe(1);
    const failure = logs.lines.map((l) => JSON.parse(l)).find((l) => l.event === "job_item_failed");
    expect(failure).toMatchObject({ level: "error", job: "throw_test", itemId: failing, errorName: "Error" });
    expect(logs.lines.join("\n")).not.toContain("customer note");

    // 다시 띄운 서버(새 연결)의 실행기가 다음 분에 되돌린 행만 함.
    await runDueJobs({ db: other, now: plus(now, MIN), jobs: [job], log: quiet });
    st = await states(db, ids);
    for (const id of ids) expect(st.get(id)?.attempts).toBe(1);
    expect(calls.filter((c) => c === failing)).toHaveLength(2);
    expect(calls).toHaveLength(5);
  });

  it("(나) 처리 중 연결이 끊긴 실행기(서버 멈춤): 잡던 행은 되돌려지고, 겹친 실행기는 잡힌 행을 건너뛰며, 새 실행기가 이어서 한 번", async () => {
    const now = pastMinute();
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) ids.push((await addAlert(db, a.shopId, plus(now, -(5 - i) * 1000))).id);
    const mine = new Set(ids);
    const calls: string[] = [];
    const stuck = ids[2] as string;
    const reached = gate();
    const release = gate();
    let pid = 0;
    let stopped = false;
    const job = txJob("crash_test", mine, calls, async (item, sdb) => {
      if (item.id !== stuck || stopped) return;
      stopped = true;
      pid = await backendPid(sdb);
      reached.open();
      await release.wait;
    });
    const dying = testDb();
    const runA = runDueJobs({ db: dying, now, jobs: [job], log: quiet });
    await reached.wait;
    // A가 셋째 행을 쥔 채 멈춰 있는 동안 도는 실행기 B: 잡힌 행은 건너뛰고 남은 행을 함.
    const runB = await runDueJobs({ db: other, now, jobs: [job], log: quiet });
    expect(runB.jobs.crash_test?.skipped).toBeGreaterThanOrEqual(1);
    let st = await states(db, ids);
    expect(st.get(stuck)?.attempts).toBe(0);
    for (const id of [ids[3], ids[4]] as string[]) expect(st.get(id)?.attempts).toBe(1);
    // 서버가 멈춤: A의 연결을 끊는다. A의 트랜잭션은 데이터베이스가 되돌린다.
    await db.query("SELECT pg_terminate_backend($1)", [pid]);
    release.open();
    const summaryA = await runA;
    expect(summaryA.jobs.crash_test?.failed).toBeGreaterThanOrEqual(1);
    await dying.close();
    st = await states(db, ids);
    expect(st.get(stuck)).toMatchObject({ attempts: 0, status: "pending" });
    // 다시 띄운 서버의 실행기가 되돌린 행을 이어서 함.
    await runDueJobs({ db: other, now: plus(now, MIN), jobs: [job], log: quiet });
    st = await states(db, ids);
    for (const id of ids) expect(st.get(id)?.attempts, id).toBe(1);
    expect(calls.filter((c) => c === stuck)).toHaveLength(2);
  });

  /** 바깥 호출이 있는 시험용 일(카카오 보내기 꼴): 임대에서 시도 수를 세고 때를 미루고, 결과에 따라 확인 중이나 G4 다시 보내기. */
  function leasedJob(
    name: string,
    mine: ReadonlySet<string>,
    acts: string[],
    act: (id: string) => Promise<string>,
    onLease?: (db: ShopDb) => Promise<void>,
  ): RunnableJob {
    const handler: LeasedHandler<{ readonly id: string }, string> = {
      mode: "leased",
      async lease(sdb, item, ctx) {
        if (!mine.has(item.id)) return null;
        await sdb.run(
          "UPDATE owner_alerts t SET attempts = t.attempts + 1, next_attempt_at = $3 WHERE t.shop_id = $1 AND t.id = $2",
          [item.id, ctx.leaseUntil],
        );
        if (onLease !== undefined) await onLease(sdb);
        return { id: item.id };
      },
      async act(prepared) {
        acts.push(prepared.id);
        return act(prepared.id);
      },
      async record(sdb, item, _prepared, outcome, ctx) {
        // 임대한 그대로일 때만 쓴다(때 = 임대 끝). 늦게 온 결과가 다른 실행기의 새 임대를 덮지 않게.
        if (outcome.ok) {
          await sdb.run(
            "UPDATE owner_alerts t SET status = 'confirming', kakao_task_id = $3, requested_at = $4, next_attempt_at = NULL WHERE t.shop_id = $1 AND t.id = $2 AND t.status = 'pending' AND t.next_attempt_at = $5",
            [item.id, outcome.value, ctx.now, ctx.leaseUntil],
          );
          return;
        }
        const r = await sdb.run<{ attempts: number }>(
          "SELECT t.attempts FROM owner_alerts t WHERE t.shop_id = $1 AND t.id = $2 AND t.next_attempt_at = $3",
          [item.id, ctx.leaseUntil],
        );
        const attempts = r.rows[0]?.attempts;
        if (attempts === undefined) return;
        const next = nextKakaoAttemptAt(attempts, ctx.now);
        if (next === null) {
          await sdb.run(
            "UPDATE owner_alerts t SET status = 'failed', fail_code = 'kakao_error', next_attempt_at = NULL WHERE t.shop_id = $1 AND t.id = $2",
            [item.id],
          );
        } else {
          await sdb.run("UPDATE owner_alerts t SET next_attempt_at = $3 WHERE t.shop_id = $1 AND t.id = $2", [
            item.id,
            next,
          ]);
        }
      },
    };
    return { name, every: "minute", sources: ["owner_alert_send"], handler };
  }

  it("바깥 호출이 실패하면 G4대로 1·5·30분 뒤 다시, 4번이면 끝(시간 한도를 넘긴 호출도 실패)", async () => {
    const t0 = pastMinute();
    const id = (await addAlert(db, a.shopId, t0)).id;
    const acts: string[] = [];
    let hang = false;
    const job = leasedJob("resend_test", new Set([id]), acts, async () => {
      if (hang) return new Promise<string>(() => {});
      throw new Error("kakao said no");
    });
    const run = (now: Date) => runDueJobs({ db, now, jobs: [job], log: quiet, limits: { actTimeoutMs: 100 } });
    await run(t0);
    expect((await states(db, [id])).get(id)).toMatchObject({ attempts: 1, next_attempt_at: plus(t0, MIN) });
    await run(plus(t0, 30_000));
    expect(acts).toHaveLength(1);
    await run(plus(t0, MIN));
    expect((await states(db, [id])).get(id)).toMatchObject({ attempts: 2, next_attempt_at: plus(t0, 6 * MIN) });
    hang = true;
    const r = await run(plus(t0, 6 * MIN));
    expect(r.jobs.resend_test?.failed).toBeGreaterThanOrEqual(1);
    expect((await states(db, [id])).get(id)).toMatchObject({ attempts: 3, next_attempt_at: plus(t0, 36 * MIN) });
    hang = false;
    await run(plus(t0, 36 * MIN));
    expect((await states(db, [id])).get(id)).toMatchObject({ attempts: 4, status: "failed", next_attempt_at: null });
    expect(acts).toHaveLength(4);
  });

  it("(나) 바깥 호출 중에 멈춘 실행기: 임대가 끝나기 전에는 다시 찾지 않고, 끝난 뒤 새 실행기가 한 번 더 부르고 결과를 씀", async () => {
    const t0 = pastMinute();
    const id = (await addAlert(db, a.shopId, t0)).id;
    const acts: string[] = [];
    const calling = gate();
    const release = gate();
    let first = true;
    let pid = 0;
    const job = leasedJob(
      "lease_test",
      new Set([id]),
      acts,
      async () => {
        if (first) {
          first = false;
          calling.open();
          await release.wait;
        }
        return "task-ok";
      },
      async (sdb) => {
        if (pid === 0) pid = await backendPid(sdb);
      },
    );
    const dying = testDb();
    const runA = runDueJobs({ db: dying, now: t0, jobs: [job], log: quiet, clock: () => t0.getTime() });
    await calling.wait;
    // 임대는 커밋되어 있음: 시도 1, 때는 임대 끝(2분 뒤).
    expect((await states(db, [id])).get(id)).toMatchObject({ attempts: 1, next_attempt_at: plus(t0, 2 * MIN) });
    await db.query("SELECT pg_terminate_backend($1)", [pid]);
    release.open();
    expect((await runA).jobs.lease_test?.failed).toBe(1);
    await dying.close();
    // 임대가 끝나기 전의 실행기는 찾지 않음.
    await runDueJobs({ db: other, now: plus(t0, MIN), jobs: [job], log: quiet });
    expect(acts).toHaveLength(1);
    // 임대가 끝난 뒤 다시 띄운 서버의 실행기가 이어서 함.
    await runDueJobs({ db: other, now: plus(t0, 3 * MIN), jobs: [job], log: quiet });
    const after = (await states(db, [id])).get(id);
    // 끝난 행으로 둔다(발송 결과 조회 곳을 찾는 다른 시험에 걸리지 않게).
    await scoped(db, a.shopId).run(
      "UPDATE owner_alerts t SET status = 'failed', fail_code = 'unknown' WHERE t.shop_id = $1 AND t.id = $2",
      [id],
    );
    expect(acts).toEqual([id, id]);
    expect(after).toMatchObject({ attempts: 2, status: "confirming", kakao_task_id: "task-ok" });
  });

  it("한 번에 찾는 수와 시간 한도를 넘으면 남은 것은 다음 실행에", async () => {
    const now = pastMinute();
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) ids.push((await addAlert(db, b.shopId, plus(now, -(5 - i) * 1000))).id);
    const calls: string[] = [];
    const job = txJob("limit_test", new Set(ids), calls);
    await runDueJobs({ db, now, jobs: [job], log: quiet, limits: { batch: 2 } });
    expect(calls).toEqual(ids.slice(0, 2));

    let clock = 0;
    const timed = txJob("budget_test", new Set(ids), calls, async () => {
      clock += 1000;
    });
    const logs = collectLogs();
    const r = await runDueJobs({
      db,
      now,
      jobs: [timed],
      log: (level, fields) => logs.sink(JSON.stringify({ level, ...fields })),
      limits: { budgetMs: 1500 },
      clock: () => clock,
    });
    expect(r.stoppedByBudget).toBe(true);
    expect(calls).toEqual(ids.slice(0, 4));
    expect(logs.lines.some((l) => l.includes("job_run_budget_reached"))).toBe(true);
    await runDueJobs({ db, now, jobs: [timed], log: quiet });
    expect(calls).toEqual(ids);
  });

  it("하루 한 번 일: 같은 분의 두 실행기 중 하나만 시작하고, 그날 다시 시작하지 않으며, 다음 날 다시", async () => {
    const slot = await freeSlot(db, 3);
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) ids.push((await addAlert(db, a.shopId, plus(slot, -i * 1000))).id);
    const calls: string[] = [];
    const minute = txJob("daily_test", new Set(ids), calls);
    const daily: RunnableJob = {
      ...minute,
      every: "day",
      at: "03:00",
      timeZone: "Asia/Seoul",
      marker: "purge_run",
    };
    const [r1, r2] = await Promise.all([
      runDueJobs({ db, now: plus(slot, MIN), jobs: [daily], log: quiet }),
      runDueJobs({ db: other, now: plus(slot, MIN), jobs: [daily], log: quiet }),
    ]);
    expect([...r1.dailyStarted, ...r2.dailyStarted]).toEqual(["daily_test"]);
    expect([...calls].sort()).toEqual([...ids].sort());

    const again = await runDueJobs({ db, now: plus(slot, 2 * MIN), jobs: [daily], log: quiet });
    expect(again.dailyStarted).toEqual([]);
    const nextDay = await runDueJobs({ db, now: plus(slot, 24 * 60 * MIN + 5 * MIN), jobs: [daily], log: quiet });
    expect(nextDay.dailyStarted).toEqual(["daily_test"]);
    // 그다음 날은 시간(3시간)을 놓치면 시작하지 않음.
    const missed = await runDueJobs({ db, now: plus(slot, 48 * 60 * MIN + 181 * MIN), jobs: [daily], log: quiet });
    expect(missed.dailyStarted).toEqual([]);

    const marks = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM ops_events WHERE kind = 'purge_run' AND shop_id IS NULL AND created_at >= $1 AND created_at < $2",
      [slot, plus(slot, 72 * 60 * MIN)],
    );
    expect(marks.rows[0]?.n).toBe(2);
  });

  it("하루 한 번 일: 앞 분의 실행기가 늦게 도착해도, 그날 이미 시작했으면 다시 시작하지 않음(Codex 지적)", async () => {
    const slot = await freeSlot(db);
    const daily: RunnableJob = {
      ...txJob("daily_order_test", new Set(), []),
      every: "day",
      at: "03:00",
      timeZone: "Asia/Seoul",
      marker: "purge_run",
    };
    const later = await runDueJobs({ db, now: plus(slot, 2 * MIN), jobs: [daily], log: quiet });
    // 03:01에 깨우기로 한 실행기가 03:02 실행기보다 늦게 도착함.
    const delayed = await runDueJobs({ db: other, now: plus(slot, MIN), jobs: [daily], log: quiet });
    expect(later.dailyStarted).toEqual(["daily_order_test"]);
    expect(delayed.dailyStarted).toEqual([]);
  });

  it("늦게 깨운 실행기의 임대는 실제로 잡은 때부터 셈: 제때 깨운 다음 실행기가 같은 행을 함께 부르지 않음(Codex 지적)", async () => {
    const t0 = pastMinute();
    const id = (await addAlert(db, a.shopId, t0)).id;
    const acts: string[] = [];
    const calling = gate();
    const release = gate();
    const job = leasedJob("late_lease_test", new Set([id]), acts, async () => {
      if (acts.length === 1) {
        calling.open();
        await release.wait;
      }
      return "task-late";
    });
    // t0에 깨우기로 한 실행기가 3분 늦게 돎(시계는 t0+3분).
    const late = runDueJobs({ db, now: t0, jobs: [job], log: quiet, clock: () => plus(t0, 3 * MIN).getTime() });
    await calling.wait;
    const leased = (await states(other, [id])).get(id)?.next_attempt_at;
    await runDueJobs({ db: other, now: plus(t0, 3 * MIN), jobs: [job], log: quiet });
    release.open();
    await late;
    const after = (await states(db, [id])).get(id);
    // 끝난 행으로 둔다(다른 시험의 찾기에 걸리지 않게).
    await scoped(db, a.shopId).run(
      "UPDATE owner_alerts t SET status = 'failed', fail_code = 'unknown' WHERE t.shop_id = $1 AND t.id = $2",
      [id],
    );
    expect(leased).toEqual(plus(t0, 5 * MIN));
    expect(acts).toEqual([id]);
    expect(after).toMatchObject({ attempts: 1, status: "confirming", kakao_task_id: "task-late" });
  });

  it("한 일의 앞 곳이 시간 한도를 다 써도, 찾는 곳의 차례를 분마다 돌려 뒤 곳도 함(Codex 지적)", async () => {
    const now = pastMinute();
    const send = (await addAlert(db, b.shopId, plus(now, -1000))).id;
    const r = await db.query<{ id: string }>(
      "INSERT INTO owner_alerts (shop_id, event_key, kind, status, kakao_task_id, requested_at) VALUES ($1, $2, 'new_task', 'confirming', 'task-test', $3) RETURNING id",
      [b.shopId, eventKeys.alert("new_task", newUuid()), plus(now, -2 * MIN)],
    );
    const check = r.rows[0]?.id as string;
    const mine = new Set([send, check]);
    let clock = 0;
    const seen: string[] = [];
    const job: RunnableJob = {
      name: "source_turn_test",
      every: "minute",
      sources: ["owner_alert_send", "owner_alert_check"],
      handler: {
        mode: "transaction",
        async run(_db, item) {
          if (!mine.has(item.id)) return;
          seen.push(item.source);
          clock += 2000;
        },
      },
    };
    for (const at of [now, plus(now, MIN)]) {
      await runDueJobs({ db, now: at, jobs: [job], log: quiet, limits: { budgetMs: 1000 }, clock: () => clock });
    }
    // 끝난 행으로 둔다(다른 시험의 찾기에 걸리지 않게).
    await scoped(db, b.shopId).run(
      "UPDATE owner_alerts t SET status = 'failed', fail_code = 'unknown' WHERE t.shop_id = $1 AND t.id = ANY($2::uuid[])",
      [[send, check]],
    );
    expect([...seen].sort()).toEqual(["owner_alert_check", "owner_alert_send"]);
  });

  it("늘 던지는 행이 한 번에 찾는 수만큼 앞을 막아도, 같은 실행에서 그 뒤의 행을 이어 찾아 함(Codex 지적)", async () => {
    const now = pastMinute();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) ids.push((await addAlert(db, a.shopId, plus(now, -(3 - i) * 1000))).id);
    const [p0, p1, last] = ids as [string, string, string];
    const calls: string[] = [];
    const job = txJob("poison_test", new Set(ids), calls, async (item) => {
      if (item.id !== last) throw new Error("always fails");
    });
    for (let m = 0; m < 3; m += 1) {
      await runDueJobs({ db, now: plus(now, m * MIN), jobs: [job], log: quiet, limits: { batch: 2 } });
    }
    const st = await states(db, ids);
    // 끝난 행으로 둔다(다른 시험의 찾기에 걸리지 않게).
    await scoped(db, a.shopId).run(
      "UPDATE owner_alerts t SET status = 'failed', fail_code = 'unknown' WHERE t.shop_id = $1 AND t.id = ANY($2::uuid[])",
      [ids],
    );
    // 앞의 둘은 실행마다 한 번씩 던져 되돌려지고(그 실행에서 다시 잡지 않음), 뒤의 행은 첫 실행에서 한 번.
    expect(calls.slice(0, 3)).toEqual([p0, p1, last]);
    expect(calls.filter((c) => c === last)).toHaveLength(1);
    expect(calls.filter((c) => c === p0)).toHaveLength(3);
    expect(calls.filter((c) => c === p1)).toHaveLength(3);
    expect(st.get(last)).toMatchObject({ attempts: 1, status: "failed" });
    expect(st.get(p0)).toMatchObject({ attempts: 0, status: "pending" });
  });

  it("하루 한 번 일도 늘 던지는 행 뒤의 행을 그 실행에서 이어 찾아 함(Codex 지적)", async () => {
    const slot = await freeSlot(db);
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) ids.push((await addAlert(db, b.shopId, plus(slot, -(3 - i) * 1000))).id);
    const [p0, p1, last] = ids as [string, string, string];
    const calls: string[] = [];
    const daily: RunnableJob = {
      ...txJob("daily_poison_test", new Set(ids), calls, async (item) => {
        if (item.id !== last) throw new Error("always fails");
      }),
      every: "day",
      at: "03:00",
      timeZone: "Asia/Seoul",
      marker: "purge_run",
    };
    const r = await runDueJobs({ db, now: plus(slot, MIN), jobs: [daily], log: quiet, limits: { batch: 2 } });
    await scoped(db, b.shopId).run(
      "UPDATE owner_alerts t SET status = 'failed', fail_code = 'unknown' WHERE t.shop_id = $1 AND t.id = ANY($2::uuid[])",
      [ids],
    );
    expect(r.dailyStarted).toEqual(["daily_poison_test"]);
    expect(calls).toEqual([p0, p1, last]);
  });

  it("바깥 호출이 실패한 행은 다시 하기 때로 물러나 있어, 그 실행에서 뒤의 행을 더 찾지 않음(바깥에 몰아 부르지 않음)", async () => {
    const t0 = pastMinute();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) ids.push((await addAlert(db, a.shopId, plus(t0, -(3 - i) * 1000))).id);
    const acts: string[] = [];
    const job = leasedJob("act_down_test", new Set(ids), acts, async () => {
      throw new Error("kakao down");
    });
    await runDueJobs({ db, now: t0, jobs: [job], log: quiet, limits: { batch: 2 } });
    const st = await states(db, ids);
    await scoped(db, a.shopId).run(
      "UPDATE owner_alerts t SET status = 'failed', fail_code = 'unknown' WHERE t.shop_id = $1 AND t.id = ANY($2::uuid[])",
      [ids],
    );
    expect(acts).toEqual(ids.slice(0, 2));
    // 실패한 둘은 G4대로 1분 뒤에 다시. 남은 하나는 그대로라 다음 분에 앞의 둘보다 먼저 찾힘.
    expect(st.get(ids[0] as string)).toMatchObject({ attempts: 1, next_attempt_at: plus(t0, MIN) });
    expect(st.get(ids[2] as string)).toMatchObject({ attempts: 0, next_attempt_at: plus(t0, -1000) });
  });
});
