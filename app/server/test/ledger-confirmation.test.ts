import { expect, it } from "vitest";
import { ledgerConfirmation } from "../src/ledger-confirmation";
import { LEDGER_STORAGE_HEADERS, signLedgerColumns } from "../src/ledger-sheet-columns";
import { ledgerRowDigest } from "../src/ledger-sheet-write";
import { Secret } from "../src/settings";

it("사장님 확인은 읽은 주문·파일·행의 서명만 만들고 시트를 수정하지 않는다", async () => {
  const key = new Secret("synthetic-key"),
    shopId = crypto.randomUUID(),
    linkId = crypto.randomUUID(),
    orderId = crypto.randomUUID(),
    eventId = crypto.randomUUID().replaceAll("-", ""),
    file = "synthetic_sheet_1234567890",
    tab = "장부";
  const proof = await signLedgerColumns(key, { shopId, spreadsheetId: file, sheetId: 7 }, 0, false);
  const row = [
    "ABC123",
    "합성 이름",
    "010-0000-0000",
    "",
    "",
    "",
    0,
    "",
    "",
    0,
    "",
    "",
    eventId,
    orderId.replaceAll("-", ""),
  ];
  let sheetWrites = 0;
  const send = async (raw: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(raw));
    if (url.hostname === "oauth2.googleapis.com")
      return Response.json({ access_token: "fake-access", token_type: "Bearer", expires_in: 3600 });
    if (url.hostname === "www.googleapis.com")
      return Response.json({
        id: file,
        mimeType: "application/vnd.google-apps.spreadsheet",
        capabilities: { canEdit: true },
      });
    if (init?.method === "POST") {
      sheetWrites++;
      throw new Error("unexpected sheet write");
    }
    if (url.pathname.includes("/values/"))
      return Response.json({ values: url.pathname.includes("1%3A1") ? [LEDGER_STORAGE_HEADERS] : [["주문번호"], row] });
    return Response.json({
      sheets: [
        {
          properties: {
            sheetId: 7,
            title: tab,
            sheetType: "GRID",
            gridProperties: { columnCount: 14, rowCount: 5000 },
          },
          developerMetadata: [
            {
              metadataKey: "siljang_columns_v1",
              metadataValue: proof,
              visibility: "PROJECT",
              location: { dimensionRange: { sheetId: 7, dimension: "COLUMNS", startIndex: 0, endIndex: 1 } },
            },
          ],
        },
      ],
    });
  };
  const svc = ledgerConfirmation(
    key,
    { clientId: new Secret("id"), clientSecret: new Secret("secret") },
    { fetch: send },
  );
  const result = await svc.inspect({
    shopId,
    linkId,
    orderId,
    orderNo: "ABC123",
    file,
    tab,
    refreshToken: new Secret("synthetic-refresh"),
  });
  expect(result).toEqual({
    eventId,
    digest: await ledgerRowDigest(key, row),
    targetKey: await ledgerRowDigest(key, ["ledger-target", file, tab]),
    keyVersion: await ledgerRowDigest(key, ["ledger-key-version-v1"]),
  });
  expect(JSON.stringify(result)).not.toContain("합성 이름");
  expect(sheetWrites).toBe(0);
});

it.skipIf(!(await import("./support/db")).TEST_DATABASE_URL)(
  "할 일의 확인 버튼은 사장님 가게와 주문을 검증하고 그 행의 서명만 저장한다",
  async () => {
    const { isolatedTestDb } = await import("./support/isolated-db"),
      { createShop } = await import("./support/shops"),
      { createApp } = await import("../src/app"),
      { createShopScope } = await import("../src/shop-scope"),
      { newFieldKey, testFieldCrypto } = await import("./support/field-keys"),
      { testEnv, testDb } = await import("./support/db"),
      { createTestRole, roleConnection } = await import("./support/purge-role");
    const db = await isolatedTestDb(),
      role = `confirm157_${crypto.randomUUID().replaceAll("-", "")}`;
    try {
      await db.db.query(
        "CREATE SCHEMA vault; CREATE TABLE vault.secrets(id uuid PRIMARY KEY,name text,secret text); CREATE VIEW vault.decrypted_secrets AS SELECT id,name,secret AS decrypted_secret FROM vault.secrets",
      );
      await createTestRole(db.db, role, "app");
      const shop = await createShop(db.db, "확인 버튼"),
        link = crypto.randomUUID(),
        ref = crypto.randomUUID(),
        row = crypto.randomUUID(),
        write = crypto.randomUUID();
      const fields = testFieldCrypto(new Map([[1, newFieldKey()]]), 1),
        encrypted = await fields.seal("synthetic-refresh", {
          purpose: "ledger_links.oauth_token",
          shopId: shop.shopId,
          recordId: link,
        });
      await db.db.query("INSERT INTO vault.secrets(id,name,secret) VALUES($1,$2,$3)", [
        ref,
        `siljang-ledger:${shop.shopId}:${link}`,
        encrypted,
      ]);
      await db.db.query(
        "INSERT INTO ledger_links(id,shop_id,spreadsheet_id,sheet_name,our_columns,credential_ref) VALUES($1,$2,$3,'장부','{}',$4)",
        [link, shop.shopId, "synthetic_sheet_1234567890", ref],
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
      const lease = new Date(Date.now() + 120000);
      await db.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [
        shop.shopId,
        write,
        lease,
      ]);
      await db.db.query("SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,'conflict',now(),NULL)", [
        shop.shopId,
        write,
        lease,
      ]);
      const task = (
        await db.db.query<{ id: string }>(
          "SELECT id FROM owner_tasks WHERE shop_id=$1 AND order_id=$2 AND closed_at IS NULL",
          [shop.shopId, shop.orderId],
        )
      ).rows[0]?.id;
      const result = {
        eventId: crypto.randomUUID().replaceAll("-", ""),
        digest: "D".repeat(43),
        targetKey: "T".repeat(43),
        keyVersion: "V".repeat(43),
      };
      let inspected = 0;
      const app = createApp({
        connect: () => roleConnection(db.connect(), role),
        scopes: { owner: async () => createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId }) },
        services: {
          fieldCrypto: fields,
          ledgerConfirmation: {
            inspect: async (input) => {
              inspected++;
              expect(input.orderId).toBe(shop.orderId);
              expect(input.refreshToken.reveal()).toBe("synthetic-refresh");
              return result;
            },
          },
        },
      });
      const path = `https://siljang.example/api/owner/tasks/${task}/ledger-confirmation`,
        headers = {
          origin: "http://localhost",
          "Idempotency-Key": "test-confirm-1234567890",
          "X-Expected-Shop-Id": shop.shopId,
        };
      const denied = await app.request(
        path,
        { method: "POST", headers: { ...headers, "X-Expected-Shop-Id": crypto.randomUUID() } },
        testEnv(),
      );
      expect(denied.status).toBe(401);
      expect(inspected).toBe(0);
      const response = await app.request(path, { method: "POST", headers }, testEnv());
      expect(response.status, await response.clone().text()).toBe(200);
      expect(await response.json()).toEqual({ outcome: "confirmed" });
      expect(inspected).toBe(1);
      const stored = (
        await db.db.query<{ sheet_hash: string; confirmed_target_key: string }>(
          "SELECT sheet_hash,confirmed_target_key FROM ledger_rows WHERE id=$1",
          [row],
        )
      ).rows[0];
      expect(stored).toEqual({ sheet_hash: result.digest, confirmed_target_key: result.targetKey });
      expect((await db.db.query("SELECT id FROM owner_tasks WHERE id=$1 AND closed_at IS NULL", [task])).rowCount).toBe(
        0,
      );
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
