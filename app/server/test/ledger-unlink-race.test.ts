import { expect, it } from "vitest";
import { TEST_DATABASE_URL } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop } from "./support/shops";

it.skipIf(!TEST_DATABASE_URL)(
  "쓰기 보호 잠금은 연결 해제 뒤 예전 파일 전송을 막고 진행 중 해제는 기다린다",
  async () => {
    const isolated = await isolatedTestDb();
    const a = isolated.connect(),
      b = isolated.connect();
    try {
      const shop = await createShop(isolated.db, "합성 연결 경합"),
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
      await isolated.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [
        shop.shopId,
        write,
        lease,
      ]);
      let release = () => {};
      const ready = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked = () => {};
      const acquired = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const writer = a.transaction(async (tx) => {
        const result = await tx.query<{ allowed: boolean }>(
          "SELECT siljang_ledger_private.guard_ledger_write($1,$2,$3,$4,$5,$6) AS allowed",
          [shop.shopId, link, write, lease, file, "장부"],
        );
        expect(result.rows[0]?.allowed).toBe(true);
        locked();
        await ready;
      });
      await Promise.race([acquired, writer]);
      let unlinked = false;
      const unlink = b.query("SELECT * FROM unlink_owner_ledger($1,$2,now())", [shop.shopId, shop.ownerId]).then(() => {
        unlinked = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(unlinked).toBe(false);
      release();
      await writer;
      await unlink;
      const after = await a.transaction((tx) =>
        tx.query<{ allowed: boolean }>(
          "SELECT siljang_ledger_private.guard_ledger_write($1,$2,$3,$4,$5,$6) AS allowed",
          [shop.shopId, link, write, lease, file, "장부"],
        ),
      );
      expect(after.rows[0]?.allowed).toBe(false);
    } finally {
      await a.close();
      await b.close();
      await isolated.close();
    }
  },
);
