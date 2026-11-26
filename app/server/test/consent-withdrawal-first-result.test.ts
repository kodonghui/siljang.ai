/** 실제 철회 업무는 TASK146의 합성 실행기로 대체한다. 카드 표시·저장·재검증 경계를 검사한다. */
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import {
  prepareConfirmCardInTransaction,
  pressConfirmCard,
  readConfirmCardDelivery,
  showConfirmCard,
} from "../src/confirm-card-store";
import { kakaoConfirmCardReply } from "../src/kakao-confirm-card";
import { kakaoConsultationMessage } from "../src/kakao-consultation-message";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { createConsentWithdrawalFixture } from "./support/consent-withdrawal-fixture";
import { expectSchema } from "./support/contract";
import { describeDb, TEST_HASH_KEY } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-28T06:00:00Z");
describeDb("사진 게시 동의 철회 카드의 현재 값과 처음 결과(TASK-149)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture;
  let review: string, reviewConsent: string;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  afterAll(async () => {
    await isolated?.close();
  });
  beforeEach(async () => {
    ({ shop, review, reviewConsent } = await createConsentWithdrawalFixture(isolated.db, NOW));
  });
  const scoped = () => shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }), isolated.db);
  const identity = () => ({ customerId: shop.customerId, consultationId: shop.consultationId });
  const target = () => ({
    ...identity(),
    kind: "consent_withdrawal" as const,
    orderId: shop.orderId,
    sourceMessageId: shop.messageId,
    now: NOW,
  });
  const prepare = () => showConfirmCard(scoped(), target());
  const press = (cardKey: string, now = NOW) => ({ ...identity(), cardKey, choice: "confirm" as const, now });
  const response = (answer: Parameters<typeof kakaoConfirmCardReply>[1]) =>
    kakaoConfirmCardReply(
      { json: (value, status = 200, headers = {}) => Response.json(value, { status, headers }) },
      answer,
    );
  async function http(
    cardKey: string,
    now = NOW,
    user = shop.userKey,
    execute?: Parameters<typeof pressConfirmCard>[2],
  ) {
    const key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
    return createApp({
      connect: () => isolated.connect(),
      services: { now: () => now, confirmCardCommand: execute },
      logSink: () => {},
    }).request(
      "/api/kakao/skills/card",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
        body: JSON.stringify({
          bot: { id: shop.botId },
          userRequest: {
            utterance: "동의 철회",
            block: { id: "blk-card" },
            user: { id: user, type: "botUserKey" },
          },
          action: {
            id: "card",
            params: {},
            clientExtra: { cardKey, choice: "confirm", completionPhotoCount: 99, publishedCount: 0 },
          },
        }),
      },
      { APP_ENV: "development", REQUEST_HASH_KEY: TEST_HASH_KEY },
    );
  }
  it.each(["stale", "expired", "not_allowed_now", "not_accepting", "card_not_yours"] as const)(
    "실제 API071의 %s 응답이 현재 서버 값의 카드·연락처만 보인다",
    async (state) => {
      const card = await prepare();
      if (state === "stale")
        await isolated.db.query("UPDATE photo_consents SET withdrawn_at=$2,publishable=false WHERE id=$1", [
          reviewConsent,
          NOW,
        ]);
      if (state === "not_allowed_now") {
        await isolated.db.query(
          "UPDATE portfolio_items SET unpublished_at=$2,unpublish_reason='consent_withdrawn',consent_live=NULL WHERE shop_id=$1",
          [shop.shopId, NOW],
        );
        await isolated.db.query("UPDATE photo_consents SET withdrawn_at=$2,publishable=false WHERE shop_id=$1", [
          shop.shopId,
          NOW,
        ]);
      }
      if (state === "not_accepting")
        await isolated.db.query("UPDATE shops SET booking_issued_at=NULL,booking_slug=NULL WHERE id=$1", [shop.shopId]);
      const result = await http(
        card.cardKey,
        state === "expired" ? new Date(NOW.getTime() + 30 * 60000) : NOW,
        state === "card_not_yours" ? "unknown-user" : shop.userKey,
      );
      expect(result.status).toBe(200);
      expect(result.headers.get("Cache-Control")).toBe("no-store");
      expect(result.headers.get("Siljang-Outcome")).toBe(
        state === "stale" ? "card_stale" : state === "expired" ? "card_expired" : state,
      );
      const body = await result.json();
      expectSchema("SkillTemplateResponse", body);
      const text = JSON.stringify(body);
      expect(text).not.toContain("사진 99장");
      if (state === "stale") expect(text).toContain("후기 사진 0장");
      if (state === "expired") expect(text).toContain("시간이 지나 새 카드를 보내 드려요");
      if (state === "not_allowed_now") expect(text).toContain("게시에 동의한 사진이 없어요");
      if (state === "not_accepting") expect(text).toContain("가게로 연락해 주세요: 010-1234-5678");
      if (state === "card_not_yours") {
        expect(text).toContain("이 버튼은 카드를 받은 분만 누를 수 있어요");
        expect(text).not.toContain("사진 2장");
      }
    },
  );
  it("실제 API071의 같은 버튼 반복은 처음 실행기의 결과를 한 번만 남긴다", async () => {
    const card = await prepare();
    const execute = vi.fn(async () => ({ outcome: "consent_withdrawn", text: "합성 HTTP 첫 철회 결과" }));
    const first = await http(card.cardKey, NOW, shop.userKey, execute);
    const repeated = await http(card.cardKey, NOW, shop.userKey, execute);
    expect(first.headers.get("Siljang-Outcome")).toBe("consent_withdrawn");
    expect(repeated.headers.get("Siljang-Outcome")).toBe("card_used");
    expect(await first.json()).toEqual(await repeated.json());
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("현재 같은 주문의 완성·후기 사진과 게시 수를 읽고 원문/사진 경로를 복사하지 않는다", async () => {
    const card = await prepare();
    expect(card.consentWithdrawal).toMatchObject({
      completionPhotoCount: 1,
      reviewPhotoCount: 1,
      publishedCount: 1,
      expiresAt: new Date(NOW.getTime() + 30 * 60000).toISOString(),
    });
    const body = kakaoConsultationMessage({ state: "normal", contents: [card] });
    expectSchema("SkillTemplateResponse", body);
    expect(JSON.stringify(body)).toContain("완성 사진 1장 · 후기 사진 1장");
    const saved = (
      await isolated.db.query<{ payload: unknown }>("SELECT payload FROM confirm_cards WHERE card_key=$1", [
        card.cardKey,
      ])
    ).rows[0]?.payload;
    expect(JSON.stringify(saved)).not.toMatch(
      /synthetic\/(?:completion|review)|합성 후기|consentWithdrawal.*completionPhotoCount/,
    );
    expect(JSON.stringify(saved)).toContain("consentWithdrawalBinding");
  });
  it.each(["review", "consent", "publication"] as const)(
    "카드 뒤 %s가 바뀌면 현재 값의 새 카드만 보이고 명령은 실행하지 않는다",
    async (change) => {
      const card = await prepare();
      if (change === "review") {
        await isolated.db.query("UPDATE reviews SET superseded_at=$2 WHERE id=$1", [review, NOW]);
        await isolated.db.query("INSERT INTO reviews(shop_id,order_id,version,body) VALUES($1,$2,2,'바뀐 합성 후기')", [
          shop.shopId,
          shop.orderId,
        ]);
      } else if (change === "consent") {
        await isolated.db.query("UPDATE photo_consents SET withdrawn_at=$2,publishable=false WHERE id=$1", [
          reviewConsent,
          NOW,
        ]);
      } else {
        await isolated.db.query(
          "UPDATE portfolio_items SET unpublished_at=$2,unpublish_reason='owner_removed',consent_live=NULL WHERE shop_id=$1",
          [shop.shopId, NOW],
        );
      }
      const execute = vi.fn(async () => ({ outcome: "consent_withdrawn", text: "합성 철회 결과" }));
      const answer = await pressConfirmCard(scoped(), press(card.cardKey), execute);
      expect(answer.outcome).toBe("card_stale");
      expect(answer.card?.cardKey).not.toBe(card.cardKey);
      expect(execute).not.toHaveBeenCalled();
      expect(JSON.stringify(await response(answer).json())).toContain("내용이 바뀌었어요. 새 카드를 확인해 주세요");
      if (change === "consent") expect(answer.card?.consentWithdrawal?.reviewPhotoCount).toBe(0);
      if (change === "publication") expect(answer.card?.consentWithdrawal?.publishedCount).toBe(0);
    },
  );
  it("30분 경계는 새 카드와 현재 만료 시각을 보인다", async () => {
    const card = await prepare(),
      at = new Date(NOW.getTime() + 30 * 60000);
    const execute = vi.fn(async () => ({ outcome: "consent_withdrawn", text: "합성 철회 결과" }));
    const answer = await pressConfirmCard(scoped(), press(card.cardKey, at), execute);
    expect(answer.outcome).toBe("card_expired");
    expect(execute).not.toHaveBeenCalled();
    expect(answer.card?.consentWithdrawal?.expiresAt).toBe(new Date(at.getTime() + 30 * 60000).toISOString());
    expect(JSON.stringify(await response(answer).json())).toContain("시간이 지나 새 카드를 보내 드려요");
  });
  it("철회 가능한 동의가 없으면 빈 카드를 만들지 않고 기존 버튼도 실행하지 않는다", async () => {
    const card = await prepare();
    await isolated.db.query(
      "UPDATE portfolio_items SET unpublished_at=$2,unpublish_reason='consent_withdrawn',consent_live=NULL WHERE shop_id=$1",
      [shop.shopId, NOW],
    );
    await isolated.db.query("UPDATE photo_consents SET withdrawn_at=$2,publishable=false WHERE shop_id=$1", [
      shop.shopId,
      NOW,
    ]);
    const execute = vi.fn(async () => ({ outcome: "consent_withdrawn", text: "합성 철회 결과" }));
    const answer = await pressConfirmCard(scoped(), press(card.cardKey), execute);
    expect(answer.outcome).toBe("not_allowed_now");
    expect(execute).not.toHaveBeenCalled();
    expect(JSON.stringify(await response(answer).json())).toContain("지금은 할 수 없어요: 게시에 동의한 사진이 없어요");
    expect(await scoped().transaction((tx) => prepareConfirmCardInTransaction(tx, target()))).toMatchObject({
      unavailable: true,
      text: "지금은 할 수 없어요: 게시에 동의한 사진이 없어요",
    });
    expect((await isolated.db.query("SELECT id FROM confirm_cards WHERE shop_id=$1", [shop.shopId])).rowCount).toBe(1);
  });
  it("같은 카드 두 번과 다음 대화는 처음 실행기의 답을 그대로 보인다", async () => {
    const card = await prepare();
    const execute = vi.fn(async () => ({ outcome: "consent_withdrawn", text: "합성 처음 철회 결과" }));
    const first = await pressConfirmCard(scoped(), press(card.cardKey), execute);
    const repeated = await pressConfirmCard(scoped(), press(card.cardKey), execute);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(repeated.outcome).toBe("card_used");
    expect(await response(repeated).json()).toEqual(await response(first).json());
    expect(JSON.stringify(await response(first).json())).toContain("합성 처음 철회 결과");
    expect(
      await scoped().transaction((tx) =>
        readConfirmCardDelivery(tx, { ...identity(), sourceMessageId: shop.messageId, now: NOW }),
      ),
    ).toEqual({ text: "합성 처음 철회 결과" });
  });
  it("안 할래요는 카드 사용·사진·동의에 아무 쓰기도 하지 않는다", async () => {
    const card = await prepare();
    const answer = await pressConfirmCard(scoped(), { ...press(card.cardKey), choice: "decline" });
    expect(answer.outcome).toBe("declined");
    expect(JSON.stringify(await response(answer).json())).toContain("알겠어요. 더 궁금한 것이 있으면 말씀해 주세요");
    expect(
      (
        await isolated.db.query<{ used_at: Date | null }>("SELECT used_at FROM confirm_cards WHERE card_key=$1", [
          card.cardKey,
        ])
      ).rows[0]?.used_at,
    ).toBeNull();
    expect(
      (
        await isolated.db.query("SELECT id FROM photo_consents WHERE shop_id=$1 AND withdrawn_at IS NOT NULL", [
          shop.shopId,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await isolated.db.query("SELECT id FROM portfolio_items WHERE shop_id=$1 AND unpublished_at IS NOT NULL", [
          shop.shopId,
        ])
      ).rowCount,
    ).toBe(0);
  });
  it("다른 손님은 받은 카드나 사진 수를 알 수 없다", async () => {
    const card = await prepare(),
      other = await createShop(isolated.db, "다른 합성 손님 가게");
    const answer = await pressConfirmCard(scoped(), { ...press(card.cardKey), customerId: other.customerId });
    expect(answer.outcome).toBe("card_not_yours");
    expect(answer.card).toBeUndefined();
  });
  it("다음 대화도 바뀐 현재 값과 만료 시각을 다시 읽는다", async () => {
    const card = await prepare();
    await isolated.db.query("UPDATE photo_consents SET withdrawn_at=$2,publishable=false WHERE id=$1", [
      reviewConsent,
      NOW,
    ]);
    const next = await scoped().transaction((tx) =>
      readConfirmCardDelivery(tx, { ...identity(), sourceMessageId: shop.messageId, now: NOW }),
    );
    expect(next.card?.cardKey).not.toBe(card.cardKey);
    expect(next.card?.consentWithdrawal?.reviewPhotoCount).toBe(0);
    if (next.card === undefined) throw new Error("철회 카드가 없어요");
    expect(JSON.stringify(kakaoConsultationMessage({ state: "normal", contents: [next.card] }))).toContain(
      "후기 사진 0장",
    );
  });
  function cardKeyOf(body: unknown): string {
    const value = body as {
      template?: { outputs?: { textCard?: { buttons?: { extra?: { cardKey?: string } }[] } }[] };
    };
    const key = value.template?.outputs?.find((output) => output.textCard)?.textCard?.buttons?.[0]?.extra?.cardKey;
    expect(key).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    if (key === undefined) throw new Error("교체 카드 키가 없어요");
    return key;
  }
  async function loseStaleResponse() {
    const original = await prepare();
    await isolated.db.query(
      "UPDATE portfolio_items SET unpublished_at=$2,unpublish_reason='owner_removed',consent_live=NULL WHERE shop_id=$1",
      [shop.shopId, NOW],
    );
    const lost = await http(original.cardKey);
    expect(lost.headers.get("Siljang-Outcome")).toBe("card_stale");
    return { original, replacement: cardKeyOf(await lost.json()) };
  }
  it.each(["stale", "expired"] as const)(
    "%s 교체 응답을 놓쳐도 원래 버튼이 같은 유효한 새 카드를 다시 보인다",
    async (state) => {
      const original = await prepare();
      if (state === "stale")
        await isolated.db.query(
          "UPDATE portfolio_items SET unpublished_at=$2,unpublish_reason='owner_removed',consent_live=NULL WHERE shop_id=$1",
          [shop.shopId, NOW],
        );
      const at = state === "expired" ? new Date(NOW.getTime() + 30 * 60000) : NOW;
      const first = await http(original.cardKey, at),
        firstBody = await first.json();
      expect(first.headers.get("Siljang-Outcome")).toBe(state === "stale" ? "card_stale" : "card_expired");
      const repeated = await http(original.cardKey, at),
        repeatedBody = await repeated.json();
      expect(repeated.headers.get("Siljang-Outcome")).toBe("card_used");
      expect(cardKeyOf(repeatedBody)).toBe(cardKeyOf(firstBody));
      expect(repeatedBody).toEqual(firstBody);
      expect((await isolated.db.query("SELECT id FROM confirm_cards WHERE shop_id=$1", [shop.shopId])).rowCount).toBe(
        2,
      );
    },
  );
  it.each(["changed_again", "expired_again"] as const)(
    "원래 버튼 재시도도 교체 카드의 %s를 확인하고 명령 없이 현재 새 카드를 보인다",
    async (mode) => {
      const { original, replacement } = await loseStaleResponse();
      if (mode === "changed_again")
        await isolated.db.query(
          "UPDATE portfolio_items SET unpublished_at=NULL,unpublish_reason=NULL,consent_live=true WHERE shop_id=$1",
          [shop.shopId],
        );
      const at = mode === "expired_again" ? new Date(NOW.getTime() + 30 * 60000) : NOW;
      const execute = vi.fn(async () => ({ outcome: "consent_withdrawn", text: "합성 실행 결과" }));
      const retry = await http(original.cardKey, at, shop.userKey, execute),
        body = await retry.json();
      const current = cardKeyOf(body);
      expect(current).not.toBe(replacement);
      expect(execute).not.toHaveBeenCalled();
      if (mode === "expired_again") expect(JSON.stringify(body)).toContain("시간이 지나 새 카드를 보내 드려요");
      else expect(JSON.stringify(body)).toContain("포트폴리오에 올라 있음");
      const row = (
        await isolated.db.query<{ expires_at: Date }>("SELECT expires_at FROM confirm_cards WHERE card_key=$1", [
          current,
        ])
      ).rows[0];
      expect(row?.expires_at.toISOString()).toBe(new Date(at.getTime() + 30 * 60000).toISOString());
      expect(cardKeyOf(await (await http(original.cardKey, at)).json())).toBe(current);
      expect((await isolated.db.query("SELECT id FROM confirm_cards WHERE shop_id=$1", [shop.shopId])).rowCount).toBe(
        3,
      );
    },
  );
  it("교체 카드가 이미 완료됐으면 예전 버튼도 그 처음 업무 결과만 보인다", async () => {
    const { original, replacement } = await loseStaleResponse();
    const execute = vi.fn(async () => ({ outcome: "consent_withdrawn", text: "교체 카드의 합성 첫 결과" }));
    const completed = await http(replacement, NOW, shop.userKey, execute),
      body = await completed.json();
    expect(completed.headers.get("Siljang-Outcome")).toBe("consent_withdrawn");
    const repeated = await http(original.cardKey, NOW, shop.userKey, execute);
    expect(repeated.headers.get("Siljang-Outcome")).toBe("card_used");
    expect(await repeated.json()).toEqual(body);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("교체 참조가 있어도 다른 사용자는 새 카드나 사진 수를 알 수 없다", async () => {
    const { original } = await loseStaleResponse();
    const result = await http(original.cardKey, NOW, "unknown-user");
    expect(result.headers.get("Siljang-Outcome")).toBe("card_not_yours");
    expect(JSON.stringify(await result.json())).not.toContain("철회할 사진");
  });
  it("다른 가게 카드로 바뀐 교체 참조는 내용을 보이거나 실행하지 않는다", async () => {
    const { original } = await loseStaleResponse();
    const other = await createConsentWithdrawalFixture(isolated.db, NOW);
    const otherDb = shopRequestDb(
      createShopScope(other.shop.shopId, { kind: "job", job: "kakao_callback" }),
      isolated.db,
    );
    const foreign = await showConfirmCard(otherDb, {
      customerId: other.shop.customerId,
      consultationId: other.shop.consultationId,
      kind: "consent_withdrawal",
      orderId: other.shop.orderId,
      now: NOW,
    });
    await isolated.db.query(
      "UPDATE confirm_cards SET payload=jsonb_set(payload,'{replacedBy}',$2::jsonb) WHERE card_key=$1",
      [original.cardKey, JSON.stringify({ cardKey: foreign.cardKey })],
    );
    const execute = vi.fn(async () => ({ outcome: "consent_withdrawn", text: "합성 실행 결과" }));
    const result = await http(original.cardKey, NOW, shop.userKey, execute);
    expect(result.headers.get("Siljang-Outcome")).toBe("retry_needed");
    expect(JSON.stringify(await result.json())).not.toContain("철회할 사진");
    expect(execute).not.toHaveBeenCalled();
  });
  it("순환한 교체 참조는 새 카드를 만들거나 끝없이 조회하지 않는다", async () => {
    const { original, replacement } = await loseStaleResponse();
    await isolated.db.query(
      "UPDATE confirm_cards SET used_at=$2,outcome='stale',payload=jsonb_set(payload,'{replacedBy}',$3::jsonb) WHERE card_key=$1",
      [replacement, NOW, JSON.stringify({ cardKey: original.cardKey })],
    );
    const result = await http(original.cardKey);
    expect(result.headers.get("Siljang-Outcome")).toBe("retry_needed");
    expect((await isolated.db.query("SELECT id FROM confirm_cards WHERE shop_id=$1", [shop.shopId])).rowCount).toBe(2);
  });
});
