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
          FOR r IN SELECT unnest(ARRAY['anon','authenticated','service_role','test_runtime_0049','test_purge_0049']) AS name LOOP
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r.name) THEN EXECUTE format('CREATE ROLE %I',r.name); END IF;
          END LOOP;
        END $$;`);
          await tx.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
          ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
          ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC, anon, authenticated, service_role;
          GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO test_runtime_0049;
          GRANT EXECUTE ON FUNCTION public.purge_expired_masked_value_erasures(integer) TO test_purge_0049;`);
          const query = `SELECT p.oid::regprocedure::text AS name, r.rolname,
          has_function_privilege(r.oid,p.oid,'EXECUTE') AS allowed
          FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          CROSS JOIN pg_roles r WHERE n.nspname='public' AND p.prosecdef
          AND r.rolname = ANY($1::text[]) ORDER BY 1,2`;
          const roles = ["anon", "authenticated", "service_role"];
          const before = await tx.query<{ name: string; allowed: boolean }>(query, [roles]);
          expect(before.rows.length).toBeGreaterThanOrEqual(42);
          expect(before.rows.every((row) => row.allowed)).toBe(true);
          const preserved = await tx.query(query, [["test_runtime_0049", "test_purge_0049"]]);
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
          await tx.query(
            `CREATE FUNCTION public.test_future_0049() RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';`,
          );
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
