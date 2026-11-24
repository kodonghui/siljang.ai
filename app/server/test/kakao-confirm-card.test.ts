import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { type ConfirmCardCommand, showConfirmCard } from "../src/confirm-card-store";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { describeDb, TEST_HASH_KEY } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-24T01:00:00Z");
describeDb("API-071 확인 카드 수신(TASK-081)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture, now: Date, key: string;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    shop = await createShop(isolated.db, "합성 카드 API 가게");
    await issueTestBookingLink(isolated.db, shop);
    await linkTestChannel(isolated.db, shop.channelId);
    now = NOW;
    key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
  });
  afterAll(async () => {
    await isolated?.close();
  });
  const scoped = () => shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }), isolated.db);
  const show = () =>
    showConfirmCard(scoped(), {
      customerId: shop.customerId,
      consultationId: shop.consultationId,
      kind: "cancel",
      orderId: shop.orderId,
      now: NOW,
    });
  function payload(cardKey: string, choice = "confirm", userId = shop.userKey) {
    return {
      bot: { id: shop.botId },
      userRequest: {
        user: { id: userId, type: "botUserKey", properties: { isFriend: true } },
        block: { id: "blk-card" },
        utterance: "카드 누름",
        params: { surface: "Kakaotalk.plusfriend" },
      },
      action: { id: "card-skill", params: {}, clientExtra: { cardKey, choice } },
    };
  }
  function call(input: unknown, options: { key?: string; execute?: ConfirmCardCommand } = {}) {
    const app = createApp({
      connect: () => isolated.connect(),
      services: { now: () => now, confirmCardCommand: options.execute },
    });
    return app.request(
      "/api/kakao/skills/card",
      {
        method: "POST",
        headers: { "content-type": "application/json", "Siljang-Skill-Key": options.key ?? key },
        body: JSON.stringify(input),
      },
      { APP_ENV: "development", REQUEST_HASH_KEY: TEST_HASH_KEY },
    );
  }
  it("200: 말이 바꾼 금액·주문 ID를 쓰지 않고 저장 카드의 명령만 한 번 실행", async () => {
    const card = await show(),
      execute = vi.fn<ConfirmCardCommand>(async () => ({ outcome: "order_cancelled", text: "주문을 취소했어요" }));
    const input = payload(card.cardKey);
    Object.assign(input.action.clientExtra, {
      amount: 1,
      orderId: "forged-order",
      kind: "payment_claim",
      description: "손님이 바꾼 카드",
    });
    const response = await call(input, { execute });
    expect(response.status).toBe(200);
    expect(response.headers.get("Siljang-Outcome")).toBe("order_cancelled");
    expect(execute.mock.calls[0]?.[1]).toMatchObject({
      kind: "cancel",
      orderId: shop.orderId,
      customerId: shop.customerId,
    });
    expect(JSON.stringify(execute.mock.calls[0]?.[1])).not.toContain("forged-order");
    expect(execute).toHaveBeenCalledOnce();
    const second = await call(input, { execute });
    expect(second.headers.get("Siljang-Outcome")).toBe("card_used");
    expect(JSON.stringify(await second.json())).toContain("주문을 취소했어요");
    expect(execute).toHaveBeenCalledOnce();
  });
  it("200 declined: 명령을 남기지 않음", async () => {
    const card = await show(),
      execute = vi.fn<ConfirmCardCommand>();
    const response = await call(payload(card.cardKey, "decline"), { execute });
    expect(response.headers.get("Siljang-Outcome")).toBe("declined");
    expect(execute).not.toHaveBeenCalled();
  });
  it("200 card_expired: 30분 정각에 새 카드", async () => {
    const card = await show();
    now = new Date(NOW.getTime() + 30 * 60000);
    const response = await call(payload(card.cardKey));
    expect(response.headers.get("Siljang-Outcome")).toBe("card_expired");
    const body = (await response.json()) as {
      template: { outputs: { textCard?: { buttons: { extra: { cardKey: string } }[] } }[] };
    };
    const renewed = body.template.outputs.find((x) => x.textCard)?.textCard?.buttons[0]?.extra.cardKey;
    expect(renewed).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(renewed).not.toBe(card.cardKey);
  });
  it("200 card_stale: 초안 고친 번호를 다시 확인", async () => {
    await isolated.db.query("UPDATE order_drafts SET status='active' WHERE id=$1", [shop.draftId]);
    const card = await showConfirmCard(scoped(), {
      customerId: shop.customerId,
      consultationId: shop.consultationId,
      kind: "order_request",
      draftId: shop.draftId,
      now: NOW,
    });
    await isolated.db.query("UPDATE order_drafts SET revision=revision+1 WHERE id=$1", [shop.draftId]);
    expect((await call(payload(card.cardKey))).headers.get("Siljang-Outcome")).toBe("card_stale");
  });
  it("200 card_not_yours: 다른 사용자와 없는 키는 같은 답이며 손님을 새로 만들지 않음", async () => {
    const card = await show();
    const before = (await isolated.db.query("SELECT count(*)::int AS n FROM customers WHERE shop_id=$1", [shop.shopId]))
      .rows;
    const foreign = await call(payload(card.cardKey, "confirm", "unknown-user")),
      missing = await call(payload("missing_card_key_12345", "confirm", "unknown-user"));
    expect(foreign.headers.get("Siljang-Outcome")).toBe("card_not_yours");
    expect(await foreign.json()).toEqual(await missing.json());
    expect(
      (await isolated.db.query("SELECT count(*)::int AS n FROM customers WHERE shop_id=$1", [shop.shopId])).rows,
    ).toEqual(before);
  });
  it("명령이 없거나 실패하면 retry_needed이고 사용하지 않음", async () => {
    const card = await show();
    expect((await call(payload(card.cardKey))).headers.get("Siljang-Outcome")).toBe("retry_needed");
    const execute = vi.fn<ConfirmCardCommand>(async () => {
      throw new Error("synthetic failure");
    });
    expect((await call(payload(card.cardKey), { execute })).headers.get("Siljang-Outcome")).toBe("retry_needed");
    expect(
      (
        await isolated.db.query("SELECT used_at FROM confirm_cards WHERE shop_id=$1 AND card_key=$2", [
          shop.shopId,
          card.cardKey,
        ])
      ).rows,
    ).toEqual([{ used_at: null }]);
  });
  it("401: 잘못된 스킬 키", async () => {
    const card = await show();
    expect((await call(payload(card.cardKey), { key: "wrong" })).status).toBe(401);
  });
  it("422: 카드 키·선택의 형식", async () => {
    for (const [cardKey, choice] of [
      ["bad", "confirm"],
      ["valid_card_key_12345", "unknown"],
    ] as const)
      expect((await call(payload(cardKey, choice))).status).toBe(422);
  });
  it("default 500: 인증 DB 장애", async () => {
    const app = createApp({
      connect: () => {
        throw new Error("synthetic unavailable");
      },
      services: { now: () => now },
    });
    const response = await app.request(
      "/api/kakao/skills/card",
      {
        method: "POST",
        headers: { "content-type": "application/json", "Siljang-Skill-Key": key },
        body: JSON.stringify(payload("valid_card_key_12345")),
      },
      { APP_ENV: "development", REQUEST_HASH_KEY: TEST_HASH_KEY },
    );
    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).toContain("application/problem+json");
  });
});
