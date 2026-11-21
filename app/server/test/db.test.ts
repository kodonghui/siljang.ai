import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { DbUnavailableError, pgConnector, type RequestDb, TransactionMisuseError } from "../src/db";
import { collectLogs, describeDb, testDb, testEnv } from "./support/db";

describe("데이터베이스 연결 없음", () => {
  it("요청을 중단하면 이후 query·transaction이 연결을 다시 맺지 않음", async () => {
    const db = pgConnector(null) as RequestDb & { abort(): Promise<void> };
    expect(db.abort).toBeTypeOf("function");
    await db.abort();
    await expect(db.query("SELECT 1")).rejects.toMatchObject({ name: "DbAbortedError" });
    await expect(db.transaction(async () => 1)).rejects.toMatchObject({ name: "DbAbortedError" });
    await db.close();
    await db.abort();
    await expect(db.query("SELECT 1")).rejects.toMatchObject({ name: "DbAbortedError" });
  });

  it("DATABASE_URL이 없으면 쿼리 때 DbUnavailableError, 앱 응답은 500 internal이고 로그에는 이름만", async () => {
    await expect(pgConnector(null).query("SELECT 1")).rejects.toBeInstanceOf(DbUnavailableError);
    const { lines, sink } = collectLogs();
    const app = createApp({ logSink: sink });
    app.get("/needs-db", async (c) => c.json((await c.get("db").query("SELECT 1 AS one")).rows));
    const res = await app.request("/api/needs-db", {}, { APP_ENV: "development" });
    expect(res.status).toBe(500);
    expect(((await res.json()) as Record<string, unknown>).code).toBe("internal");
    expect(lines.join("\n")).toContain('"errorName":"DbUnavailableError"');
  });

  it("연결 문자열이 postgres:// 꼴이 아니면 설정 잘못(값은 싣지 않음)", async () => {
    const { lines, sink } = collectLogs();
    const res = await createApp({ logSink: sink }).request(
      "/api/healthz",
      {},
      { DATABASE_URL: "mysql://u:pw-Q7@h/db" },
    );
    expect(res.status).toBe(500);
    expect(lines.join("\n")).toContain('"errorName":"SettingsError"');
    expect(`${await res.text()}${lines.join("\n")}`).not.toContain("pw-Q7");
  });
});

describeDb("데이터베이스 연결 층(데이터베이스)", () => {
  const db = testDb();
  afterAll(() => db.close());

  it("date는 'YYYY-MM-DD' 글 그대로, timestamptz는 같은 절대 시각의 Date(04 G8)", async () => {
    const r = await db.query<{ d: unknown; t: unknown }>(
      "SELECT '2026-11-15'::date AS d, '2026-11-15 23:30:00+09'::timestamptz AS t",
    );
    expect(r.rows[0]?.d).toBe("2026-11-15");
    expect(r.rows[0]?.t).toBeInstanceOf(Date);
    const t = r.rows[0]?.t;
    expect(t instanceof Date ? t.toISOString() : null).toBe("2026-11-15T14:30:00.000Z");
  });

  it("트랜잭션: 끝나면 COMMIT, 던지면 ROLLBACK하고 다시 던짐", async () => {
    await db.query("CREATE TEMP TABLE IF NOT EXISTS tx_probe (v int)");
    await db.transaction(async (tx) => {
      await tx.query("INSERT INTO tx_probe VALUES (1)");
    });
    await expect(
      db.transaction(async (tx) => {
        await tx.query("INSERT INTO tx_probe VALUES (2)");
        throw new Error("stop");
      }),
    ).rejects.toThrow("stop");
    const r = await db.query<{ v: number }>("SELECT v FROM tx_probe ORDER BY v");
    expect(r.rows.map((x) => x.v)).toEqual([1]);
  });

  it("트랜잭션 안에서 바깥 query()나 다른 트랜잭션을 부르면 TransactionMisuseError(되돌림)", async () => {
    await db.query("CREATE TEMP TABLE IF NOT EXISTS tx_probe2 (v int)");
    await expect(
      db.transaction(async (tx) => {
        await tx.query("INSERT INTO tx_probe2 VALUES (1)");
        await db.query("SELECT 1");
      }),
    ).rejects.toBeInstanceOf(TransactionMisuseError);
    await expect(db.transaction(async () => db.transaction(async () => 1))).rejects.toBeInstanceOf(
      TransactionMisuseError,
    );
    const r = await db.query<{ n: string }>("SELECT count(*) AS n FROM tx_probe2");
    expect(r.rows[0]?.n).toBe("0");
  });

  it("같은 연결에서 트랜잭션 둘을 동시에 열면 뒤의 것은 TransactionMisuseError이고 앞의 것만 남는다", async () => {
    const fresh = testDb();
    try {
      await fresh.query("CREATE TEMP TABLE IF NOT EXISTS tx_probe3 (v int)");
      const [first, second] = await Promise.allSettled([
        fresh.transaction(async (tx) => {
          await tx.query("INSERT INTO tx_probe3 VALUES (1)");
        }),
        fresh.transaction(async (tx) => {
          await tx.query("INSERT INTO tx_probe3 VALUES (2)");
        }),
      ]);
      expect(first.status).toBe("fulfilled");
      expect(second.status).toBe("rejected");
      if (second.status === "rejected") expect(second.reason).toBeInstanceOf(TransactionMisuseError);
      const r = await fresh.query<{ v: number }>("SELECT v FROM tx_probe3 ORDER BY v");
      expect(r.rows.map((x) => x.v)).toEqual([1]);
    } finally {
      await fresh.close();
    }
  });

  it("데이터베이스 오류는 500 internal이고, 응답·로그에 SQL·넣은 값·제약 이름이 없다. 로그에는 SQLSTATE만(04 G6)", async () => {
    const { lines, sink } = collectLogs();
    const app = createApp({ logSink: sink });
    app.post("/bad-insert", async (c) => {
      // CHECK에 걸리는 값(ops_events.kind). 오류 메시지에는 넣은 값이 들어간다.
      await c.get("db").query("INSERT INTO ops_events (kind, count) VALUES ($1, 1)", ["leak-010-9876-5432"]);
      return c.json({});
    });
    const res = await app.request("/api/bad-insert", { method: "POST" }, testEnv());
    expect(res.status).toBe(500);
    const all = `${await res.text()}\n${lines.join("\n")}`;
    for (const s of ["010-9876-5432", "ops_events_kind_check", "INSERT", "violates"]) expect(all).not.toContain(s);
    const errorLine = lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.level === "error");
    expect(errorLine).toMatchObject({
      event: "unhandled_error",
      errorName: "DatabaseError",
      dbCode: "23514",
      status: 500,
    });
  });

  it("요청마다 연결을 닫는다(같은 앱으로 여러 번 불러도 연결이 쌓이지 않음)", async () => {
    const app = createApp({ logSink: () => {} });
    app.get("/pid", async (c) =>
      c.json((await c.get("db").query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]),
    );
    const pids = new Set<number>();
    for (let i = 0; i < 3; i += 1) {
      const res = await app.request("/api/pid", {}, testEnv());
      pids.add(((await res.json()) as { pid: number }).pid);
    }
    const open = await db.query<{ n: string }>(
      "SELECT count(*) AS n FROM pg_stat_activity WHERE application_name = 'siljang-api' AND pid = ANY($1::int[])",
      [[...pids]],
    );
    expect(open.rows[0]?.n).toBe("0");
  });
});
