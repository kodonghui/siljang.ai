import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { type CustomerNoticeOptions, createCustomerNoticeHandler } from "../src/customer-notices";
import type { RequestDb } from "../src/db";
import { runDueJobs } from "../src/job-runner";
import type { KakaoEvents } from "../src/kakao-event";
import { ownerAlertContent } from "../src/owner-alert-content";
import { runScheduled } from "../src/scheduled";
import { createShopScope, shopDb } from "../src/shop-scope";
import { describeDb, newUuid, testEnv } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-25T00:00:00Z"),
  TASK = newUuid();
describeDb("손님 안내 일 실행기(TASK-104)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture, id: string, now: Date;
  let events: KakaoEvents;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    now = NOW;
    shop = await createShop(isolated.db, "합성 안내 실행 가게");
    await linkTestChannel(isolated.db, shop.channelId);
    await isolated.db.query("UPDATE customers SET channel_friend=true,friend_checked_at=$2 WHERE id=$1", [
      shop.customerId,
      NOW,
    ]);
    await isolated.db.query("UPDATE kakao_channels SET event_status='ready',event_checked_at=$2 WHERE id=$1", [
      shop.channelId,
      NOW,
    ]);
    id = newUuid();
    await isolated.db.query(
      "INSERT INTO notifications(id,shop_id,customer_id,consultation_id,kind,event_key,template_key,body,status,next_attempt_at,created_at) VALUES($1,$2,$3,$4,'owner_reply',$5,'owner_reply:v1','합성 사장님 안내','pending',$6,$6)",
      [id, shop.shopId, shop.customerId, shop.consultationId, `notice:${id}:owner_reply`, NOW],
    );
    events = {
      requestNotice: vi.fn(async () => ({ kind: "accepted" as const, taskId: TASK })),
      checkDelivery: vi.fn(async () => ({ kind: "delivered" as const })),
    };
  });
  afterAll(async () => {
    await isolated?.close();
  });
  const state = async () =>
    (
      await isolated.db.query(
        "SELECT status,attempts,kakao_task_id,requested_at,sent_at FROM notifications WHERE id=$1",
        [id],
      )
    ).rows[0];
  const run = (
    factory: () => KakaoEvents,
    enabled = false,
    attention?: CustomerNoticeOptions["attention"],
    db: RequestDb = isolated.db,
  ) =>
    runDueJobs({
      db,
      now,
      jobs: [
        {
          name: "customer_notice",
          every: "minute",
          sources: ["notification_send", "notification_check"],
          handler: createCustomerNoticeHandler({
            enabled,
            events: factory,
            now: () => now,
            ...(attention === undefined ? {} : { attention }),
          }),
        },
      ],
      log: () => {},
      clock: () => 0,
    });
  it("무료 MVP는 친구·설정이 준비돼도 실제 발신과 결과 조회를 만들지 않고 다음 대화로 둔다", async () => {
    const factory = vi.fn(() => events);
    await run(factory);
    expect(await state()).toEqual({
      status: "deferred",
      attempts: 0,
      kakao_task_id: null,
      requested_at: null,
      sent_at: null,
    });
    expect(factory).not.toHaveBeenCalled();
    expect(events.requestNotice).not.toHaveBeenCalled();
    expect(events.checkDelivery).not.toHaveBeenCalled();
  });
  it("실제 Cron 어댑터의 기본 등록부도 무료 MVP 안내를 처리하며 외부 API를 호출하지 않는다", async () => {
    const result = await runScheduled({ scheduledTime: NOW.getTime(), cron: "* * * * *" }, testEnv(), {
      connect: () => isolated.connect(),
      kakaoEvents: events,
      now: () => now,
      logSink: () => {},
    });
    expect(result).not.toBeNull();
    expect((await state())?.status).toBe("deferred");
    expect(events.requestNotice).not.toHaveBeenCalled();
    expect(events.checkDelivery).not.toHaveBeenCalled();
  });
  it("실제 발신을 켠 합성 경로는 접수만 확인 중이며 전달 성공을 관측한 뒤 보냄이다", async () => {
    await run(() => events, true);
    expect(await state()).toEqual({
      status: "confirming",
      attempts: 1,
      kakao_task_id: TASK,
      requested_at: NOW,
      sent_at: null,
    });
    now = new Date(NOW.getTime() + 60000);
    await run(() => events, true);
    expect(await state()).toEqual({
      status: "sent",
      attempts: 1,
      kakao_task_id: TASK,
      requested_at: NOW,
      sent_at: now,
    });
    expect(events.requestNotice).toHaveBeenCalledTimes(1);
    expect(events.checkDelivery).toHaveBeenCalledWith(TASK, { type: "botUserKey", id: shop.userKey });
  });
  it("요청 실패를1·5·30분 간격으로 네 번만 시도한 뒤 다음 대화로 보존한다", async () => {
    vi.mocked(events.requestNotice).mockResolvedValue({
      kind: "failed",
      code: "kakao_error",
      retryable: true,
      disableChannel: false,
      attention: null,
    });
    await run(() => events, true);
    for (const [index, minutes] of [1, 5, 30].entries()) {
      const row = (
        await isolated.db.query<{ status: string; attempts: number; next_attempt_at: Date }>(
          "SELECT status,attempts,next_attempt_at FROM notifications WHERE id=$1",
          [id],
        )
      ).rows[0];
      expect(row).toEqual({
        status: "retrying",
        attempts: index + 1,
        next_attempt_at: new Date(now.getTime() + minutes * 60000),
      });
      now = row?.next_attempt_at ?? NOW;
      await run(() => events, true);
    }
    expect((await state())?.status).toBe("deferred");
    expect((await state())?.attempts).toBe(4);
    now = new Date(now.getTime() + 3600000);
    await run(() => events, true);
    expect(events.requestNotice).toHaveBeenCalledTimes(4);
    expect(events.checkDelivery).not.toHaveBeenCalled();
  });
  it("접수 뒤1·5·30분에만 확인하고30분 동안 모르면 unknown으로 다음 대화에 남긴다", async () => {
    vi.mocked(events.checkDelivery).mockResolvedValue({ kind: "pending" });
    const attention = vi.fn();
    await run(() => events, true, attention);
    for (const [minute, calls] of [
      [1, 1],
      [2, 1],
      [5, 2],
      [29, 2],
      [30, 3],
    ] as const) {
      now = new Date(NOW.getTime() + minute * 60000);
      await run(() => events, true, attention);
      expect(events.checkDelivery).toHaveBeenCalledTimes(calls);
    }
    expect(
      (
        await isolated.db.query(
          "SELECT status,attempts,fail_code,sent_at,delivery_checked_at FROM notifications WHERE id=$1",
          [id],
        )
      ).rows,
    ).toEqual([{ status: "deferred", attempts: 1, fail_code: "unknown", sent_at: null, delivery_checked_at: now }]);
    expect(attention).toHaveBeenCalledWith({ target: "operator", code: "unknown", shopId: shop.shopId, noticeId: id });
  });
  it.each([false, true])("친구 아님 결과는 더 최근의 친구 확인을 덮어쓰지 않는다(새 확인:%s)", async (newer) => {
    vi.mocked(events.checkDelivery).mockResolvedValue({
      kind: "failed",
      code: "not_friend",
      retryable: false,
      disableChannel: false,
      attention: null,
    });
    await run(() => events, true);
    if (newer)
      await isolated.db.query("UPDATE customers SET channel_friend=true,friend_checked_at=$2 WHERE id=$1", [
        shop.customerId,
        new Date(NOW.getTime() + 30000),
      ]);
    now = new Date(NOW.getTime() + 60000);
    await run(() => events, true);
    expect((await state())?.status).toBe("deferred");
    expect(
      (await isolated.db.query("SELECT channel_friend FROM customers WHERE id=$1", [shop.customerId])).rows,
    ).toEqual([{ channel_friend: newer }]);
  });
  it.each([
    ["event_setup", true, "owner", "kakao_error"],
    ["wallet", true, "owner", "wallet_missing"],
    ["wallet", false, "operator", null],
  ] as const)(
    "설정/월렛 오류(%s·차단%s)는 채널과 알림 대상을 구분한다",
    async (code, disableChannel, target, reason) => {
      vi.mocked(events.requestNotice).mockResolvedValue({
        kind: "failed",
        code,
        retryable: false,
        disableChannel,
        attention: target,
      });
      const attention = vi.fn();
      await run(() => events, true, attention);
      expect((await state())?.status).toBe("deferred");
      expect(
        (
          await isolated.db.query("SELECT event_status,event_fail_reason FROM kakao_channels WHERE id=$1", [
            shop.channelId,
          ])
        ).rows,
      ).toEqual([{ event_status: disableChannel ? "unavailable" : "ready", event_fail_reason: reason }]);
      expect(attention).toHaveBeenCalledWith({ target, code, shopId: shop.shopId, noticeId: id });
      const alerts = (
        await isolated.db.query<{ id: string; kind: string; event_key: string }>(
          "SELECT id,kind,event_key FROM owner_alerts WHERE shop_id=$1",
          [shop.shopId],
        )
      ).rows;
      expect(alerts).toHaveLength(disableChannel ? 1 : 0);
      if (disableChannel) {
        const alert = alerts[0];
        if (!alert) throw new Error("missing synthetic owner alert");
        expect(alert).toMatchObject({
          kind: "channel_event_unavailable",
          event_key: `alert:channel_event_unavailable:${id}`,
        });
        const scope = createShopScope(shop.shopId, { kind: "job", job: "customer_notice" });
        const content = await ownerAlertContent(
          shopDb(scope, isolated.db),
          { ...alert, task_kind: null },
          new URL("https://siljang.example"),
        );
        expect(content?.text).toContain("먼저 보낼 수 없어요");
        expect(content?.url).toBe("https://siljang.example/owner/kakao-channel");
      }
    },
  );
  it.each(["friend", "channel"])(
    "친구/먼저 보내기가 안 되는 상태(%s)는 클라이언트도 만들지 않는다",
    async (blocked) => {
      if (blocked === "friend")
        await isolated.db.query("UPDATE customers SET channel_friend=false WHERE id=$1", [shop.customerId]);
      else
        await isolated.db.query(
          "UPDATE kakao_channels SET event_status='unavailable',event_fail_reason='kakao_error' WHERE id=$1",
          [shop.channelId],
        );
      const factory = vi.fn(() => events);
      await run(factory, true);
      expect((await state())?.status).toBe("deferred");
      expect(factory).not.toHaveBeenCalled();
    },
  );
  it("예약 시각이 있는 안내는20:50 뒤 발신하지 않고 다음 날08:00에 다시 잡는다", async () => {
    await isolated.db.query("UPDATE notifications SET scheduled_for=$2 WHERE id=$1", [id, NOW]);
    now = new Date(NOW.getTime() + 12 * 3600000);
    await run(() => events, true);
    const next = new Date("2026-11-25T23:00:00Z");
    expect(
      (await isolated.db.query("SELECT status,attempts,next_attempt_at FROM notifications WHERE id=$1", [id])).rows,
    ).toEqual([{ status: "pending", attempts: 0, next_attempt_at: next }]);
    expect(events.requestNotice).not.toHaveBeenCalled();
    now = next;
    await run(() => events, true);
    expect((await state())?.status).toBe("confirming");
    expect(events.requestNotice).toHaveBeenCalledTimes(1);
  });
  it("예약 안내는08:00 전에는 요청하지 않고 같은 날08:00으로 잡는다", async () => {
    now = new Date("2026-11-25T22:59:00Z");
    await isolated.db.query("UPDATE notifications SET scheduled_for=$2,next_attempt_at=$2 WHERE id=$1", [id, now]);
    await run(() => events, true);
    expect(events.requestNotice).not.toHaveBeenCalled();
    expect(
      (await isolated.db.query("SELECT status,attempts,next_attempt_at FROM notifications WHERE id=$1", [id])).rows,
    ).toEqual([{ status: "pending", attempts: 0, next_attempt_at: new Date("2026-11-25T23:00:00Z") }]);
    now = new Date("2026-11-25T23:00:00Z");
    await run(() => events, true);
    expect(events.requestNotice).toHaveBeenCalledTimes(1);
  });
  it.each(["day_changed", "day_expired", "day_ok", "day_future", "closed_issue", "remake", "review_ok"] as const)(
    "예약 안내는 현재 주문의 의미(%s)를 다시 확인한다",
    async (kind) => {
      const paid = newUuid();
      const dayNotice = kind.startsWith("day_");
      await isolated.db.transaction(async (tx) => {
        await tx.query(
          "UPDATE payment_requests SET status='paid',paid_at=$2,arrived_amount=amount,arrived_at=$2 WHERE id=$1",
          [shop.paymentRequestId, NOW],
        );
        await tx.query(
          "INSERT INTO payments(id,shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES($1,$2,$3,$4,35000,$5)",
          [paid, shop.shopId, shop.orderId, shop.paymentRequestId, NOW],
        );
        await tx.query("UPDATE orders SET status=$2,confirmed_at=$3,confirmed_payment_id=$4 WHERE id=$1", [
          shop.orderId,
          dayNotice ? "confirmed" : "received",
          NOW,
          paid,
        ]);
        if (!dayNotice)
          await tx.query(
            "INSERT INTO productions(shop_id,order_id,handed_over_at,handover_kind) VALUES($1,$2,$3,'pickup')",
            [shop.shopId, shop.orderId, NOW],
          );
        await tx.query("UPDATE notifications SET kind=$2,order_id=$3,scheduled_for=$4 WHERE id=$1", [
          id,
          dayNotice ? "day_before" : "review_request",
          shop.orderId,
          NOW,
        ]);
      });
      if (kind === "day_expired" || kind === "day_ok" || kind === "day_future") {
        const row = (
          await isolated.db.query<{ day: string }>("SELECT pickup_day::text AS day FROM orders WHERE id=$1", [
            shop.orderId,
          ])
        ).rows[0];
        if (!row) throw new Error("합성 픽업 날짜 없음");
        const midnight = new Date(`${row.day}T00:00:00+09:00`);
        const scheduled = new Date(midnight.getTime() - 6 * 3600000);
        now =
          kind === "day_ok"
            ? scheduled
            : kind === "day_future"
              ? new Date(scheduled.getTime() - 86400000)
              : new Date(midnight.getTime() + 8 * 3600000);
        await isolated.db.query("UPDATE notifications SET scheduled_for=$2,next_attempt_at=$2 WHERE id=$1", [
          id,
          scheduled,
        ]);
        if (kind === "day_future")
          await isolated.db.query("UPDATE notifications SET next_attempt_at=$2 WHERE id=$1", [id, now]);
      }
      if (kind === "closed_issue") {
        const detail = newUuid();
        await isolated.db.query(
          "INSERT INTO issue_details(id,shop_id,consultation_id,order_id,description,status) VALUES($1,$2,$3,$4,'합성 문제 신고','reported')",
          [detail, shop.shopId, shop.consultationId, shop.orderId],
        );
        await isolated.db.query(
          "INSERT INTO issue_reports(shop_id,order_id,issue_details_id,late,reported_by,status,compensation,decided_at,closed_at,problem_kind) VALUES($1,$2,$3,false,'owner_from_handoff','closed','none',$4,$4,'other')",
          [shop.shopId, shop.orderId, detail, NOW],
        );
      }
      if (kind === "remake") {
        const remake = newUuid();
        await isolated.db.transaction(async (tx) => {
          await tx.query(
            `INSERT INTO orders(id,shop_id,order_no,customer_id,consultation_id,kind,status,version,price_list_id,operating_rules_id,pickup_at,pickup_day,amount,remake_of_order_id,confirmed_at)
          SELECT $2,shop_id,$3,customer_id,consultation_id,'standard','received',1,price_list_id,operating_rules_id,pickup_at,pickup_day,0,id,$4 FROM orders WHERE id=$1`,
            [shop.orderId, remake, remake.replaceAll("-", "").slice(0, 8).toUpperCase(), NOW],
          );
          await tx.query(
            `INSERT INTO order_details(shop_id,order_id,version,source,price_list_id,pickup_at,allergy_consent,allergy_consent_version,allergy_consent_at,amount)
          SELECT shop_id,$2,1,'remake',price_list_id,pickup_at,allergy_consent,allergy_consent_version,allergy_consent_at,0 FROM order_details WHERE order_id=$1 AND version=1`,
            [shop.orderId, remake],
          );
          await tx.query("UPDATE notifications SET order_id=$2 WHERE id=$1", [id, remake]);
          await tx.query(
            "INSERT INTO productions(shop_id,order_id,handed_over_at,handover_kind) VALUES($1,$2,$3,'pickup')",
            [shop.shopId, remake, NOW],
          );
        });
      }
      await run(() => events, true);
      expect((await state())?.status).toBe(
        kind === "review_ok" || kind === "day_ok" ? "confirming" : kind === "day_future" ? "pending" : "dropped",
      );
      expect(events.requestNotice).toHaveBeenCalledTimes(kind === "review_ok" || kind === "day_ok" ? 1 : 0);
    },
  );
  it("다른 실행기가 임대를 바꾼 뒤 옛 결과는 새 상태를 덮어쓰지 않는다", async () => {
    const handler = createCustomerNoticeHandler({ enabled: true, events: () => events, now: () => now }),
      scope = createShopScope(shop.shopId, { kind: "job", job: "customer_notice" });
    const item = { source: "notification_send" as const, shopId: shop.shopId, id, dueAt: NOW },
      ctx = { job: "customer_notice", now: NOW, leaseUntil: new Date(NOW.getTime() + 120000) };
    const prepared = await isolated.db.transaction((tx) => handler.lease(shopDb(scope, tx), item, ctx));
    if (prepared === null) throw new Error("missing synthetic lease");
    const outcome = await handler.act(prepared, ctx),
      changed = new Date(prepared.leaseUntil.getTime() + 1);
    await isolated.db.query("UPDATE notifications SET next_attempt_at=$2 WHERE id=$1", [id, changed]);
    await isolated.db.transaction((tx) =>
      handler.record(shopDb(scope, tx), item, prepared, { ok: true, value: outcome }, ctx),
    );
    expect((await state())?.status).toBe("pending");
    expect((await state())?.kakao_task_id).toBeNull();
    expect((await isolated.db.query("SELECT next_attempt_at FROM notifications WHERE id=$1", [id])).rows).toEqual([
      { next_attempt_at: changed },
    ]);
    await isolated.db.query("UPDATE notifications SET status='deferred',next_attempt_at=NULL WHERE id=$1", [id]);
  });
  it("두 실행기가 겹쳐도 임대한 안내를 동시에 두 번 발신하지 않는다", async () => {
    let started: () => void = () => {},
      release: () => void = () => {};
    const begun = new Promise<void>((resolve) => {
        started = resolve;
      }),
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    vi.mocked(events.requestNotice).mockImplementation(async () => {
      started();
      await gate;
      return { kind: "accepted", taskId: TASK };
    });
    const first = run(() => events, true);
    await begun;
    const other = isolated.connect();
    try {
      await run(() => events, true, undefined, other);
    } finally {
      release();
      await other.close();
    }
    await first;
    expect(events.requestNotice).toHaveBeenCalledTimes(1);
    expect((await state())?.status).toBe("confirming");
  });
  it("채널을 다시 확인한 뒤에는 옛 실패가 설정이나 사장님 알림을 덮어쓰지 않는다", async () => {
    const checked = new Date(NOW.getTime() + 30000);
    vi.mocked(events.requestNotice).mockImplementation(async () => {
      await isolated.db.query(
        "UPDATE kakao_channels SET event_status='ready',event_fail_reason=NULL,event_checked_at=$2 WHERE id=$1",
        [shop.channelId, checked],
      );
      now = new Date(NOW.getTime() + 60000);
      return { kind: "failed", code: "wallet", retryable: false, disableChannel: true, attention: "owner" };
    });
    const attention = vi.fn();
    await run(() => events, true, attention);
    expect(
      (
        await isolated.db.query("SELECT event_status,event_checked_at FROM kakao_channels WHERE id=$1", [
          shop.channelId,
        ])
      ).rows,
    ).toEqual([{ event_status: "ready", event_checked_at: checked }]);
    expect(attention).not.toHaveBeenCalled();
  });
  it("같은 채널의 두 실패가 겹쳐도 같은 장애의 사장님 알림은 한 건만 남긴다", async () => {
    const secondId = newUuid();
    await isolated.db.query(
      "INSERT INTO notifications(id,shop_id,customer_id,consultation_id,kind,event_key,template_key,body,status,next_attempt_at,created_at) VALUES($1,$2,$3,$4,'owner_reply',$5,'owner_reply:v1','합성 둘째 안내','pending',$6,$6)",
      [secondId, shop.shopId, shop.customerId, shop.consultationId, `notice:${secondId}:owner_reply`, NOW],
    );
    let firstStarted: () => void = () => {},
      bothStarted: () => void = () => {},
      release: () => void = () => {},
      count = 0;
    const firstReady = new Promise<void>((resolve) => {
        firstStarted = resolve;
      }),
      bothReady = new Promise<void>((resolve) => {
        bothStarted = resolve;
      }),
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    vi.mocked(events.requestNotice).mockImplementation(async () => {
      count++;
      if (count === 1) firstStarted();
      if (count === 2) bothStarted();
      await gate;
      return { kind: "failed", code: "event_setup", retryable: false, disableChannel: true, attention: "owner" };
    });
    const attention = vi.fn(),
      first = run(() => events, true, attention);
    await firstReady;
    const other = isolated.connect(),
      second = run(() => events, true, attention, other);
    try {
      await bothReady;
      release();
      await Promise.all([first, second]);
    } finally {
      release();
      await other.close();
    }
    expect((await isolated.db.query("SELECT kind FROM owner_alerts WHERE shop_id=$1", [shop.shopId])).rows).toEqual([
      { kind: "channel_event_unavailable" },
    ]);
    expect(attention).toHaveBeenCalledTimes(1);
  });
  it("결제 안내는 접수 때가 아니라 전달 성공을 관측한 때부터12시간을 센다", async () => {
    await isolated.db.query("UPDATE notifications SET status='dropped',next_attempt_at=NULL WHERE id=$1", [id]);
    id = newUuid();
    await isolated.db.query(
      "UPDATE payment_requests SET delivered_at=NULL,issued_at=$2,due_at=$3,due_cap_at=$3 WHERE id=$1",
      [shop.paymentRequestId, new Date(NOW.getTime() - 3600000), new Date(NOW.getTime() + 24 * 3600000)],
    );
    await isolated.db.query(
      "INSERT INTO notifications(id,shop_id,customer_id,consultation_id,order_id,kind,event_key,template_key,body,status,next_attempt_at,created_at) VALUES($1,$2,$3,$4,$5,'payment_request',$6,'payment_request:v1','합성 결제 안내','pending',$7,$7)",
      [
        id,
        shop.shopId,
        shop.customerId,
        shop.consultationId,
        shop.orderId,
        `notice:${shop.paymentRequestId}:payment_request`,
        NOW,
      ],
    );
    await run(() => events, true);
    expect(
      (await isolated.db.query("SELECT delivered_at FROM payment_requests WHERE id=$1", [shop.paymentRequestId])).rows,
    ).toEqual([{ delivered_at: null }]);
    now = new Date(NOW.getTime() + 60000);
    await run(() => events, true);
    expect(
      (await isolated.db.query("SELECT delivered_at,due_at FROM payment_requests WHERE id=$1", [shop.paymentRequestId]))
        .rows,
    ).toEqual([{ delivered_at: now, due_at: new Date(now.getTime() + 12 * 3600000) }]);
  });
});
