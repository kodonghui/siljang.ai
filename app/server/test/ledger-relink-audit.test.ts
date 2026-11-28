import { expect, it } from "vitest";
import { TEST_DATABASE_URL } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop } from "./support/shops";

it.skipIf(!TEST_DATABASE_URL).each(["scheduled", "pending"])(
  "파일 교체 시 기존 파일 사후 확인 %s을 폐기한다",
  async (phase) => {
    const isolated = await isolatedTestDb();
    try {
      const shop = await createShop(isolated.db, "장부 교체"),
        link = crypto.randomUUID(),
        row = crypto.randomUUID(),
        write = crypto.randomUUID();
      await isolated.db.query(
        "INSERT INTO ledger_links(id,shop_id,spreadsheet_id,sheet_name,our_columns,credential_ref) VALUES($1,$2,$3,'장부','{}',$4)",
        [link, shop.shopId, "synthetic_sheet_old_1234567890", crypto.randomUUID()],
      );
      await isolated.db.query("INSERT INTO ledger_rows(id,shop_id,order_id) VALUES($1,$2,$3)", [
        row,
        shop.shopId,
        shop.orderId,
      ]);
      await isolated.db.query(
        "INSERT INTO ledger_writes(id,shop_id,ledger_row_id,event_key,event_kind,status,written_at,next_attempt_at,write_uncertain,audit_due_at,audit_deadline) VALUES($1,$2,$3,$4,'changed','written',now(),NULL,true,now()+interval '1 minute',now()+interval '1 day')",
        [write, shop.shopId, row, `ledger:${write}:changed`],
      );
      if (phase === "pending") {
        await isolated.db.query("UPDATE ledger_writes SET audit_due_at=now()-interval '1 minute' WHERE id=$1", [write]);
        const lease = new Date(Date.now() + 120000);
        expect(
          (
            await isolated.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [
              shop.shopId,
              write,
              lease,
            ])
          ).rowCount,
        ).toBe(1);
        await isolated.db.query(
          "SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,'audit_missing',now(),NULL)",
          [shop.shopId, write, lease],
        );
        expect(
          (await isolated.db.query<{ status: string }>("SELECT status FROM ledger_writes WHERE id=$1", [write])).rows[0]
            ?.status,
        ).toBe("pending");
      }
      const revision = (
        await isolated.db.query<{ v: string }>(
          "SELECT id::text||CASE WHEN status='unlinked' THEN '.u' ELSE '.l' END AS v FROM ledger_links WHERE id=$1",
          [link],
        )
      ).rows[0]?.v;
      await isolated.db.query(
        "SELECT * FROM siljang_ledger_private.create_owner_ledger($1,$2,$3,$4,'장부','{}',$5,now())",
        [shop.shopId, shop.ownerId, crypto.randomUUID(), "synthetic_sheet_new_1234567890", revision],
      );
      const state = (
        await isolated.db.query<{ status: string; audit_due_at: Date | null }>(
          "SELECT status,audit_due_at FROM ledger_writes WHERE id=$1",
          [write],
        )
      ).rows[0];
      expect(state).toEqual({ status: "written", audit_due_at: null });
    } finally {
      await isolated.close();
    }
  },
);

it.skipIf(!TEST_DATABASE_URL)("예약 쓰기 임대는 사장님의 연결 설정 버전을 바꾸지 않는다", async () => {
  const isolated = await isolatedTestDb();
  try {
    const shop = await createShop(isolated.db, "장부 버전"),
      link = crypto.randomUUID();
    await isolated.db.query(
      "INSERT INTO ledger_links(id,shop_id,spreadsheet_id,sheet_name,our_columns,credential_ref) VALUES($1,$2,$3,'장부','{}',$4)",
      [link, shop.shopId, "synthetic_sheet_old_1234567890", crypto.randomUUID()],
    );
    const before = (
      await isolated.db.query<{ revision: string }>("SELECT revision FROM read_owner_ledger($1,$2,NULL)", [
        shop.shopId,
        shop.ownerId,
      ])
    ).rows[0]?.revision;
    await isolated.db.query(
      "UPDATE ledger_links SET write_lease_id=$2,write_lease_until=now()+interval '1 minute' WHERE id=$1",
      [link, crypto.randomUUID()],
    );
    const result = (
      await isolated.db.query<{ outcome: string }>(
        "SELECT siljang_ledger_private.lock_owner_ledger($1,$2,$3) AS outcome",
        [shop.shopId, shop.ownerId, before],
      )
    ).rows[0]?.outcome;
    expect(result).toBe("ok");
  } finally {
    await isolated.close();
  }
});
