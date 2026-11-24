import { readFileSync } from "node:fs";
import { Client } from "pg";
import { expect, it } from "vitest";
import { describeDb, newUuid, TEST_DATABASE_URL, testDb } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";

const probe = readFileSync(new URL("../../../tools/staging-kakao-runtime-probe.sql", import.meta.url), "utf8");
const definition = probe.slice(0, probe.lastIndexOf("\nSELECT pg_temp.siljang_kakao_runtime_probe("));
const grants = readFileSync(new URL("../../../tools/staging-login-callback-grants.sql", import.meta.url), "utf8");

async function scenario(adminOption: boolean, allowedInsert: boolean, canSet = false, switchedRole = false) {
  const isolated = await isolatedTestDb();
  const admin = testDb();
  const suffix = newUuid().replaceAll("-", "");
  const actor = `probe_actor_${suffix}`;
  const runtime = `probe_runtime_${suffix}`;
  let actorCreated = false;
  let runtimeCreated = false;
  let client: Client | undefined;
  try {
    await admin.query(`CREATE ROLE "${actor}" LOGIN NOINHERIT CREATEROLE`);
    actorCreated = true;
    await admin.query(`CREATE ROLE "${runtime}" NOLOGIN NOINHERIT`);
    runtimeCreated = true;
    await admin.query(`GRANT "${runtime}" TO "${actor}" WITH ADMIN ${adminOption}, INHERIT FALSE, SET ${canSet}`);
    await isolated.db.query(`GRANT USAGE ON SCHEMA public TO "${actor}", "${runtime}"`);
    await isolated.db.query(`GRANT ALL ON ALL TABLES IN SCHEMA public TO "${actor}"`);
    await isolated.db.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO "${actor}"`);
    await isolated.db.query(grants.replaceAll(':"runtime_role"', `"${runtime}"`));
    if (!allowedInsert) await isolated.db.query(`REVOKE INSERT ON messages FROM "${runtime}"`);
    const { rows } = await isolated.db.query<{ db: string }>("SELECT current_database() AS db");
    const url = new URL(TEST_DATABASE_URL);
    url.username = actor;
    url.password = "";
    const database = rows[0]?.db;
    if (!database) throw new Error("시험 데이터베이스 없음");
    url.pathname = `/${database}`;
    client = new Client({ connectionString: url.toString() });
    await client.connect();
    await client.query(definition);
    const before = await client.query("SELECT pg_has_role(current_user, $1, 'SET') AS can_set", [runtime]);
    expect(before.rows).toEqual([{ can_set: canSet }]);
    const membershipSql = `SELECT admin_option, inherit_option, set_option FROM pg_auth_members
      WHERE roleid = (SELECT oid FROM pg_roles WHERE rolname = $1)
      AND member = (SELECT oid FROM pg_roles WHERE rolname = current_user)`;
    const membershipBefore = await client.query(membershipSql, [runtime]);
    if (switchedRole) await client.query(`SET ROLE "${runtime}"`);
    const result = (await client.query("SELECT pg_temp.siljang_kakao_runtime_probe($1) AS result", [runtime])).rows[0]
      ?.result;
    if (switchedRole) await client.query("RESET ROLE");
    const after = await client.query("SELECT pg_has_role(current_user, $1, 'SET') AS can_set", [runtime]);
    expect(after.rows).toEqual([{ can_set: canSet }]);
    expect((await client.query(membershipSql, [runtime])).rows).toEqual(membershipBefore.rows);
    expect((await isolated.db.query("SELECT count(*)::int AS n FROM shops")).rows).toEqual([{ n: 0 }]);
    expect(result).toMatchObject({ rollback_verified: true, role_restored: true });
    return result;
  } finally {
    await client?.end();
    try {
      await isolated.close();
    } finally {
      try {
        if (actorCreated) await admin.query(`DROP ROLE "${actor}"`);
        if (runtimeCreated) await admin.query(`DROP ROLE "${runtime}"`);
      } finally {
        await admin.close();
      }
    }
  }
}

describeDb("실제 역할 쓰기 점검의 임시 역할 전환(TASK-028)", () => {
  it("관리자 옵션만 있는 편집기에서도 검사하고 멤버십과 합성 행을 모두 되돌림", async () => {
    expect(await scenario(true, true)).toMatchObject({
      allowed_writes: true,
      blocked_writes: 5,
      failure_sqlstate: null,
      membership_restored: true,
      temporary_grant_applied: true,
    });
  });

  it("관리자 옵션이 없으면 권한을 넓히지 않고 역할 전환 실패로 남김", async () => {
    expect(await scenario(false, true)).toMatchObject({
      allowed_writes: false,
      failure_sqlstate: "42501",
      failure_step: "set_runtime_role",
      membership_restored: true,
      temporary_grant_applied: false,
    });
  });

  it("전환 뒤 실제 쓰기 권한이 없으면 실패 위치를 남기고 임시 멤버십도 되돌림", async () => {
    expect(await scenario(true, false)).toMatchObject({
      allowed_writes: false,
      failure_sqlstate: "42501",
      failure_step: "insert_message",
      membership_restored: true,
      temporary_grant_applied: true,
    });
  });

  it("원래 SET이 있는 멤버십은 관리자 옵션 없이 그대로 검사함", async () => {
    expect(await scenario(false, true, true)).toMatchObject({
      allowed_writes: true,
      blocked_writes: 5,
      failure_sqlstate: null,
      membership_restored: true,
      temporary_grant_applied: false,
    });
  });

  it("앞서 SET ROLE을 한 연결은 합성 쓰기 전에 고정 분류로 거절함", async () => {
    expect(await scenario(false, true, true, true)).toMatchObject({
      allowed_writes: false,
      failure_sqlstate: "42501",
      failure_step: "check_session",
      membership_restored: true,
      temporary_grant_applied: false,
    });
  });

  it("없는 역할은 멤버십을 만들지 않고 안전한 실패 분류만 반환함", async () => {
    const isolated = await isolatedTestDb();
    try {
      await isolated.db.query(definition);
      const result = await isolated.db.query<{ result: Record<string, unknown> }>(
        "SELECT pg_temp.siljang_kakao_runtime_probe($1) AS result",
        [`absent_${newUuid().replaceAll("-", "")}`],
      );
      expect(result.rows[0]?.result).toMatchObject({
        allowed_writes: false,
        failure_sqlstate: "P0001",
        failure_step: "validate_target",
        rollback_verified: true,
        role_restored: true,
        membership_restored: true,
      });
    } finally {
      await isolated.close();
    }
  });
});
