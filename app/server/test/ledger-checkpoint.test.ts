import { expect, it } from "vitest";
import { buildLedgerCheckpoint } from "../src/ledger-checkpoint";
import { Secret } from "../src/settings";
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
    const checkpoint = {
      scope: "A".repeat(43),
      keyVersion: "K".repeat(43),
      sentDigest: "B".repeat(43),
      rows: [],
      unidentifiedRows: false,
      conflicted: false,
      affectedOrderIds: [],
    };
    const save = (value: unknown) =>
      isolated.db.query<{ ok: boolean }>(
        "SELECT siljang_ledger_private.save_ledger_checkpoint($1,$2,$3,$4,$5::jsonb) AS ok",
        [shop.shopId, write, lease, link, JSON.stringify(value)],
      );
    expect((await save({ ...checkpoint, privateData: "합성 이름" })).rows[0]?.ok).toBe(false);
    expect(
      (
        await save({
          ...checkpoint,
          rows: [{ key: "A".repeat(43), digest: "B".repeat(43), orderId: null, name: "합성 이름" }],
        })
      ).rows[0]?.ok,
    ).toBe(false);
    expect(
      (
        await isolated.db.query<{ ok: boolean }>(
          "SELECT siljang_ledger_private.save_ledger_checkpoint($1,$2,$3,$4,$5::jsonb) AS ok",
          [shop.shopId, write, lease, crypto.randomUUID(), JSON.stringify(checkpoint)],
        )
      ).rows[0]?.ok,
    ).toBe(false);
    expect(
      (
        await isolated.db.query<{ ok: boolean }>(
          "SELECT siljang_ledger_private.save_ledger_checkpoint($1,$2,$3,$4,$5::jsonb) AS ok",
          [crypto.randomUUID(), write, lease, link, JSON.stringify(checkpoint)],
        )
      ).rows[0]?.ok,
    ).toBe(false);
    expect((await save(checkpoint)).rows[0]?.ok).toBe(true);
    expect(
      (
        await isolated.db.query<{ checkpoint_hashes: unknown }>(
          "SELECT checkpoint_hashes FROM ledger_writes WHERE id=$1",
          [write],
        )
      ).rows[0]?.checkpoint_hashes,
    ).toEqual(checkpoint);
    await isolated.db.query("SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,'written',now(),NULL)", [
      shop.shopId,
      write,
      lease,
    ]);
    expect(
      (
        await isolated.db.query<{ checkpoint_hashes: unknown }>(
          "SELECT checkpoint_hashes FROM ledger_writes WHERE id=$1",
          [write],
        )
      ).rows[0]?.checkpoint_hashes,
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
      otherRow = crypto.randomUUID(),
      otherWrite = crypto.randomUUID(),
      link = crypto.randomUUID(),
      row = crypto.randomUUID(),
      write = crypto.randomUUID();
    await isolated.db.transaction(async (tx) => {
      const draft = crypto.randomUUID();
      await tx.query(
        "INSERT INTO order_drafts SELECT (jsonb_populate_record(NULL::order_drafts,to_jsonb(d)||jsonb_build_object('id',$2::uuid))).* FROM order_drafts d WHERE id=$1",
        [shop.draftId, draft],
      );
      await tx.query(
        "INSERT INTO orders SELECT (jsonb_populate_record(NULL::orders,to_jsonb(o)||jsonb_build_object('id',$2::uuid,'order_no','OTHER12','draft_id',$3::uuid))).* FROM orders o WHERE id=$1",
        [shop.orderId, other, draft],
      );
      await tx.query(
        "INSERT INTO order_details SELECT (jsonb_populate_record(NULL::order_details,to_jsonb(d)||jsonb_build_object('id',$3::uuid,'order_id',$2::uuid))).* FROM order_details d WHERE order_id=$1 AND version=1",
        [shop.orderId, other, crypto.randomUUID()],
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
    await isolated.db.query("INSERT INTO ledger_rows(id,shop_id,order_id) VALUES($1,$2,$3)", [
      otherRow,
      shop.shopId,
      other,
    ]);
    await isolated.db.query(
      "INSERT INTO ledger_writes(id,shop_id,ledger_row_id,event_key,event_kind,next_attempt_at) VALUES($1,$2,$3,$4,'changed',now())",
      [otherWrite, shop.shopId, otherRow, `ledger:${otherWrite}:changed`],
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
    expect(
      (await isolated.db.query<{ status: string }>("SELECT status FROM ledger_writes WHERE id=$1", [otherWrite]))
        .rows[0]?.status,
    ).toBe("unlinked");
    const newer = crypto.randomUUID();
    await isolated.db.query(
      "INSERT INTO ledger_writes(id,shop_id,ledger_row_id,event_key,event_kind,next_attempt_at) VALUES($1,$2,$3,$4,'changed',now()-interval '1 minute')",
      [newer, shop.shopId, otherRow, `ledger:${newer}:changed`],
    );
    expect(
      (
        await isolated.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [
          shop.shopId,
          newer,
          lease,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (await isolated.db.query<{ status: string }>("SELECT status FROM ledger_writes WHERE id=$1", [newer])).rows[0]
        ?.status,
    ).toBe("unlinked");
    const newLink = crypto.randomUUID();
    await isolated.db.query(
      "SELECT * FROM siljang_ledger_private.create_owner_ledger($1,$2,$3,$4,'장부','{}',$5,now())",
      [shop.shopId, shop.ownerId, newLink, "synthetic_sheet_1234567890", `${link}.l`],
    );
    expect(
      (
        await isolated.db.query("SELECT id FROM owner_tasks WHERE shop_id=$1 AND event_key=$2 AND closed_at IS NULL", [
          shop.shopId,
          `task:ledger_conflict:${other}`,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (await isolated.db.query<{ status: string }>("SELECT status FROM ledger_writes WHERE id=$1", [otherWrite]))
        .rows[0]?.status,
    ).toBe("pending");
  } finally {
    await isolated.close();
  }
});
it.skipIf(!TEST_DATABASE_URL)("행 서명은 주문당 최신 파일·탭과 기록 ID만 보관한다", async () => {
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
    const second = crypto.randomUUID(),
      third = crypto.randomUUID(),
      keyB = "C".repeat(43),
      sigB = "D".repeat(43);
    await isolated.db.query("UPDATE ledger_links SET spreadsheet_id=$2 WHERE id=$1", [
      link,
      "synthetic_sheet_other_123456789",
    ]);
    await isolated.db.query(
      "INSERT INTO ledger_writes(id,shop_id,ledger_row_id,event_key,event_kind,next_attempt_at) VALUES($1,$2,$3,$4,'changed',now()-interval '1 second')",
      [second, shop.shopId, row, `ledger:${second}:changed`],
    );
    await isolated.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [
      shop.shopId,
      second,
      lease,
    ]);
    await isolated.db.query("SELECT siljang_ledger_private.finish_ledger_write($1,$2,$3,'written',now(),$4::jsonb)", [
      shop.shopId,
      second,
      lease,
      JSON.stringify({ targetKey: keyB, sheetHash: sigB }),
    ]);
    await isolated.db.query("UPDATE ledger_links SET spreadsheet_id=$2 WHERE id=$1", [
      link,
      "synthetic_sheet_1234567890",
    ]);
    await isolated.db.query(
      "INSERT INTO ledger_writes(id,shop_id,ledger_row_id,event_key,event_kind,next_attempt_at) VALUES($1,$2,$3,$4,'changed',now()-interval '1 second')",
      [third, shop.shopId, row, `ledger:${third}:changed`],
    );
    const returned = (
      await isolated.db.query<{ expected_hashes: Record<string, Record<string, string>> }>(
        "SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)",
        [shop.shopId, third, lease],
      )
    ).rows[0]?.expected_hashes;
    expect(returned?.[key]).toBeUndefined();
    expect(returned?.[keyB]?.[second.replaceAll("-", "")]).toBe(sigB);
  } finally {
    await isolated.close();
  }
});
it.skipIf(!TEST_DATABASE_URL)(
  "5000행 HMAC 기준도 저장 함수로 원문 없이 저장한다",
  async () => {
    const isolated = await isolatedTestDb();
    try {
      const shop = await createShop(isolated.db, "큰 장부 기준"),
        link = crypto.randomUUID(),
        row = crypto.randomUUID(),
        write = crypto.randomUUID(),
        file = "synthetic_sheet_1234567890",
        key = new Secret("synthetic-hmac-key");
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
        "INSERT INTO ledger_writes(id,shop_id,ledger_row_id,event_key,event_kind,next_attempt_at) VALUES($1,$2,$3,$4,'changed',now()-interval '1 second')",
        [write, shop.shopId, row, `ledger:${write}:changed`],
      );
      const lease = new Date(Date.now() + 120000);
      await isolated.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [
        shop.shopId,
        write,
        lease,
      ]);
      const rows = Array.from({ length: 5000 }, (_, i) => [
        `X${String(i).padStart(6, "0")}`,
        "이름",
        "010-0000-0000",
        "",
        "",
        "",
        0,
        "",
        "",
        0,
        "",
        "",
        "old",
        crypto.randomUUID().replaceAll("-", ""),
      ]);
      const sent = [
        "ABC123",
        "이름",
        "010-0000-0000",
        "",
        "",
        "",
        0,
        "",
        "",
        0,
        "",
        "",
        write.replaceAll("-", ""),
        shop.orderId.replaceAll("-", ""),
      ];
      const checkpoint = await buildLedgerCheckpoint(
        key,
        { file, tab: "장부", eventId: write, orderId: shop.orderId },
        rows,
        sent,
      );
      const json = JSON.stringify(checkpoint);
      expect(json).not.toContain("010-0000-0000");
      expect(
        (
          await isolated.db.query<{ ok: boolean }>(
            "SELECT siljang_ledger_private.save_ledger_checkpoint($1,$2,$3,$4,$5::jsonb) AS ok",
            [shop.shopId, write, lease, link, json],
          )
        ).rows[0]?.ok,
      ).toBe(true);
    } finally {
      await isolated.close();
    }
  },
  30000,
);
it.skipIf(!TEST_DATABASE_URL)(
  "비교 기준 저장도 행 잠금을 무한히 기다리지 않는다",
  async () => {
    const isolated = await isolatedTestDb(),
      blocker = isolated.connect(),
      caller = isolated.connect();
    try {
      const shop = await createShop(isolated.db, "기준 저장 잠금"),
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
        "INSERT INTO ledger_writes(id,shop_id,ledger_row_id,event_key,event_kind,next_attempt_at) VALUES($1,$2,$3,$4,'changed',now()-interval '1 minute')",
        [write, shop.shopId, row, `ledger:${write}:changed`],
      );
      const lease = new Date(Date.now() + 120000),
        checkpoint = {
          scope: "A".repeat(43),
          keyVersion: "K".repeat(43),
          sentDigest: "B".repeat(43),
          rows: [],
          unidentifiedRows: false,
          conflicted: false,
          affectedOrderIds: [],
        };
      await isolated.db.query("SELECT * FROM siljang_ledger_private.claim_ledger_write($1,$2,$3)", [
        shop.shopId,
        write,
        lease,
      ]);
      let release = () => {},
        ready = () => {};
      const held = new Promise<void>((resolve) => {
          ready = resolve;
        }),
        proceed = new Promise<void>((resolve) => {
          release = resolve;
        });
      const locking = blocker.transaction(async (tx) => {
        await tx.query("SELECT id FROM ledger_writes WHERE id=$1 FOR UPDATE", [write]);
        ready();
        await proceed;
      });
      await held;
      try {
        await expect(
          caller.transaction(async (tx) => {
            await tx.query("SET LOCAL statement_timeout='4s'");
            return tx.query("SELECT siljang_ledger_private.save_ledger_checkpoint($1,$2,$3,$4,$5::jsonb)", [
              shop.shopId,
              write,
              lease,
              link,
              JSON.stringify(checkpoint),
            ]);
          }),
        ).rejects.toMatchObject({ code: "55P03" });
      } finally {
        release();
        await locking;
      }
    } finally {
      await blocker.close();
      await caller.close();
      await isolated.close();
    }
  },
  30000,
);
