import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { describeDb } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";

describeDb("Supabase 기본 역할의 함수 실행 권한", () => {
  it("기존 보안 함수의 직접 권한과 새 함수의 기본 권한을 회수한다", async () => {
    const isolated = await isolatedTestDb({ lastMigration: 48 });
    try {
      await isolated.db
        .transaction(async (tx) => {
          await tx.query(`DO $$ DECLARE r record; BEGIN
          FOR r IN SELECT unnest(ARRAY['anon','authenticated','service_role','test_runtime_0049','test_purge_0049','postgres']) AS name LOOP
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r.name) THEN EXECUTE format('CREATE ROLE %I',r.name); END IF;
          END LOOP;
        END $$;`);
          await tx.query(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC, anon, authenticated, service_role;
          ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC, anon, authenticated, service_role;
          GRANT CREATE ON SCHEMA public TO postgres;`);
          for (const [file, variable, role] of [
            ["staging-login-callback-grants.sql", "runtime_role", "test_runtime_0049"],
            ["staging-purge-grants.sql", "purge_role", "test_purge_0049"],
          ]) {
            await tx.query(
              readFileSync(new URL(`../../../tools/${file}`, import.meta.url), "utf8").replaceAll(
                `:"${variable}"`,
                `"${role}"`,
              ),
            );
          }
          const query = `SELECT p.oid::regprocedure::text AS name, r.rolname,
          has_function_privilege(r.oid,p.oid,'EXECUTE') AS allowed
          FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          CROSS JOIN pg_roles r WHERE n.nspname='public' AND p.prosecdef
          AND r.rolname = ANY($1::text[]) ORDER BY 1,2`;
          const roles = ["anon", "authenticated", "service_role"];
          const preserved = await tx.query<{ name: string; rolname: string; allowed: boolean }>(query, [
            ["test_runtime_0049", "test_purge_0049"],
          ]);
          const allowedNames = (role: string) =>
            preserved.rows
              .filter((row) => row.rolname === role && row.allowed)
              .map((row) => row.name.split("(")[0])
              .sort();
          expect(allowedNames("test_purge_0049")).toEqual([
            "purge_closed_consultation",
            "purge_expired_masked_value_erasures",
          ]);
          expect(allowedNames("test_runtime_0049")).toEqual([
            "claim_kakao_bot",
            "read_operator_consultation",
            "read_operator_messages",
            "read_operator_order",
            "read_operator_original",
            "read_operator_record_list",
            "read_prepared_consent_withdrawal_card",
            "read_prepared_issue_card",
            "refresh_pending_day_before_notice",
            "resubmit_shop_license",
            "review_shop_identity",
            "review_shop_license",
          ]);
          await tx.query(
            "GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO PUBLIC, anon, authenticated, service_role",
          );
          const before = await tx.query<{ name: string; allowed: boolean }>(query, [roles]);
          expect(before.rows.length).toBeGreaterThanOrEqual(42);
          expect(before.rows.every((row) => row.allowed)).toBe(true);
          await tx.query(
            readFileSync(
              new URL("../../../db/migrations/0049_revoke_supabase_definer_execute.sql", import.meta.url),
              "utf8",
            ),
          );
          const after = await tx.query<{ allowed: boolean }>(query, [roles]);
          expect(after.rows).toHaveLength(before.rows.length);
          expect(after.rows.every((row) => !row.allowed)).toBe(true);
          expect((await tx.query(query, [["test_runtime_0049", "test_purge_0049"]])).rows).toEqual(preserved.rows);
          await tx.query("SET LOCAL ROLE postgres");
          await tx.query(
            `CREATE FUNCTION public.test_future_0049() RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';`,
          );
          await tx.query("RESET ROLE");
          for (const role of roles) {
            const result = await tx.query<{ allowed: boolean }>(
              `SELECT has_function_privilege($1,'public.test_future_0049()','EXECUTE') AS allowed`,
              [role],
            );
            expect(result.rows[0]?.allowed).toBe(false);
          }
          throw new Error("rollback test roles");
        })
        .catch((error: Error) => {
          if (error.message !== "rollback test roles") throw error;
        });
    } finally {
      await isolated.close();
    }
  }, 30000);
});
