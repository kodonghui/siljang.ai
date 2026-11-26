import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { unlinkLedgerRecord } from "../src/ledger-unlink-store";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { describeDb, newUuid, testDb } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createTestRole, roleConnection } from "./support/purge-role";
import { createShop, type ShopFixture, snapshotShop } from "./support/shops";

const NOW = new Date("2026-11-26T12:00:00Z");
describeDb("장부 연결 해제의 기록/대기 쓰기 보존(TASK156)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture;
  const role = `unlink156_${newUuid().replaceAll("-", "")}`;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
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
  beforeEach(async () => {
    shop = await createShop(isolated.db, "합성 장부 해제 가게");
  });
  async function fixture(target = shop, status = "linked") {
    const id = newUuid(),
      row = newUuid();
    await isolated.db.query(
      "INSERT INTO ledger_links(id,shop_id,spreadsheet_id,sheet_name,our_columns,credential_ref,status,unlinked_at) VALUES($1,$2,$3,'합성 장부',$4::jsonb,'synthetic-credential-reference',$5,$6)",
      [
        id,
        target.shopId,
        `sheet_${newUuid().replaceAll("-", "")}`,
        JSON.stringify([{ header: "주문번호", column: "A" }]),
        status,
        status === "unlinked" ? new Date(NOW.getTime() - 1000) : null,
      ],
    );
    await isolated.db.query("INSERT INTO ledger_rows(id,shop_id,order_id) VALUES($1,$2,$3)", [
      row,
      target.shopId,
      target.orderId,
    ]);
    for (const state of ["pending", "retrying", "alerted", "unlinked", "written"])
      await isolated.db.query(
        "INSERT INTO ledger_writes(shop_id,ledger_row_id,event_key,event_kind,status,attempts,next_attempt_at,first_failed_at,last_error_kind,written_at) VALUES($1,$2,$3,'changed',$4,3,$5,$5,'synthetic_retry',$6)",
        [target.shopId, row, `ledger:${newUuid()}:changed`, state, NOW, state === "written" ? NOW : null],
      );
    return id;
  }
  async function invoke(target = shop, limited = false) {
    const conn = limited ? roleConnection(isolated.connect(), role) : isolated.connect();
    try {
      return await shopRequestDb(
        createShopScope(target.shopId, { kind: "owner", ownerId: target.ownerId }),
        conn,
      ).transaction((tx) => unlinkLedgerRecord(tx, NOW));
    } finally {
      await conn.close();
    }
  }
  it("연결을 끊고 미완료 네 쓰기는 버리지 않은 채 멈추며 적힌 행은 보존한다", async () => {
    const id = await fixture(),
      before = (
        await isolated.db.query("SELECT * FROM ledger_writes WHERE shop_id=$1 AND status='written'", [shop.shopId])
      ).rows;
    expect(await invoke()).toEqual({ outcome: "done", linkId: id, keptWrites: 4 });
    expect(
      (await isolated.db.query("SELECT status,unlinked_at,credential_ref FROM ledger_links WHERE id=$1", [id])).rows,
    ).toEqual([{ status: "unlinked", unlinked_at: NOW, credential_ref: "synthetic-credential-reference" }]);
    const rows = (
      await isolated.db.query(
        "SELECT status,attempts,next_attempt_at,first_failed_at,last_error_kind FROM ledger_writes WHERE shop_id=$1 AND status<>'written'",
        [shop.shopId],
      )
    ).rows;
    expect(rows).toHaveLength(4);
    for (const row of rows)
      expect(row).toEqual({
        status: "unlinked",
        attempts: 3,
        next_attempt_at: null,
        first_failed_at: NOW,
        last_error_kind: "synthetic_retry",
      });
    expect(
      (await isolated.db.query("SELECT * FROM ledger_writes WHERE shop_id=$1 AND status='written'", [shop.shopId]))
        .rows,
    ).toEqual(before);
  });
  it("이미 끊긴 연결을 반복하면 시각/버전과 업무 자료는 그대로다", async () => {
    const id = await fixture(shop, "unlinked");
    await invoke();
    const before = await snapshotShop(isolated.db, shop),
      version = (
        await isolated.db.query("SELECT xmin::text AS revision,unlinked_at FROM ledger_links WHERE id=$1", [id])
      ).rows;
    expect(await invoke()).toEqual({ outcome: "unchanged", linkId: id, keptWrites: 4 });
    expect(await snapshotShop(isolated.db, shop)).toEqual(before);
    expect(
      (await isolated.db.query("SELECT xmin::text AS revision,unlinked_at FROM ledger_links WHERE id=$1", [id])).rows,
    ).toEqual(version);
  });
  it("권한이 끊긴 연결도 해제하고 대기 쓰기를 남긴다", async () => {
    const id = await fixture(shop, "auth_lost");
    expect(await invoke()).toEqual({ outcome: "done", linkId: id, keptWrites: 4 });
  });
  it("자기 연결이 없으면 다른 가게 기록을 찾지 않고 not_set이다", async () => {
    const other = await createShop(isolated.db, "다른 장부 가게");
    await fixture(other);
    const before = await snapshotShop(isolated.db, other);
    await expect(invoke()).rejects.toMatchObject({ code: "not_set" });
    expect(await snapshotShop(isolated.db, other)).toEqual(before);
  });
  it("다른 가게의 연결/쓰기는 바꾸지 않는다", async () => {
    await fixture();
    const other = await createShop(isolated.db, "다른 장부 가게");
    await fixture(other);
    const before = await snapshotShop(isolated.db, other);
    await invoke();
    expect(await snapshotShop(isolated.db, other)).toEqual(before);
  });
  it("두 실제 연결의 해제가 겹쳐도 done/unchanged로 하나씩 처리한다", async () => {
    await fixture();
    const results = await Promise.all([invoke(), invoke()]);
    expect(results.map((r) => r.outcome).sort()).toEqual(["done", "unchanged"]);
    expect(results.map((r) => r.keptWrites)).toEqual([4, 4]);
  });
  it("뒤 단계가 실패하면 연결과 대기 쓰기 변경이 함께 되돌아간다", async () => {
    await fixture();
    const before = await snapshotShop(isolated.db, shop),
      conn = isolated.connect();
    try {
      await expect(
        shopRequestDb(createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId }), conn).transaction(
          async (tx) => {
            await unlinkLedgerRecord(tx, NOW);
            throw new Error("synthetic-after-unlink");
          },
        ),
      ).rejects.toThrow("synthetic-after-unlink");
    } finally {
      await conn.close();
    }
    expect(await snapshotShop(isolated.db, shop)).toEqual(before);
  });
  it("실행 역할은 토큰 참조를 읽지 않고 해제하며 참조 수정은 막는다", async () => {
    const id = await fixture();
    expect(await invoke(shop, true)).toEqual({ outcome: "done", linkId: id, keptWrites: 4 });
    const conn = roleConnection(isolated.connect(), role);
    try {
      await expect(conn.query("SELECT credential_ref FROM ledger_links")).rejects.toMatchObject({ code: "42501" });
      await expect(
        conn.query("UPDATE ledger_links SET credential_ref='synthetic-forged-reference'"),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await conn.close();
    }
  });
  it("잘못된 시계는 쓰기 전에 거절한다", async () => {
    await fixture();
    const before = await snapshotShop(isolated.db, shop),
      conn = isolated.connect();
    try {
      await expect(
        shopRequestDb(createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId }), conn).transaction((tx) =>
          unlinkLedgerRecord(tx, new Date(Number.NaN)),
        ),
      ).rejects.toThrow(RangeError);
    } finally {
      await conn.close();
    }
    expect(await snapshotShop(isolated.db, shop)).toEqual(before);
  });
});
