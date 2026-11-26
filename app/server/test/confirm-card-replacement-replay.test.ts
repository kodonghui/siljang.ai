import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { pressConfirmCard, showConfirmCard } from "../src/confirm-card-store";
import { kakaoConfirmCardReply } from "../src/kakao-confirm-card";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { describeDb } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { prepareOrderCardSource } from "./support/order-card";
import { createShop, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-28T06:00:00Z");
describeDb("공통 확인 카드의 교체 응답 재시도(TASK-081)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  afterAll(async () => {
    await isolated?.close();
  });
  beforeEach(async () => {
    shop = await createShop(isolated.db, "합성 교체 응답 가게");
    await linkTestChannel(isolated.db, shop.channelId);
    await prepareOrderCardSource(isolated.db, shop, NOW);
    await isolated.db.query("UPDATE order_drafts SET status='active' WHERE id=$1", [shop.draftId]);
  });
  const scoped = () => shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }), isolated.db);
  const identity = () => ({ customerId: shop.customerId, consultationId: shop.consultationId });
  it.each(["cancel", "order_request"] as const)(
    "%s에서도 만료 교체 응답을 놓친 원래 버튼은 유효한 새 카드를 다시 보인다",
    async (kind) => {
      const card = await showConfirmCard(scoped(), {
        ...identity(),
        kind,
        now: NOW,
        ...(kind === "cancel" ? { orderId: shop.orderId } : { draftId: shop.draftId }),
      });
      const execute = vi.fn(async () => ({
        outcome: kind === "cancel" ? "order_cancelled" : "order_requested",
        text: "합성 첫 결과",
      }));
      const input = {
        ...identity(),
        cardKey: card.cardKey,
        choice: "confirm" as const,
        now: new Date(NOW.getTime() + 30 * 60000),
      };
      const first = await pressConfirmCard(scoped(), input, execute),
        retry = await pressConfirmCard(scoped(), input, execute);
      expect(first.outcome).toBe("card_expired");
      expect(first.card).toBeDefined();
      expect(retry.outcome).toBe("card_used");
      expect(retry.card?.cardKey).toBe(first.card?.cardKey);
      expect(execute).not.toHaveBeenCalled();
      const responder = {
        json: (body: unknown, status = 200, headers = {}) => Response.json(body, { status, headers }),
      };
      expect(await kakaoConfirmCardReply(responder, retry).json()).toEqual(
        await kakaoConfirmCardReply(responder, first).json(),
      );
    },
  );
});
