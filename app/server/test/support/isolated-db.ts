import { readdirSync, readFileSync } from "node:fs";
import { Client } from "pg";
import { pgConnector, type RequestDb } from "../../src/db";
import { Secret } from "../../src/settings";
import { TEST_DATABASE_URL } from "./db";

/** 여러 가게의 실제 지우기 시험은 다른 시험 자료를 건드리지 않는 독립 DB에서 한다. */
export async function isolatedTestDb(): Promise<{
  readonly db: RequestDb;
  readonly connect: () => RequestDb;
  close(): Promise<void>;
}> {
  const name = `purge_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: TEST_DATABASE_URL });
  await admin.connect();
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  const secret = new Secret(url.toString());
  let db: RequestDb | undefined;
  try {
    await admin.query(`CREATE DATABASE ${name}`);
    const setup = new Client({ connectionString: url.toString() });
    try {
      await setup.connect();
      const dir = new URL("../../../../db/migrations/", import.meta.url);
      for (const file of readdirSync(dir)
        .filter((p) => /^\d{4}_.+\.sql$/.test(p))
        .sort()) {
        await setup.query(readFileSync(new URL(file, dir), "utf8"));
      }
    } finally {
      await setup.end();
    }
    db = pgConnector(secret);
    return {
      db,
      connect: () => pgConnector(secret),
      async close() {
        try {
          await db?.close();
        } finally {
          try {
            await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
          } finally {
            await admin.end();
          }
        }
      },
    };
  } catch (error) {
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    } finally {
      await admin.end();
    }
    throw error;
  }
}
