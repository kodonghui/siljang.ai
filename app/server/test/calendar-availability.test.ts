import { afterAll, beforeAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import { calendarBookingDays, lockedCalendarSlotStatus } from "../src/calendar";
import { DUE_SOURCES } from "../src/due-sources";
import { runDueJobs } from "../src/job-runner";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { describeDb, newRequestKey, newUuid, testEnv } from "./support/db";
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

  it.each([
    ["2026-11-18", "outside_window"],
    ["2027-06-01", "outside_window"],
    ["2027-01-18", "outside_window"],
    ["2026-13-40", "bad_format"],
  ])("기간/형식 밖 %s는 호출자가 지정한 필드 오류이고 잡지 않은 날짜를 만들지 않음", async (day, code) => {
    const h = await fixture();
    const before = (await (await h.call("GET", "/owner/calendar")).json()) as { revision: string };
    await h.db.transaction(async (tx) => {
      try {
        await lockedCalendarSlotStatus(tx, day, NOW, "/draft/pickupDay");
        throw new Error("기간 밖 날짜를 받음");
      } catch (error) {
        expect(error).toMatchObject({
          code: "validation_failed",
          extras: { errors: [{ field: "/draft/pickupDay", code }] },
        });
      }
    });
    const after = (await (await h.call("GET", "/owner/calendar")).json()) as { revision: string };
    expect(after.revision).toBe(before.revision);
    expect(
      (await isolated.db.query("SELECT count(*)::int AS n FROM calendar_days WHERE shop_id=$1", [h.shop.shopId])).rows,
    ).toEqual([{ n: 0 }]);
  });

  it("날짜를 잡지 않은 휴무/열린 날 판정은 커밋해도 빈 행을 남기지 않으며 기간 마지막 날도 허용함", async () => {
    const h = await fixture();
    const before = (await (await h.call("GET", "/owner/calendar")).json()) as { revision: string };
    expect(await h.db.transaction((tx) => lockedCalendarSlotStatus(tx, "2026-11-23", NOW))).toEqual({
      day: "2026-11-23",
      status: "day_off",
    });
    expect(await h.db.transaction((tx) => lockedCalendarSlotStatus(tx, "2027-01-17", NOW))).toEqual({
      day: "2027-01-17",
      status: "open",
    });
    expect(
      (await isolated.db.query("SELECT count(*)::int AS n FROM calendar_days WHERE shop_id=$1", [h.shop.shopId])).rows,
    ).toEqual([{ n: 0 }]);
    expect(((await (await h.call("GET", "/owner/calendar")).json()) as { revision: string }).revision).toBe(
      before.revision,
    );
  });

  it("기존 자리 아래로 줄인 개수와 추가 수락은 공개/새 자리 판정에서 모두 마감이며 기존 자리를 보존함", async () => {
    const h = await fixture();
    await isolated.db.query("INSERT INTO calendar_days (shop_id,day) VALUES ($1,'2026-11-21')", [h.shop.shopId]);
    await isolated.db.query(
      "INSERT INTO slot_holds (shop_id,day,order_id,payment_request_id,hold_key,status,overbooked) VALUES ($1,'2026-11-21',$2,$3,$4,'held',true)",
      [h.shop.shopId, h.shop.orderId, h.shop.paymentRequestId, `hold:${h.shop.orderId}:availability`],
    );
    const held = await h.db.transaction((tx) => lockedCalendarSlotStatus(tx, "2026-11-21", NOW));
    expect(held.status).toBe("closed");
    await isolated.db.query("UPDATE slot_holds SET overbooked=false WHERE shop_id=$1", [h.shop.shopId]);
    expect((await h.db.transaction((tx) => lockedCalendarSlotStatus(tx, "2026-11-21", NOW))).status).toBe("open");
    const {
      revision,
      updatedAt: _updated,
      ...settings
    } = (await (await h.call("GET", "/owner/calendar")).json()) as Record<string, unknown>;
    expect(
      (
        await h.call("PUT", "/owner/calendar", {
          ...settings,
          baseRevision: revision,
          dailyCapacity: 0,
          confirm: ["capacity_below_held"],
        })
      ).status,
    ).toBe(200);
    const days = await h.db.transaction((tx) => calendarBookingDays(tx, NOW));
    expect(days.find((d) => d.day === "2026-11-21")).toEqual({ day: "2026-11-21", status: "closed" });
    expect(await h.db.transaction((tx) => lockedCalendarSlotStatus(tx, "2026-11-21", NOW))).toEqual({
      day: "2026-11-21",
      status: "closed",
    });
    expect((await isolated.db.query("SELECT status FROM slot_holds WHERE shop_id=$1", [h.shop.shopId])).rows).toEqual([
      { status: "held" },
    ]);
  });

  it("후기 예정 시각을 늦춘 재시도도 새 시각 전에는 찾거나 잡지 않고 한 번만 실행함", async () => {
    const h = await fixture();
    const id = newUuid();
    await isolated.db.query(
      `INSERT INTO notifications (id,shop_id,customer_id,consultation_id,order_id,kind,event_key,template_key,body,status,attempts,scheduled_for,next_attempt_at)
      VALUES ($1,$2,$3,$4,$5,'review_request',$6,'합성 후기','합성 후기','retrying',1,'2026-11-21T02:00:00Z','2026-11-21T02:00:00Z')`,
      [
        id,
        h.shop.shopId,
        h.shop.customerId,
        h.shop.consultationId,
        h.shop.orderId,
        `notice:${h.shop.orderId}:calendar-test`,
      ],
    );
    const {
      revision,
      updatedAt: _updated,
      ...settings
    } = (await (await h.call("GET", "/owner/calendar")).json()) as Record<string, unknown>;
    expect(
      (await h.call("PUT", "/owner/calendar", { ...settings, baseRevision: revision, reviewRequestTime: "15:00" }))
        .status,
    ).toBe(200);
    const eleven = new Date("2026-11-21T02:00:00Z");
    const fifteen = new Date("2026-11-21T06:00:00Z");
    expect((await isolated.db.query(DUE_SOURCES.notification_send.find, [eleven, 1000])).rows).toEqual([]);
    expect((await h.db.transaction((tx) => tx.run(DUE_SOURCES.notification_send.claim, [id, eleven]))).rowCount).toBe(
      0,
    );
    let runs = 0;
    const run = (now: Date) =>
      runDueJobs({
        db: isolated.db,
        now,
        log: () => {},
        jobs: [
          {
            name: "calendar_notice_test",
            every: "minute",
            sources: ["notification_send"],
            handler: {
              mode: "transaction",
              async run(tx, item, ctx) {
                runs++;
                await tx.run(
                  "UPDATE notifications SET status='delivered_on_reply',sent_at=$3 WHERE shop_id=$1 AND id=$2",
                  [item.id, ctx.now],
                );
              },
            },
          },
        ],
      });
    await run(eleven);
    expect(runs).toBe(0);
    await run(fifteen);
    await run(fifteen);
    expect(runs).toBe(1);
    const notice = (
      await isolated.db.query<{ attempts: number; next_attempt_at: Date }>(
        "SELECT attempts,next_attempt_at FROM notifications WHERE id=$1",
        [id],
      )
    ).rows[0];
    expect(notice?.attempts).toBe(1);
    expect(notice?.next_attempt_at.toISOString()).toBe(eleven.toISOString());
  });
});
