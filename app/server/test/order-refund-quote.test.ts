import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { quoteOrderCancellation } from "../src/order-refund-quote";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { describeDb, newUuid } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-24T00:00:00Z");
describeDb("요청 당시 운영규정의 취소 계산(TASK-067 수락 기준5)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    shop = await createShop(isolated.db, "합성 규정 계산 가게");
  });
  afterAll(async () => {
    await isolated?.close();
  });
  const scoped = () => shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "quote" }), isolated.db);
  const quote = (received = 35000, decided = 0, reserved = 0, reason: "customer" | "shop" = "customer") =>
    quoteOrderCancellation(scoped(), {
      orderId: shop.orderId,
      cancelledAt: NOW,
      funds: { received, decided, reserved },
      reason,
    });
  it("새 규정3의 비율이0%여도 요청 당시 규정2로35000원을 계산한다", async () => {
    await isolated.db.query("UPDATE operating_rules SET version=2,superseded_at=$2 WHERE id=$1", [
      shop.operatingRulesId,
      NOW,
    ]);
    await isolated.db.query(
      "INSERT INTO operating_rules (id,shop_id,version,change_deadline_hours,date_change_refund_basis,pre_production_refund_pct,pre_production_lowered_ack) VALUES ($1,$2,3,24,'original_pickup',0,true)",
      [newUuid(), shop.shopId],
    );
    expect(await quote()).toMatchObject({ amount: 35000, operatingRulesVersion: 2, basis: { refundPct: 100 } });
  });
  it("수수료를 먼저 빼고 비율을 곱해 원 미만은 버린다", async () => {
    await isolated.db.query(
      "UPDATE operating_rules SET cancellation_fee_krw=5000,pre_production_refund_pct=50,pre_production_lowered_ack=true WHERE id=$1",
      [shop.operatingRulesId],
    );
    expect(await quote(33333)).toMatchObject({ amount: 14166, basis: { base: 33333, fee: 5000, refundPct: 50 } });
  });
  it("이미 정한 환불과 별도 환불 몫은 바탕에서 빼고 수수료가 크면0원이다", async () => {
    await isolated.db.query("UPDATE operating_rules SET cancellation_fee_krw=5000 WHERE id=$1", [
      shop.operatingRulesId,
    ]);
    expect(await quote(50000, 10000, 2000)).toMatchObject({ amount: 33000, basis: { base: 38000 } });
    expect(await quote(3000)).toMatchObject({ amount: 0, basis: { base: 3000, fee: 3000 } });
  });
  it("가게 사정 취소는 수수료와 비율을 쓰지 않고 바탕 전액이다", async () => {
    await isolated.db.query(
      "UPDATE operating_rules SET cancellation_fee_krw=5000,pre_production_refund_pct=50,pre_production_lowered_ack=true WHERE id=$1",
      [shop.operatingRulesId],
    );
    expect(await quote(50000, 10000, 2000, "shop")).toMatchObject({ amount: 38000, basis: { fee: 0, refundPct: 100 } });
  });
  it("제작 뒤 단계는 남은 시간을 버리고 같은 규정의 범위 행을 고른다", async () => {
    const pickup = new Date(NOW.getTime() + 71.5 * 3600000);
    await isolated.db.transaction(async (tx) => {
      await tx.query(
        "UPDATE orders SET pickup_at=$2,pickup_day=($2::timestamptz AT TIME ZONE 'Asia/Seoul')::date WHERE id=$1",
        [shop.orderId, pickup],
      );
      await tx.query("UPDATE order_details SET pickup_at=$2 WHERE order_id=$1", [shop.orderId, pickup]);
    });
    await isolated.db.query("INSERT INTO productions (shop_id,order_id,production_started_at) VALUES ($1,$2,$3)", [
      shop.shopId,
      shop.orderId,
      new Date(NOW.getTime() - 1000),
    ]);
    await isolated.db.query(
      "INSERT INTO refund_tiers (shop_id,operating_rules_id,hours_before_min,hours_before_max,refund_pct) VALUES ($1,$2,0,72,0),($1,$2,72,NULL,50)",
      [shop.shopId, shop.operatingRulesId],
    );
    expect(await quote(50000)).toMatchObject({ amount: 0, basis: { hoursBefore: 71, refundPct: 0 } });
  });
  it("다른 가게 주문은404이고 금액을 반환하지 않는다", async () => {
    const other = await createShop(isolated.db, "다른 규정 가게");
    await expect(
      quoteOrderCancellation(scoped(), {
        orderId: other.orderId,
        cancelledAt: NOW,
        funds: { received: 35000, decided: 0, reserved: 0 },
        reason: "customer",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it("안전한 정수의 상한에서도 비율 계산은 원 단위를 잃지 않는다", async () => {
    await isolated.db.query(
      "UPDATE operating_rules SET pre_production_refund_pct=99,pre_production_lowered_ack=true WHERE id=$1",
      [shop.operatingRulesId],
    );
    expect(await quote(9007199254740991)).toMatchObject({ amount: 8917127262193581 });
  });
  it.each([-1, 0.5, 9007199254740992])(
    "검증되지 않은 음수·소수·정수 상한 밖 금액은 계산하지 않는다(%s)",
    async (received) => {
      await expect(quote(received)).rejects.toThrow(RangeError);
    },
  );
});
