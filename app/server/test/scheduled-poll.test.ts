import { DatabaseError } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RequestDb } from "../src/db";
import { type RunnableJob, runDueJobs } from "../src/job-runner";
import { runScheduled } from "../src/scheduled";
import { collectLogs, describeDb, testEnv } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";

const noon = new Date("2026-11-21T03:00:00Z");
const event = (now: Date) => ({ scheduledTime: now.getTime(), cron: "* * * * *" });

describe("기본 Cron의 매분 연결 확인", () => {
  it("실행 시각 밖에도 DB 연결 실패를 숨기지 않고 다음 분에 다시 확인할 수 있게 남김", async () => {
    const logs = collectLogs();
    const result = await runScheduled(event(noon), { APP_ENV: "development" }, { logSink: logs.sink });
    expect(result?.jobs.purge?.failed).toBe(1);
    expect(logs.lines.map((line) => JSON.parse(line))).toEqual([
      { level: "error", event: "job_start_failed", job: "purge", errorName: "DbUnavailableError" },
    ]);
  });

  it("권한 실패는 SQLSTATE만 남기고 성공 표시는 하지 않으며 연결을 닫음", async () => {
    const logs = collectLogs();
    let closed = 0;
    const db: RequestDb = {
      query: async () => {
        throw Object.assign(new DatabaseError("합성 비공개 오류 내용"), { code: "42501" });
      },
      transaction: async () => {
        throw new Error("조회 실패 뒤 실행하면 안 됨");
      },
      abort: async () => {},
      close: async () => {
        closed += 1;
      },
    };
    const result = await runScheduled(event(noon), testEnv(), { connect: () => db, logSink: logs.sink });
    expect(result?.jobs.purge?.failed).toBe(1);
    expect(closed).toBe(1);
    expect(logs.lines.map((line) => JSON.parse(line))).toEqual([
      { level: "error", event: "job_start_failed", job: "purge", errorName: "DatabaseError", dbCode: "42501" },
    ]);
  });
});

describeDb("시작 표시 조회와 실제 실행의 분리", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30_000);
  afterAll(async () => {
    await isolated?.close();
  });

  it("03시 직전·실행 창 끝·정오에도 시작 표를 읽고 성공을 남기며 잠금·쓰기는 하지 않음", async () => {
    const base = isolated.connect();
    let reads = 0;
    const db: RequestDb = {
      query: async (sql, params) => {
        expect(sql).toMatch(/SELECT.*FROM ops_events/s);
        reads += 1;
        return base.query(sql, params);
      },
      transaction: async () => {
        throw new Error("실행 시각 밖에서는 쓰기 트랜잭션을 열면 안 됨");
      },
      abort: () => base.abort(),
      close: async () => {},
    };
    const before = await base.query("SELECT count(*)::int AS n FROM ops_events");
    try {
      for (const time of ["2026-11-21T17:59:59Z", "2026-11-21T21:00:00Z", noon.toISOString()]) {
        const logs = collectLogs();
        const result = await runScheduled(event(new Date(time)), testEnv(), { connect: () => db, logSink: logs.sink });
        expect(result?.dailyStarted).toEqual([]);
        expect(result?.jobs.purge).toEqual({ found: 0, done: 0, skipped: 0, failed: 0 });
        expect(logs.lines.map((line) => JSON.parse(line))).toEqual([
          { level: "info", event: "job_polled", job: "purge" },
        ]);
      }
      expect(reads).toBe(3);
      expect((await base.query("SELECT count(*)::int AS n FROM ops_events")).rows).toEqual(before.rows);
    } finally {
      await base.close();
    }
  });

  it("두 실행기가 같은 미시작 표시를 읽어도 잠금 아래 재확인해 한 번만 시작", async () => {
    const first = isolated.connect();
    const second = isolated.connect();
    let reads = 0;
    let release = () => {};
    const bothRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    const polling = (base: RequestDb): RequestDb => ({
      query: async <R>(sql: string, params?: readonly unknown[]) => {
        const result = await base.query<R>(sql, params);
        if (sql.includes("FROM ops_events")) {
          reads += 1;
          if (reads === 2) release();
          await bothRead;
        }
        return result;
      },
      transaction: (fn) => base.transaction(fn),
      abort: () => base.abort(),
      close: () => base.close(),
    });
    const job: RunnableJob = {
      name: "poll_race",
      every: "day",
      at: "03:00",
      timeZone: "Asia/Seoul",
      marker: "purge_run",
      sources: [],
      handler: { mode: "transaction", run: async () => {} },
    };
    const now = new Date("2026-11-22T18:00:00Z");
    const run = (db: RequestDb) => runDueJobs({ db, now, jobs: [job], log: () => {} });
    try {
      const results = await Promise.all([run(polling(first)), run(polling(second))]);
      expect(reads).toBe(2);
      expect(results.flatMap((result) => result.dailyStarted)).toEqual(["poll_race"]);
      expect((await first.query("SELECT count(*)::int AS n FROM ops_events WHERE kind = 'purge_run'")).rows).toEqual([
        { n: 1 },
      ]);
    } finally {
      release();
      await first.close();
      await second.close();
    }
  });
});
