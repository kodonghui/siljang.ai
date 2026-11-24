import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { Queryable, RequestDb } from "../src/db";
import { supabaseAuth } from "../src/operator-auth";
import { createSession, emailHash, tokenHash } from "../src/operator-session";
import { Secret } from "../src/settings";
import { collectLogs, describeDb, newUuid, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { SupabaseMock, testPublishableKey } from "./support/supabase-mock";

describeDb("운영자 로그인 최소 서버 역할(TASK-021)", () => {
  const role = `operator_runtime_${newUuid().replaceAll("-", "")}`;
  const admin = testDb();
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>> | undefined;
  let created = false;

  function roleDb(): RequestDb {
    if (!isolated) throw new Error("시험 DB 없음");
    const base = isolated.connect();
    async function transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      return base.transaction(async (tx) => {
        await tx.query(`SET LOCAL ROLE "${role}"`);
        return fn(tx);
      });
    }
    return {
      query: (sql, params) => transaction((tx) => tx.query(sql, params)),
      transaction,
      abort: () => base.abort(),
      close: () => base.close(),
    };
  }

  beforeAll(async () => {
    isolated = await isolatedTestDb();
    await admin.query(`CREATE ROLE "${role}" NOLOGIN NOINHERIT`);
    created = true;
    await isolated.db.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    const grants = readFileSync(new URL("../../../tools/staging-login-callback-grants.sql", import.meta.url), "utf8");
    await isolated.db.query(grants.replaceAll(':"runtime_role"', `"${role}"`));
  }, 30_000);

  afterAll(async () => {
    try {
      await isolated?.close();
    } finally {
      try {
        if (created) await admin.query(`DROP ROLE "${role}"`);
      } finally {
        await admin.close();
      }
    }
  });

  async function harness() {
    if (!isolated) throw new Error("시험 DB 없음");
    const mock = new SupabaseMock(testPublishableKey());
    const email = `operator-${newUuid()}@runtime.example`;
    const password = `not-real-${newUuid()}`;
    const otp = "135790";
    const user = mock.addUser(email, password, otp);
    const factor = user.factors[0];
    if (!factor) throw new Error("시험 인증 수단 없음");
    const operatorId = newUuid();
    const clock = { now: new Date("2026-11-24T15:00:00Z") };
    await isolated.db.query(
      `INSERT INTO operators (id,email,display_name,auth_user_id,mfa_factor_id,mfa_enrolled_at)
       VALUES ($1,$2,'합성 최소 역할 운영자',$3,$4,$5)`,
      [operatorId, email, user.id, factor.id, clock.now],
    );
    const logs = collectLogs();
    const app = createApp({
      connect: () => roleDb(),
      logSink: logs.sink,
      services: {
        now: () => clock.now,
        wait: async () => {},
        operatorAuth: supabaseAuth(
          { url: "https://project.supabase.example", publishableKey: new Secret(testPublishableKey()) },
          { fetch: mock.fetch },
        ),
      },
    });
    const origin = "https://siljang.example";
    const call = (method: string, path: string, body?: unknown, cookie?: string) =>
      app.request(
        `${origin}/api${path}`,
        {
          method,
          headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        testEnv(),
      );
    const login = (correct = true) =>
      call("POST", "/operator/session", { email, password: correct ? password : "wrong", otp });
    return { call, login, clock, logs, mock, operatorId, email, password, factorId: factor.id, authUserId: user.id };
  }

  it("FOR SHARE 잠금으로 세션을 만들되 운영자 보안 열 수정은 거절한다", async () => {
    const h = await harness();
    const db = roleDb();
    try {
      expect(
        await createSession(db, { id: h.operatorId, mfaFactorId: h.factorId, authUserId: h.authUserId }, h.clock.now),
      ).toBeTruthy();
      for (const column of [
        "disabled_at",
        "auth_user_id",
        "mfa_factor_id",
        "mfa_enrolled_at",
        "email",
        "display_name",
        "created_at",
      ]) {
        await expect(
          db.query(`UPDATE operators SET ${column}=${column} WHERE id=$1`, [h.operatorId]),
        ).rejects.toMatchObject({ code: "42501" });
      }
      await expect(db.query("DELETE FROM operators WHERE id=$1", [h.operatorId])).rejects.toMatchObject({
        code: "42501",
      });
      await expect(
        db.query("INSERT INTO operators (email,display_name) VALUES ('unused@runtime.example','합성')"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(db.query("TRUNCATE operators CASCADE")).rejects.toMatchObject({ code: "42501" });
      await expect(
        db.query("UPDATE operator_login_failures SET attempted_at=attempted_at WHERE false"),
      ).rejects.toMatchObject({ code: "42501" });
      if (!isolated) throw new Error("시험 DB 없음");
      const writable = await isolated.db.query<{ column_name: string }>(
        `SELECT attname AS column_name FROM pg_attribute WHERE attrelid='public.operators'::regclass
         AND attnum>0 AND NOT attisdropped AND has_column_privilege($1,'public.operators',attname,'UPDATE') ORDER BY attname`,
        [role],
      );
      expect(writable.rows.map((row) => row.column_name)).toEqual(["id"]);
    } finally {
      await db.close();
    }
  });

  it("실패 기록 뒤 로그인200·내 정보200·로그아웃204·옛 세션401과 만료 세션 정리를 실행한다", async () => {
    const h = await harness();
    if (!isolated) throw new Error("시험 DB 없음");
    await isolated.db.query(
      `INSERT INTO operator_sessions (operator_id,token_hash,created_at,expires_at)
       VALUES ($1,$2,$3::timestamptz-interval '13 hours',$3::timestamptz-interval '1 hour')`,
      [h.operatorId, await tokenHash(newUuid()), h.clock.now],
    );
    expect((await h.login(false)).status).toBe(401);
    const login = await h.login();
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toMatch(/^siljang_operator=/);
    expect((await h.call("GET", "/operator/me", undefined, cookie)).status).toBe(200);
    expect((await h.call("DELETE", "/operator/session", undefined, cookie)).status).toBe(204);
    expect((await h.call("GET", "/operator/me", undefined, cookie)).status).toBe(401);
    const sessions = await isolated.db.query<{ ended: boolean; hours: number }>(
      "SELECT ended_at IS NOT NULL AS ended,extract(epoch FROM expires_at-created_at)/3600::float8 AS hours FROM operator_sessions WHERE operator_id=$1",
      [h.operatorId],
    );
    expect(sessions.rows).toEqual([{ ended: true, hours: 12 }]);
    const hash = await emailHash(new Secret(TEST_HASH_KEY), h.email);
    expect(
      (await isolated.db.query("SELECT id FROM operator_login_failures WHERE email_hash=$1", [hash])).rows,
    ).toEqual([]);
    expect(h.mock.liveTokens()).toBe(0);
    expect(h.logs.lines.join("\n")).not.toContain(h.password);
  });

  it("실패5회 뒤429·Retry-After와15분 뒤 정상 로그인으로 제한 역할의 정리/쓰기 전체를 확인한다", async () => {
    const h = await harness();
    for (let i = 0; i < 5; i += 1) expect((await h.login(false)).status).toBe(401);
    const locked = await h.login();
    expect(locked.status).toBe(429);
    expect(locked.headers.get("retry-after")).toBe("900");
    h.clock.now = new Date(h.clock.now.getTime() + 901_000);
    expect((await h.login()).status).toBe(200);
  });
});
