import { expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { ledgerConfirmation } from "../src/ledger-confirmation";
import { Secret } from "../src/settings";
import { createShopScope } from "../src/shop-scope";
import { TEST_DATABASE_URL, testEnv } from "./support/db";
import { newFieldKey, testFieldCrypto } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { createLedgerShop } from "./support/ledger-shop";

it.skipIf(!TEST_DATABASE_URL)(
  "API-084의 DB 연결이 끊기고 가게를 끈 뒤에는 진행 중 조회가 중단되고 새 구글 조회가 없다",
  async () => {
    const db = await isolatedTestDb();
    let notify: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      notify = resolve;
    });
    const fetch = vi.fn(async (_raw: string | URL | Request, init?: RequestInit) => {
      notify?.();
      if (!init?.signal?.aborted)
        await new Promise<void>((resolve) => init?.signal?.addEventListener("abort", () => resolve(), { once: true }));
      return Response.json({ access_token: "fake-access", token_type: "Bearer", expires_in: 3600 });
    });
    try {
      await db.db.query(
        "CREATE SCHEMA vault; CREATE TABLE vault.secrets(id uuid PRIMARY KEY,name text,secret text); CREATE VIEW vault.decrypted_secrets AS SELECT id,name,secret AS decrypted_secret FROM vault.secrets",
      );
      const shop = await createLedgerShop(db.db, "확인 연결 중단"),
        link = crypto.randomUUID(),
        ref = crypto.randomUUID(),
        row = crypto.randomUUID(),
        write = crypto.randomUUID();
      const fields = testFieldCrypto(new Map([[1, newFieldKey()]]), 1);
      const envelope = await fields.seal("synthetic-refresh", {
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
      const service = ledgerConfirmation(
        new Secret("synthetic-key"),
        { clientId: new Secret("id"), clientSecret: new Secret("secret") },
        { fetch },
      );
      const app = createApp({
        connect: () => db.connect(),
        scopes: { owner: async () => createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId }) },
        services: { fieldCrypto: fields, ledgerConfirmation: service },
      });
      const pending = app.request(
        `https://siljang.example/api/owner/tasks/${task}/ledger-confirmation`,
        {
          method: "POST",
          headers: {
            origin: "http://localhost",
            "Idempotency-Key": "disconnect-confirm-test",
            "X-Expected-Shop-Id": shop.shopId,
          },
        },
        testEnv(),
      );
      await started;
      const pid = (
        await db.db.query<{ pid: number }>(
          "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction' AND query LIKE '%prepare_ledger_confirmation%' LIMIT 1",
        )
      ).rows[0]?.pid;
      expect(pid).toBeTypeOf("number");
      await db.db.query("SELECT pg_terminate_backend($1)", [pid]);
      await db.db.query("UPDATE shops SET ledger_write_enabled=false WHERE id=$1", [shop.shopId]);
      const response = await pending;
      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      expect((await db.db.query("SELECT id FROM owner_tasks WHERE id=$1 AND closed_at IS NULL", [task])).rowCount).toBe(
        1,
      );
    } finally {
      await db.close();
    }
  },
  30000,
);
