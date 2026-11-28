import { expect, it } from "vitest";
import { writeLedgerSheet } from "../src/ledger-sheet-write";
import { Secret } from "../src/settings";
import { TEST_DATABASE_URL } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop } from "./support/shops";

it.skipIf(!TEST_DATABASE_URL)(
  "불확실 주문이 확인되기 전 같은 가게의 다른 주문은 기다리고 다른 가게는 진행한다",
  async () => {
    const db = await isolatedTestDb();
    try {
      const shop = await createShop(db.db, "불확실 직렬화"),
        otherShop = await createShop(db.db, "다른 가게");
      const link = crypto.randomUUID(),
        row = crypto.randomUUID(),
        a = crypto.randomUUID(),
        b = crypto.randomUUID();
      const otherOrder = crypto.randomUUID(),
        draft = crypto.randomUUID(),
        otherRow = crypto.randomUUID();
      await db.db.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO order_drafts SELECT (jsonb_populate_record(NULL::order_drafts,to_jsonb(d)||jsonb_build_object('id',$2::uuid))).* FROM order_drafts d WHERE id=$1",
          [shop.draftId, draft],
        );
        await tx.query(
          "INSERT INTO orders SELECT (jsonb_populate_record(NULL::orders,to_jsonb(o)||jsonb_build_object('id',$2::uuid,'order_no','OTHER12','draft_id',$3::uuid))).* FROM orders o WHERE id=$1",
          [shop.orderId, otherOrder, draft],
        );
        await tx.query(
          "INSERT INTO order_details SELECT (jsonb_populate_record(NULL::order_details,to_jsonb(d)||jsonb_build_object('id',$3::uuid,'order_id',$2::uuid))).* FROM order_details d WHERE order_id=$1 AND version=1",
          [shop.orderId, otherOrder, crypto.randomUUID()],
        );
      });
      for (const s of [shop, otherShop])
        await db.db.query(
          "INSERT INTO ledger_links(id,shop_id,spreadsheet_id,sheet_name,our_columns,credential_ref) VALUES($1,$2,$3,'장부','{}',$4)",
          [s === shop ? link : crypto.randomUUID(), s.shopId, "synthetic_sheet_1234567890", crypto.randomUUID()],
        );
      await db.db.query("INSERT INTO ledger_rows(id,shop_id,order_id) VALUES($1,$2,$3),($4,$2,$5)", [
        row,
        shop.shopId,
        shop.orderId,
        otherRow,
        otherOrder,
      ]);
      const otherShopRow = crypto.randomUUID(),
        otherShopWrite = crypto.randomUUID();
      await db.db.query("INSERT INTO ledger_rows(id,shop_id,order_id) VALUES($1,$2,$3)", [
        otherShopRow,
        otherShop.shopId,
        otherShop.orderId,
      ]);
      await db.db.query(
        "INSERT INTO ledger_writes(id,shop_id,ledger_row_id,event_key,event_kind,next_attempt_at) VALUES($1,$2,$3,$4,'changed',now()-interval '1 second'),($5,$2,$6,$7,'changed',now()-interval '1 second'),($8,$9,$10,$11,'changed',now()-interval '1 second')",
        [
          a,
          shop.shopId,
          row,
          `a:${a}`,
          b,
          otherRow,
          `b:${b}`,
          otherShopWrite,
          otherShop.shopId,
          otherShopRow,
          `c:${otherShopWrite}`,
        ],
      );
      const lease = new Date(Date.now() + 120000);
      expect(
        (
          await db.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [
            shop.shopId,
            a,
            lease,
          ])
        ).rowCount,
      ).toBe(1);
      await db.db.query("SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,'uncertain',now(),NULL)", [
        shop.shopId,
        a,
        lease,
      ]);
      expect(
        (
          await db.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [
            shop.shopId,
            b,
            lease,
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await db.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [
            otherShop.shopId,
            otherShopWrite,
            lease,
          ])
        ).rowCount,
      ).toBe(1);
      await db.db.query("UPDATE ledger_writes SET next_attempt_at=now()-interval '1 second' WHERE id=$1", [a]);
      expect(
        (
          await db.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [
            shop.shopId,
            a,
            lease,
          ])
        ).rowCount,
      ).toBe(1);
      await db.db.query("SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,'written',now(),NULL)", [
        shop.shopId,
        a,
        lease,
      ]);
      await db.db.query("UPDATE ledger_writes SET next_attempt_at=now()-interval '1 second' WHERE id=$1", [b]);
      expect(
        (
          await db.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [
            shop.shopId,
            b,
            lease,
          ])
        ).rowCount,
      ).toBe(1);
      await db.db.query(
        "UPDATE orders SET status='cancelled',cancel_kind='customer',cancelled_at=now()-interval '31 days',finished_at=now()-interval '31 days' WHERE id=$1",
        [shop.orderId],
      );
      await db.db.query("UPDATE orders SET personal_data_purged_at=now() WHERE id=$1", [shop.orderId]);
      const baseline = {
        scope: "A".repeat(43),
        keyVersion: "K".repeat(43),
        sentDigest: "B".repeat(43),
        unidentifiedRows: false,
        conflicted: false,
        affectedOrderIds: [shop.orderId, otherOrder],
        rows: [
          { key: "C".repeat(43), digest: "D".repeat(43), orderId: shop.orderId },
          { key: "E".repeat(43), digest: "F".repeat(43), orderId: otherOrder },
        ],
      };
      expect(
        (
          await db.db.query<{ ok: boolean }>(
            "SELECT siljang_ledger_private.save_ledger_checkpoint($1,$2,$3,$4,$5::jsonb) AS ok",
            [shop.shopId, b, lease, link, JSON.stringify(baseline)],
          )
        ).rows[0]?.ok,
      ).toBe(true);
      const stored = (
        await db.db.query<{ checkpoint_hashes: { rows: { orderId: string }[]; affectedOrderIds: string[] } }>(
          "SELECT checkpoint_hashes FROM ledger_writes WHERE id=$1",
          [b],
        )
      ).rows[0]?.checkpoint_hashes;
      expect(stored?.rows.map((r) => r.orderId)).toEqual([otherOrder]);
      expect(stored?.affectedOrderIds).toEqual([otherOrder]);
    } finally {
      await db.close();
    }
  },
);

it.skipIf(!TEST_DATABASE_URL)("권한이 복원되면 auth_lost 상태에서도 비교 기준을 저장한다", async () => {
  const db = await isolatedTestDb();
  try {
    const shop = await createShop(db.db, "권한 복원"),
      link = crypto.randomUUID(),
      row = crypto.randomUUID(),
      write = crypto.randomUUID();
    await db.db.query(
      "INSERT INTO ledger_links(id,shop_id,spreadsheet_id,sheet_name,our_columns,credential_ref,status) VALUES($1,$2,$3,'장부','{}',$4,'auth_lost')",
      [link, shop.shopId, "synthetic_sheet_1234567890", crypto.randomUUID()],
    );
    await db.db.query("INSERT INTO ledger_rows(id,shop_id,order_id) VALUES($1,$2,$3)", [
      row,
      shop.shopId,
      shop.orderId,
    ]);
    await db.db.query(
      "INSERT INTO ledger_writes(id,shop_id,ledger_row_id,event_key,event_kind,next_attempt_at) VALUES($1,$2,$3,$4,'changed',now()-interval '1 second')",
      [write, shop.shopId, row, `a:${write}`],
    );
    const lease = new Date(Date.now() + 120000);
    await db.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [shop.shopId, write, lease]);
    const baseline = {
      scope: "A".repeat(43),
      keyVersion: "K".repeat(43),
      sentDigest: "B".repeat(43),
      rows: [],
      unidentifiedRows: false,
      conflicted: false,
      affectedOrderIds: [],
    };
    expect(
      (
        await db.db.query<{ ok: boolean }>(
          "SELECT siljang_ledger_private.save_ledger_checkpoint($1,$2,$3,$4,$5::jsonb) AS ok",
          [shop.shopId, write, lease, link, JSON.stringify(baseline)],
        )
      ).rows[0]?.ok,
    ).toBe(true);
  } finally {
    await db.close();
  }
});

it.skipIf(!TEST_DATABASE_URL)(
  "충돌 해결 뒤 재연결은 불확실 상태를 원자적으로 해제하고 쓰기를 다시 실행한다",
  async () => {
    const db = await isolatedTestDb();
    try {
      const shop = await createShop(db.db, "충돌 재개"),
        link = crypto.randomUUID(),
        row = crypto.randomUUID(),
        write = crypto.randomUUID();
      await db.db.query(
        "INSERT INTO ledger_links(id,shop_id,spreadsheet_id,sheet_name,our_columns,credential_ref) VALUES($1,$2,$3,'장부','{}',$4)",
        [link, shop.shopId, "synthetic_sheet_1234567890", crypto.randomUUID()],
      );
      await db.db.query("INSERT INTO ledger_rows(id,shop_id,order_id) VALUES($1,$2,$3)", [
        row,
        shop.shopId,
        shop.orderId,
      ]);
      await db.db.query(
        "INSERT INTO ledger_writes(id,shop_id,ledger_row_id,event_key,event_kind,next_attempt_at,write_uncertain) VALUES($1,$2,$3,$4,'changed',now()-interval '1 second',true)",
        [write, shop.shopId, row, `a:${write}`],
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
      const later = crypto.randomUUID();
      await db.db.query(
        "INSERT INTO ledger_writes(id,shop_id,ledger_row_id,event_key,event_kind,status,last_error_kind) VALUES($1,$2,$3,$4,'changed','unlinked','conflict')",
        [later, shop.shopId, row, `later:${later}`],
      );
      await db.db.query("SELECT * FROM siljang_ledger_private.create_owner_ledger($1,$2,$3,$4,'장부','{}',$5,now())", [
        shop.shopId,
        shop.ownerId,
        crypto.randomUUID(),
        "synthetic_sheet_1234567890",
        `${link}.l`,
      ]);
      const resumeLease = new Date(Date.now() + 120000);
      const claimed = await db.db.query<{
        uncertain: boolean;
        resume_approved: boolean;
        row_values: (string | number)[];
      }>("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [shop.shopId, write, resumeLease]);
      expect(claimed.rows[0]?.uncertain).toBe(false);
      expect(claimed.rows[0]?.resume_approved).toBe(true);
      const values = claimed.rows[0]?.row_values;
      if (!values) throw new Error("claimed order missing");
      let sheet: (string | number)[] = [...values, "old", shop.orderId.replaceAll("-", "")],
        writes = 0;
      sheet[1] = "사장님이 확인한 값";
      const send = async (raw: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "GET")
          return Response.json({
            values: decodeURIComponent(String(raw)).includes("!A2:N2") ? [sheet] : [["header"], sheet],
          });
        writes++;
        sheet = JSON.parse(String(init?.body)).requests[0].updateCells.rows[0].values.map(
          (c: { userEnteredValue: { stringValue?: string; numberValue?: number } }) =>
            c.userEnteredValue.stringValue ?? c.userEnteredValue.numberValue ?? "",
        );
        return Response.json({ spreadsheetId: "synthetic_sheet_1234567890", replies: [{}] });
      };
      await writeLedgerSheet(
        {
          file: "synthetic_sheet_1234567890",
          tab: "장부",
          access: new Secret("fake"),
          hashKey: new Secret("synthetic-key"),
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
          linkId: crypto.randomUUID(),
          eventId: write,
          orderId: shop.orderId,
          resumeApproved: claimed.rows[0]?.resume_approved ?? false,
        },
        { fetch: send },
      );
      expect(writes).toBe(1);
      expect(sheet[12]).toBe(write.replaceAll("-", ""));
      await db.db.query("SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,'written',now(),NULL)", [
        shop.shopId,
        write,
        resumeLease,
      ]);
      expect(
        (
          await db.db.query<{ resume_approved: boolean }>("SELECT resume_approved FROM ledger_writes WHERE id=$1", [
            later,
          ])
        ).rows[0]?.resume_approved,
      ).toBe(false);
    } finally {
      await db.close();
    }
  },
);

it.skipIf(!TEST_DATABASE_URL)("개인정보 삭제 시 주문 서명과 다른 비교 기준에 포함된 주문도 지운다", async () => {
  const db = await isolatedTestDb();
  try {
    const shop = await createShop(db.db, "서명 삭제"),
      row = crypto.randomUUID(),
      write = crypto.randomUUID();
    await db.db.query(
      "INSERT INTO ledger_rows(id,shop_id,order_id,sheet_hash,sheet_hashes) VALUES($1,$2,$3,$4,$5::jsonb)",
      [row, shop.shopId, shop.orderId, "A".repeat(43), JSON.stringify({ x: { y: "A".repeat(43) } })],
    );
    await db.db.query(
      "INSERT INTO ledger_writes(id,shop_id,ledger_row_id,event_key,event_kind,next_attempt_at,checkpoint_hashes) VALUES($1,$2,$3,$4,'changed',now(),$5::jsonb)",
      [
        write,
        shop.shopId,
        row,
        `a:${write}`,
        JSON.stringify({ rows: [{ orderId: shop.orderId, key: "B".repeat(43), digest: "C".repeat(43) }] }),
      ],
    );
    await db.db.query(
      "UPDATE orders SET status='cancelled',cancel_kind='customer',cancelled_at=now()-interval '31 days',finished_at=now()-interval '31 days' WHERE id=$1",
      [shop.orderId],
    );
    await db.db.query("UPDATE orders SET personal_data_purged_at=now() WHERE id=$1", [shop.orderId]);
    const r = (
      await db.db.query<{ sheet_hash: string | null; sheet_hashes: unknown; checkpoint_hashes: unknown }>(
        "SELECT r.sheet_hash,r.sheet_hashes,w.checkpoint_hashes FROM ledger_rows r JOIN ledger_writes w ON w.ledger_row_id=r.id WHERE r.id=$1",
        [row],
      )
    ).rows[0];
    expect(r).toEqual({ sheet_hash: null, sheet_hashes: {}, checkpoint_hashes: null });
  } finally {
    await db.close();
  }
});
