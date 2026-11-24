import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { assessPickupDay, closedDayNoticeTrace, requestClosedPickupDay } from "../src/booking-capacity";
import { eventKeys } from "../src/event-keys";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { describeDb, newUuid } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-18T00:00:00Z"),
  DAY = "2026-11-22";
describeDb("날짜 판정·가까운 날과 마감 질문(TASK-068)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    shop = await createShop(isolated.db, "합성 날짜 가게");
    await issueTestBookingLink(isolated.db, shop);
    await isolated.db.query(
      "UPDATE business_calendars SET closed_weekdays='{}',daily_capacity=1,order_cutoff_days=0,order_cutoff_time='23:59' WHERE shop_id=$1",
      [shop.shopId],
    );
  });
  afterAll(async () => {
    await isolated?.close();
  });
  const scoped = () => shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }), isolated.db);
  const ask = (day: string, now = NOW) => assessPickupDay(scoped(), day, now);
  async function fullDay() {
    await isolated.db.transaction(async (tx) => {
      await tx.query(
        "UPDATE orders SET pickup_day=$2::date,pickup_at=$2::date+time '06:00' AT TIME ZONE 'UTC' WHERE id=$1",
        [shop.orderId, DAY],
      );
      await tx.query("UPDATE order_details SET pickup_at=$2::date+time '06:00' AT TIME ZONE 'UTC' WHERE order_id=$1", [
        shop.orderId,
        DAY,
      ]);
      await tx.query("INSERT INTO calendar_days (shop_id,day) VALUES ($1,$2::date)", [shop.shopId, DAY]);
      await tx.query(
        "INSERT INTO slot_holds (shop_id,day,order_id,payment_request_id,hold_key,status) VALUES ($1,$2::date,$3,$4,$5,'held')",
        [shop.shopId, DAY, shop.orderId, shop.paymentRequestId, eventKeys.hold(shop.orderId, shop.paymentRequestId)],
      );
    });
  }
  async function notice(delivered = false) {
    const id = newUuid();
    await isolated.db.query(
      "INSERT INTO messages (id,shop_id,consultation_id,direction,author,kind,trace_id,body_masked,delivery,sent_at,created_at) VALUES ($1,$2,$3,'outbound','system','text',$4,'그날은 마감됐어요.',$5,$6,$7)",
      [
        id,
        shop.shopId,
        shop.consultationId,
        closedDayNoticeTrace(shop.messageId, DAY),
        delivered ? "callback" : "deferred",
        delivered ? NOW : null,
        NOW,
      ],
    );
    return id;
  }
  const request = (noticeMessageId: string, insist = true) =>
    requestClosedPickupDay(scoped(), {
      consultationId: shop.consultationId,
      sourceMessageId: shop.messageId,
      day: DAY,
      noticeMessageId,
      insist,
      now: NOW,
    });
  it("휴무20일에는19/21일을 포함해 가까운 세 날만 권하고 자리/질문을 만들지 않는다", async () => {
    await isolated.db.query("INSERT INTO calendar_days (shop_id,day,closed) VALUES ($1,'2026-11-20',true)", [
      shop.shopId,
    ]);
    const result = await ask("2026-11-20");
    expect(result).toMatchObject({ day: "2026-11-20", status: "day_off" });
    expect(result.alternatives).toEqual(["2026-11-19", "2026-11-21", "2026-11-18"]);
    expect((await isolated.db.query("SELECT id FROM slot_holds WHERE shop_id=$1", [shop.shopId])).rows).toHaveLength(0);
    expect((await isolated.db.query("SELECT id FROM handoffs WHERE shop_id=$1", [shop.shopId])).rows).toHaveLength(0);
  });
  it("다 찬 날을 원해도 새 자리를 잡지 않고 안내 전달 뒤에만 사장님 할 일/알림을 만든다", async () => {
    await fullDay();
    const id = await notice();
    expect(await request(id)).toMatchObject({ kind: "waiting_for_notice", availability: { status: "closed" } });
    expect((await isolated.db.query("SELECT id FROM owner_tasks WHERE shop_id=$1", [shop.shopId])).rows).toHaveLength(
      0,
    );
    await isolated.db.query("UPDATE messages SET delivery='callback',sent_at=$2 WHERE id=$1", [id, NOW]);
    const result = await request(id);
    expect(result).toMatchObject({ kind: "handed_off", availability: { status: "closed" } });
    const handoffs = (
      await isolated.db.query("SELECT reason,requested_day::text FROM handoffs WHERE shop_id=$1", [shop.shopId])
    ).rows;
    expect(handoffs).toEqual([{ reason: "closed_day", requested_day: DAY }]);
    expect((await isolated.db.query("SELECT id FROM slot_holds WHERE shop_id=$1", [shop.shopId])).rows).toHaveLength(1);
    expect(
      (await isolated.db.query("SELECT kind,wait_status FROM owner_tasks WHERE shop_id=$1", [shop.shopId])).rows,
    ).toEqual([{ kind: "handoff", wait_status: "waiting" }]);
    expect((await isolated.db.query("SELECT kind FROM owner_alerts WHERE shop_id=$1", [shop.shopId])).rows).toEqual([
      { kind: "new_task" },
    ]);
    expect(await request(id)).toEqual(result);
    expect((await isolated.db.query("SELECT id FROM owner_alerts WHERE shop_id=$1", [shop.shopId])).rows).toHaveLength(
      1,
    );
  });
  it("마감된 날이어도 손님이 다시 원하지 않으면 넘기지 않는다", async () => {
    await fullDay();
    expect(await request(await notice(true), false)).toMatchObject({ kind: "not_requested" });
    expect((await isolated.db.query("SELECT id FROM handoffs WHERE shop_id=$1", [shop.shopId])).rows).toHaveLength(0);
  });
  it.each(["2026-11-17", "2027-01-17"])("기간 밖 날짜는 받을 수 없고 다른 날/수량을 내지 않는다(%s)", async (day) => {
    expect(await ask(day)).toMatchObject({ status: "outside_window", alternatives: [] });
  });
  it("가까운 날이 없으면 빈 목록과 사장님 확인을 요청할 수 있다는 안내를 낸다", async () => {
    await isolated.db.query("UPDATE business_calendars SET closed_weekdays=ARRAY[1,2,3,4,5,6,7] WHERE shop_id=$1", [
      shop.shopId,
    ]);
    const result = await ask("2026-11-20");
    expect(result.alternatives).toEqual([]);
    expect(result.message).toContain("가까운 날에 자리가 없어요");
    expect(Object.keys(result).sort()).toEqual(["alternatives", "day", "message", "status"]);
  });
  it("가게 시간대의 마감 시각 바로 전은 열리고 정각은 마감이다", async () => {
    await isolated.db.query(
      "UPDATE business_calendars SET order_cutoff_days=2,order_cutoff_time='09:00' WHERE shop_id=$1",
      [shop.shopId],
    );
    expect(await ask("2026-11-20", new Date(NOW.getTime() - 1))).toMatchObject({ status: "open" });
    expect(await ask("2026-11-20", NOW)).toMatchObject({ status: "closed" });
  });
  it("다른 가게의 상담/메시지로는 요청하지 못한다", async () => {
    const other = await createShop(isolated.db, "다른 날짜 가게");
    await fullDay();
    await expect(
      requestClosedPickupDay(scoped(), {
        consultationId: other.consultationId,
        sourceMessageId: other.messageId,
        day: DAY,
        noticeMessageId: await notice(true),
        insist: true,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
