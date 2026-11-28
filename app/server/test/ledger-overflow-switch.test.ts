import { expect, it } from "vitest";
import { TEST_DATABASE_URL } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createLedgerShop } from "./support/ledger-shop";

it.skipIf(!TEST_DATABASE_URL)(
  "숨김 열 한도에 닿으면 장부 쓰기를 다시 끄고 사장님 할 일을 남긴다",
  async () => {
    const db = await isolatedTestDb();
    try {
      const shop = await createLedgerShop(db.db, "열 한도"),
        otherShop = await createLedgerShop(db.db, "다른 가게"),
        link = crypto.randomUUID(),
        row = crypto.randomUUID(),
        write = crypto.randomUUID(),
        lease = new Date(Date.now() + 120000);
      await db.db.query(
        "INSERT INTO ledger_links(id,shop_id,spreadsheet_id,sheet_name,our_columns,credential_ref) VALUES($1,$2,'synthetic_sheet_1234567890','장부','{}',$3)",
        [link, shop.shopId, crypto.randomUUID()],
      );
      await db.db.query("INSERT INTO ledger_rows(id,shop_id,order_id) VALUES($1,$2,$3)", [
        row,
        shop.shopId,
        shop.orderId,
      ]);
      await db.db.query(
        "INSERT INTO ledger_writes(id,shop_id,ledger_row_id,event_key,event_kind,next_attempt_at) VALUES($1,$2,$3,$4,'changed',now()-interval '1 second')",
        [write, shop.shopId, row, `write:${write}`],
      );
      expect(
        (
          await db.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [
            shop.shopId,
            write,
            lease,
          ])
        ).rowCount,
      ).toBe(1);
      const finished = await db.db.query<{ ok: boolean }>(
        "SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,'overflow',now(),NULL) AS ok",
        [shop.shopId, write, lease],
      );
      expect(finished.rows[0]?.ok).toBe(true);
      expect(
        (
          await db.db.query<{ enabled: boolean }>("SELECT ledger_write_enabled AS enabled FROM shops WHERE id=$1", [
            shop.shopId,
          ])
        ).rows[0]?.enabled,
      ).toBe(false);
      expect(
        (
          await db.db.query<{ enabled: boolean }>("SELECT ledger_write_enabled AS enabled FROM shops WHERE id=$1", [
            otherShop.shopId,
          ])
        ).rows[0]?.enabled,
      ).toBe(true);
      expect(
        (await db.db.query<{ status: string }>("SELECT status FROM ledger_links WHERE id=$1", [link])).rows[0]?.status,
      ).toBe("linked");
      expect(
        (
          await db.db.query("SELECT id FROM owner_tasks WHERE shop_id=$1 AND event_key=$2 AND closed_at IS NULL", [
            shop.shopId,
            `task:ledger_columns:${link}`,
          ])
        ).rowCount,
      ).toBe(1);
    } finally {
      await db.close();
    }
  },
  30000,
);

it.skipIf(!TEST_DATABASE_URL)(
  "첫 쓰기 준비에서 한도를 발견하면 시트에 쓰지 않고 자동으로 끄며 할 일을 만든다",
  async () => {
    const { vi } = await import("vitest"),
      { runDueJobs } = await import("../src/job-runner"),
      { ledgerWriteJob } = await import("../src/ledger-write-job"),
      { createServices } = await import("../src/services"),
      { readSettings, Secret } = await import("../src/settings"),
      { signLegacyLedgerColumns, LEDGER_HEADERS, LEDGER_MAX_COLUMNS } = await import("../src/ledger-sheet-columns"),
      { newFieldKey, testFieldCrypto } = await import("./support/field-keys"),
      { ledgerDuplicateSummary } = await import("../src/owner-tasks"),
      { createTestRole, roleConnection } = await import("./support/purge-role"),
      { testDb } = await import("./support/db");
    const db = await isolatedTestDb(),
      file = "synthetic_sheet_1234567890",
      hash = `test-${crypto.randomUUID()}`,
      role = `overflow157_${crypto.randomUUID().replaceAll("-", "")}`;
    let sheetPosts = 0;
    try {
      await db.db.query(
        "CREATE SCHEMA vault; CREATE TABLE vault.secrets(id uuid PRIMARY KEY,name text,secret text); CREATE VIEW vault.decrypted_secrets AS SELECT id,name,secret AS decrypted_secret FROM vault.secrets",
      );
      await createTestRole(db.db, role, "app");
      const shop = await createLedgerShop(db.db, "열이 가득 찬 시트"),
        link = crypto.randomUUID(),
        ref = crypto.randomUUID(),
        row = crypto.randomUUID(),
        write = crypto.randomUUID();
      const fields = testFieldCrypto(new Map([[1, newFieldKey()]]), 1),
        envelope = await fields.seal("synthetic-refresh", {
          purpose: "ledger_links.oauth_token",
          shopId: shop.shopId,
          recordId: link,
        });
      await db.db.query("INSERT INTO vault.secrets(id,name,secret) VALUES($1,$2,$3)", [
        ref,
        `siljang-ledger:${shop.shopId}:${link}`,
        envelope,
      ]);
      await db.db.query(
        "INSERT INTO ledger_links(id,shop_id,spreadsheet_id,sheet_name,our_columns,credential_ref) VALUES($1,$2,$3,'장부','{}',$4)",
        [link, shop.shopId, file, ref],
      );
      await db.db.query("INSERT INTO ledger_rows(id,shop_id,order_id) VALUES($1,$2,$3)", [
        row,
        shop.shopId,
        shop.orderId,
      ]);
      await db.db.query(
        "INSERT INTO ledger_writes(id,shop_id,ledger_row_id,event_key,event_kind,next_attempt_at) VALUES($1,$2,$3,$4,'changed',now()-interval '1 second')",
        [write, shop.shopId, row, `write:${write}`],
      );
      const token = await signLegacyLedgerColumns(
        new Secret(hash),
        { shopId: shop.shopId, spreadsheetId: file, sheetId: 7 },
        0,
        false,
      );
      const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (raw, init) => {
        const url = new URL(String(raw));
        if (url.hostname === "oauth2.googleapis.com")
          return Response.json({ access_token: "fake-access", token_type: "Bearer", expires_in: 3600 });
        if (init?.method === "POST") {
          sheetPosts++;
          throw new Error("시트에 쓰면 안 됨");
        }
        if (url.pathname.includes("/values/")) return Response.json({ values: [LEDGER_HEADERS] });
        return Response.json({
          sheets: [
            {
              properties: {
                sheetId: 7,
                title: "장부",
                sheetType: "GRID",
                gridProperties: { columnCount: LEDGER_MAX_COLUMNS, rowCount: 5000 },
              },
              developerMetadata: [
                {
                  metadataKey: "siljang_columns_v1",
                  metadataValue: token,
                  visibility: "PROJECT",
                  location: { dimensionRange: { sheetId: 7, dimension: "COLUMNS", startIndex: 0, endIndex: 1 } },
                },
              ],
            },
          ],
        });
      });
      const jobDb = roleConnection(db.connect(), role);
      try {
        const settings = readSettings({
          APP_ENV: "development",
          REQUEST_HASH_KEY: hash,
          GOOGLE_CLIENT_ID: "test-client",
          GOOGLE_CLIENT_SECRET: "test-secret",
          GOOGLE_LEDGER_REDIRECT_URIS: "https://test.example/callback",
        });
        const services = createServices({}, settings, { fieldCrypto: fields });
        const result = await runDueJobs({
          db: jobDb,
          now: new Date(),
          jobs: [
            {
              name: "ledger_write",
              every: "minute",
              sources: ["ledger_write"],
              handler: ledgerWriteJob(settings, services, () => roleConnection(db.connect(), role)),
            },
          ],
          log: () => {},
        });
        expect(result.jobs.ledger_write?.done).toBe(1);
        expect(sheetPosts).toBe(0);
        expect(
          (
            await db.db.query<{ enabled: boolean }>("SELECT ledger_write_enabled AS enabled FROM shops WHERE id=$1", [
              shop.shopId,
            ])
          ).rows[0]?.enabled,
        ).toBe(false);
        const task = (
          await db.db.query<{ event_key: string; order_id: string | null }>(
            "SELECT event_key,order_id FROM owner_tasks WHERE shop_id=$1 AND event_key=$2 AND closed_at IS NULL",
            [shop.shopId, `task:ledger_columns:${link}`],
          )
        ).rows[0];
        expect(task?.order_id).toBeNull();
        expect(ledgerDuplicateSummary(task?.event_key ?? "", null)).toContain("열이 가득");
        expect(
          (await db.db.query<{ status: string }>("SELECT status FROM ledger_links WHERE id=$1", [link])).rows[0]
            ?.status,
        ).toBe("linked");
      } finally {
        await jobDb.close();
        fetch.mockRestore();
      }
    } finally {
      await db.close();
      const admin = testDb();
      try {
        await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      } finally {
        await admin.close();
      }
    }
  },
  30000,
);
