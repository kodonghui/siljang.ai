import { expect, it } from "vitest";
import { buildLedgerCheckpoint } from "../src/ledger-checkpoint";
import { writeLedgerSheet } from "../src/ledger-sheet-write";
import { Secret } from "../src/settings";
import { TEST_DATABASE_URL } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop } from "./support/shops";

it.skipIf(!TEST_DATABASE_URL)(
  "CPU 중단으로 결과를 기록하지 못해도 5분 뒤 이미 쓴 ID를 확인하고 재전송하지 않는다",
  async () => {
    const isolated = await isolatedTestDb();
    try {
      const shop = await createShop(isolated.db, "합성 CPU 중단"),
        link = crypto.randomUUID(),
        row = crypto.randomUUID(),
        write = crypto.randomUUID();
      const file = "synthetic_sheet_1234567890",
        lease = new Date(Date.now() + 120000);
      await isolated.db.query(
        "INSERT INTO ledger_links(id,shop_id,spreadsheet_id,sheet_name,our_columns,credential_ref) VALUES($1,$2,$3,'장부','{}',$4)",
        [link, shop.shopId, file, crypto.randomUUID()],
      );
      await isolated.db.query("INSERT INTO ledger_rows(id,shop_id,order_id) VALUES($1,$2,$3)", [
        row,
        shop.shopId,
        shop.orderId,
      ]);
      await isolated.db.query(
        "INSERT INTO ledger_writes(id,shop_id,ledger_row_id,event_key,event_kind,next_attempt_at) VALUES($1,$2,$3,$4,'changed',now()-interval '1 minute')",
        [write, shop.shopId, row, `ledger:${write}:changed`],
      );
      const first = await isolated.db.query<{ row_values: (string | number)[] }>(
        "SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)",
        [shop.shopId, write, lease],
      );
      expect(first.rowCount).toBe(1);
      const valuesBefore = first.rows[0]?.row_values ?? [];
      const key = new Secret("synthetic-hash-key");
      const context = { file, tab: "장부", eventId: write, orderId: shop.orderId };
      const baseline = await buildLedgerCheckpoint(
        key,
        context,
        [],
        [...valuesBefore, write.replaceAll("-", ""), shop.orderId.replaceAll("-", "")],
      );
      await isolated.db.query("SELECT siljang_ledger_private.save_ledger_checkpoint($1,$2,$3,$4,$5::jsonb)", [
        shop.shopId,
        write,
        lease,
        link,
        JSON.stringify(baseline),
      ]);
      // 구글 반영 직후 실행이 강제 종료되어 결과 기록 없이 임대가 만료된 상태다.
      await isolated.db.query("UPDATE ledger_writes SET next_attempt_at=now()-interval '1 second' WHERE id=$1", [
        write,
      ]);
      await isolated.db.query("UPDATE ledger_links SET write_lease_until=now()-interval '1 second' WHERE id=$1", [
        link,
      ]);
      const recovered = await isolated.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [
        shop.shopId,
        write,
        new Date(Date.now() + 120000),
      ]);
      expect(recovered.rowCount).toBe(0);
      const state = (
        await isolated.db.query<{ write_uncertain: boolean; next_attempt_at: Date }>(
          "SELECT write_uncertain,next_attempt_at FROM ledger_writes WHERE id=$1",
          [write],
        )
      ).rows[0];
      expect(state?.write_uncertain).toBe(true);
      expect(state?.next_attempt_at.getTime()).toBeGreaterThan(Date.now() + 299000);
      await isolated.db.query("UPDATE ledger_writes SET next_attempt_at=now()-interval '1 second' WHERE id=$1", [
        write,
      ]);
      const retry = (
        await isolated.db.query<{
          uncertain: boolean;
          row_values: (string | number)[];
          checkpoint_hashes: import("../src/ledger-checkpoint").LedgerCheckpoint;
        }>("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [
          shop.shopId,
          write,
          new Date(Date.now() + 120000),
        ])
      ).rows[0];
      expect(retry?.uncertain).toBe(true);
      const values = retry?.row_values ?? [];
      let posts = 0;
      await writeLedgerSheet(
        {
          file,
          tab: "장부",
          access: new Secret("fake"),
          hashKey: new Secret("synthetic-hash-key"),
          setup: {
            sheetId: 1,
            start: 0,
            end: 14,
            sheetColumnCount: 14,
            movedRight: false,
            ownershipToken: "test",
            columns: [],
          },
          values,
          shopId: shop.shopId,
          linkId: link,
          eventId: write,
          orderId: shop.orderId,
          uncertain: true,
          checkpoint: retry?.checkpoint_hashes ?? null,
        },
        {
          fetch: async (_raw, init) => {
            if (init?.method === "POST") posts++;
            return Response.json({
              values: [["header"], [...values, write.replaceAll("-", ""), shop.orderId.replaceAll("-", "")]],
            });
          },
        },
      );
      expect(posts).toBe(0);
    } finally {
      await isolated.close();
    }
  },
  30000,
);
