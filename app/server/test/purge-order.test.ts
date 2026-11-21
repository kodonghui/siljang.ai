import { afterAll, beforeEach, expect, it } from "vitest";
import { purgeOrder } from "../src/purge-order";
import { createShopScope, type ShopDb, shopRequestDb } from "../src/shop-scope";
import { describeDb, newUuid, testDb } from "./support/db";
import { createShop, type ShopFixture, snapshotShop } from "./support/shops";

const NOW = new Date("2026-11-21T00:00:00Z");
const DAY = 86_400_000;

describeDb("끝난 주문의 개인정보 지우기(TASK-158, SPEC-065 #1·#6·A16·A22)", () => {
  const db = testDb();
  let shop: ShopFixture;
  let storageKey: string;
  beforeEach(async () => {
    shop = await createShop(db, "보관 기록 주문");
    storageKey = `shops/${shop.shopId}/reference/${newUuid()}.webp`;
    await db.query(
      `INSERT INTO reference_photos (shop_id, draft_id, message_id, storage_key, content_type, byte_size)
       VALUES ($1, $2, $3, $4, 'image/webp', 10)`,
      [shop.shopId, shop.draftId, shop.messageId, storageKey],
    );
    await db.query("UPDATE payment_requests SET depositor_name = '합성입금자' WHERE id = $1", [shop.paymentRequestId]);
  });
  afterAll(() => db.close());

  const scoped = (f: ShopFixture, connection = db) =>
    shopRequestDb(createShopScope(f.shopId, { kind: "job", job: "purge" }), connection);
  const run = (f: ShopFixture, id = f.orderId, connection = db) =>
    scoped(f, connection).transaction((tx) => purgeOrder(tx, id, NOW));
  async function finish(f: ShopFixture, ageDays = 31) {
    const at = new Date(NOW.getTime() - ageDays * DAY);
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE payment_requests SET status = 'closed', closed_at = $2, close_reason = 'order_cancelled' WHERE order_id = $1",
        [f.orderId, at],
      );
      await tx.query(
        "UPDATE orders SET status = 'cancelled', cancelled_at = $2, cancel_kind = 'no_payment', finished_at = $2, lock_version = lock_version + 1 WHERE id = $1",
        [f.orderId, at],
      );
    });
    return at;
  }
  const kept = (f: ShopFixture) =>
    db.query(
      "SELECT customer_name, finished_at, contract_keep_until FROM kept_records WHERE shop_id = $1 AND order_id = $2",
      [f.shopId, f.orderId],
    );

  it("끝나지 않은 주문은 내용과 사진을 바꾸지 않음", async () => {
    const before = await snapshotShop(db, shop);
    expect(await run(shop)).toBe(0);
    expect(await snapshotShop(db, shop)).toEqual(before);
  });
  it("끝난 지 29일인 주문은 아직 지우지 않음", async () => {
    await finish(shop, 29);
    const before = await snapshotShop(db, shop);
    expect(await run(shop)).toBe(0);
    expect(await snapshotShop(db, shop)).toEqual(before);
  });
  it("31일 지난 주문은 이름을 보관 기록으로 옮기고 연락처·입금자·사진을 지우며 금액·동의는 보존", async () => {
    const finishedAt = await finish(shop);
    const before = (
      await db.query<{ lock_version: number; amount: number }>(
        "SELECT lock_version, amount FROM orders WHERE id = $1",
        [shop.orderId],
      )
    ).rows[0];
    const agreement = await db.query(
      "SELECT id, version, amount, allergy_consent, allergy_consent_version, allergy_consent_at FROM order_details WHERE order_id = $1",
      [shop.orderId],
    );
    const payment = await db.query(
      "SELECT id, amount, status, payment_account_id FROM payment_requests WHERE order_id = $1",
      [shop.orderId],
    );
    expect(await run(shop)).toBe(1);
    const names = await kept(shop);
    expect(names.rows).toHaveLength(1);
    expect(names.rows[0]).toMatchObject({ customer_name: "시험손님", finished_at: finishedAt });
    const fiveYears = new Date(finishedAt);
    fiveYears.setUTCFullYear(fiveYears.getUTCFullYear() + 5);
    expect(names.rows[0]?.contract_keep_until).toEqual(fiveYears);
    expect(
      (await db.query("SELECT customer_name, customer_phone FROM order_details WHERE order_id = $1", [shop.orderId]))
        .rows,
    ).toEqual([{ customer_name: null, customer_phone: null }]);
    expect(
      (await db.query("SELECT customer_name, customer_phone FROM order_drafts WHERE id = $1", [shop.draftId])).rows,
    ).toEqual([{ customer_name: null, customer_phone: null }]);
    expect(
      (await db.query("SELECT depositor_name FROM payment_requests WHERE id = $1", [shop.paymentRequestId])).rows,
    ).toEqual([{ depositor_name: null }]);
    expect((await db.query("SELECT id FROM reference_photos WHERE draft_id = $1", [shop.draftId])).rows).toEqual([]);
    expect(
      (await db.query("SELECT storage_key, source FROM file_deletions WHERE shop_id = $1", [shop.shopId])).rows,
    ).toEqual([{ storage_key: storageKey, source: "reference_photo" }]);
    expect(
      (await db.query("SELECT lock_version, amount, personal_data_purged_at FROM orders WHERE id = $1", [shop.orderId]))
        .rows,
    ).toEqual([
      { lock_version: (before?.lock_version ?? 0) + 1, amount: before?.amount, personal_data_purged_at: NOW },
    ]);
    expect(
      (
        await db.query(
          "SELECT id, version, amount, allergy_consent, allergy_consent_version, allergy_consent_at FROM order_details WHERE order_id = $1",
          [shop.orderId],
        )
      ).rows,
    ).toEqual(agreement.rows);
    expect(
      (
        await db.query("SELECT id, amount, status, payment_account_id FROM payment_requests WHERE order_id = $1", [
          shop.orderId,
        ])
      ).rows,
    ).toEqual(payment.rows);
    const after = await snapshotShop(db, shop);
    expect(await run(shop)).toBe(0);
    expect(await snapshotShop(db, shop)).toEqual(after);
  });
  it("다른 가게의 주문 ID는 아무것도 바꾸지 않음", async () => {
    const other = await createShop(db, "다른 보관 가게");
    await finish(other);
    const before = await snapshotShop(db, other);
    expect(await run(shop, other.orderId)).toBe(0);
    expect(await snapshotShop(db, other)).toEqual(before);
  });
  it("주문 잠금이 있으면 기다리지 않고 다음 실행에서 지움", async () => {
    await finish(shop);
    const locker = testDb();
    try {
      await locker.transaction(async (tx) => {
        await tx.query("SELECT id FROM orders WHERE id = $1 FOR UPDATE", [shop.orderId]);
        expect(await run(shop)).toBe(0);
      });
      expect(await run(shop)).toBe(1);
    } finally {
      await locker.close();
    }
  });
  it("중간 DB 오류는 보관 기록·연락처·사진·삭제 대기를 모두 되돌림", async () => {
    await finish(shop);
    const before = await snapshotShop(db, shop);
    await expect(
      scoped(shop).transaction(async (tx) => {
        const runFailing: ShopDb["run"] = <R>(sql: string, params?: readonly unknown[]) =>
          tx.run<R>(sql.replace(/UPDATE orders SET/, "UPDATE purge_missing_orders SET"), params);
        const failing: ShopDb = {
          scope: tx.scope,
          run: runFailing,
          found: tx.found.bind(tx),
          owned: tx.owned.bind(tx),
          references: tx.references.bind(tx),
        };
        return purgeOrder(failing, shop.orderId, NOW);
      }),
    ).rejects.toThrow();
    expect(await snapshotShop(db, shop)).toEqual(before);
  });
  it("두 실행이 같은 주문을 한 번만 지움", async () => {
    await finish(shop);
    const other = testDb();
    try {
      expect((await Promise.all([run(shop), run(shop, shop.orderId, other)])).sort()).toEqual([0, 1]);
      expect((await kept(shop)).rows).toHaveLength(1);
    } finally {
      await other.close();
    }
  });
});
