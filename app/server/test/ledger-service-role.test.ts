import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { TEST_DATABASE_URL, testDb } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";

it.skipIf(!TEST_DATABASE_URL)("기본 권한이 새 함수 실행을 허용해도 service_role에서 명시적으로 회수한다", async () => {
  const admin = testDb();
  const exists = (await admin.query("SELECT 1 FROM pg_roles WHERE rolname='service_role'")).rowCount === 1;
  if (!exists) await admin.query("CREATE ROLE service_role NOLOGIN");
  const isolated = await isolatedTestDb({ lastMigration: 56 });
  try {
    await isolated.db.query("ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO service_role");
    for (const file of ["0057_ledger_job_credential.sql", "0058_ledger_write_lease.sql"]) {
      await isolated.db.query(readFileSync(new URL(`../../../db/migrations/${file}`, import.meta.url), "utf8"));
    }
    for (const fn of [
      "read_leased_ledger_credential(uuid,uuid,uuid,timestamptz)",
      "claim_ledger_write(uuid,uuid,timestamptz)",
      "finish_ledger_write(uuid,uuid,timestamptz,text,timestamptz,jsonb)",
      "count_unwritten_orders(uuid)",
    ]) {
      const row = (
        await isolated.db.query<{ allowed: boolean }>(
          "SELECT has_function_privilege('service_role',$1,'EXECUTE') AS allowed",
          [`siljang_ledger_private.${fn}`],
        )
      ).rows[0];
      expect(row?.allowed, fn).toBe(false);
    }
  } finally {
    await isolated.close();
    if (!exists) await admin.query("DROP ROLE service_role");
    await admin.close();
  }
});
