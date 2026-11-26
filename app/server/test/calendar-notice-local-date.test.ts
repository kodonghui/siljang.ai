/** 실제 캘린더 API와 저장된 안내의 재예약. 실제 카카오/모델 발신은 하지 않는다. */
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { rescheduleCalendarNotices } from "../src/calendar-notices";
import { createDayBeforeNotice } from "../src/day-before-notice";
import {
  deferredKakaoBatch,
  markDeferredKakaoMessages,
  releaseDeferredKakaoClaim,
  validateDeferredKakaoCallback,
} from "../src/kakao-deferred";
import { ApiError } from "../src/problem";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { describeDb, newRequestKey, newUuid, testEnv } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, type ShopFixture } from "./support/shops";

const PICKUP = new Date("2026-11-28T06:00:00Z"),
  INITIAL = new Date("2026-11-27T04:00:00Z");
describeDb("TASK134 후속: 캘린더 재예약의 현재 현지 픽업 날짜", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    shop = await createShop(isolated.db, "합성 현지 날짜 캘린더 가게");
    const confirmed = new Date("2026-11-25T04:00:00Z"),
      paymentId = newUuid();
    await isolated.db.transaction(async (tx) => {
      await tx.query(
        "UPDATE shops SET time_zone='Pacific/Honolulu',pickup_address='합성 픽업 장소',contact_phone='02-000-0000' WHERE id=$1",
        [shop.shopId],
      );
      await tx.query(
        "UPDATE payment_requests SET status='paid',paid_at=$2,arrived_at=$2,arrived_amount=amount WHERE id=$1",
        [shop.paymentRequestId, confirmed],
      );
      await tx.query(
        "INSERT INTO payments(id,shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES($1,$2,$3,$4,35000,$5)",
        [paymentId, shop.shopId, shop.orderId, shop.paymentRequestId, confirmed],
      );
      await tx.query("UPDATE order_details SET pickup_at=$2 WHERE order_id=$1 AND version=1", [shop.orderId, PICKUP]);
      await tx.query(
        "UPDATE orders SET status='confirmed',confirmed_at=$2,confirmed_payment_id=$3,pickup_at=$4,pickup_day='2026-11-28' WHERE id=$1",
        [shop.orderId, confirmed, paymentId, PICKUP],
      );
    });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("합성 캘린더의 실제 발신 금지"));
  });
  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await isolated?.close();
  });
  const scoped = () =>
    shopRequestDb(createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId }), isolated.db);

  const saveCalendar = async (now: Date) => {
    const app = createApp({
      connect: () => isolated.connect(),
      scopes: {
        owner: async (c) => {
          if (c.req.header("x-test-owner") !== shop.ownerId) throw new ApiError("unauthenticated");
          return createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId });
        },
      },
      services: { now: () => now },
      logSink: () => {},
    });
    return app.request(
      "https://siljang.example/api/owner/calendar",
      {
        method: "PUT",
        headers: {
          origin: "https://siljang.example",
          "content-type": "application/json",
          "Idempotency-Key": newRequestKey(),
          "x-test-owner": shop.ownerId,
        },
        body: JSON.stringify({
          baseRevision: null,
          closedWeekdays: [],
          dailyCapacity: 10,
          orderCutoffDays: 2,
          orderCutoffTime: "18:00",
          replyStart: "09:00",
          replyEnd: "21:00",
          dayBeforeNoticeTime: "20:50",
          reviewRequestTime: "11:00",
        }),
      },
      testEnv(),
    );
  };
  it.each([
    {
      zone: "Pacific/Honolulu",
      initial: INITIAL,
      now: new Date("2026-11-27T06:50:30Z"),
      expected: "2026-11-27T06:50:00.000Z",
    },
    {
      zone: "UTC",
      initial: new Date("2026-11-27T18:00:00Z"),
      now: new Date("2026-11-27T20:50:30Z"),
      expected: "2026-11-27T20:50:00.000Z",
    },
  ])(
    "마지막 Cron 뒤 API027에서20:50으로 바꿔도 현지 전날의 안내를 다음 대화에 전한다($zone)",
    async ({ zone, initial, now, expected }) => {
      await isolated.db.query("UPDATE shops SET time_zone=$2 WHERE id=$1", [shop.shopId, zone]);
      expect(await scoped().transaction((tx) => createDayBeforeNotice(tx, shop.orderId, initial))).toBe(true);
      const response = await saveCalendar(now);
      expect(response.status, await response.clone().text()).toBe(200);
      const notice = (
        await isolated.db.query<{ id: string; scheduled_for: Date; status: string }>(
          "SELECT id,scheduled_for,status FROM notifications WHERE shop_id=$1 AND kind='day_before'",
          [shop.shopId],
        )
      ).rows[0];
      expect(notice?.scheduled_for.toISOString()).toBe(expected);
      expect(notice?.status).toBe("deferred");
      expect(
        (await scoped().transaction((tx) => deferredKakaoBatch(tx, shop.customerId, { now }))).messages.map(
          (n) => n.id,
        ),
      ).toEqual([notice?.id]);
    },
  );
  it("전송 선점 중인 안내는 재예약하지 않고 만료 뒤에는 현지 날짜로 고치며 옛 표지를 푼다", async () => {
    expect(await scoped().transaction((tx) => createDayBeforeNotice(tx, shop.orderId, INITIAL))).toBe(true);
    const claim = { id: newUuid(), until: new Date(INITIAL.getTime() + 30000) };
    const previous = (
      await scoped().transaction((tx) =>
        deferredKakaoBatch(tx, shop.customerId, { now: INITIAL, callbackClaim: claim }),
      )
    ).messages;
    expect(previous).toHaveLength(1);
    const before = { dayBefore: "18:00", review: "11:00" },
      after = { dayBefore: "20:50", review: "11:00" };
    await scoped().transaction((tx) => rescheduleCalendarNotices(tx, "Pacific/Honolulu", before, after, INITIAL));
    const active = (
      await isolated.db.query<{ scheduled_for: Date; reply_claim_id: string }>(
        "SELECT scheduled_for,reply_claim_id FROM notifications WHERE shop_id=$1",
        [shop.shopId],
      )
    ).rows[0];
    expect(active?.scheduled_for).toEqual(INITIAL);
    expect(active?.reply_claim_id).toBe(claim.id);
    await scoped().transaction((tx) =>
      rescheduleCalendarNotices(tx, "Pacific/Honolulu", before, after, new Date(INITIAL.getTime() + 30001)),
    );
    const expired = (
      await isolated.db.query<{ scheduled_for: Date; reply_claim_id: string | null; reply_claim_until: Date | null }>(
        "SELECT scheduled_for,reply_claim_id,reply_claim_until FROM notifications WHERE shop_id=$1",
        [shop.shopId],
      )
    ).rows[0];
    expect(expired?.scheduled_for.toISOString()).toBe("2026-11-27T06:50:00.000Z");
    expect(expired).toMatchObject({ reply_claim_id: null, reply_claim_until: null });
  });
  it.each(["released", "expired"] as const)(
    "마지막 Cron 뒤 저장 한 번과 선점 %s 뒤 다음 대화가 현재 시각의 같은 안내를 전한다",
    async (mode) => {
      expect(await scoped().transaction((tx) => createDayBeforeNotice(tx, shop.orderId, INITIAL))).toBe(true);
      const now = new Date("2026-11-27T06:50:30Z"),
        claim = { id: newUuid(), until: new Date(now.getTime() + 10000) };
      const previous = (
        await scoped().transaction((tx) => deferredKakaoBatch(tx, shop.customerId, { now, callbackClaim: claim }))
      ).messages;
      expect(previous).toHaveLength(1);
      const response = await saveCalendar(now);
      expect(response.status, await response.clone().text()).toBe(200);
      expect(
        await scoped().transaction((tx) =>
          validateDeferredKakaoCallback(tx, shop.customerId, previous, claim, new Date(now.getTime() + 1)),
        ),
      ).toBe(false);
      if (mode === "released")
        await scoped().transaction((tx) => releaseDeferredKakaoClaim(tx, shop.customerId, claim));
      const nextAt = new Date(mode === "released" ? now.getTime() + 20 : claim.until.getTime() + 1);
      const next = await scoped().transaction((tx) => deferredKakaoBatch(tx, shop.customerId, { now: nextAt }));
      expect(next.messages.map((n) => n.id)).toEqual(previous.map((n) => n.id));
      const notice = (
        await isolated.db.query<{ scheduled_for: Date; status: string }>(
          "SELECT scheduled_for,status,reply_claim_id,reply_claim_until,sent_at FROM notifications WHERE shop_id=$1",
          [shop.shopId],
        )
      ).rows[0];
      expect(notice?.scheduled_for.toISOString()).toBe("2026-11-27T06:50:00.000Z");
      expect(notice).toMatchObject({
        status: "deferred",
        reply_claim_id: null,
        reply_claim_until: null,
        sent_at: null,
      });
      await scoped().transaction((tx) => markDeferredKakaoMessages(tx, shop.customerId, next.messages, nextAt));
      expect(
        (await isolated.db.query("SELECT status,sent_at FROM notifications WHERE shop_id=$1", [shop.shopId])).rows,
      ).toEqual([{ status: "delivered_on_reply", sent_at: nextAt }]);
    },
  );
});
