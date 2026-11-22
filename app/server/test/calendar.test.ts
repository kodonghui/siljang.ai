import { afterAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import { ApiError } from "../src/problem";
import { createShopScope } from "../src/shop-scope";
import { expectProblem, expectSchema } from "./support/contract";
import { describeDb, newRequestKey, testDb, testEnv } from "./support/db";
import { createShop } from "./support/shops";

const ORIGIN = "https://siljang.example";
const OWNER = "x-test-owner";
const NOW = new Date("2026-11-19T00:00:00Z");
const db = testDb();

function settings(baseRevision: string | null = null) {
  return {
    baseRevision,
    closedWeekdays: [1],
    dailyCapacity: 5,
    orderCutoffDays: 2,
    orderCutoffTime: "18:00",
    replyStart: "09:00",
    replyEnd: "21:00",
    dayBeforeNoticeTime: "18:00",
    reviewRequestTime: "11:00",
  };
}

async function harness() {
  const shop = await createShop(db, "캘린더 합성 가게");
  const app = createApp({
    scopes: {
      owner: async (c) => {
        if (c.req.header(OWNER) !== shop.ownerId) throw new ApiError("unauthenticated");
        return createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId });
      },
    },
    services: { now: () => NOW },
    logSink: () => {},
  });
  function call(method: string, path: string, input?: unknown, authenticated = true, key = newRequestKey()) {
    const init: RequestInit = {
      method,
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        "Idempotency-Key": key,
        ...(authenticated ? { [OWNER]: shop.ownerId } : {}),
      },
    };
    if (input !== undefined) init.body = JSON.stringify(input);
    return app.request(`${ORIGIN}/api${path}`, init, testEnv());
  }
  return { shop, app, call };
}

describeDb("TASK-041 캘린더 API-026~029", () => {
  afterAll(async () => db.close());

  it("정하지 않은 설정은 404 not_set", async () => {
    const h = await harness();
    await expectProblem(await h.call("GET", "/owner/calendar"), "not_set");
  });

  it("처음 설정은 200 created이고 요일/최대 개수/시각을 조회함", async () => {
    const h = await harness();
    const response = await h.call("PUT", "/owner/calendar", settings());
    expect(response.status, await response.clone().text()).toBe(200);
    const result = (await response.json()) as {
      outcome: string;
      calendar: Record<string, unknown>;
      conflicts: unknown[];
    };
    expectSchema("CalendarSettingsResult", result);
    expect(result.outcome).toBe("created");
    expect(result.conflicts).toEqual([]);
    expect(result.calendar).toMatchObject({
      closedWeekdays: [1],
      dailyCapacity: 5,
      orderCutoffTime: "18:00",
      updatedAt: "2026-11-19T09:00:00+09:00",
    });
    const read = await h.call("GET", "/owner/calendar");
    expect(read.status).toBe(200);
    const current = await read.json();
    expectSchema("CalendarSettings", current);
    expect(current).toEqual(result.calendar);
  });

  it("날짜 조회는 날짜 순이며 수동 마감/다시 마감/풀기는 자리 수를 바꾸지 않음", async () => {
    const h = await harness();
    expect((await h.call("PUT", "/owner/calendar", settings())).status).toBe(200);
    const response = await h.call("GET", "/owner/calendar/days?from=2026-11-20&to=2026-11-23");
    expect(response.status).toBe(200);
    const result = (await response.json()) as { items: { day: string; revision: string; weekdayClosed: boolean }[] };
    expectSchema("CalendarDayList", result);
    expect(result.items.map((x) => x.day)).toEqual(["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23"]);
    expect(result.items[3]?.weekdayClosed).toBe(true);
    let revision = result.items[0]?.revision;
    for (const [manuallyClosed, outcome] of [
      [true, "done"],
      [true, "unchanged"],
      [false, "done"],
    ] as const) {
      const updated = await h.call("PATCH", "/owner/calendar/days/2026-11-20", {
        baseRevision: revision,
        manuallyClosed,
      });
      expect(updated.status, await updated.clone().text()).toBe(200);
      const value = (await updated.json()) as { outcome: string; day: { revision: string } };
      expectSchema("CalendarDayResult", value);
      expect(value.outcome).toBe(outcome);
      expect(value.day).toMatchObject({ manuallyClosed, capacity: 5, held: 0, remaining: 5 });
      revision = value.day.revision;
    }
  });

  it.each([
    ["GET", "/owner/calendar", undefined],
    ["PUT", "/owner/calendar", settings()],
    ["GET", "/owner/calendar/days?from=2026-11-20&to=2026-11-23", undefined],
    ["PATCH", "/owner/calendar/days/2026-11-20", { baseRevision: null, manuallyClosed: true }],
  ])("인증 없는 %s %s는 401", async (method, path, input) => {
    const h = await harness();
    await expectProblem(await h.call(method, path, input, false), "unauthenticated");
  });

  async function heldDay(h: Awaited<ReturnType<typeof harness>>, status: "held" | "fixed" = "held") {
    await h.call("PUT", "/owner/calendar", settings());
    await db.query("INSERT INTO calendar_days (shop_id, day) VALUES ($1, '2026-11-20')", [h.shop.shopId]);
    await db.query(
      `INSERT INTO slot_holds (shop_id, day, order_id, payment_request_id, hold_key, status, fixed_at)
      VALUES ($1, '2026-11-20', $2, $3, $4, $5, CASE WHEN $5 = 'fixed' THEN now() ELSE NULL END)`,
      [
        h.shop.shopId,
        h.shop.orderId,
        status === "held" ? h.shop.paymentRequestId : null,
        `hold:${h.shop.orderId}:calendar`,
        status,
      ],
    );
    return (
      (
        (await (await h.call("GET", "/owner/calendar/days?from=2026-11-20&to=2026-11-20")).json()) as {
          items: { revision: string }[];
        }
      ).items[0]?.revision ?? "missing"
    );
  }

  it.each(["held", "fixed"] as const)(
    "%s 주문이 있는 날을 휴무로 바꾸기 전에 주문을 보이고 확인받음",
    async (status) => {
      const h = await harness();
      const baseRevision = await heldDay(h, status);
      const input = { baseRevision, closed: true };
      const result = await expectProblem(
        await h.call("PATCH", "/owner/calendar/days/2026-11-20", input),
        "confirmation_required",
      );
      expect(result).toMatchObject({
        confirm: [{ kind: "closed_day_with_orders", count: 1 }],
        conflicts: [{ day: "2026-11-20", held: 1, orders: [{ orderId: h.shop.orderId }] }],
      });
      const closed = await db.query<{ closed: boolean }>("SELECT closed FROM calendar_days WHERE shop_id = $1", [
        h.shop.shopId,
      ]);
      expect(closed.rows[0]?.closed).toBe(false);
      const confirmed = await h.call("PATCH", "/owner/calendar/days/2026-11-20", {
        ...input,
        confirm: ["closed_day_with_orders"],
      });
      expect(confirmed.status, await confirmed.clone().text()).toBe(200);
      expect(await confirmed.json()).toMatchObject({ day: { closed: true, held: 1, remaining: 4 } });
      expect((await db.query("SELECT status FROM slot_holds WHERE shop_id = $1", [h.shop.shopId])).rows).toEqual([
        { status },
      ]);
    },
  );

  it("하루 최대 개수를 예약 수 아래로 낮추기 전에 확인하고 주문과 자리는 보존함", async () => {
    const h = await harness();
    const baseRevision = await heldDay(h);
    const before = (await (await h.call("GET", "/owner/calendar")).json()) as { revision: string };
    const globalInput = { ...settings(before.revision), dailyCapacity: 0 };
    const problem = await expectProblem(await h.call("PUT", "/owner/calendar", globalInput), "confirmation_required");
    expect(problem).toMatchObject({
      confirm: [{ kind: "capacity_below_held", count: 1 }],
      conflicts: [{ capacity: 0, held: 1, orders: [{ orderId: h.shop.orderId }] }],
    });
    const result = await h.call("PUT", "/owner/calendar", { ...globalInput, confirm: ["capacity_below_held"] });
    expect(result.status, await result.clone().text()).toBe(200);
    expect(await result.json()).toMatchObject({
      calendar: { dailyCapacity: 0 },
      conflicts: [{ capacity: 0, held: 1 }],
    });
    await expectProblem(
      await h.call("PATCH", "/owner/calendar/days/2026-11-20", { baseRevision, manuallyClosed: true }),
      "version_conflict",
    );
    expect((await db.query("SELECT status FROM slot_holds WHERE shop_id = $1", [h.shop.shopId])).rows).toEqual([
      { status: "held" },
    ]);
  });

  it("날짜별 수량도 예약보다 낮추려면 확인이 필요함", async () => {
    const h = await harness();
    const baseRevision = await heldDay(h);
    const input = { baseRevision, capacityOverride: 0 };
    await expectProblem(await h.call("PATCH", "/owner/calendar/days/2026-11-20", input), "confirmation_required");
    const response = await h.call("PATCH", "/owner/calendar/days/2026-11-20", {
      ...input,
      confirm: ["capacity_below_held"],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ day: { capacity: 0, held: 1, remaining: 0, full: true } });
  });
});
