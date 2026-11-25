import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { createOrderConfirmedNotice, createPaymentRequestNotice } from "../src/customer-notice-store";
import { createCustomerNoticeHandler } from "../src/customer-notices";
import { runDueJobs } from "../src/job-runner";
import type { KakaoEvents } from "../src/kakao-event";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { expectSchema } from "./support/contract";
import { describeDb, newUuid, TEST_HASH_KEY, testEnv } from "./support/db";
import { newFieldKey } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-25T00:00:00Z");
describeDb("손님 안내 생성(TASK-104)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    shop = await createShop(isolated.db, "합성 확정 안내 가게");
    const paymentId = newUuid();
    await isolated.db.transaction(async (db) => {
      await db.query(
        "UPDATE payment_requests SET status='paid',paid_at=$2,arrived_amount=amount,arrived_at=$2 WHERE id=$1",
        [shop.paymentRequestId, NOW],
      );
      await db.query(
        "INSERT INTO payments(id,shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES($1,$2,$3,$4,35000,$5)",
        [paymentId, shop.shopId, shop.orderId, shop.paymentRequestId, NOW],
      );
      await db.query("UPDATE orders SET status='confirmed',confirmed_at=$2,confirmed_payment_id=$3 WHERE id=$1", [
        shop.orderId,
        NOW,
        paymentId,
      ]);
    });
  });
  afterAll(async () => {
    await isolated?.close();
  });
  const scoped = () =>
    shopRequestDb(createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId }), isolated.db);
  it("결제 안내는 같은 사건 한 번만 만들며 계좌를 저장하지 않고 실제 전달 전에는 시계를 시작하지 않는다", async () => {
    const target = await createShop(isolated.db, "합성 새 결제 안내 가게"),
      scope = shopRequestDb(createShopScope(target.shopId, { kind: "owner", ownerId: target.ownerId }), isolated.db),
      cap = new Date(NOW.getTime() + 24 * 3600000);
    await isolated.db.query(
      "UPDATE payment_requests SET delivered_at=NULL,issued_at=$2,due_at=$3,due_cap_at=$3 WHERE id=$1",
      [target.paymentRequestId, NOW, cap],
    );
    const first = await scope.transaction((db) => createPaymentRequestNotice(db, target.paymentRequestId, NOW));
    expect(first?.created).toBe(true);
    expect(await scope.transaction((db) => createPaymentRequestNotice(db, target.paymentRequestId, NOW))).toEqual({
      id: first?.id,
      created: false,
    });
    expect(
      (
        await isolated.db.query(
          "SELECT kind,event_key,template_key,body,status,next_attempt_at FROM notifications WHERE id=$1",
          [first?.id],
        )
      ).rows,
    ).toEqual([
      {
        kind: "payment_request",
        event_key: `notice:${target.paymentRequestId}:payment_request`,
        template_key: "payment_request:v1",
        body: "결제 안내를 확인해 주세요",
        status: "deferred",
        next_attempt_at: null,
      },
    ]);
    expect(
      (
        await isolated.db.query("SELECT delivered_at,due_at FROM payment_requests WHERE id=$1", [
          target.paymentRequestId,
        ])
      ).rows,
    ).toEqual([{ delivered_at: null, due_at: cap }]);
  });
  it("같은 확정 사건은 안내 하나이며 무료 MVP는 실제 발신 없이 다음 대화로 남긴다", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("합성 시험 실제 발신 금지"));
    try {
      const first = await scoped().transaction((db) => createOrderConfirmedNotice(db, shop.orderId, NOW));
      expect(first?.created).toBe(true);
      const again = await scoped().transaction((db) => createOrderConfirmedNotice(db, shop.orderId, NOW));
      expect(again).toEqual({ id: first?.id, created: false });
      const rows = (
        await isolated.db.query(
          "SELECT id,kind,event_key,body,status,next_attempt_at,sent_at FROM notifications WHERE shop_id=$1",
          [shop.shopId],
        )
      ).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: first?.id,
        kind: "order_confirmed",
        event_key: `notice:${shop.orderId}:order_confirmed`,
        status: "deferred",
        next_attempt_at: null,
        sent_at: null,
      });
      const body = String(rows[0]?.body);
      expect(body).toContain("주문이 확정됐어요");
      expect(body).toContain("결제가 확인된 금액");
      expect(body).toContain("상호");
      expect(body).toContain("대표자");
      expect(body).toContain("사업장 주소");
      expect(body).toContain("전화번호");
      for (const id of [shop.orderId, shop.customerId, shop.consultationId, shop.shopId])
        expect(body).not.toContain(id);
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  });
  it.each(["not_friend", "event_off"])(
    "먼저 보내지 못하는 손님(%s)의 다음 메시지는 확정 안내를 현재 답보다 먼저 한 번만 전한다",
    async (reason) => {
      await issueTestBookingLink(isolated.db, shop);
      await linkTestChannel(isolated.db, shop.channelId);
      await isolated.db.query("UPDATE customers SET channel_friend=$2 WHERE id=$1", [
        shop.customerId,
        reason === "event_off",
      ]);
      await isolated.db.query(
        "UPDATE kakao_channels SET event_status=$2,event_checked_at=$3,event_fail_reason=CASE WHEN $2='unavailable' THEN 'kakao_error' ELSE NULL END WHERE id=$1",
        [shop.channelId, reason === "event_off" ? "unavailable" : "ready", NOW],
      );
      const created = await scoped().transaction((db) =>
        createOrderConfirmedNotice(db, shop.orderId, NOW, { sendEnabled: true }),
      );
      const stored = (
        await isolated.db.query<{ body: string }>("SELECT body FROM notifications WHERE id=$1", [created?.id])
      ).rows[0];
      const key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
      const app = createApp({ connect: () => isolated.connect(), services: { now: () => NOW }, logSink: () => {} });
      const env = testEnv({ FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: newFieldKey() });
      const call = (utterance: string) =>
        app.request(
          "/api/kakao/skills/message",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
            body: JSON.stringify({
              bot: { id: shop.botId },
              userRequest: { utterance, block: { id: "conversation" }, user: { id: shop.userKey, type: "botUserKey" } },
              action: { id: "synthetic-notice-followup", params: {} },
            }),
          },
          env,
        );
      const first = (await (await call("확정 안내 뒤의 합성 첫 질문")).json()) as { template: { outputs: unknown[] } };
      expectSchema("SkillTemplateResponse", first);
      expect(first.template.outputs[0]).toEqual({ simpleText: { text: stored?.body } });
      expect(first.template.outputs.length).toBeGreaterThan(1);
      expect(
        (await isolated.db.query("SELECT status,sent_at FROM notifications WHERE id=$1", [created?.id])).rows,
      ).toEqual([{ status: "delivered_on_reply", sent_at: NOW }]);
      const second = await (await call("확정 안내 뒤의 합성 둘째 질문")).json();
      expect(JSON.stringify(second)).not.toContain("주문이 확정됐어요");
    },
  );
  it("실제 확정 안내 생성부터 합성 Event 접수와 관측 뒤 보냄까지 연결한다", async () => {
    await linkTestChannel(isolated.db, shop.channelId);
    await isolated.db.query("UPDATE customers SET channel_friend=true WHERE id=$1", [shop.customerId]);
    await isolated.db.query("UPDATE kakao_channels SET event_status='ready',event_checked_at=$2 WHERE id=$1", [
      shop.channelId,
      NOW,
    ]);
    const created = await scoped().transaction((db) =>
      createOrderConfirmedNotice(db, shop.orderId, NOW, { sendEnabled: true }),
    );
    let now = NOW;
    const taskId = newUuid();
    const events = {
      requestNotice: vi.fn<KakaoEvents["requestNotice"]>(async () => ({ kind: "accepted" as const, taskId })),
      checkDelivery: vi.fn<KakaoEvents["checkDelivery"]>(async () => ({ kind: "delivered" as const })),
    };
    const run = () =>
      runDueJobs({
        db: isolated.db,
        now,
        jobs: [
          {
            name: "customer_notice",
            every: "minute",
            sources: ["notification_send", "notification_check"],
            handler: createCustomerNoticeHandler({ enabled: true, now: () => now, events: () => events }),
          },
        ],
        log: () => {},
        clock: () => 0,
      });
    await run();
    expect(
      (await isolated.db.query("SELECT status,sent_at,kakao_task_id FROM notifications WHERE id=$1", [created?.id]))
        .rows,
    ).toEqual([{ status: "confirming", sent_at: null, kakao_task_id: taskId }]);
    expect(events.requestNotice).toHaveBeenCalledTimes(1);
    expect(events.requestNotice.mock.calls[0]?.[0]).toMatchObject({
      noticeKey: created?.id,
      userKey: shop.userKey,
      botId: shop.botId,
    });
    now = new Date(NOW.getTime() + 60000);
    await run();
    expect(
      (await isolated.db.query("SELECT status,sent_at FROM notifications WHERE id=$1", [created?.id])).rows,
    ).toEqual([{ status: "sent", sent_at: now }]);
    expect(events.checkDelivery).toHaveBeenCalledWith(taskId, { type: "botUserKey", id: shop.userKey });
  });
});
