import { afterAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import { lockCalendarDay } from "../src/calendar";
import { ApiError } from "../src/problem";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { expectProblem, expectSchema } from "./support/contract";
import { describeDb, newRequestKey, newUuid, testDb, testEnv } from "./support/db";
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

async function harness(options: Parameters<typeof createApp>[0] = {}) {
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
    ...options,
  });
  async function call(method: string, path: string, input?: unknown, authenticated = true, key = newRequestKey()) {
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

  it.each([
    ["GET", "/owner/calendar/days?from=2026-11-20&to=2026-11-20", undefined],
    ["PATCH", "/owner/calendar/days/2026-11-20", { baseRevision: null, manuallyClosed: true }],
  ])("설정 전의 %s %s도 404 not_set", async (method, path, input) => {
    const h = await harness();
    await expectProblem(await h.call(method, path, input), "not_set");
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

  it.each(["PUT", "PATCH"] as const)("%s는 JSON이 아닌 본문 형식과 깨진 JSON을 422로 거절함", async (method) => {
    const h = await harness();
    const path = method === "PUT" ? "/owner/calendar" : "/owner/calendar/days/2026-11-20";
    for (const [contentType, body, field, code] of [
      ["text/plain", JSON.stringify(settings()), "header:Content-Type", "not_allowed"],
      ["application/json", "{", "/", "bad_json"],
    ] as const) {
      const response = await h.app.request(
        `${ORIGIN}/api${path}`,
        {
          method,
          headers: {
            origin: ORIGIN,
            [OWNER]: h.shop.ownerId,
            "content-type": contentType as string,
            "Idempotency-Key": newRequestKey(),
          },
          body,
        },
        testEnv(),
      );
      const problem = await expectProblem(response, "validation_failed");
      expect(problem.errors).toEqual([{ field, code }]);
    }
  });

  async function heldDay(h: Awaited<ReturnType<typeof harness>>, status: "held" | "fixed" = "held") {
    await h.call("PUT", "/owner/calendar", settings());
    await db.transaction(async (tx) => {
      await tx.query("UPDATE order_details SET pickup_at = '2026-11-20T06:00:00Z' WHERE shop_id = $1", [h.shop.shopId]);
      await tx.query(
        "UPDATE orders SET pickup_day = '2026-11-20', pickup_at = '2026-11-20T06:00:00Z' WHERE shop_id = $1",
        [h.shop.shopId],
      );
      if (status === "fixed") {
        const payment = newUuid();
        await tx.query(
          "UPDATE payment_requests SET status='paid', arrived_amount=amount, arrived_at=$2, paid_at=$2 WHERE id=$1",
          [h.shop.paymentRequestId, NOW],
        );
        await tx.query(
          "INSERT INTO payments (id,shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES ($1,$2,$3,$4,35000,$5)",
          [payment, h.shop.shopId, h.shop.orderId, h.shop.paymentRequestId, NOW],
        );
        await tx.query("UPDATE orders SET status='confirmed', confirmed_at=$2, confirmed_payment_id=$3 WHERE id=$1", [
          h.shop.orderId,
          NOW,
          payment,
        ]);
      }
    });
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
        conflicts: [
          {
            day: "2026-11-20",
            held: 1,
            orders: [
              {
                orderId: h.shop.orderId,
                status: status === "held" ? "awaiting_payment" : "confirmed",
                pickupAt: "2026-11-20T15:00:00+09:00",
              },
            ],
          },
        ],
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

  it("전날/후기 시각 변경은 미발송 안내만 다시 계산하고 보낸 안내와 진행 중 시도는 보존함", async () => {
    const h = await harness();
    const first = await h.call("PUT", "/owner/calendar", settings());
    const value = (await first.json()) as { calendar: { revision: string } };
    await db.transaction(async (tx) => {
      await tx.query("UPDATE order_details SET pickup_at = '2026-11-22T06:00:00Z' WHERE shop_id = $1", [h.shop.shopId]);
      await tx.query(
        "UPDATE orders SET pickup_day = '2026-11-22', pickup_at = '2026-11-22T06:00:00Z' WHERE shop_id = $1",
        [h.shop.shopId],
      );
    });
    await db.transaction(async (tx) => {
      const payment = newUuid();
      await tx.query(
        "UPDATE payment_requests SET status='paid', arrived_amount=amount, arrived_at=$2, paid_at=$2 WHERE id=$1",
        [h.shop.paymentRequestId, NOW],
      );
      await tx.query(
        "INSERT INTO payments (id, shop_id, order_id, payment_request_id, amount, confirmed_at) VALUES ($1,$2,$3,$4,35000,$5)",
        [payment, h.shop.shopId, h.shop.orderId, h.shop.paymentRequestId, NOW],
      );
      await tx.query(
        "UPDATE orders SET status='received', confirmed_at=$2, confirmed_payment_id=$3, finished_at=$2 WHERE id=$1",
        [h.shop.orderId, NOW, payment],
      );
      await tx.query(
        "INSERT INTO productions (shop_id, order_id, handed_over_at, handover_kind) VALUES ($1, $2, '2026-11-18T23:30:00Z', 'pickup')",
        [h.shop.shopId, h.shop.orderId],
      );
    });
    const insert = async (kind: string, tag: string, status: string, attempts: number, scheduled: string) => {
      await db.query(
        `INSERT INTO notifications (shop_id, customer_id, consultation_id, order_id, kind, event_key, template_key, body, status, scheduled_for, next_attempt_at, attempts, sent_at, kakao_task_id, requested_at)
        VALUES ($1,$2,$3,$4,$5,$6,'합성 안내','합성 안내',$7,$8,$8,$9, CASE WHEN $7 = 'sent' THEN now() END, CASE WHEN $7 IN ('sent','confirming') THEN 'synthetic-task' END, CASE WHEN $7 IN ('sent','confirming') THEN now() END)`,
        [
          h.shop.shopId,
          h.shop.customerId,
          h.shop.consultationId,
          h.shop.orderId,
          kind,
          tag,
          status,
          scheduled,
          attempts,
        ],
      );
    };
    await insert("day_before", "pending-before", "pending", 0, "2026-11-21T09:00:00Z");
    await insert("review_request", "pending-review", "pending", 0, "2026-11-20T02:00:00Z");
    await insert("review_request", "retry-review", "retrying", 1, "2026-11-20T02:00:00Z");
    await insert("review_request", "sent-review", "sent", 1, "2026-11-20T02:00:00Z");
    await insert("review_request", "confirming-review", "confirming", 1, "2026-11-20T02:00:00Z");
    const response = await h.call("PUT", "/owner/calendar", {
      ...settings(value.calendar.revision),
      dayBeforeNoticeTime: "19:30",
      reviewRequestTime: "12:30",
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const rows = await db.query<{ event_key: string; scheduled_for: Date; next_attempt_at: Date; attempts: number }>(
      "SELECT event_key, scheduled_for, next_attempt_at, attempts FROM notifications WHERE shop_id = $1 ORDER BY event_key",
      [h.shop.shopId],
    );
    const result = Object.fromEntries(
      rows.rows.map((r) => [
        r.event_key,
        { scheduled: r.scheduled_for.toISOString(), next: r.next_attempt_at.toISOString(), attempts: r.attempts },
      ]),
    );
    expect(result["pending-before"]).toEqual({
      scheduled: "2026-11-21T10:30:00.000Z",
      next: "2026-11-21T10:30:00.000Z",
      attempts: 0,
    });
    expect(result["pending-review"]).toEqual({
      scheduled: "2026-11-20T03:30:00.000Z",
      next: "2026-11-20T03:30:00.000Z",
      attempts: 0,
    });
    expect(result["retry-review"]).toEqual({
      scheduled: "2026-11-20T03:30:00.000Z",
      next: "2026-11-20T02:00:00.000Z",
      attempts: 1,
    });
    for (const key of ["sent-review", "confirming-review"])
      expect(result[key]).toEqual({
        scheduled: "2026-11-20T02:00:00.000Z",
        next: "2026-11-20T02:00:00.000Z",
        attempts: 1,
      });
  });

  it.each([
    ["dailyCapacity", -1, "out_of_range"],
    ["dailyCapacity", 101, "out_of_range"],
    ["dailyCapacity", 1.5, "bad_format"],
    ["orderCutoffDays", 31, "out_of_range"],
    ["closedWeekdays", [0], "out_of_range"],
    ["closedWeekdays", [8], "out_of_range"],
    ["closedWeekdays", [1, 1], "duplicate"],
    ["closedWeekdays", null, "out_of_range"],
    ["replyEnd", "09:00", "not_after_start"],
    ["replyEnd", "08:59", "not_after_start"],
    ["orderCutoffTime", "24:00", "bad_format"],
    ["orderCutoffTime", "09:00\u0000", "bad_format"],
    ["dayBeforeNoticeTime", "07:59", "outside_window"],
    ["dayBeforeNoticeTime", "20:51", "outside_window"],
    ["reviewRequestTime", "07:59", "outside_window"],
    ["reviewRequestTime", "20:51", "outside_window"],
    ["confirm", ["overbooking"], "not_allowed"],
    ["confirm", ["closed_day_with_orders", "closed_day_with_orders"], "duplicate"],
    ["unknown", "합성 입력", "unknown_field"],
  ])("설정 %s=%j의 잘못된 값은 저장하지 않음", async (field, value, code) => {
    const h = await harness();
    const problem = await expectProblem(
      await h.call("PUT", "/owner/calendar", { ...settings(), [field]: value }),
      "validation_failed",
    );
    expect(problem.errors).toContainEqual({ field: `/${field}`, code });
    expect(
      (await db.query("SELECT count(*)::int AS n FROM business_calendars WHERE shop_id = $1", [h.shop.shopId])).rows,
    ).toEqual([{ n: 0 }]);
  });

  it.each([null, [], 5, { ...settings(), baseRevision: "x".repeat(65) }, { ...settings(), baseRevision: 1 }, {}])(
    "잘못된 본문 %j는 422",
    async (input) => {
      const h = await harness();
      await expectProblem(await h.call("PUT", "/owner/calendar", input), "validation_failed");
    },
  );

  it.each([
    ["", "query:from", "required"],
    ["?from=2026-02-30&to=2026-03-01", "query:from", "bad_format"],
    ["?from=2026-11-20&to=2026-11-19", "query:to", "out_of_range"],
    ["?from=2026-11-20&to=2027-01-21", "query:to", "out_of_range"],
  ])("조회 기간 %s는 필드 오류", async (query, field, code) => {
    const h = await harness();
    const problem = await expectProblem(await h.call("GET", `/owner/calendar/days${query}`), "validation_failed");
    expect(problem.errors).toEqual([{ field, code }]);
  });

  it.each([
    ["2026-11-18", { baseRevision: null, manuallyClosed: true }, "path:day", "in_past"],
    ["not-a-date", { baseRevision: null, manuallyClosed: true }, "path:day", "bad_format"],
    ["2026-11-20", { baseRevision: null }, "/", "required"],
    ["2026-11-20", { baseRevision: null, capacityOverride: 101 }, "/capacityOverride", "out_of_range"],
    ["2026-11-20", { baseRevision: null, manuallyClosed: "yes" }, "/manuallyClosed", "bad_format"],
    ["2026-11-20", { baseRevision: null, closed: null }, "/closed", "bad_format"],
  ])("날짜 변경 %s %j는 저장하지 않음", async (day, input, field, code) => {
    const h = await harness();
    await h.call("PUT", "/owner/calendar", settings());
    const problem = await expectProblem(
      await h.call("PATCH", `/owner/calendar/days/${day}`, input),
      "validation_failed",
    );
    expect(problem.errors).toContainEqual({ field, code });
    expect(
      (await db.query("SELECT count(*)::int AS n FROM calendar_days WHERE shop_id = $1", [h.shop.shopId])).rows,
    ).toEqual([{ n: 0 }]);
  });

  it("경계 시각·최대 범위 62일·처음 값 없는 날의 변경 없음", async () => {
    const h = await harness();
    const response = await h.call("PUT", "/owner/calendar", {
      ...settings(),
      dailyCapacity: 100,
      orderCutoffDays: 30,
      dayBeforeNoticeTime: "08:00",
      reviewRequestTime: "20:50",
    });
    expect(response.status).toBe(200);
    const list = await h.call("GET", "/owner/calendar/days?from=2026-11-20&to=2027-01-20");
    expect(list.status).toBe(200);
    expectSchema("CalendarDayList", await list.json());
    const unchanged = await h.call("PATCH", "/owner/calendar/days/2026-11-20", {
      baseRevision: null,
      manuallyClosed: false,
      capacityOverride: null,
    });
    expect(unchanged.status).toBe(200);
    expect(await unchanged.json()).toMatchObject({
      outcome: "unchanged",
      day: { capacity: 100, manuallyClosed: false },
    });
    expect(
      (await db.query("SELECT count(*)::int AS n FROM calendar_days WHERE shop_id = $1", [h.shop.shopId])).rows,
    ).toEqual([{ n: 0 }]);
  });

  it("설정은 같은 값이면 변경 없음, 같은 키는 현재 값을 읽고 처음 결과를 반복함", async () => {
    const h = await harness();
    const key = newRequestKey();
    const first = await h.call("PUT", "/owner/calendar", { ...settings(), closedWeekdays: [1, 5] }, true, key);
    const result = (await first.json()) as { calendar: { revision: string } };
    const same = await h.call("PUT", "/owner/calendar", {
      ...settings(result.calendar.revision),
      closedWeekdays: [5, 1],
    });
    expect(await same.json()).toMatchObject({ outcome: "unchanged", calendar: { revision: result.calendar.revision } });
    const changed = await h.call("PUT", "/owner/calendar", { ...settings(result.calendar.revision), dailyCapacity: 3 });
    expect(changed.status).toBe(200);
    const replay = await h.call("PUT", "/owner/calendar", { ...settings(), closedWeekdays: [1, 5] }, true, key);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await replay.json()).toMatchObject({ outcome: "created", calendar: { dailyCapacity: 3 } });
    await expectProblem(
      await h.call("PUT", "/owner/calendar", { ...settings(), dailyCapacity: 4 }, true, key),
      "idempotency_key_reused",
    );
  });

  it("동시에 처음 설정하면 하나만 저장됨", async () => {
    const h = await harness();
    const responses = await Promise.all([
      h.call("PUT", "/owner/calendar", settings()),
      h.call("PUT", "/owner/calendar", { ...settings(), dailyCapacity: 3 }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("동시에 날짜를 바꾸면 오래된 버전 하나는 거절함", async () => {
    const h = await harness();
    await h.call("PUT", "/owner/calendar", settings());
    const list = (await (await h.call("GET", "/owner/calendar/days?from=2026-11-20&to=2026-11-20")).json()) as {
      items: { revision: string }[];
    };
    const baseRevision = list.items[0]?.revision;
    const responses = await Promise.all([
      h.call("PATCH", "/owner/calendar/days/2026-11-20", { baseRevision, manuallyClosed: true }),
      h.call("PATCH", "/owner/calendar/days/2026-11-20", { baseRevision, capacityOverride: 3 }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("날짜 명령의 같은 키는 처음 결과 종류와 지금 날짜 값을 돌려줌", async () => {
    const h = await harness();
    await h.call("PUT", "/owner/calendar", settings());
    const key = newRequestKey(),
      input = { baseRevision: null, manuallyClosed: true };
    const response = await h.call("PATCH", "/owner/calendar/days/2026-11-20", input, true, key);
    const first = (await response.json()) as { day: { revision: string } };
    await h.call("PATCH", "/owner/calendar/days/2026-11-20", {
      baseRevision: first.day.revision,
      manuallyClosed: false,
    });
    const replay = await h.call("PATCH", "/owner/calendar/days/2026-11-20", input, true, key);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await replay.json()).toMatchObject({ outcome: "done", day: { manuallyClosed: false } });
  });

  it.each(["PUT", "PATCH"] as const)(
    "%s 변경은 먼저 자리를 잡은 트랜잭션을 기다리고 새 자리를 보존함",
    async (method) => {
      const h = await harness();
      const first = await h.call("PUT", "/owner/calendar", settings());
      const global = (await first.json()) as { calendar: { revision: string } };
      const list = (await (await h.call("GET", "/owner/calendar/days?from=2026-11-20&to=2026-11-20")).json()) as {
        items: { revision: string }[];
      };
      const connection = testDb();
      const scope = createShopScope(h.shop.shopId, { kind: "owner", ownerId: h.shop.ownerId });
      let release = () => {};
      let entered = (_pid: number) => {};
      let failed = (_error: unknown) => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<number>((resolve, reject) => {
        entered = resolve;
        failed = reject;
      });
      const holding = shopRequestDb(scope, connection)
        .transaction(async (tx) => {
          await lockCalendarDay(tx, "2026-11-20");
          const pid = await tx.found<{ pid: number }>("SELECT pg_backend_pid() AS pid FROM shops s WHERE s.id = $1");
          await tx.run(
            "INSERT INTO slot_holds (shop_id, day, order_id, payment_request_id, hold_key, status) VALUES ($1, '2026-11-20', $2, $3, $4, 'held')",
            [h.shop.orderId, h.shop.paymentRequestId, `hold:${h.shop.orderId}:race`],
          );
          entered(pid.pid);
          await gate;
        })
        .catch((error) => {
          failed(error);
          throw error;
        });
      let response: Promise<Response> | undefined;
      try {
        const pid = await ready;
        response =
          method === "PUT"
            ? h.call("PUT", "/owner/calendar", { ...settings(global.calendar.revision), dailyCapacity: 0 })
            : h.call("PATCH", "/owner/calendar/days/2026-11-20", {
                baseRevision: list.items[0]?.revision,
                manuallyClosed: true,
              });
        await expect
          .poll(
            async () =>
              (
                await db.query<{ blocked: boolean }>(
                  "SELECT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE $1::int = ANY(pg_blocking_pids(a.pid))) AS blocked",
                  [pid],
                )
              ).rows[0]?.blocked,
            { timeout: 3000, interval: 20 },
          )
          .toBe(true);
        release();
        await holding;
        await expectProblem(await response, "version_conflict");
        expect((await db.query("SELECT status FROM slot_holds WHERE shop_id = $1", [h.shop.shopId])).rows).toEqual([
          { status: "held" },
        ]);
      } finally {
        release();
        await Promise.allSettled([holding, ...(response ? [response] : [])]);
        await connection.close();
      }
    },
  );

  it.each([
    ["GET", "/owner/calendar", undefined],
    ["PUT", "/owner/calendar", settings()],
    ["GET", "/owner/calendar/days?from=2026-11-20&to=2026-11-20", undefined],
    ["PATCH", "/owner/calendar/days/2026-11-20", { baseRevision: null, manuallyClosed: true }],
  ])("가게가 없는 %s %s는 404, DB 실패는 내부 내용을 빼고 500", async (method, path, input) => {
    const missing = await harness({
      scopes: {
        owner: async () => {
          throw new ApiError("shop_not_registered");
        },
      },
    });
    await expectProblem(await missing.call(method, path, input), "shop_not_registered");
    const fail = () => Promise.reject(new Error("비공개 합성 DB 오류"));
    const broken = await harness({
      connect: () => ({ query: fail, transaction: fail, abort: async () => {}, close: async () => {} }),
    });
    const response = await broken.call(method, path, input);
    expect(await response.clone().text()).not.toContain("비공개 합성 DB 오류");
    await expectProblem(response, "internal");
  });
});
