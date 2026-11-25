import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createCustomerNoticeHandler } from "../src/customer-notices";
import { runDueJobs } from "../src/job-runner";
import type { KakaoEvents } from "../src/kakao-event";
import { runScheduled } from "../src/scheduled";
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
  const run = (factory: () => KakaoEvents, enabled = false) =>
    runDueJobs({
      db: isolated.db,
      now,
      jobs: [
        {
          name: "customer_notice",
          every: "minute",
          sources: ["notification_send", "notification_check"],
          handler: createCustomerNoticeHandler({ enabled, events: factory, now: () => now }),
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
});
