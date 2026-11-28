import { expect, it } from "vitest";
import { TEST_DATABASE_URL } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop } from "./support/shops";

it.skipIf(!TEST_DATABASE_URL)("쓰기 전 비교 기준은 임대와 연결에 묶어 별도 저장하고 성공 기록 때 지운다", async () => {
  const isolated = await isolatedTestDb();
  try {
    const shop = await createShop(isolated.db, "비교 기준"),
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
    const lease = new Date(Date.now() + 120000);
    await isolated.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [
      shop.shopId,
      write,
      lease,
    ]);
    const envelope = `v1:${"A".repeat(50)}`;
    expect(
      (
        await isolated.db.query<{ ok: boolean }>(
          "SELECT siljang_ledger_private.save_ledger_checkpoint($1,$2,$3,$4,$5) AS ok",
          [shop.shopId, write, lease, link, envelope],
        )
      ).rows[0]?.ok,
    ).toBe(true);
    expect(
      (
        await isolated.db.query<{ checkpoint_enc: string }>("SELECT checkpoint_enc FROM ledger_writes WHERE id=$1", [
          write,
        ])
      ).rows[0]?.checkpoint_enc,
    ).toBe(envelope);
    await isolated.db.query("SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,'written',now(),NULL)", [
      shop.shopId,
      write,
      lease,
    ]);
    expect(
      (
        await isolated.db.query<{ checkpoint_enc: string | null }>(
          "SELECT checkpoint_enc FROM ledger_writes WHERE id=$1",
          [write],
        )
      ).rows[0]?.checkpoint_enc,
    ).toBeNull();
  } finally {
    await isolated.close();
  }
});
it.skipIf(!TEST_DATABASE_URL)("다른 주문의 행 충돌은 해당 주문에 사장님 할 일을 연결한다", async () => {
  const isolated = await isolatedTestDb();
  try {
    const shop = await createShop(isolated.db, "피해 주문"),
      other = crypto.randomUUID(),
      link = crypto.randomUUID(),
      row = crypto.randomUUID(),
      write = crypto.randomUUID();
    await isolated.db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO orders(id,shop_id,order_no,customer_id,consultation_id,kind,status,version,price_list_id,operating_rules_id,pickup_at,pickup_day,amount,remake_of_order_id,cancelled_at,cancel_kind) SELECT $2,shop_id,'REMAKE1',customer_id,consultation_id,'standard','cancelled',1,price_list_id,operating_rules_id,pickup_at,pickup_day,0,id,now(),'customer' FROM orders WHERE id=$1",
        [shop.orderId, other],
      );
      await tx.query(
        "INSERT INTO order_details(shop_id,order_id,version,source,price_list_id,pickup_at,allergy_consent,allergy_consent_at,amount) SELECT shop_id,$2,1,'remake',price_list_id,pickup_at,'not_required',now(),0 FROM order_details WHERE order_id=$1 AND version=1",
        [shop.orderId, other],
      );
    });
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
    const lease = new Date(Date.now() + 120000);
    await isolated.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [
      shop.shopId,
      write,
      lease,
    ]);
    await isolated.db.query("SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,'conflict',now(),$4::jsonb)", [
      shop.shopId,
      write,
      lease,
      JSON.stringify({ affectedOrderIds: [other] }),
    ]);
    const tasks = await isolated.db.query<{ order_id: string }>(
      "SELECT order_id FROM owner_tasks WHERE shop_id=$1 AND event_key=$2 AND closed_at IS NULL",
      [shop.shopId, `task:ledger_conflict:${other}`],
    );
    expect(tasks.rows).toEqual([{ order_id: other }]);
  } finally {
    await isolated.close();
  }
});
it.skipIf(!TEST_DATABASE_URL)("행 서명은 파일·탭과 기록 ID별로 보관한다", async () => {
  const isolated = await isolatedTestDb();
  try {
    const shop = await createShop(isolated.db, "대상별 서명"),
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
    const lease = new Date(Date.now() + 120000),
      key = "A".repeat(43),
      sig = "B".repeat(43);
    await isolated.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [
      shop.shopId,
      write,
      lease,
    ]);
    await isolated.db.query("SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,'written',now(),$4::jsonb)", [
      shop.shopId,
      write,
      lease,
      JSON.stringify({ targetKey: key, sheetHash: sig }),
    ]);
    const stored = (
      await isolated.db.query<{ sheet_hashes: Record<string, Record<string, string>> }>(
        "SELECT sheet_hashes FROM ledger_rows WHERE id=$1",
        [row],
      )
    ).rows[0]?.sheet_hashes;
    expect(stored?.[key]?.[write.replaceAll("-", "")]).toBe(sig);
  } finally {
    await isolated.close();
  }
});
