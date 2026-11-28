import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DUE_SOURCES } from "../src/due-sources";
import { TEST_DATABASE_URL, testDb } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createTestRole, roleConnection } from "./support/purge-role";
import { createShop } from "./support/shops";

describe.skipIf(!TEST_DATABASE_URL)("장부 임대 DB", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>;
  const role = `ledger157_${crypto.randomUUID().replaceAll("-", "")}`;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
    await isolated.db.query(
      "CREATE SCHEMA vault; CREATE TABLE vault.secrets(id uuid PRIMARY KEY,name text,secret text); CREATE VIEW vault.decrypted_secrets AS SELECT id,name,secret AS decrypted_secret FROM vault.secrets",
    );
    await createTestRole(isolated.db, role, "app");
  }, 30000);
  afterAll(async () => {
    await isolated?.close();
    const admin = testDb();
    try {
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
    } finally {
      await admin.close();
    }
  });
  it("같은 가게 쓰기는 직렬화하고 늦은 임대 결과는 무시한다", async () => {
    const shop = await createShop(isolated.db, "합성 장부");
    const link = crypto.randomUUID(),
      row = crypto.randomUUID(),
      first = crypto.randomUUID(),
      second = crypto.randomUUID(),
      ref = crypto.randomUUID();
    await isolated.db.query(
      "INSERT INTO ledger_links(id,shop_id,spreadsheet_id,sheet_name,our_columns,credential_ref) VALUES($1,$2,$3,'장부','{}',$4)",
      [link, shop.shopId, "synthetic_sheet_1234567890", ref],
    );
    const envelope = `v1:${"A".repeat(50)}`;
    await isolated.db.query("INSERT INTO vault.secrets(id,name,secret) VALUES($1,$2,$3)", [
      ref,
      `siljang-ledger:${shop.shopId}:${link}`,
      envelope,
    ]);
    await isolated.db.query("INSERT INTO ledger_rows(id,shop_id,order_id) VALUES($1,$2,$3)", [
      row,
      shop.shopId,
      shop.orderId,
    ]);
    await isolated.db.query(
      "INSERT INTO ledger_writes(id,shop_id,ledger_row_id,event_key,event_kind,next_attempt_at) VALUES($1,$3,$4,$5,'changed',now()),($2,$3,$4,$6,'changed',now())",
      [first, second, shop.shopId, row, `ledger:${first}:changed`, `ledger:${second}:changed`],
    );
    await isolated.db.query(
      "UPDATE order_details SET lettering='최신 문구', allergy_consent='agreed', allergy_answer='장부에 없어야 함' WHERE shop_id=$1 AND order_id=$2",
      [shop.shopId, shop.orderId],
    );
    const remake = crypto.randomUUID();
    await isolated.db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO orders(id,shop_id,order_no,customer_id,consultation_id,kind,status,version,price_list_id,operating_rules_id,pickup_at,pickup_day,amount,remake_of_order_id,cancelled_at,cancel_kind) SELECT $2,shop_id,'REMAKE1',customer_id,consultation_id,'standard','cancelled',1,price_list_id,operating_rules_id,pickup_at,pickup_day,0,id,now(),'customer' FROM orders WHERE id=$1",
        [shop.orderId, remake],
      );
      await tx.query(
        "INSERT INTO order_details(shop_id,order_id,version,source,price_list_id,pickup_at,allergy_consent,allergy_consent_at,amount) SELECT shop_id,$2,1,'remake',price_list_id,pickup_at,'not_required',now(),0 FROM order_details WHERE order_id=$1 AND version=1",
        [shop.orderId, remake],
      );
    });
    const lease = new Date(Date.now() + 120000);
    const claim = (id: string) =>
      isolated.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [shop.shopId, id, lease]);
    const restricted = roleConnection(isolated.connect(), role);
    const firstClaim = await restricted.transaction(async (tx) => {
      expect((await tx.query(DUE_SOURCES.ledger_write.claim, [shop.shopId, first, new Date()])).rowCount).toBe(1);
      return tx.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [shop.shopId, first, lease]);
    });
    expect(firstClaim.rowCount).toBe(1);
    const values = (firstClaim.rows[0] as { row_values: unknown[] }).row_values;
    expect(values).toHaveLength(12);
    expect(values[5]).toBe("최신 문구");
    expect(values[8]).toBe("결제 기다림");
    expect(values[11]).toBe("취소됨");
    expect(JSON.stringify(values)).not.toContain("장부에 없어야 함");
    expect((await isolated.db.query("SELECT id FROM ledger_rows WHERE order_id=$1", [remake])).rowCount).toBe(0);
    const credential = (shopId: string, linkId: string, writeId: string, until: Date) =>
      isolated.db.query<{ envelope: string | null }>(
        "SELECT siljang_ledger_private.read_leased_ledger_credential($1,$2,$3,$4) AS envelope",
        [shopId, linkId, writeId, until],
      );
    expect((await credential(shop.shopId, link, first, lease)).rows[0]?.envelope).toBe(envelope);
    expect((await credential(shop.shopId, link, second, lease)).rows[0]?.envelope).toBeNull();
    expect((await credential(crypto.randomUUID(), link, first, lease)).rows[0]?.envelope).toBeNull();
    try {
      await expect(restricted.query("SELECT * FROM vault.decrypted_secrets")).rejects.toMatchObject({ code: "42501" });
      expect(
        (
          await restricted.query<{ envelope: string }>(
            "SELECT siljang_ledger_private.read_leased_ledger_credential($1,$2,$3,$4) AS envelope",
            [shop.shopId, link, first, lease],
          )
        ).rows[0]?.envelope,
      ).toBe(envelope);
    } finally {
      await restricted.close();
    }
    expect((await claim(second)).rowCount).toBe(0);
    const stale = new Date(lease.getTime() + 1000);
    await isolated.db.query("SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,$4,$5,NULL)", [
      shop.shopId,
      first,
      stale,
      "written",
      new Date(),
    ]);
    expect(
      (await isolated.db.query<{ status: string }>("SELECT status FROM ledger_writes WHERE id=$1", [first])).rows[0]
        ?.status,
    ).toBe("pending");
    await isolated.db.query("SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,$4,$5,$6::jsonb)", [
      shop.shopId,
      first,
      lease,
      "written",
      new Date(),
      JSON.stringify({ columns: [{ header: "주문번호", column: "AA" }], movedRight: true, ownershipToken: "proof" }),
    ]);
    expect(
      (await isolated.db.query<{ status: string }>("SELECT status FROM ledger_writes WHERE id=$1", [first])).rows[0]
        ?.status,
    ).toBe("written");
    expect(
      (
        await isolated.db.query<{ our_columns: { movedRight: boolean } }>(
          "SELECT our_columns FROM ledger_links WHERE id=$1",
          [link],
        )
      ).rows[0]?.our_columns.movedRight,
    ).toBe(true);
    expect((await claim(second)).rowCount).toBe(1);
    await isolated.db.query("SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,$4,$5,NULL)", [
      shop.shopId,
      second,
      lease,
      "auth_lost",
      new Date(),
    ]);
    const failure = await isolated.db.query<{ status: string; next_attempt_at: Date }>(
      "SELECT status,next_attempt_at FROM ledger_writes WHERE id=$1",
      [second],
    );
    expect(failure.rows[0]?.status).toBe("alerted");
    expect(failure.rows[0]?.next_attempt_at.getTime()).toBeGreaterThan(Date.now() + 23 * 3600000);
    expect(
      (await isolated.db.query("SELECT id FROM owner_tasks WHERE shop_id=$1 AND kind='ledger_relink'", [shop.shopId]))
        .rowCount,
    ).toBe(1);
    expect(
      (await isolated.db.query("SELECT id FROM owner_alerts WHERE shop_id=$1 AND kind='ledger_failing'", [shop.shopId]))
        .rowCount,
    ).toBe(1);
  });
  it("24시간 경계보다 늦게 재시도하지 않아 지속 실패 알림을 놓치지 않는다", async () => {
    const shop = await createShop(isolated.db, "합성 장부 24시간"),
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
      "INSERT INTO ledger_writes(id,shop_id,ledger_row_id,event_key,event_kind,status,attempts,first_failed_at,next_attempt_at) VALUES($1,$2,$3,$4,'changed','retrying',5,now()-interval '23 hours 59 minutes',now())",
      [write, shop.shopId, row, `ledger:${write}:changed`],
    );
    const lease = new Date(Date.now() + 120000);
    await isolated.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [
      shop.shopId,
      write,
      lease,
    ]);
    await isolated.db.query("SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,$4,$5,NULL)", [
      shop.shopId,
      write,
      lease,
      "retry",
      new Date(),
    ]);
    const result = (
      await isolated.db.query<{ status: string; next_attempt_at: Date; first_failed_at: Date }>(
        "SELECT status,next_attempt_at,first_failed_at FROM ledger_writes WHERE id=$1",
        [write],
      )
    ).rows[0];
    if (!result) throw new Error("ledger write missing");
    expect(result?.status).toBe("retrying");
    expect(result.next_attempt_at.getTime()).toBe(result.first_failed_at.getTime() + 24 * 3600000);
  });
});
