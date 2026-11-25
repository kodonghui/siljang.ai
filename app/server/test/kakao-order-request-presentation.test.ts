import { afterAll, beforeEach, expect, it } from "vitest";
import { createApp } from "../src/app";
import { showConfirmCard } from "../src/confirm-card-store";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { describeDb, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-25T03:00:00Z");
describeDb("SCR004의 실제 저장 카드와 응답 문구(TASK-086)", () => {
  const db = testDb();
  let shop: ShopFixture;
  beforeEach(async () => {
    shop = await createShop(db, "합성 주문 요청 표시 가게");
    await issueTestBookingLink(db, shop);
    await linkTestChannel(db, shop.channelId);
  });
  afterAll(() => db.close());
  const scoped = () => shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }), db);
  async function send(cardKey: string, blockId: string, fail = false) {
    const skillKey = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
    return createApp({
      services: {
        now: () => NOW,
        ...(fail
          ? {
              confirmCardCommand: async () => {
                throw new Error("합성 명령 실패");
              },
            }
          : {}),
      },
      logSink: () => {},
    }).request(
      "/api/kakao/skills/card",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Siljang-Skill-Key": skillKey },
        body: JSON.stringify({
          bot: { id: shop.botId },
          userRequest: { utterance: "확인", block: { id: blockId }, user: { id: shop.userKey, type: "botUserKey" } },
          action: { id: "synthetic-card", params: {}, clientExtra: { cardKey, choice: "confirm" } },
        }),
      },
      testEnv(),
    );
  }
  it("저장하는 주문 요청 카드는 규정 동의를 명시한14자 버튼과 별도 제목을 쓴다", async () => {
    const draft = (
      await db.query<{ id: string }>("INSERT INTO order_drafts(shop_id,consultation_id) VALUES($1,$2) RETURNING id", [
        shop.shopId,
        shop.consultationId,
      ])
    ).rows[0];
    const card = await showConfirmCard(scoped(), {
      customerId: shop.customerId,
      consultationId: shop.consultationId,
      kind: "order_request",
      draftId: draft?.id ?? "",
      now: NOW,
    });
    expect(card.title).toBe("주문 요청 확인");
    expect(card.confirmLabel).toBe("규정에 동의하고 주문 요청");
    expect([...card.confirmLabel]).toHaveLength(14);
  });
  it("없는 키는 사용자에게 정의된 권한 문구만 보인다", async () => {
    const card = await showConfirmCard(scoped(), {
      customerId: shop.customerId,
      consultationId: shop.consultationId,
      kind: "cancel",
      orderId: shop.orderId,
      now: NOW,
    });
    const response = await send("missing_card_key_12345", card.blockId);
    expect(response.headers.get("Siljang-Outcome")).toBe("card_not_yours");
    expect(await response.json()).toMatchObject({
      template: { outputs: [{ simpleText: { text: "이 버튼은 카드를 받은 분만 누를 수 있어요" } }] },
    });
  });
  it("실제 명령 실패는 쓰기를 되돌리고 정의된 다시 누르기 문구를 보인다", async () => {
    const card = await showConfirmCard(scoped(), {
      customerId: shop.customerId,
      consultationId: shop.consultationId,
      kind: "cancel",
      orderId: shop.orderId,
      now: NOW,
    });
    const response = await send(card.cardKey, card.blockId, true);
    expect(response.headers.get("Siljang-Outcome")).toBe("retry_needed");
    expect(await response.json()).toMatchObject({
      template: { outputs: [{ simpleText: { text: "다시 눌러 주세요" } }] },
    });
    expect(
      (
        await db.query("SELECT used_at FROM confirm_cards WHERE shop_id=$1 AND card_key=$2", [
          shop.shopId,
          card.cardKey,
        ])
      ).rows[0]?.used_at,
    ).toBeNull();
  });
});
