import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { describeDb, newUuid, testDb } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const source = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const generator = fileURLToPath(new URL("../../../tools/build-staging-db-update.py", import.meta.url));

function render(role: string, cleanup: string): string {
  return execFileSync(
    "python3",
    ["-I", generator, "--source-commit", source, "--role", role, "--cleanup-ops-id", cleanup],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

async function scenario(
  run: (s: {
    db: Awaited<ReturnType<typeof isolatedTestDb>>["db"];
    role: string;
    cleanup: string;
    other: string;
  }) => Promise<void>,
) {
  const isolated = await isolatedTestDb({ lastMigration: 22 });
  const admin = testDb();
  const role = `migration_test_${newUuid().replaceAll("-", "")}`;
  let created = false;
  try {
    await admin.query(`CREATE ROLE "${role}" LOGIN NOINHERIT`);
    created = true;
    await isolated.db.query(`CREATE SCHEMA siljang_deploy; CREATE TABLE siljang_deploy.migrations (
      filename text PRIMARY KEY, source_commit text NOT NULL, sha256 text NOT NULL, applied_at timestamptz NOT NULL)`);
    const dir = new URL("../../../db/migrations/", import.meta.url);
    for (const file of readdirSync(dir)
      .filter((f) => /^\d{4}_.+\.sql$/.test(f) && Number(f.slice(0, 4)) <= 22)
      .sort()) {
      const sha = createHash("sha256")
        .update(readFileSync(new URL(file, dir)))
        .digest("hex");
      await isolated.db.query("INSERT INTO siljang_deploy.migrations VALUES ($1, $2, $3, now())", [file, source, sha]);
    }
    await isolated.db.query(
      `GRANT USAGE ON SCHEMA public TO "${role}"; GRANT INSERT, DELETE ON access_logs TO "${role}"; GRANT SELECT (accessed_at) ON access_logs TO "${role}"`,
    );
    const cleanup = newUuid();
    const other = newUuid();
    await isolated.db.query(
      `INSERT INTO ops_events (id, kind, count, detail) VALUES
      ($1, 'privacy_transfer_missing', 0, '{"task173_probe":1}'), ($2, 'privacy_transfer_missing', 1, '{"task173_probe":1}')`,
      [cleanup, other],
    );
    await run({ db: isolated.db, role, cleanup, other });
  } finally {
    try {
      await isolated.close();
    } finally {
      try {
        if (created) await admin.query(`DROP ROLE "${role}"`);
      } finally {
        await admin.close();
      }
    }
  }
}

describeDb("기존 DB 원장을 지키는 스테이징 갱신(TASK-173)", () => {
  it("원장 22건에서 36건으로 진행하고 반복해도 지정한 합성 행만 지움", async () => {
    await scenario(async ({ db, role, cleanup, other }) => {
      const sql = render(role, cleanup);
      await db.query(sql);
      await db.query(sql);
      expect((await db.query("SELECT count(*)::int AS n FROM siljang_deploy.migrations")).rows).toEqual([{ n: 36 }]);
      expect(
        (
          await db.query(
            "SELECT to_regprocedure('public.resubmit_shop_license(uuid,uuid,text,timestamptz,text,text,text,text)') IS NOT NULL AS present",
          )
        ).rows,
      ).toEqual([{ present: true }]);
      expect(
        (
          await db.query(
            "SELECT to_regprocedure('public.review_shop_identity(uuid,uuid,uuid,text,timestamptz,text,uuid,text,text,text)') IS NOT NULL AS present",
          )
        ).rows,
      ).toEqual([{ present: true }]);
      expect(
        (
          await db.query(
            "SELECT to_regprocedure('public.review_shop_license(uuid,uuid,text,timestamptz,text,text,text)') IS NOT NULL AS present",
          )
        ).rows,
      ).toEqual([{ present: true }]);
      expect(
        (
          await db.query(
            "SELECT to_regprocedure('public.claim_kakao_bot(uuid,text,timestamptz)') IS NOT NULL AS present",
          )
        ).rows,
      ).toEqual([{ present: true }]);
      expect(
        (await db.query("SELECT to_regprocedure('public.payment_account_license_pending()') IS NOT NULL AS present"))
          .rows,
      ).toEqual([{ present: true }]);
      expect((await db.query("SELECT to_regclass('public.owner_sessions') IS NOT NULL AS present")).rows).toEqual([
        { present: true },
      ]);
      expect((await db.query("SELECT id FROM ops_events WHERE id = ANY($1::uuid[])", [[cleanup, other]])).rows).toEqual(
        [{ id: other }],
      );
      expect(
        (
          await db.query(
            "SELECT has_table_privilege($1, 'owner_sessions', 'UPDATE') AS session_update, has_table_privilege($1, 'access_logs', 'SELECT') AS access_select",
            [role],
          )
        ).rows,
      ).toEqual([{ session_update: true, access_select: false }]);
    });
  }, 30_000);

  it("이미 적용한 파일 해시가 다르면 DDL·권한 변경 전에 중단", async () => {
    await scenario(async ({ db, role, cleanup }) => {
      await db.query("UPDATE siljang_deploy.migrations SET sha256 = repeat('0', 64) WHERE filename LIKE '0001_%'");
      await expect(db.query(render(role, cleanup))).rejects.toMatchObject({ code: "P0001" });
      await db.query("ROLLBACK");
      expect((await db.query("SELECT to_regclass('public.owner_sessions') IS NULL AS absent")).rows).toEqual([
        { absent: true },
      ]);
    });
  }, 30_000);

  it("원장에 없는 중간 DDL이 있으면 같은 실행의 앞선 변경도 되돌림", async () => {
    await scenario(async ({ db, role, cleanup }) => {
      await db.query("CREATE TABLE owner_sessions (id uuid)");
      await expect(db.query(render(role, cleanup))).rejects.toMatchObject({ code: "42P07" });
      await db.query("ROLLBACK");
      expect((await db.query("SELECT count(*)::int AS n FROM siljang_deploy.migrations")).rows).toEqual([{ n: 22 }]);
      expect(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'kakao_callback_enc'",
          )
        ).rows,
      ).toEqual([{ n: 0 }]);
    });
  }, 30_000);
});
