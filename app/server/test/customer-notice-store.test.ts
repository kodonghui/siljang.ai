import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { createOrderConfirmedNotice } from "../src/customer-notice-store";
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
  it("친구가 아닌 손님의 다음 메시지는 확정 안내를 현재 답보다 먼저 한 번만 전한다", async () => {
    await issueTestBookingLink(isolated.db, shop);
    await linkTestChannel(isolated.db, shop.channelId);
    const created = await scoped().transaction((db) => createOrderConfirmedNotice(db, shop.orderId, NOW));
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
    const first = await (await call("확정 안내 뒤의 합성 첫 질문")).json();
    expectSchema("SkillTemplateResponse", first);
    expect(first.template.outputs[0]).toEqual({ simpleText: { text: stored?.body } });
    expect(first.template.outputs.length).toBeGreaterThan(1);
    expect(
      (await isolated.db.query("SELECT status,sent_at FROM notifications WHERE id=$1", [created?.id])).rows,
    ).toEqual([{ status: "delivered_on_reply", sent_at: NOW }]);
    const second = await (await call("확정 안내 뒤의 합성 둘째 질문")).json();
    expect(JSON.stringify(second)).not.toContain("주문이 확정됐어요");
  });
});
