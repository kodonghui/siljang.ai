/** 실제 신고 쓰기는 TASK140의 합성 명령으로 대체하고 카드 저장/전달 경계만 검사한다. */
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
describeDb("신고 카드의 실제 저장 첫 결과와 재전달(TASK-147)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture, key: string;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    shop = await createShop(isolated.db, "합성 신고 첫 결과 가게");
    await issueTestBookingLink(isolated.db, shop);
    await linkTestChannel(isolated.db, shop.channelId);
    const paid = newUuid();
    const confirmed = new Date(NOW.getTime() - 4 * 3600000);
    await isolated.db.transaction(async (tx) => {
      await tx.query(
        "UPDATE payment_requests SET status='paid',paid_at=$2,arrived_at=$2,arrived_amount=amount WHERE id=$1",
        [shop.paymentRequestId, confirmed],
      );
      await tx.query(
        "INSERT INTO payments(id,shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES($1,$2,$3,$4,35000,$5)",
        [paid, shop.shopId, shop.orderId, shop.paymentRequestId, confirmed],
      );
      await tx.query(
        "UPDATE orders SET status='received',confirmed_at=$2,confirmed_payment_id=$3,finished_at=$4 WHERE id=$1",
        [shop.orderId, confirmed, paid, new Date(NOW.getTime() - 3 * 3600000)],
      );
      await tx.query(
        "INSERT INTO productions(shop_id,order_id,completed_at,handed_over_at,handover_kind,created_at) VALUES($1,$2,$3,$3,'pickup',$4)",
        [shop.shopId, shop.orderId, new Date(NOW.getTime() - 3 * 3600000), confirmed],
      );
    });
    key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
  });
  afterAll(async () => {
    await isolated?.close();
  });
  const scoped = () => shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }), isolated.db);
  it.each(["신고를 받았어요. 사장님이 보시고 정하실 거예요", "이전 합성 신고 접수 안내"])(
    "API071 재클릭과 카드 재전달이 현재/이전 첫 결과만 보이고 명령은 한 번이다(%s)",
    async (text) => {
      const sourceMessageId = newUuid();
      const card = await showConfirmCard(scoped(), {
        customerId: shop.customerId,
        consultationId: shop.consultationId,
        kind: "issue_report",
        orderId: shop.orderId,
        sourceMessageId,
        now: NOW,
      });
      const execute = vi.fn(async () => ({ outcome: "issue_reported", text }));
      const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("합성 신고 첫 결과의 실제 발신 금지"));
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
                  utterance: "문제 신고",
                  block: { id: "blk-card" },
                  user: { id: shop.userKey, type: "botUserKey" },
                },
                action: {
                  id: "synthetic-issue-first",
                  params: {},
                  clientExtra: { cardKey: card.cardKey, choice: "confirm" },
                },
              }),
            },
            testEnv(),
          );
        const first = await call(),
          repeated = await call();
        const initial: unknown = await first.json(),
          again: unknown = await repeated.json();
        const delivery = await scoped().transaction((tx) =>
          readConfirmCardDelivery(tx, {
            customerId: shop.customerId,
            consultationId: shop.consultationId,
            sourceMessageId,
            now: NOW,
          }),
        );
        expect(first.headers.get("Siljang-Outcome")).toBe("issue_reported");
        expect(repeated.headers.get("Siljang-Outcome")).toBe("card_used");
        expectSchema("SkillTemplateResponse", initial);
        expectSchema("SkillTemplateResponse", again);
        expect.soft(again).toEqual(initial);
        expect.soft(again).toHaveProperty("template.outputs", [{ simpleText: { text } }]);
        expect.soft(delivery).toEqual({ text });
        expect(execute).toHaveBeenCalledTimes(1);
        expect(network).not.toHaveBeenCalled();
      } finally {
        network.mockRestore();
      }
    },
  );
});
