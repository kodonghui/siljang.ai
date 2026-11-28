import { expect, it } from "vitest";
import { guardedLedgerFetch } from "../src/ledger-guarded-fetch";
import { purgeOrder } from "../src/purge-order";
import { createShopScope, shopDb } from "../src/shop-scope";
import { TEST_DATABASE_URL } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createLedgerShop as createShop } from "./support/ledger-shop";

async function fixture(db: Awaited<ReturnType<typeof isolatedTestDb>>) {
  const shop = await createShop(db.db, "재리뷰 다섯"),
    link = crypto.randomUUID(),
    row = crypto.randomUUID(),
    write = crypto.randomUUID();
  await db.db.query(
    "INSERT INTO ledger_links(id,shop_id,spreadsheet_id,sheet_name,our_columns,credential_ref) VALUES($1,$2,$3,'장부','{}',$4)",
    [link, shop.shopId, "synthetic_sheet_1234567890", crypto.randomUUID()],
  );
  await db.db.query("INSERT INTO ledger_rows(id,shop_id,order_id) VALUES($1,$2,$3)", [row, shop.shopId, shop.orderId]);
  await db.db.query(
    "INSERT INTO ledger_writes(id,shop_id,ledger_row_id,event_key,event_kind,next_attempt_at) VALUES($1,$2,$3,$4,'changed',now()-interval '1 second')",
    [write, shop.shopId, row, `a:${write}`],
  );
  return { ...shop, link, row, write };
}
it.skipIf(!TEST_DATABASE_URL)("중복이 확인되면 해당 주문만 보류하고 같은 가게 다른 주문은 쓴다", async () => {
  const db = await isolatedTestDb();
  try {
    const a = await fixture(db),
      order = crypto.randomUUID(),
      draft = crypto.randomUUID(),
      row = crypto.randomUUID(),
      write = crypto.randomUUID();
    await db.db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO order_drafts SELECT (jsonb_populate_record(NULL::order_drafts,to_jsonb(d)||jsonb_build_object('id',$2::uuid))).* FROM order_drafts d WHERE id=$1",
        [a.draftId, draft],
      );
      await tx.query(
        "INSERT INTO orders SELECT (jsonb_populate_record(NULL::orders,to_jsonb(o)||jsonb_build_object('id',$2::uuid,'order_no','OTHER12','draft_id',$3::uuid))).* FROM orders o WHERE id=$1",
        [a.orderId, order, draft],
      );
      await tx.query(
        "INSERT INTO order_details SELECT (jsonb_populate_record(NULL::order_details,to_jsonb(d)||jsonb_build_object('id',$3::uuid,'order_id',$2::uuid))).* FROM order_details d WHERE order_id=$1 AND version=1",
        [a.orderId, order, crypto.randomUUID()],
      );
    });
    await db.db.query("INSERT INTO ledger_rows(id,shop_id,order_id) VALUES($1,$2,$3)", [row, a.shopId, order]);
    await db.db.query(
      "INSERT INTO ledger_writes(id,shop_id,ledger_row_id,event_key,event_kind,next_attempt_at) VALUES($1,$2,$3,$4,'changed',now()-interval '1 second')",
      [write, a.shopId, row, `b:${write}`],
    );
    const lease = new Date(Date.now() + 120000);
    await db.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [a.shopId, a.write, lease]);
    await db.db.query("SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,'uncertain',now(),NULL)", [
      a.shopId,
      a.write,
      lease,
    ]);
    await db.db.query("UPDATE ledger_writes SET next_attempt_at=now()-interval '1 second' WHERE id=$1", [a.write]);
    await db.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [a.shopId, a.write, lease]);
    await db.db.query("SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,'duplicate',now(),NULL)", [
      a.shopId,
      a.write,
      lease,
    ]);
    expect(
      (
        await db.db.query<{ status: string; write_uncertain: boolean }>(
          "SELECT status,write_uncertain FROM ledger_writes WHERE id=$1",
          [a.write],
        )
      ).rows[0],
    ).toEqual({ status: "unlinked", write_uncertain: false });
    expect(
      (await db.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [a.shopId, write, lease]))
        .rowCount,
    ).toBe(1);
  } finally {
    await db.close();
  }
});
it.skipIf(!TEST_DATABASE_URL)("재연결만으로는 충돌 할 일을 닫거나 그 주문 쓰기를 승인하지 않는다", async () => {
  const db = await isolatedTestDb();
  try {
    const a = await fixture(db),
      lease = new Date(Date.now() + 120000);
    await db.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [a.shopId, a.write, lease]);
    await db.db.query("SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,'conflict',now(),NULL)", [
      a.shopId,
      a.write,
      lease,
    ]);
    await db.db.query("SELECT * FROM siljang_ledger_private.create_owner_ledger($1,$2,$3,$4,'장부','{}',$5,now())", [
      a.shopId,
      a.ownerId,
      crypto.randomUUID(),
      "synthetic_sheet_1234567890",
      `${a.link}.l`,
    ]);
    expect(
      (await db.db.query<{ status: string }>("SELECT status FROM ledger_writes WHERE id=$1", [a.write])).rows[0],
    ).toEqual({ status: "unlinked" });
    expect(
      (
        await db.db.query(
          "SELECT id FROM owner_tasks WHERE shop_id=$1 AND order_id=$2 AND event_key=$3 AND closed_at IS NULL",
          [a.shopId, a.orderId, `task:ledger_conflict:${a.orderId}`],
        )
      ).rowCount,
    ).toBe(1);
  } finally {
    await db.close();
  }
});
it.skipIf(!TEST_DATABASE_URL)("삭제가 먼저 끝나면 전송 직전 가드가 막아 구글 요청을 보내지 않는다", async () => {
  const db = await isolatedTestDb();
  try {
    const a = await fixture(db),
      lease = new Date(Date.now() + 120000);
    await db.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [a.shopId, a.write, lease]);
    await db.db.query(
      "UPDATE orders SET status='cancelled',cancel_kind='customer',cancelled_at=now()-interval '31 days',finished_at=now()-interval '31 days' WHERE id=$1",
      [a.orderId],
    );
    await db.db.query("UPDATE orders SET personal_data_purged_at=now() WHERE id=$1", [a.orderId]);
    let sent = 0;
    const revalidate = async () =>
      (
        await db.db.query<{ allowed: boolean }>(
          "SELECT siljang_ledger_private.guard_ledger_write($1,$2,$3,$4,$5,'장부') AS allowed",
          [a.shopId, a.link, a.write, lease, "synthetic_sheet_1234567890"],
        )
      ).rows[0]?.allowed === true;
    const fetch = guardedLedgerFetch(
      { signal: new AbortController().signal, revalidate },
      new AbortController().signal,
      async () => {
        sent++;
        return Response.json({});
      },
    );
    await expect(fetch("https://sheets.googleapis.com/test", { method: "POST" })).rejects.toThrow();
    expect(sent).toBe(0);
  } finally {
    await db.close();
  }
});
it.skipIf(!TEST_DATABASE_URL)(
  "실제 개인정보 삭제와 쓰기 완료가 동시에 실행돼도 교착 없이 끝난다",
  async () => {
    const db = await isolatedTestDb(),
      p = db.connect(),
      f = db.connect();
    try {
      const a = await fixture(db),
        lease = new Date(Date.now() + 120000);
      await db.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [
        a.shopId,
        a.write,
        lease,
      ]);
      await db.db.query("UPDATE ledger_writes SET checkpoint_hashes='{}' WHERE id=$1", [a.write]);
      await db.db.query(
        "UPDATE orders SET status='cancelled',cancel_kind='customer',cancelled_at=now()-interval '31 days',finished_at=now()-interval '31 days' WHERE id=$1",
        [a.orderId],
      );
      const scope = createShopScope(a.shopId, { kind: "job", job: "purge" });
      const results = await Promise.allSettled([
        p.transaction((tx) => purgeOrder(shopDb(scope, tx), a.orderId, new Date())),
        f.query("SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,'written',now(),$4::jsonb)", [
          a.shopId,
          a.write,
          lease,
          JSON.stringify({ sheetHash: "A".repeat(43), targetKey: "B".repeat(43), keyVersion: "C".repeat(43) }),
        ]),
      ]);
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
      if (results[0]?.status === "fulfilled" && results[0].value === 0)
        expect(await p.transaction((tx) => purgeOrder(shopDb(scope, tx), a.orderId, new Date()))).toBe(1);
      expect(
        (await db.db.query<{ sheet_hash: string | null }>("SELECT sheet_hash FROM ledger_rows WHERE id=$1", [a.row]))
          .rows[0]?.sheet_hash,
      ).toBeNull();
    } finally {
      await p.close();
      await f.close();
      await db.close();
    }
  },
  30000,
);
it.skipIf(!TEST_DATABASE_URL)("주문별 확인만 할 일을 닫고 해당 시트·행 서명으로 그 주문을 다시 연다", async () => {
  const db = await isolatedTestDb();
  try {
    const a = await fixture(db),
      lease = new Date(Date.now() + 120000),
      target = "T".repeat(43),
      hash = "H".repeat(43),
      version = "V".repeat(43),
      event = crypto.randomUUID().replaceAll("-", "");
    await db.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [a.shopId, a.write, lease]);
    await db.db.query("SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,'conflict',now(),NULL)", [
      a.shopId,
      a.write,
      lease,
    ]);
    const task = (
      await db.db.query<{ id: string }>(
        "SELECT id FROM owner_tasks WHERE shop_id=$1 AND order_id=$2 AND closed_at IS NULL",
        [a.shopId, a.orderId],
      )
    ).rows[0]?.id;
    expect(task).toBeDefined();
    const call = (owner: string, link: string) =>
      db.db.query<{ ok: boolean }>(
        "SELECT siljang_ledger_private.confirm_ledger_order($1,$2,$3,$4,$5,$6,$7,$8) AS ok",
        [a.shopId, owner, task, link, target, event, hash, version],
      );
    expect((await call(crypto.randomUUID(), a.link)).rows[0]?.ok).toBe(false);
    expect((await call(a.ownerId, crypto.randomUUID())).rows[0]?.ok).toBe(false);
    expect((await call(a.ownerId, a.link)).rows[0]?.ok).toBe(true);
    const r = (
      await db.db.query<{
        sheet_hash: string;
        sheet_hashes: Record<string, Record<string, string>>;
        confirmed_target_key: string;
      }>("SELECT sheet_hash,sheet_hashes,confirmed_target_key FROM ledger_rows WHERE id=$1", [a.row])
    ).rows[0];
    expect(r?.sheet_hash).toBe(hash);
    expect(r?.sheet_hashes[target]?.[event]).toBe(hash);
    expect(r?.confirmed_target_key).toBe(target);
    expect(
      (await db.db.query<{ status: string }>("SELECT status FROM ledger_writes WHERE id=$1", [a.write])).rows[0]
        ?.status,
    ).toBe("pending");
    expect((await db.db.query("SELECT id FROM owner_tasks WHERE id=$1 AND closed_at IS NULL", [task])).rowCount).toBe(
      0,
    );
  } finally {
    await db.close();
  }
});
