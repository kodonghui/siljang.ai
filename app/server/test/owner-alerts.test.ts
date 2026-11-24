import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { pgConnector } from "../src/db";
import { type LeaseContext, runDueJobs } from "../src/job-runner";
import type { KakaoOwnerEvents } from "../src/kakao-event";
import { createCustomOrderTask } from "../src/order-output";
import { createOwnerAlertHandler } from "../src/owner-alerts";
import { runScheduled } from "../src/scheduled";
import { Secret } from "../src/settings";
import { createShopScope, shopDb, shopRequestDb } from "../src/shop-scope";
import { describeDb, newUuid, TEST_DATABASE_URL } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-24T00:00:00Z"),
  BOT = "b".repeat(24);
describeDb("사장님 알림 실행기(TASK-072)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture, now: Date, events: KakaoOwnerEvents;
  const request = vi.fn<KakaoOwnerEvents["requestAlert"]>(),
    check = vi.fn<KakaoOwnerEvents["checkDelivery"]>(),
    factory = vi.fn<() => KakaoOwnerEvents>();
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    now = NOW;
    shop = await createShop(isolated.db, "합성 사장님 알림 가게");
    await issueTestBookingLink(isolated.db, shop);
    await isolated.db.query("UPDATE owners SET alert_channel_friend=true,alert_friend_checked_at=$2 WHERE id=$1", [
      shop.ownerId,
      new Date(NOW.getTime() - 1000),
    ]);
    request.mockReset().mockResolvedValue({ kind: "accepted", taskId: newUuid() });
    check.mockReset().mockResolvedValue({ kind: "delivered" });
    events = { requestAlert: request, checkDelivery: check };
    factory.mockReset().mockImplementation(() => events);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("합성 시험에서 실제 발신 금지"));
  });
  afterEach(async () => {
    const external = fetch;
    vi.restoreAllMocks();
    await isolated.db.query(
      "UPDATE owner_alerts SET status='failed',batched_into_id=NULL,next_attempt_at=NULL,sent_at=NULL WHERE shop_id=$1",
      [shop.shopId],
    );
    expect(external).not.toHaveBeenCalled();
  });
  afterAll(async () => {
    await isolated?.close();
  });
  const run = (db = isolated.db) =>
    runDueJobs({
      db,
      now,
      jobs: [
        {
          name: "owner_alert",
          every: "minute",
          sources: ["owner_alert_send", "owner_alert_check"],
          handler: createOwnerAlertHandler({
            botId: BOT,
            origin: "https://app.example",
            events: factory,
            now: () => now,
          }),
        },
      ],
      log: () => {},
    });
  async function custom() {
    await isolated.db.query("UPDATE orders SET kind='custom',status='requested' WHERE id=$1", [shop.orderId]);
    return createCustomOrderTask(
      shopRequestDb(createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId }), isolated.db),
      shop.orderId,
      NOW,
    );
  }
  async function alert(kind: string, taskId: string | null = null, createdAt = NOW) {
    const id = newUuid();
    await isolated.db.query(
      "INSERT INTO owner_alerts(id,shop_id,owner_task_id,kind,event_key,next_attempt_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$6)",
      [
        id,
        shop.shopId,
        taskId,
        kind,
        `alert:${kind}:${["change_not_applied", "order_cancelled", "new_amount_declined", "health_concern"].includes(kind) ? shop.orderId : id}`,
        createdAt,
      ],
    );
    return id;
  }
  it("맞춤 주문 할 일은 하나이고 우리 봇의 appUserId로 접수한 뒤 전달 확인 때만 보냄이다", async () => {
    await custom();
    await run();
    expect(request).not.toHaveBeenCalled();
    now = new Date(NOW.getTime() + 60000);
    await run();
    expect(request).toHaveBeenCalledOnce();
    const owner = (
      await isolated.db.query("SELECT kakao_account_id::text AS id FROM owners WHERE id=$1", [shop.ownerId])
    ).rows[0];
    expect(request.mock.calls[0]?.[0]).toMatchObject({ botId: BOT, appUserId: owner?.id });
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      text: expect.stringContaining("맞춤 주문"),
      url: "https://app.example/owner",
    });
    expect(
      (await isolated.db.query("SELECT status,sent_at FROM owner_alerts WHERE shop_id=$1", [shop.shopId])).rows,
    ).toEqual([{ status: "confirming", sent_at: null }]);
    now = new Date(now.getTime() + 60000);
    await run();
    expect(check).toHaveBeenCalledOnce();
    expect((await isolated.db.query("SELECT status FROM owner_alerts WHERE shop_id=$1", [shop.shopId])).rows).toEqual([
      { status: "sent" },
    ]);
    expect((await isolated.db.query("SELECT closed_at FROM owner_tasks WHERE shop_id=$1", [shop.shopId])).rows).toEqual(
      [{ closed_at: null }],
    );
  });
  it("계좌 변경 안내는 할 일 없이 한 번 보내고 계좌·손님 값은 전송 인자에 없다", async () => {
    await alert("payment_account_changed");
    now = new Date(NOW.getTime() + 60000);
    await run();
    await run();
    expect(request).toHaveBeenCalledOnce();
    expect((await isolated.db.query("SELECT id FROM owner_tasks WHERE shop_id=$1", [shop.shopId])).rows).toHaveLength(
      0,
    );
    const payload = JSON.stringify(request.mock.calls);
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      text: expect.stringContaining("결제 받을 계좌가 바뀌었어요"),
      url: "https://app.example/owner/payment-destination",
    });
    for (const privateValue of ["010-0000-0000", "customerPhone", "allergy", "accountNumber"])
      expect(payload).not.toContain(privateValue);
  });
  it("상위 취소 업무가 남긴 환불 결정 할 일도 알림 한 건으로 전달한다", async () => {
    const taskId = newUuid();
    await isolated.db.query(
      "INSERT INTO owner_tasks(id,shop_id,order_id,kind,event_key,wait_status,wait_due_at,opened_at) VALUES($1,$2,$3,'refund_decision',$4,'waiting',$5,$6)",
      [
        taskId,
        shop.shopId,
        shop.orderId,
        `task:refund_decision:${shop.orderId}`,
        new Date(NOW.getTime() + 3600000),
        NOW,
      ],
    );
    await alert("new_task", taskId);
    now = new Date(NOW.getTime() + 60000);
    await run();
    expect(request).toHaveBeenCalledOnce();
    expect((await isolated.db.query("SELECT kind FROM owner_tasks WHERE shop_id=$1", [shop.shopId])).rows).toEqual([
      { kind: "refund_decision" },
    ]);
  });
  it("발송 결과101이면 친구 아님으로 고치고 할 일은 남긴다", async () => {
    await custom();
    now = new Date(NOW.getTime() + 60000);
    await run();
    check.mockResolvedValueOnce({
      kind: "failed",
      code: "not_friend",
      retryable: false,
      disableChannel: false,
      attention: null,
    });
    now = new Date(now.getTime() + 60000);
    await run();
    expect(
      (await isolated.db.query("SELECT status,fail_code FROM owner_alerts WHERE shop_id=$1", [shop.shopId])).rows,
    ).toEqual([{ status: "not_friend", fail_code: "not_friend" }]);
    expect(
      (await isolated.db.query("SELECT alert_channel_friend FROM owners WHERE id=$1", [shop.ownerId])).rows,
    ).toEqual([{ alert_channel_friend: false }]);
    expect((await isolated.db.query("SELECT closed_at FROM owner_tasks WHERE shop_id=$1", [shop.shopId])).rows).toEqual(
      [{ closed_at: null }],
    );
  });
  it("접수 뒤 재로그인으로 확인한 친구 상태는 늦은101 결과로 덮어쓰지 않는다", async () => {
    await alert("payment_account_changed");
    now = new Date(NOW.getTime() + 60000);
    await run();
    await isolated.db.query("UPDATE owners SET alert_channel_friend=true,alert_friend_checked_at=$2 WHERE id=$1", [
      shop.ownerId,
      new Date(now.getTime() + 1000),
    ]);
    check.mockResolvedValueOnce({
      kind: "failed",
      code: "not_friend",
      retryable: false,
      disableChannel: false,
      attention: null,
    });
    now = new Date(now.getTime() + 60000);
    await run();
    expect(
      (await isolated.db.query("SELECT alert_channel_friend FROM owners WHERE id=$1", [shop.ownerId])).rows,
    ).toEqual([{ alert_channel_friend: true }]);
  });
  it("친구 아님 기록 뒤에도 이미 접수한 알림의 배달 결과는 조회한다", async () => {
    const id = await alert("payment_account_changed");
    now = new Date(NOW.getTime() + 60000);
    await run();
    await isolated.db.query("UPDATE owners SET alert_channel_friend=false WHERE id=$1", [shop.ownerId]);
    now = new Date(now.getTime() + 60000);
    await run();
    expect(check).toHaveBeenCalledOnce();
    expect((await isolated.db.query("SELECT status FROM owner_alerts WHERE id=$1", [id])).rows).toEqual([
      { status: "sent" },
    ]);
  });
  it("재시도 전에 대표 할 일만 닫혀도 묶인 열린 할 일의 알림은 다시 보낸다", async () => {
    const headTask = newUuid(),
      peerTask = newUuid();
    for (const [id, offset] of [
      [headTask, 0],
      [peerTask, 30000],
    ] as const) {
      const at = new Date(NOW.getTime() + offset);
      await isolated.db.query(
        "INSERT INTO owner_tasks(id,shop_id,kind,event_key,opened_at) VALUES($1,$2,'ledger_relink',$3,$4)",
        [id, shop.shopId, `task:ledger_relink:${id}`, at],
      );
    }
    const head = await alert("new_task", headTask),
      peer = await alert("new_task", peerTask, new Date(NOW.getTime() + 30000));
    request.mockResolvedValueOnce({
      kind: "failed",
      code: "kakao_error",
      retryable: true,
      disableChannel: false,
      attention: null,
    });
    now = new Date(NOW.getTime() + 60000);
    await run();
    expect(request).toHaveBeenCalledOnce();
    expect(
      (await isolated.db.query("SELECT status,batched_into_id FROM owner_alerts WHERE id=$1", [peer])).rows,
    ).toEqual([{ status: "batched", batched_into_id: head }]);
    await isolated.db.query("UPDATE owner_tasks SET closed_at=$2 WHERE id=$1", [
      headTask,
      new Date(NOW.getTime() + 90000),
    ]);
    now = new Date(NOW.getTime() + 120000);
    await run();
    await run();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[0].alertKey).toBe(peer);
    expect(
      (await isolated.db.query("SELECT status,batched_into_id FROM owner_alerts WHERE id=$1", [peer])).rows,
    ).toEqual([{ status: "confirming", batched_into_id: null }]);
    expect((await isolated.db.query("SELECT closed_at FROM owner_tasks WHERE id=$1", [peerTask])).rows).toEqual([
      { closed_at: null },
    ]);
  });
  it("대표 알림의 대상이 없으면 함께 묶인 유효 알림은 다음 시각에 따로 보낸다", async () => {
    const head = await alert("change_not_applied");
    await isolated.db.query("UPDATE owner_alerts SET event_key=$2 WHERE id=$1", [
      head,
      `alert:change_not_applied:${newUuid()}`,
    ]);
    const peer = await alert("change_not_applied", null, new Date(NOW.getTime() + 30000));
    now = new Date(NOW.getTime() + 60000);
    await run();
    expect(
      (await isolated.db.query("SELECT status,batched_into_id FROM owner_alerts WHERE id=$1", [peer])).rows,
    ).toEqual([{ status: "pending", batched_into_id: null }]);
    now = new Date(NOW.getTime() + 90000);
    await run();
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0].alertKey).toBe(peer);
  });
  it("영업 신고 보류 할 일이 닫혔으면 오래된 보류 알림을 보내지 않는다", async () => {
    const task = newUuid();
    await isolated.db.query(
      "INSERT INTO owner_tasks(id,shop_id,kind,event_key,opened_at,closed_at) VALUES($1,$2,'license_on_hold',$3,$4,$5)",
      [task, shop.shopId, `task:license_on_hold:${task}`, NOW, new Date(NOW.getTime() + 1)],
    );
    const id = await alert("license_on_hold", task);
    now = new Date(NOW.getTime() + 60000);
    await run();
    expect(request).not.toHaveBeenCalled();
    expect((await isolated.db.query("SELECT status,fail_code FROM owner_alerts WHERE id=$1", [id])).rows).toEqual([
      { status: "failed", fail_code: "cannot_send" },
    ]);
  });
  it("1분 안 같은 종류의 새 할 일은 하나로 묶고 다른 창의 것은 다음 발신으로 남긴다", async () => {
    for (const offset of [0, 30000, 61000]) {
      const taskId = newUuid(),
        at = new Date(NOW.getTime() + offset);
      await isolated.db.query(
        "INSERT INTO owner_tasks(id,shop_id,kind,event_key,opened_at) VALUES($1,$2,'ledger_relink',$3,$4)",
        [taskId, shop.shopId, `task:ledger_relink:${taskId}`, at],
      );
      await alert("new_task", taskId, at);
    }
    now = new Date(NOW.getTime() + 60000);
    await run();
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0].text).toContain("장부 다시 연결 2건");
    expect(
      (
        await isolated.db.query(
          "SELECT status,count(*)::int AS n FROM owner_alerts WHERE shop_id=$1 GROUP BY status ORDER BY status",
          [shop.shopId],
        )
      ).rows,
    ).toEqual([
      { status: "batched", n: 1 },
      { status: "confirming", n: 1 },
      { status: "pending", n: 1 },
    ]);
  });
  it("MVP 기본 scheduled는 꺼둔 알림을 조회하거나 수정하지 않는다", async () => {
    const id = await alert("change_not_applied");
    const result = await runScheduled(
      { scheduledTime: NOW.getTime(), cron: "* * * * *" },
      { APP_ENV: "development" },
      { connect: () => isolated.connect(), logSink: () => {} },
    );
    expect(result?.jobs.owner_alert).toBeUndefined();
    expect((await isolated.db.query("SELECT status,fail_code FROM owner_alerts WHERE id=$1", [id])).rows).toEqual([
      { status: "pending", fail_code: null },
    ]);
  });
  it("켜진 scheduled 등록은 주입한 사장님 전송기로 우리 봇의 알림을 접수한다", async () => {
    const id = await alert("payment_account_changed");
    const result = await runScheduled(
      { scheduledTime: NOW.getTime() + 60000, cron: "* * * * *" },
      {
        APP_ENV: "development",
        KAKAO_REST_API_KEY: crypto.randomUUID(),
        KAKAO_CLIENT_SECRET: crypto.randomUUID(),
        KAKAO_OWNER_REDIRECT_URIS: "https://app.example/api/owner/auth/callback",
        PUBLIC_APP_ORIGIN: "https://app.example",
        KAKAO_OWNER_ALERTS_ENABLED: "true",
        KAKAO_OWNER_BOT_ID: BOT,
      },
      { connect: () => isolated.connect(), logSink: () => {}, kakaoOwnerEvents: events },
    );
    expect(result?.jobs.owner_alert?.failed).toBe(0);
    expect(request).toHaveBeenCalledOnce();
    expect((await isolated.db.query("SELECT status FROM owner_alerts WHERE id=$1", [id])).rows).toEqual([
      { status: "confirming" },
    ]);
  });
  it("다른 가게 주문을 가리키는 알림은 보내지 않고 그 가게 알림도 바꾸지 않는다", async () => {
    const other = await createShop(isolated.db, "합성 다른 가게"),
      id = await alert("change_not_applied");
    await isolated.db.query("UPDATE owner_alerts SET event_key=$2 WHERE id=$1", [
      id,
      `alert:change_not_applied:${other.orderId}`,
    ]);
    now = new Date(NOW.getTime() + 60000);
    await run();
    expect(factory).not.toHaveBeenCalled();
    expect((await isolated.db.query("SELECT status,fail_code FROM owner_alerts WHERE id=$1", [id])).rows).toEqual([
      { status: "failed", fail_code: "cannot_send" },
    ]);
  });
  it("모의 알림 내용은 내부 상세 자료를 읽거나 전하지 않는다", async () => {
    await custom();
    await isolated.db.query("UPDATE owner_tasks SET detail=$2::jsonb WHERE shop_id=$1", [
      shop.shopId,
      JSON.stringify({
        contact: "010-0000-0000",
        accountNumber: "합성 계좌",
        allergy: "합성 알레르기",
        closedDaySourceIds: [newUuid()],
      }),
    ]);
    now = new Date(NOW.getTime() + 60000);
    await run();
    const payload = JSON.stringify(request.mock.calls);
    for (const value of ["010-0000-0000", "합성 계좌", "합성 알레르기", "closedDaySourceIds"])
      expect(payload).not.toContain(value);
  });
  it("요청 오류는 1·5·30분 뒤 다시 보내고 네 번째 실패 뒤 멈춘다", async () => {
    const id = await alert("change_not_applied");
    request.mockResolvedValue({
      kind: "failed",
      code: "kakao_error",
      retryable: true,
      disableChannel: false,
      attention: null,
    });
    now = new Date(NOW.getTime() + 60000);
    for (const delay of [60000, 300000, 1800000]) {
      await run();
      const next = new Date(now.getTime() + delay);
      expect(
        (await isolated.db.query("SELECT status,next_attempt_at FROM owner_alerts WHERE id=$1", [id])).rows,
      ).toEqual([{ status: "pending", next_attempt_at: next }]);
      now = new Date(next.getTime() - 1);
      const before = request.mock.calls.length;
      await run();
      expect(request).toHaveBeenCalledTimes(before);
      now = next;
    }
    await run();
    await run();
    expect(request).toHaveBeenCalledTimes(4);
    expect(
      (await isolated.db.query("SELECT status,attempts,next_attempt_at FROM owner_alerts WHERE id=$1", [id])).rows,
    ).toEqual([{ status: "failed", attempts: 4, next_attempt_at: null }]);
  });
  it("접수 뒤 1·5·30분에만 조회하고 끝까지 모르면 재발신 없이 실패로 남긴다", async () => {
    const id = await alert("change_not_applied");
    now = new Date(NOW.getTime() + 60000);
    await run();
    const acceptedAt = now;
    check.mockResolvedValue({ kind: "pending" });
    for (const offset of [60000, 300000, 1800000]) {
      now = new Date(acceptedAt.getTime() + offset - 1);
      const before = check.mock.calls.length;
      await run();
      expect(check).toHaveBeenCalledTimes(before);
      now = new Date(now.getTime() + 1);
      await run();
      expect(check).toHaveBeenCalledTimes(before + 1);
    }
    await run();
    expect(request).toHaveBeenCalledOnce();
    expect(
      (await isolated.db.query("SELECT status,fail_code,sent_at FROM owner_alerts WHERE id=$1", [id])).rows,
    ).toEqual([{ status: "failed", fail_code: "unknown", sent_at: null }]);
  });
  it("이미 친구가 아니면 전송기를 만들지 않고 할 일을 목록에 남긴다", async () => {
    await custom();
    await isolated.db.query("UPDATE owners SET alert_channel_friend=false WHERE id=$1", [shop.ownerId]);
    await run();
    expect(factory).not.toHaveBeenCalled();
    expect((await isolated.db.query("SELECT status FROM owner_alerts WHERE shop_id=$1", [shop.shopId])).rows).toEqual([
      { status: "not_friend" },
    ]);
    expect((await isolated.db.query("SELECT closed_at FROM owner_tasks WHERE shop_id=$1", [shop.shopId])).rows).toEqual(
      [{ closed_at: null }],
    );
  });
  it("변경 반영 안 됨은 할 일 없이 알림만 남긴다", async () => {
    const id = await alert("change_not_applied");
    now = new Date(NOW.getTime() + 60000);
    await run();
    expect(request).toHaveBeenCalledOnce();
    expect((await isolated.db.query("SELECT owner_task_id,status FROM owner_alerts WHERE id=$1", [id])).rows).toEqual([
      { owner_task_id: null, status: "confirming" },
    ]);
    expect((await isolated.db.query("SELECT id FROM owner_tasks WHERE shop_id=$1", [shop.shopId])).rows).toHaveLength(
      0,
    );
  });
  it("서로 다른 연결의 동시 실행은 같은 종류 묶음을 한 번만 발신한다", async () => {
    await alert("payment_account_changed");
    await alert("payment_account_changed", null, new Date(NOW.getTime() + 30000));
    now = new Date(NOW.getTime() + 60000);
    const one = isolated.connect(),
      two = isolated.connect();
    try {
      const results = await Promise.all([run(one), run(two)]);
      expect(results.every((result) => result.jobs.owner_alert?.failed === 0)).toBe(true);
    } finally {
      await one.close();
      await two.close();
    }
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0].text).toContain("같은 종류의 알림 2건");
    expect(
      (await isolated.db.query("SELECT status FROM owner_alerts WHERE shop_id=$1 ORDER BY status", [shop.shopId])).rows,
    ).toEqual([{ status: "batched" }, { status: "confirming" }]);
  });
  it("같은 분의 새 할 일 알림도 맞춤 주문과 환불 결정은 따로 보낸다", async () => {
    await custom();
    const task = newUuid();
    await isolated.db.query(
      "INSERT INTO owner_tasks(id,shop_id,order_id,kind,event_key,wait_status,wait_due_at,opened_at) VALUES($1,$2,$3,'refund_decision',$4,'waiting',$5,$6)",
      [task, shop.shopId, shop.orderId, `task:refund_decision:${shop.orderId}`, new Date(NOW.getTime() + 3600000), NOW],
    );
    await alert("new_task", task);
    now = new Date(NOW.getTime() + 60000);
    await run();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map(([input]) => input.text).some((text) => text.includes("맞춤 주문"))).toBe(true);
    expect(request.mock.calls.map(([input]) => input.text).some((text) => text.includes("환불 결정"))).toBe(true);
  });
  it("결과를 못 쓴 채 임대가 끝나도 다음 실행은 시도 수를 이어서 처리한다", async () => {
    const id = await alert("payment_account_changed");
    now = new Date(NOW.getTime() + 60000);
    const handler = createOwnerAlertHandler({
      botId: BOT,
      origin: "https://app.example",
      events: factory,
      now: () => now,
    });
    const ctx: LeaseContext = { job: "owner_alert", now, leaseUntil: new Date(now.getTime() + 120000) };
    const item = { source: "owner_alert_send" as const, shopId: shop.shopId, id, dueAt: NOW };
    const scope = createShopScope(shop.shopId, { kind: "job", job: "owner_alert" });
    const prepared = await isolated.db.transaction((tx) => handler.lease(shopDb(scope, tx), item, ctx));
    expect(prepared).not.toBeNull();
    now = new Date(ctx.leaseUntil.getTime() - 1);
    await run();
    expect(factory).not.toHaveBeenCalled();
    now = ctx.leaseUntil;
    await run();
    expect(request).toHaveBeenCalledOnce();
    expect((await isolated.db.query("SELECT status,attempts FROM owner_alerts WHERE id=$1", [id])).rows).toEqual([
      { status: "confirming", attempts: 2 },
    ]);
    if (!prepared) throw new Error("합성 임대가 필요합니다");
    await isolated.db.transaction((tx) =>
      handler.record(
        shopDb(scope, tx),
        item,
        prepared,
        { ok: true, value: { plan: { status: "sent", sentAt: now }, at: now } },
        ctx,
      ),
    );
    expect((await isolated.db.query("SELECT status,sent_at FROM owner_alerts WHERE id=$1", [id])).rows).toEqual([
      { status: "confirming", sent_at: null },
    ]);
  });
  it("101 결과가 늦게 와도 요청 뒤 새로 확인한 친구 상태는 덮어쓰지 않는다", async () => {
    await alert("payment_account_changed");
    now = new Date(NOW.getTime() + 60000);
    request.mockImplementationOnce(async () => {
      await isolated.db.query("UPDATE owners SET alert_friend_checked_at=$2 WHERE id=$1", [
        shop.ownerId,
        new Date(now.getTime() + 1),
      ]);
      return { kind: "failed", code: "not_friend", retryable: false, disableChannel: false, attention: null };
    });
    await run();
    expect(
      (await isolated.db.query("SELECT alert_channel_friend FROM owners WHERE id=$1", [shop.ownerId])).rows,
    ).toEqual([{ alert_channel_friend: true }]);
  });
  it("제한 역할은 알림 상태만 고치며 할 일 닫기와 알림 삭제 권한은 없다", async () => {
    const id = await alert("change_not_applied"),
      role = `task072_alert_${newUuid().replaceAll("-", "")}`;
    const grants = readFileSync(new URL("../../../tools/staging-login-callback-grants.sql", import.meta.url), "utf8");
    await isolated.db.query(`CREATE ROLE "${role}" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    let runtime: ReturnType<typeof pgConnector> | undefined;
    try {
      await isolated.db.query(grants.replaceAll(':"runtime_role"', `"${role}"`));
      const name = (await isolated.db.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name;
      const url = new URL(TEST_DATABASE_URL);
      url.pathname = `/${name}`;
      url.username = role;
      url.password = "";
      runtime = pgConnector(new Secret(url.toString()));
      now = new Date(NOW.getTime() + 60000);
      expect((await run(runtime)).jobs.owner_alert?.failed).toBe(0);
      expect((await isolated.db.query("SELECT status FROM owner_alerts WHERE id=$1", [id])).rows).toEqual([
        { status: "confirming" },
      ]);
      now = new Date(now.getTime() + 60000);
      expect((await run(runtime)).jobs.owner_alert?.failed).toBe(0);
      expect((await isolated.db.query("SELECT status FROM owner_alerts WHERE id=$1", [id])).rows).toEqual([
        { status: "sent" },
      ]);
      expect(
        (
          await isolated.db.query(
            "SELECT has_column_privilege($1,'owner_tasks','closed_at','UPDATE') AS close,has_table_privilege($1,'owner_alerts','DELETE') AS delete",
            [role],
          )
        ).rows,
      ).toEqual([{ close: false, delete: false }]);
    } finally {
      await runtime?.close();
      await isolated.db.query(`DROP OWNED BY "${role}"`);
      await isolated.db.query(`DROP ROLE "${role}"`);
    }
  });
});
