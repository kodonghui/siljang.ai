import { afterAll, beforeEach, expect, it } from "vitest";
import { purgeConsultation } from "../src/purge-consultation";
import { purgeCustomerKey } from "../src/purge-customer";
import { purgeOrder } from "../src/purge-order";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { describeDb, newUuid, testDb } from "./support/db";
import { createShop, type ShopFixture, snapshotShop } from "./support/shops";

const NOW = new Date("2026-11-21T00:00:00Z");
describeDb("손님 키 지우기(TASK-158, SPEC-065 #12·REQ-190)", () => {
  const db = testDb();
  let f: ShopFixture;
  beforeEach(async () => {
    f = await createShop(db, "손님 키 지우기");
  });
  afterAll(() => db.close());
  const scoped = (fixture = f, connection = db) =>
    shopRequestDb(createShopScope(fixture.shopId, { kind: "job", job: "purge" }), connection);
  const run = (fixture = f, id = fixture.customerId, connection = db) =>
    scoped(fixture, connection).transaction((tx) => purgeCustomerKey(tx, id, NOW));
  async function ready(fixture = f) {
    const at = new Date(NOW.getTime() - 31 * 86_400_000);
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE payment_requests SET status = 'closed', closed_at = $2, close_reason = 'order_cancelled' WHERE order_id = $1",
        [fixture.orderId, at],
      );
      await tx.query(
        "UPDATE orders SET status = 'cancelled', cancelled_at = $2, cancel_kind = 'no_payment', finished_at = $2 WHERE id = $1",
        [fixture.orderId, at],
      );
      await tx.query("UPDATE consultations SET status = 'ended', ended_at = $2 WHERE id = $1", [
        fixture.consultationId,
        at,
      ]);
    });
    await scoped(fixture).transaction(async (tx) => {
      expect(await purgeOrder(tx, fixture.orderId, NOW)).toBe(1);
      expect(await purgeConsultation(tx, fixture.consultationId, NOW)).toBe(1);
    });
  }
  it("모든 상담과 주문을 정리한 손님의 키만 비우고 행은 남김", async () => {
    await ready();
    expect(await run()).toBe(1);
    expect(
      (await db.query("SELECT kakao_user_key, purged_at FROM customers WHERE id = $1", [f.customerId])).rows,
    ).toEqual([{ kakao_user_key: null, purged_at: NOW }]);
    const after = await snapshotShop(db, f);
    expect(await run()).toBe(0);
    expect(await snapshotShop(db, f)).toEqual(after);
  });
  it("살아 있는 상담과 아직 보관되지 않은 주문은 보호", async () => {
    const before = await snapshotShop(db, f);
    expect(await run()).toBe(0);
    expect(await snapshotShop(db, f)).toEqual(before);
  });
  it("상담이 모두 지워졌어도 보관되지 않은 주문이 있으면 키를 유지", async () => {
    await db.query("UPDATE consultations SET status = 'deleted', deleted_at = $2 WHERE id = $1", [
      f.consultationId,
      NOW,
    ]);
    const before = await snapshotShop(db, f);
    expect(await run()).toBe(0);
    expect(await snapshotShop(db, f)).toEqual(before);
  });
  it("그 사이 새 상담이 열렸으면 키를 유지", async () => {
    await ready();
    await db.query("INSERT INTO consultations (shop_id, customer_id) VALUES ($1, $2)", [f.shopId, f.customerId]);
    const before = await snapshotShop(db, f);
    expect(await run()).toBe(0);
    expect(await snapshotShop(db, f)).toEqual(before);
  });
  it("다른 가게의 손님은 지우지 않음", async () => {
    const other = await createShop(db, "다른 손님 가게");
    await ready(other);
    const before = await snapshotShop(db, other);
    expect(await run(f, other.customerId)).toBe(0);
    expect(await snapshotShop(db, other)).toEqual(before);
  });
  it("동시 실행은 키를 한 번만 지움", async () => {
    await ready();
    const other = testDb();
    try {
      expect((await Promise.all([run(), run(f, f.customerId, other)])).sort()).toEqual([0, 1]);
    } finally {
      await other.close();
    }
  });
  it("다른 트랜잭션이 잡은 손님은 기다리지 않고 다음에 지움", async () => {
    await ready();
    const locker = testDb();
    try {
      await locker.transaction(async (tx) => {
        await tx.query("SELECT id FROM customers WHERE id = $1 FOR UPDATE", [f.customerId]);
        expect(await run()).toBe(0);
      });
      expect(await run()).toBe(1);
    } finally {
      await locker.close();
    }
  });
  it("지운 뒤 같은 채널 키로 다시 오면 새 손님 행을 만들 수 있음", async () => {
    await ready();
    expect(await run()).toBe(1);
    const id = newUuid();
    await db.query("INSERT INTO customers (id, shop_id, kakao_channel_id, kakao_user_key) VALUES ($1, $2, $3, $4)", [
      id,
      f.shopId,
      f.channelId,
      f.userKey,
    ]);
    await db.query("INSERT INTO consultations (shop_id, customer_id) VALUES ($1, $2)", [f.shopId, id]);
    expect(
      (
        await db.query("SELECT id FROM customers WHERE kakao_channel_id = $1 AND kakao_user_key = $2", [
          f.channelId,
          f.userKey,
        ])
      ).rows,
    ).toEqual([{ id }]);
    expect(id).not.toBe(f.customerId);
  });
});
