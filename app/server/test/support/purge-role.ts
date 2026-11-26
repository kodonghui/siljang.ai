import { readFileSync } from "node:fs";
import type { Queryable, RequestDb } from "../../src/db";

function identifier(role: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(role)) throw new TypeError("invalid synthetic role");
  return `"${role}"`;
}
export async function createTestRole(db: Queryable, role: string, kind: "app" | "purge") {
  const id = identifier(role),
    variable = kind === "app" ? "runtime_role" : "purge_role";
  await db.query(`CREATE ROLE ${id} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
  const file = kind === "app" ? "staging-login-callback-grants.sql" : "staging-purge-grants.sql";
  await db.query(
    readFileSync(new URL(`../../../../tools/${file}`, import.meta.url), "utf8").replaceAll(`:"${variable}"`, id),
  );
}
export function roleConnection(raw: RequestDb, role: string): RequestDb {
  const id = identifier(role);
  const transaction = <T>(fn: (tx: Queryable) => Promise<T>) =>
    raw.transaction(async (tx) => {
      await tx.query(`SET LOCAL ROLE ${id}`);
      return fn(tx);
    });
  return {
    query: (sql, params) => transaction((tx) => tx.query(sql, params)),
    transaction,
    abort: () => raw.abort(),
    close: () => raw.close(),
  };
}
