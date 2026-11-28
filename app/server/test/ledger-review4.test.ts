import { expect, it } from "vitest";
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

it.skipIf(!TEST_DATABASE_URL)(
  "개인정보 삭제가 전송 결과보다 먼저 끝나면 결과 기록이 서명을 되살리지 않는다",
  async () => {
    const db = await isolatedTestDb();
    try {
      const shop = await createShop(db.db, "삭제와 쓰기"),
        link = crypto.randomUUID(),
        row = crypto.randomUUID(),
        write = crypto.randomUUID();
      await db.db.query(
        "INSERT INTO ledger_links(id,shop_id,spreadsheet_id,sheet_name,our_columns,credential_ref) VALUES($1,$2,$3,'장부','{}',$4)",
        [link, shop.shopId, "synthetic_sheet_1234567890", crypto.randomUUID()],
      );
      await db.db.query(
        "INSERT INTO ledger_rows(id,shop_id,order_id,sheet_hash,sheet_hashes,sheet_key_version) VALUES($1,$2,$3,$4,$5::jsonb,$4)",
        [row, shop.shopId, shop.orderId, "A".repeat(43), JSON.stringify({ a: { b: "A".repeat(43) } })],
      );
      await db.db.query(
        "INSERT INTO ledger_writes(id,shop_id,ledger_row_id,event_key,event_kind,next_attempt_at) VALUES($1,$2,$3,$4,'changed',now()-interval '1 second')",
        [write, shop.shopId, row, `write:${write}`],
      );
      const lease = new Date(Date.now() + 120000);
      expect(
        (
          await db.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [
            shop.shopId,
            write,
            lease,
          ])
        ).rowCount,
      ).toBe(1);
      await db.db.query(
        "UPDATE orders SET status='cancelled',cancel_kind='customer',cancelled_at=now()-interval '31 days',finished_at=now()-interval '31 days' WHERE id=$1",
        [shop.orderId],
      );
      await db.db.query("UPDATE orders SET personal_data_purged_at=now() WHERE id=$1", [shop.orderId]);
      await db.db.query("SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,'written',now(),$4::jsonb)", [
        shop.shopId,
        write,
        lease,
        JSON.stringify({ sheetHash: "B".repeat(43), targetKey: "C".repeat(43), keyVersion: "K".repeat(43) }),
      ]);
      const r = (
        await db.db.query<{ sheet_hash: string | null; sheet_hashes: unknown; sheet_key_version: string | null }>(
          "SELECT sheet_hash,sheet_hashes,sheet_key_version FROM ledger_rows WHERE id=$1",
          [row],
        )
      ).rows[0];
      expect(r).toEqual({ sheet_hash: null, sheet_hashes: {}, sheet_key_version: null });
    } finally {
      await db.close();
    }
  },
);

it.skipIf(!TEST_DATABASE_URL)(
  "삭제 중인 주문의 잠금은 완료 기록이 3초 안에 포기하고 이후 다시 시도한다",
  async () => {
    const isolated = await isolatedTestDb(),
      blocker = isolated.connect(),
      caller = isolated.connect();
    try {
      const shop = await createShop(isolated.db, "삭제 잠금"),
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
        [write, shop.shopId, row, `write:${write}`],
      );
      const lease = new Date(Date.now() + 120000);
      await isolated.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [
        shop.shopId,
        write,
        lease,
      ]);
      let ready = () => {},
        release = () => {};
      const held = new Promise<void>((r) => {
          ready = r;
        }),
        go = new Promise<void>((r) => {
          release = r;
        });
      const locking = blocker.transaction(async (tx) => {
        await tx.query("SELECT id FROM orders WHERE id=$1 FOR UPDATE", [shop.orderId]);
        ready();
        await go;
      });
      await held;
      try {
        await expect(
          caller.transaction(async (tx) => {
            await tx.query("SET LOCAL statement_timeout='4s'");
            return tx.query("SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,'written',now(),NULL)", [
              shop.shopId,
              write,
              lease,
            ]);
          }),
        ).rejects.toMatchObject({ code: "55P03" });
      } finally {
        release();
        await locking;
      }
      expect(
        (
          await isolated.db.query<{ ok: boolean }>(
            "SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,'written',now(),NULL) AS ok",
            [shop.shopId, write, lease],
          )
        ).rows[0]?.ok,
      ).toBe(true);
    } finally {
      await blocker.close();
      await caller.close();
      await isolated.close();
    }
  },
  15000,
);
