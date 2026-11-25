/** 실제 취소/환불 쓰기는 TASK122의 합성 명령으로 대체하고 카드 저장/전달만 검사한다. */
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { readConfirmCardDelivery, showConfirmCard } from "../src/confirm-card-store";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { expectSchema } from "./support/contract";
import { describeDb, newUuid, TEST_HASH_KEY, testEnv } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-28T06:00:00Z");
describeDb("취소 카드의 실제 저장 첫 결과와 재전달", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture, key: string;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    shop = await createShop(isolated.db, "합성 취소 첫 결과 가게");
    await issueTestBookingLink(isolated.db, shop);
    await linkTestChannel(isolated.db, shop.channelId);
    key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
  });
  afterAll(async () => {
    await isolated?.close();
  });
  const scoped = () => shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }), isolated.db);
  it.each([false, true])("API071 재클릭과 카드 재전달은 처음 결과만 보이고 명령은 한 번이다(결제 %s)", async (paid) => {
    if (paid) {
      const payment = newUuid();
      await isolated.db.query(
        "UPDATE payment_requests SET status='paid',paid_at=$2,arrived_at=$2,arrived_amount=amount WHERE id=$1",
        [shop.paymentRequestId, NOW],
      );
      await isolated.db.query(
        "INSERT INTO payments(id,shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES($1,$2,$3,$4,35000,$5)",
        [payment, shop.shopId, shop.orderId, shop.paymentRequestId, NOW],
      );
      await isolated.db.query(
        "UPDATE orders SET status='confirmed',confirmed_at=$2,confirmed_payment_id=$3 WHERE id=$1",
        [shop.orderId, NOW, payment],
      );
    }
    const sourceMessageId = newUuid(),
      card = await showConfirmCard(scoped(), {
        customerId: shop.customerId,
        consultationId: shop.consultationId,
        kind: "cancel",
        orderId: shop.orderId,
        sourceMessageId,
        now: NOW,
      });
    const text = paid ? "주문을 취소했어요. 환불은 사장님이 정한 뒤 알려 드려요" : "주문을 취소했어요",
      execute = vi.fn(async () => ({ outcome: "order_cancelled", text }));
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("합성 취소 첫 결과의 실제 발신 금지"));
    try {
      const call = () =>
        createApp({
          connect: () => isolated.connect(),
          services: { now: () => NOW, confirmCardCommand: execute },
          logSink: () => {},
        }).request(
          "/api/kakao/skills/card",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
            body: JSON.stringify({
              bot: { id: shop.botId },
              userRequest: {
                utterance: "주문 취소하기",
                block: { id: "blk-card" },
                user: { id: shop.userKey, type: "botUserKey" },
              },
              action: {
                id: "synthetic-cancellation-first",
                params: {},
                clientExtra: { cardKey: card.cardKey, choice: "confirm" },
              },
            }),
          },
          testEnv(),
        );
      const first = await call(),
        repeated = await call(),
        initial = await first.json(),
        again = await repeated.json();
      expect(first.headers.get("Siljang-Outcome")).toBe("order_cancelled");
      expect(repeated.headers.get("Siljang-Outcome")).toBe("card_used");
      expectSchema("SkillTemplateResponse", initial);
      expectSchema("SkillTemplateResponse", again);
      expect(again).toEqual(initial);
      expect(again).toHaveProperty("template.outputs", [{ simpleText: { text } }]);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(
        await scoped().transaction((tx) =>
          readConfirmCardDelivery(tx, {
            customerId: shop.customerId,
            consultationId: shop.consultationId,
            sourceMessageId,
            now: NOW,
          }),
        ),
      ).toEqual({ text });
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  });
});
