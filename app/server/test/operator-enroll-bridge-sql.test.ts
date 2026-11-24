import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { OPERATOR_ENROLLMENT_SQL } from "../tools/operator-enroll";
import {
  type EnrollmentRequest,
  enrollmentDb,
  enrollmentRequest,
  renderEnrollmentSql,
} from "../tools/operator-enroll-bridge";
import { describeDb, newUuid, TEST_DATABASE_URL } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";

describeDb("운영자 전달 SQL의 실제 저장과 충돌 보호", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, client: Client;
  let email: string, user: string, factor: string;
  let connectionUrl: string;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
    const name = (await isolated.db.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name;
    if (!name) throw new Error("합성 데이터베이스가 없어요");
    const url = new URL(TEST_DATABASE_URL);
    url.pathname = `/${name}`;
    connectionUrl = url.toString();
    client = new Client({ connectionString: connectionUrl });
    await client.connect();
    await client.query(
      "CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz); CREATE TABLE auth.mfa_factors(id uuid PRIMARY KEY,user_id uuid,status text,factor_type text)",
    );
  }, 30000);
  afterAll(async () => {
    await client?.end();
    await isolated?.close();
  });
  beforeEach(async () => {
    email = `mvp-operator-20261124-${newUuid().replaceAll("-", "").slice(0, 8)}@example.com`;
    user = newUuid();
    factor = newUuid();
    await client.query("INSERT INTO auth.users VALUES($1,$2,now())", [user, email]);
    await client.query("INSERT INTO auth.mfa_factors VALUES($1,$2,'verified','totp')", [factor, user]);
  });
  const params = (name = "합성 '시험 운영자 $siljang_enroll$ ") => [
    email,
    name,
    user,
    factor,
    new Date("2026-11-24T00:00:00Z"),
  ];
  const db = (resumeRequest?: EnrollmentRequest) =>
    enrollmentDb({
      ...(resumeRequest === undefined ? {} : { resumeRequest }),
      email,
      authUserId: user,
      exchange: async (request) => {
        try {
          const results = await client.query(renderEnrollmentSql(request));
          const last = Array.isArray(results) ? results.at(-1) : results;
          return last?.rows[0]?.result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      },
    });
  it("원래 등록 쓰기를 실행하고 실제 확인된 행만 반환하며 이름의 인용 문자를 보존", async () => {
    const row = await db().query<{ id: string; disabled: boolean }>(OPERATOR_ENROLLMENT_SQL, params());
    expect(row.rowCount).toBe(1);
    expect(row.rows[0]?.disabled).toBe(false);
    expect(
      (await client.query("SELECT display_name FROM public.operators WHERE id=$1", [row.rows[0]?.id])).rows,
    ).toEqual([{ display_name: params()[1] }]);
  });
  it("응답 유실 재개의 같은 요청은 실제 행 하나와 원래 등록 시각을 유지", async () => {
    const request = enrollmentRequest(OPERATOR_ENROLLMENT_SQL, params(), { email, authUserId: user });
    const first = await db(request).query(OPERATOR_ENROLLMENT_SQL, params());
    const later = params();
    later[4] = new Date("2026-11-25T00:00:00Z");
    const second = await db(request).query(OPERATOR_ENROLLMENT_SQL, later);
    expect(second.rows).toEqual(first.rows);
    const rows = (await client.query("SELECT mfa_enrolled_at FROM operators WHERE lower(email)=$1", [email])).rows;
    expect(rows).toEqual([{ mfa_enrolled_at: new Date("2026-11-24T00:00:00Z") }]);
  });
  it.each(["unverified", "unconfirmed", "foreign-factor"])("%s 인증 행이면 운영자를 만들지 않음", async (kind) => {
    if (kind === "unverified")
      await client.query("UPDATE auth.mfa_factors SET status='unverified' WHERE id=$1", [factor]);
    if (kind === "unconfirmed") await client.query("UPDATE auth.users SET email_confirmed_at=NULL WHERE id=$1", [user]);
    if (kind === "foreign-factor")
      await client.query("UPDATE auth.mfa_factors SET user_id=$2 WHERE id=$1", [factor, newUuid()]);
    await expect(db().query(OPERATOR_ENROLLMENT_SQL, params())).rejects.toBeDefined();
    expect((await client.query("SELECT id FROM operators WHERE lower(email)=$1", [email])).rowCount).toBe(0);
  });
  it.each(["factor", "email"])("잠금 대기 중 %s 확인이 취소되면 최종 UPSERT도 되돌림", async (kind) => {
    const locker = new Client({ connectionString: connectionUrl });
    await locker.connect();
    let outcome: Promise<unknown> | undefined;
    try {
      const pid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0]?.pid;
      await locker.query("BEGIN; LOCK TABLE public.operators IN SHARE ROW EXCLUSIVE MODE");
      outcome = db()
        .query(OPERATOR_ENROLLMENT_SQL, params())
        .then(
          (value) => ({ ok: true, value }),
          (error) => ({ ok: false, error }),
        );
      let waiting = false;
      const until = Date.now() + 3000;
      while (Date.now() < until) {
        waiting =
          (
            await isolated.db.query<{ waiting: boolean }>(
              "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND relation='public.operators'::regclass AND NOT granted) AS waiting",
              [pid],
            )
          ).rows[0]?.waiting ?? false;
        if (waiting) break;
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(waiting).toBe(true);
      if (kind === "factor")
        await locker.query("UPDATE auth.mfa_factors SET status='unverified' WHERE id=$1", [factor]);
      else await locker.query("UPDATE auth.users SET email_confirmed_at=NULL WHERE id=$1", [user]);
      await locker.query("COMMIT");
      expect(await outcome).toMatchObject({ ok: false, error: { code: "23514" } });
      expect((await client.query("SELECT id FROM public.operators WHERE lower(email)=$1", [email])).rowCount).toBe(0);
    } finally {
      await locker.query("ROLLBACK");
      await locker.end();
      await outcome;
    }
  });
  it("같은 인증수단의 막힌 합성 계정은 풀지 않으며 등록 시각도 유지", async () => {
    const old = new Date("2026-11-20T00:00:00Z");
    await client.query(
      "INSERT INTO operators(email,display_name,auth_user_id,mfa_factor_id,mfa_enrolled_at,disabled_at) VALUES($1,'합성 기존',$2,$3,$4,$4)",
      [email, user, factor, old],
    );
    const row = await db().query(OPERATOR_ENROLLMENT_SQL, params());
    expect(row.rows[0]).toMatchObject({ disabled: true });
    expect(
      (await client.query("SELECT disabled_at,mfa_enrolled_at FROM operators WHERE lower(email)=$1", [email])).rows,
    ).toEqual([{ disabled_at: old, mfa_enrolled_at: old }]);
  });
  it("다른 사용자에 이미 묶인 행은 덮지 않고 실패 뒤 추가 연결을 막는 잠금도 남기지 않음", async () => {
    const otherUser = newUuid(),
      otherFactor = newUuid();
    await client.query(
      "INSERT INTO operators(email,display_name,auth_user_id,mfa_factor_id,mfa_enrolled_at) VALUES($1,'합성 다른 연결',$2,$3,now())",
      [email, otherUser, otherFactor],
    );
    await expect(db().query(OPERATOR_ENROLLMENT_SQL, params())).rejects.toMatchObject({ code: "23514" });
    expect(
      (await client.query("SELECT auth_user_id,mfa_factor_id FROM operators WHERE lower(email)=$1", [email])).rows,
    ).toEqual([{ auth_user_id: otherUser, mfa_factor_id: otherFactor }]);
    await isolated.db.transaction(async (tx) => {
      await tx.query("SELECT set_config('lock_timeout','200',true)");
      await tx.query("LOCK TABLE public.operators IN SHARE ROW EXCLUSIVE MODE");
    });
  });
});
