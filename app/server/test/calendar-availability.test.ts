import { afterAll, beforeAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import { calendarBookingDays, lockedCalendarSlotStatus } from "../src/calendar";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { describeDb, newRequestKey, testEnv } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop } from "./support/shops";

const ORIGIN = "https://siljang.example";
const NOW = new Date("2026-11-19T00:00:00Z");

describeDb("TASK-041 예약 날짜·새 자리 판정", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  afterAll(async () => {
    await isolated?.close();
  });

  async function fixture() {
    const shop = await createShop(isolated.db, "캘린더 날짜 판정 합성 가게");
    const scope = createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId });
    const api = createApp({
      connect: () => isolated.connect(),
      scopes: { owner: async () => scope },
      services: { now: () => NOW },
      logSink: () => {},
    });
    async function call(method: string, path: string, body?: unknown) {
      return api.request(
        `${ORIGIN}/api${path}`,
        {
          method,
          headers: { origin: ORIGIN, "content-type": "application/json", "Idempotency-Key": newRequestKey() },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        testEnv(),
      );
    }
    expect(
      (
        await call("PUT", "/owner/calendar", {
          baseRevision: null,
          closedWeekdays: [1],
          dailyCapacity: 5,
          orderCutoffDays: 1,
          orderCutoffTime: "18:00",
          replyStart: "09:00",
          replyEnd: "21:00",
          dayBeforeNoticeTime: "18:00",
          reviewRequestTime: "11:00",
        })
      ).status,
    ).toBe(200);
    const db = shopRequestDb(scope, isolated.db);
    return { shop, db, call };
  }

  it("휴무·날짜별 개수·마감 시각은 공개 날짜 상태에 반영되고 남은 자리/식별자는 없음", async () => {
    const h = await fixture();
    expect(
      (await h.call("PATCH", "/owner/calendar/days/2026-11-20", { baseRevision: null, closed: true })).status,
    ).toBe(200);
    expect(
      (await h.call("PATCH", "/owner/calendar/days/2026-11-21", { baseRevision: null, capacityOverride: 3 })).status,
    ).toBe(200);
    const days = await h.db.transaction((tx) => calendarBookingDays(tx, NOW));
    expect(days).toHaveLength(60);
    expect(days[0]).toEqual({ day: "2026-11-19", status: "closed" });
    expect(days[1]).toEqual({ day: "2026-11-20", status: "day_off" });
    expect(days[2]).toEqual({ day: "2026-11-21", status: "open" });
    expect(days[4]).toEqual({ day: "2026-11-23", status: "day_off" });
    for (const item of days) expect(Object.keys(item).sort()).toEqual(["day", "status"]);
    expect(JSON.stringify(days)).not.toContain(h.shop.shopId);
    const atCutoff = await h.db.transaction((tx) => calendarBookingDays(tx, new Date("2026-11-20T09:00:00Z")));
    expect(atCutoff.find((x) => x.day === "2026-11-21")).toEqual({ day: "2026-11-21", status: "closed" });
  });

  it("수동 마감한 날은 같은 트랜잭션의 새 자리 판정에서 거절하고 풀면 받음", async () => {
    const h = await fixture();
    const response = await h.call("PATCH", "/owner/calendar/days/2026-11-21", {
      baseRevision: null,
      manuallyClosed: true,
    });
    const first = (await response.json()) as { day: { revision: string } };
    const closed = await h.db.transaction((tx) => lockedCalendarSlotStatus(tx, "2026-11-21", NOW));
    expect(closed).toMatchObject({ day: "2026-11-21", status: "closed" });
    expect(
      (await isolated.db.query("SELECT count(*)::int AS n FROM slot_holds WHERE shop_id = $1", [h.shop.shopId])).rows,
    ).toEqual([{ n: 0 }]);
    await h.call("PATCH", "/owner/calendar/days/2026-11-21", {
      baseRevision: first.day.revision,
      manuallyClosed: false,
    });
    expect(await h.db.transaction((tx) => lockedCalendarSlotStatus(tx, "2026-11-21", NOW))).toEqual({
      day: "2026-11-21",
      status: "open",
    });
  });
});
