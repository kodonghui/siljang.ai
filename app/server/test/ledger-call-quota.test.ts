import { expect, it } from "vitest";
import { TEST_DATABASE_URL } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop } from "./support/shops";

it.skipIf(!TEST_DATABASE_URL)("여러 가게에서도 최근 60초 장부 호출 시작은 다섯 건으로 제한한다", async () => {
  const isolated = await isolatedTestDb();
  try {
    let sixth: { shop: string; write: string } | undefined;
    for (let i = 0; i < 6; i++) {
      const shop = await createShop(isolated.db, `호출 한도 ${i}`),
        link = crypto.randomUUID(),
        row = crypto.randomUUID(),
        write = crypto.randomUUID();
      await isolated.db.query(
        "INSERT INTO ledger_links(id,shop_id,spreadsheet_id,sheet_name,our_columns,credential_ref) VALUES($1,$2,$3,'장부','{}',$4)",
        [link, shop.shopId, "synthetic_sheet_1234567890", crypto.randomUUID()],
      );
      await isolated.db.query("INSERT INTO ledger_rows(id,shop_id,order_id) VALUES($1,$2,$3)", [
        row,
        shop.shopId,
        shop.orderId,
      ]);
      await isolated.db.query(
        "INSERT INTO ledger_writes(id,shop_id,ledger_row_id,event_key,event_kind,next_attempt_at) VALUES($1,$2,$3,$4,'changed',now()-interval '1 second')",
        [write, shop.shopId, row, `ledger:${write}:changed`],
      );
      const result = await isolated.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [
        shop.shopId,
        write,
        new Date(Date.now() + 120000),
      ]);
      expect(result.rowCount).toBe(i < 5 ? 1 : 0);
      if (i === 5) sixth = { shop: shop.shopId, write };
    }
    expect(sixth).toBeDefined();
    const due = (
      await isolated.db.query<{ next_attempt_at: Date }>("SELECT next_attempt_at FROM ledger_writes WHERE id=$1", [
        sixth?.write,
      ])
    ).rows[0]?.next_attempt_at;
    expect(due?.getTime()).toBeLessThan(Date.now());
  } finally {
    await isolated.close();
  }
});

it.skipIf(!TEST_DATABASE_URL)("호출 한도에 막힌 오래된 작업은 50건 뒤의 새 작업보다 먼저 남는다", async () => {
  const isolated = await isolatedTestDb();
  try {
    const shop = await createShop(isolated.db, "한도 공정성"),
      link = crypto.randomUUID(),
      row = crypto.randomUUID(),
      first = crypto.randomUUID();
    await isolated.db.query(
      "INSERT INTO ledger_links(id,shop_id,spreadsheet_id,sheet_name,our_columns,credential_ref) VALUES($1,$2,$3,'장부','{}',$4)",
      [link, shop.shopId, "synthetic_sheet_1234567890", crypto.randomUUID()],
    );
    await isolated.db.query("INSERT INTO ledger_rows(id,shop_id,order_id) VALUES($1,$2,$3)", [
      row,
      shop.shopId,
      shop.orderId,
    ]);
    await isolated.db.query(
      "INSERT INTO ledger_writes(id,shop_id,ledger_row_id,event_key,event_kind,next_attempt_at) VALUES($1,$2,$3,$4,'changed',now()-interval '2 minutes')",
      [first, shop.shopId, row, `ledger:${first}:changed`],
    );
    await isolated.db.query(
      "INSERT INTO siljang_ledger_private.ledger_call_slots(started_at) SELECT now() FROM generate_series(1,5)",
    );
    expect(
      (
        await isolated.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [
          shop.shopId,
          first,
          new Date(Date.now() + 120000),
        ])
      ).rowCount,
    ).toBe(0);
    await isolated.db.query(
      "INSERT INTO ledger_writes(shop_id,ledger_row_id,event_key,event_kind,next_attempt_at) SELECT $1,$2,'new:'||g,'changed',now()-interval '1 minute' FROM generate_series(1,51) g",
      [shop.shopId, row],
    );
    const next = (
      await isolated.db.query<{ id: string }>(
        "SELECT id FROM ledger_writes WHERE status='pending' ORDER BY next_attempt_at,id LIMIT 1",
      )
    ).rows[0]?.id;
    expect(next).toBe(first);
  } finally {
    await isolated.close();
  }
});
