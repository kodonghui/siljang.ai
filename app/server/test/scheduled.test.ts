import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbConnector, RequestDb } from "../src/db";
import { eventKeys, insertOnce } from "../src/event-keys";
import worker from "../src/index";
import type { RunnableJob } from "../src/job-runner";
import { createScheduledHandler, runScheduled } from "../src/scheduled";
import { createShopScope, shopDb } from "../src/shop-scope";
import { collectLogs, describeDb, newUuid, testDb, testEnv } from "./support/db";
import { createShop } from "./support/shops";

// Workers의 scheduled 처리기(어댑터 층, TASK-023). 가짜 scheduled 이벤트로 부른다(1분 Cron Trigger는 TASK-173).

const event = (time: Date) => ({ scheduledTime: time.getTime(), cron: "* * * * *" });

function events(lines: readonly string[]): string[] {
  return lines.map((l) => (JSON.parse(l) as { event: string }).event);
}

describe("scheduled 처리기(데이터베이스 없이)", () => {
  it("설정이 틀리면 이름만 로그로 남기고 던지지 않음", async () => {
    const logs = collectLogs();
    const r = await runScheduled(event(new Date()), { APP_ENV: "nope" }, { logSink: logs.sink });
    expect(r).toBeNull();
    expect(logs.lines.map((l) => JSON.parse(l))).toEqual([
      { level: "error", event: "job_run_failed", errorName: "SettingsError" },
    ]);
  });

  it("처리가 붙은 일이 없으면(이번 작업의 등록부) 연결을 쓰지 않고 빈 결과, 연결은 닫음", async () => {
    let closed = 0;
    const fake: RequestDb = {
      query: async () => {
        throw new Error("no query expected");
      },
      transaction: async () => {
        throw new Error("no transaction expected");
      },
      abort: async () => {},
      close: async () => {
        closed += 1;
      },
    };
    const connect: DbConnector = () => fake;
    const r = await runScheduled(event(new Date("2026-11-16T00:00:00Z")), { APP_ENV: "development" }, { connect });
    expect(r).toEqual({ jobs: {}, stoppedByBudget: false, dailyStarted: [] });
    expect(closed).toBe(1);
  });

  it("데이터베이스 주소가 없으면 찾기 실패를 로그로 남기고 다음 분에 다시(던지지 않음)", async () => {
    const logs = collectLogs();
    const job: RunnableJob = {
      name: "no_db_test",
      every: "minute",
      sources: ["owner_alert_send"],
      handler: { mode: "transaction", run: async () => {} },
    };
    const r = await runScheduled(event(new Date()), { APP_ENV: "development" }, { jobs: [job], logSink: logs.sink });
    expect(r?.jobs.no_db_test?.failed).toBe(1);
    expect(logs.lines.map((l) => JSON.parse(l))).toContainEqual({
      level: "error",
      event: "job_find_failed",
      job: "no_db_test",
      errorName: "DbUnavailableError",
    });
  });

  it("Worker 진입점이 scheduled 처리기를 내보내고, 처리기는 실행기를 waitUntil로 넘김", async () => {
    expect(typeof worker.scheduled).toBe("function");
    const waited: Promise<unknown>[] = [];
    const handler = createScheduledHandler({
      connect: () => ({
        query: async () => ({ rows: [], rowCount: 0 }),
        transaction: async () => undefined as never,
        abort: async () => {},
        close: async () => {},
      }),
    });
    handler(event(new Date()), { APP_ENV: "development" }, { waitUntil: (p) => waited.push(p) });
    expect(waited).toHaveLength(1);
    expect(await waited[0]).toEqual({ jobs: {}, stoppedByBudget: false, dailyStarted: [] });
  });
});

describeDb("scheduled 처리기(데이터베이스)", () => {
  let db: RequestDb;

  beforeAll(() => {
    db = testDb();
  });

  afterAll(async () => {
    await db.close();
  });

  it("이벤트의 시각을 기준 시각으로 실행기를 돌려 때가 된 행을 처리함", async () => {
    const f = await createShop(db, "scheduled 시험");
    const start = Date.UTC(2001, 0, 1);
    const now = new Date(start + Math.floor((Math.random() * (Date.UTC(2009, 0, 1) - start)) / 60_000) * 60_000);
    const sdb = shopDb(createShopScope(f.shopId, { kind: "job", job: "scheduled_test" }), db);
    const due = await insertOnce(
      sdb,
      "owner_alerts",
      "INSERT INTO owner_alerts (shop_id, event_key, kind, next_attempt_at) VALUES ($1, $2, 'new_task', $3) ON CONFLICT (shop_id, event_key) DO NOTHING RETURNING id",
      [eventKeys.alert("new_task", newUuid()), new Date(now.getTime() - 1000)],
    );
    const later = await insertOnce(
      sdb,
      "owner_alerts",
      "INSERT INTO owner_alerts (shop_id, event_key, kind, next_attempt_at) VALUES ($1, $2, 'new_task', $3) ON CONFLICT (shop_id, event_key) DO NOTHING RETURNING id",
      [eventKeys.alert("new_task", newUuid()), new Date(now.getTime() + 60_000)],
    );
    const mine = new Set([due.id, later.id]);
    const seen: string[] = [];
    const job: RunnableJob = {
      name: "scheduled_test",
      every: "minute",
      sources: ["owner_alert_send"],
      handler: {
        mode: "transaction",
        async run(tx, item) {
          if (!mine.has(item.id)) return;
          seen.push(item.id);
          await tx.run(
            "UPDATE owner_alerts t SET status = 'failed', fail_code = 'kakao_error' WHERE t.shop_id = $1 AND t.id = $2",
            [item.id],
          );
        },
      },
    };
    const logs = collectLogs();
    const waited: Promise<unknown>[] = [];
    createScheduledHandler({ jobs: [job], logSink: logs.sink })(event(now), testEnv(), {
      waitUntil: (p) => waited.push(p),
    });
    await Promise.all(waited);
    expect(seen).toEqual([due.id]);
    expect(events(logs.lines)).toContain("job_run");
    // 다음 분의 이벤트에서 나머지 행.
    await runScheduled(event(new Date(now.getTime() + 60_000)), testEnv(), { jobs: [job], logSink: () => {} });
    expect(seen).toEqual([due.id, later.id]);
  });
});
