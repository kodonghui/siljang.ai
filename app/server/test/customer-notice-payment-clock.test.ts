import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { recordPaymentNoticeDelivery } from "../src/customer-notice-store";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { describeDb, newUuid } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-25T00:00:00Z"),
  HOUR = 3600000;
describeDb("결제 안내 전달 시각(TASK-104)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    shop = await createShop(isolated.db, "합성 결제 전달 가게");
  });
  afterAll(async () => {
    await isolated?.close();
  });
  const scoped = () =>
    shopRequestDb(createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId }), isolated.db);
  async function notice(capHours: number, delivered = true) {
    const id = newUuid(),
      cap = new Date(NOW.getTime() + capHours * HOUR);
    await isolated.db.query(
      "UPDATE payment_requests SET delivered_at=NULL,issued_at=$2,due_at=$3,due_cap_at=$3 WHERE id=$1",
      [shop.paymentRequestId, new Date(NOW.getTime() - HOUR), cap],
    );
    await isolated.db.query(
      "INSERT INTO notifications(id,shop_id,customer_id,consultation_id,order_id,kind,event_key,template_key,body,status,sent_at,created_at) VALUES($1,$2,$3,$4,$5,'payment_request',$6,'payment_request:v1','합성 결제 안내',$7,$8,$9)",
      [
        id,
        shop.shopId,
        shop.customerId,
        shop.consultationId,
        shop.orderId,
        `notice:${shop.paymentRequestId}:payment_request`,
        delivered ? "delivered_on_reply" : "deferred",
        delivered ? NOW : null,
        NOW,
      ],
    );
    return { id, cap };
  }
  async function state() {
    return (
      await isolated.db.query("SELECT delivered_at,due_at,due_cap_at FROM payment_requests WHERE id=$1", [
        shop.paymentRequestId,
      ])
    ).rows[0];
  }
  it.each([6, 24])("실제 전달부터12시간과 남은 상한%s시간 중 이른 때를 한 번만 남긴다", async (capHours) => {
    const { id, cap } = await notice(capHours);
    expect(await scoped().transaction((db) => recordPaymentNoticeDelivery(db, id, shop.customerId, NOW))).toBe(true);
    const first = await state();
    expect(first).toEqual({
      delivered_at: NOW,
      due_at: new Date(NOW.getTime() + Math.min(12, capHours) * HOUR),
      due_cap_at: cap,
    });
    expect(
      await scoped().transaction((db) =>
        recordPaymentNoticeDelivery(db, id, shop.customerId, new Date(NOW.getTime() + HOUR)),
      ),
    ).toBe(false);
    expect(await state()).toEqual(first);
  });
  it("전달되지 않은 안내와 다른 손님은 결제 시계를 시작하지 않는다", async () => {
    const { id, cap } = await notice(24, false);
    expect(await scoped().transaction((db) => recordPaymentNoticeDelivery(db, id, shop.customerId, NOW))).toBe(false);
    await isolated.db.query("UPDATE notifications SET status='delivered_on_reply',sent_at=$2 WHERE id=$1", [id, NOW]);
    expect(await scoped().transaction((db) => recordPaymentNoticeDelivery(db, id, newUuid(), NOW))).toBe(false);
    expect(await state()).toEqual({ delivered_at: null, due_at: cap, due_cap_at: cap });
  });
  it("새 금액 확인 전에는 안내가 전달돼도 시계를 시작하지 않는다", async () => {
    const { id, cap } = await notice(24);
    await isolated.db.query(
      "UPDATE payment_requests SET needs_amount_confirm=true,requested_amount=30000 WHERE id=$1",
      [shop.paymentRequestId],
    );
    expect(await scoped().transaction((db) => recordPaymentNoticeDelivery(db, id, shop.customerId, NOW))).toBe(false);
    expect(await state()).toEqual({ delivered_at: null, due_at: cap, due_cap_at: cap });
  });
  it("기한 상한이 지난 뒤 처음 전달돼도 시계를 시작하지 않는다", async () => {
    const { id, cap } = await notice(24, false);
    await isolated.db.query("UPDATE notifications SET status='delivered_on_reply',sent_at=$2 WHERE id=$1", [
      id,
      new Date(cap.getTime() + 1),
    ]);
    expect(
      await scoped().transaction((db) =>
        recordPaymentNoticeDelivery(db, id, shop.customerId, new Date(cap.getTime() + 1)),
      ),
    ).toBe(false);
    expect(await state()).toEqual({ delivered_at: null, due_at: cap, due_cap_at: cap });
  });
});
