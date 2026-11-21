import { afterAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { expectSchema } from "./support/contract";
import { describeDb, newUuid, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-21T00:00:00Z");

describeDb("카카오 메시지의 예약 링크 준비 조건과 친구 상태(TASK-028, SPEC-017)", () => {
  const db = testDb();
  afterAll(async () => {
    await db.close();
  });

  async function send(shop: ShopFixture, user: string, friend: boolean | undefined, now = NOW) {
    const key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
    return createApp({ logSink: () => {}, services: { now: () => now } }).request(
      "/api/kakao/skills/message",
      {
        method: "POST",
        headers: { "content-type": "application/json", "Siljang-Skill-Key": key },
        body: JSON.stringify({
          bot: { id: shop.botId },
          userRequest: {
            utterance: "합성 상담",
            block: { id: "message" },
            user: {
              id: user,
              type: "botUserKey",
              ...(friend === undefined ? {} : { properties: { isFriend: friend } }),
            },
          },
          action: { id: "message", params: {} },
        }),
      },
      testEnv(),
    );
  }

  async function counts(shopId: string) {
    const r = await db.query<{ customers: number; consultations: number; messages: number }>(
      `SELECT
      (SELECT count(*)::integer FROM customers WHERE shop_id=$1) customers,
      (SELECT count(*)::integer FROM consultations WHERE shop_id=$1) consultations,
      (SELECT count(*)::integer FROM messages WHERE shop_id=$1) messages`,
      [shopId],
    );
    return r.rows[0];
  }

  it("채널이 연결돼도 예약 링크 발급 전에는 상담을 열지 않고 연락처로 안내함", async () => {
    const shop = await createShop(db, "준비 전 가게");
    await linkTestChannel(db, shop.channelId);
    const before = await counts(shop.shopId);
    const response = await send(shop, newUuid(), true);
    expect(response.status).toBe(200);
    expect(response.headers.get("Siljang-Outcome")).toBe("not_accepting");
    const body = await response.json();
    expectSchema("SkillTemplateResponse", body);
    expect(await counts(shop.shopId)).toEqual(before);
    expect(JSON.stringify(body)).toContain("010-1234-5678");
  });

  it("받는 가게는 매 요청의 친구 여부를 저장하고 값이 빠지면 친구 아님으로 고침", async () => {
    const shop = await createShop(db, "친구 상태 가게");
    await linkTestChannel(db, shop.channelId);
    await issueTestBookingLink(db, shop);
    const user = newUuid();
    expect((await send(shop, user, true)).status).toBe(200);
    const state = async () =>
      (
        await db.query<{ channel_friend: boolean; friend_checked_at: Date }>(
          "SELECT channel_friend, friend_checked_at FROM customers WHERE shop_id=$1 AND kakao_user_key=$2",
          [shop.shopId, user],
        )
      ).rows[0];
    expect(await state()).toEqual({ channel_friend: true, friend_checked_at: NOW });
    const next = new Date(NOW.getTime() + 2000);
    expect((await send(shop, user, undefined, next)).status).toBe(200);
    expect(await state()).toEqual({ channel_friend: false, friend_checked_at: next });
    expect((await send(shop, user, true, NOW)).status).toBe(200);
    expect(await state()).toEqual({ channel_friend: false, friend_checked_at: next });
  });
});
