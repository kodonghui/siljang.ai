import { afterAll, beforeEach, expect, it } from "vitest";
import { createApp } from "../src/app";
import { pressConfirmCard, readConfirmCardDelivery, showConfirmCard } from "../src/confirm-card-store";
import { deliverKakaoCallback } from "../src/kakao-callback";
import { kakaoConfirmCardReply } from "../src/kakao-confirm-card";
import { replyWithDeferredKakaoMessages } from "../src/kakao-deferred";
import { kakaoMessageOutputs } from "../src/kakao-message-content";
import { kakaoReply } from "../src/kakao-reply";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { describeDb, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { prepareOrderCardSource } from "./support/order-card";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-25T03:00:00Z");
describeDb("SCR004의 실제 저장 카드와 응답 문구(TASK-086)", () => {
  const db = testDb();
  let shop: ShopFixture;
  beforeEach(async () => {
    shop = await createShop(db, "합성 주문 요청 표시 가게");
    await issueTestBookingLink(db, shop);
    await linkTestChannel(db, shop.channelId);
    await prepareOrderCardSource(db, shop, NOW);
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
    const card = await activeOrderCard();
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
  async function activeOrderCard(sourceMessageId?: string) {
    await db.query("UPDATE order_drafts SET status='active' WHERE shop_id=$1 AND id=$2", [shop.shopId, shop.draftId]);
    await db.query(
      "INSERT INTO rule_clauses (shop_id,operating_rules_id,clause_key,position,title,condition_text,effect_text) VALUES($1,$2,'quote_validity',2,'견적 기한 조문','기한 안','새로 계산')",
      [shop.shopId, shop.operatingRulesId],
    );
    return showConfirmCard(scoped(), {
      customerId: shop.customerId,
      consultationId: shop.consultationId,
      kind: "order_request",
      draftId: shop.draftId,
      now: NOW,
      ...(sourceMessageId ? { sourceMessageId } : {}),
    });
  }
  it("저장 카드의 실제 재조회와 콜백 경로가 규정 조문/두 법률 고지를 카드보다 먼저 전한다", async () => {
    const sourceMessageId = crypto.randomUUID();
    await activeOrderCard(sourceMessageId);
    const content = await scoped().transaction((tx) =>
      readConfirmCardDelivery(tx, {
        customerId: shop.customerId,
        consultationId: shop.consultationId,
        sourceMessageId,
        now: NOW,
      }),
    );
    expect(content.card).toBeDefined();
    if (!content.card) throw new Error("missing fixture card");
    let sent: unknown;
    const result = await deliverKakaoCallback(
      { url: new URL("https://bot-api.kakao.com/v1/callback/synthetic-order"), deadline: NOW.getTime() + 55000 },
      [content.card],
      {
        now: () => NOW.getTime(),
        fetch: async (_, init) => {
          sent = JSON.parse(String(init.body));
          return Response.json({ status: "SUCCESS" });
        },
      },
    );
    expect(result).toBe("delivered");
    expect(sent).toMatchObject({
      template: {
        outputs: [
          { simpleText: { text: expect.stringContaining("운영규정 버전 1") } },
          { textCard: { buttons: [{ label: "규정에 동의하고 주문 요청" }, { label: "안 할래요" }] } },
        ],
      },
    });
    const serialized = JSON.stringify(sent);
    for (const expected of [
      "· 합성 제작 전 취소: 시작 전 → 수수료를 빼고 환불",
      "주문제작이라 청약철회가 제한될 수 있어요",
      "미성년자가 법정대리인의 동의 없이 한 주문은 본인이나 법정대리인이 취소할 수 있어요",
    ])
      expect(serialized).toContain(expected);
    expect(serialized).not.toContain("견적 기한 조문");
  });
  it("실제 만료 갱신의 API071 응답도 규정과 두 고지를 새 카드 앞에 보낸다", async () => {
    const card = await activeOrderCard();
    const answer = await pressConfirmCard(scoped(), {
      customerId: shop.customerId,
      consultationId: shop.consultationId,
      cardKey: card.cardKey,
      choice: "confirm",
      now: new Date(NOW.getTime() + 1800000),
    });
    expect(answer.outcome).toBe("card_expired");
    const body = await kakaoConfirmCardReply(
      { json: (value, status = 200, headers = {}) => Response.json(value, { status, headers }) },
      answer,
    ).json();
    expect(body).toMatchObject({
      template: {
        outputs: [
          { simpleText: { text: expect.stringContaining("운영규정 버전 1") } },
          { textCard: { description: expect.stringContaining("시간이 지나 새 카드를 보내 드려요") } },
        ],
      },
    });
  });
  it("규정 투영이 없는 옛 주문 요청 카드는 동의 버튼을 단독으로 내보내지 않는다", async () => {
    const card = await activeOrderCard();
    const legacy = Object.assign({}, card, { kind: "order_request", orderRequest: undefined });
    expect(() => kakaoMessageOutputs([legacy])).toThrow();
  });
  it("견적과 규정이 준비되지 않은 초안에는 동의 카드를 저장하지 않는다", async () => {
    const draft = (
      await db.query<{ id: string }>("INSERT INTO order_drafts(shop_id,consultation_id) VALUES($1,$2) RETURNING id", [
        shop.shopId,
        shop.consultationId,
      ])
    ).rows[0];
    await expect(
      showConfirmCard(scoped(), {
        customerId: shop.customerId,
        consultationId: shop.consultationId,
        kind: "order_request",
        draftId: draft?.id ?? "",
        now: NOW,
      }),
    ).rejects.toThrow();
    expect((await db.query("SELECT 1 FROM confirm_cards WHERE shop_id=$1", [shop.shopId])).rowCount).toBe(0);
  });
  it("규정 두 글과 카드 세 칸을 다음 대화에서 통째로 전달한 뒤에만 전함으로 남긴다", async () => {
    const sourceMessageId = crypto.randomUUID();
    await activeOrderCard(sourceMessageId);
    for (let i = 0; i < 5; i++)
      await db.query(
        "INSERT INTO rule_clauses (shop_id,operating_rules_id,clause_key,position,title,condition_text,effect_text) VALUES($1,$2,'custom',$3,$4,$5,$6)",
        [shop.shopId, shop.operatingRulesId, i + 3, `합성 조문${i}`, "조건".repeat(70), "효과".repeat(70)],
      );
    // 서버가 저장한 카드의 원본 규정 문맥도 갱신해 긴 규정 버전의 전달 자료를 만든다.
    await db.query("DELETE FROM confirm_cards WHERE shop_id=$1", [shop.shopId]);
    await showConfirmCard(scoped(), {
      customerId: shop.customerId,
      consultationId: shop.consultationId,
      kind: "order_request",
      draftId: shop.draftId,
      sourceMessageId,
      now: NOW,
    });
    await db.query(
      "UPDATE consultations SET ai_disclosed_at=$3,ai_disclosed_policy_version=1 WHERE shop_id=$1 AND id=$2",
      [shop.shopId, shop.consultationId, NOW],
    );
    const pending = (
      await db.query<{ id: string }>(
        "INSERT INTO messages(shop_id,consultation_id,direction,author,kind,body_masked,delivery,trace_id,created_at) VALUES($1,$2,'outbound','system','card','주문 요청 확인','deferred',$3,$4) RETURNING id",
        [shop.shopId, shop.consultationId, sourceMessageId, NOW],
      )
    ).rows[0];
    const response = await replyWithDeferredKakaoMessages(scoped(), shop.customerId, NOW, (previous) =>
      kakaoReply(
        { json: (value, status = 200, headers = {}) => Response.json(value, { status, headers }) },
        "ai_unavailable",
        { previous },
      ),
    );
    const body = (await response.json()) as {
      template: { outputs: { simpleText?: { text: string }; textCard?: unknown }[] };
    };
    expect(body.template.outputs).toHaveLength(3);
    expect(body.template.outputs[0]).toHaveProperty("simpleText");
    expect(body.template.outputs[1]?.simpleText?.text).toContain("미성년자가");
    expect(body.template.outputs[2]).toHaveProperty("textCard");
    expect(
      (await db.query("SELECT delivery,sent_at FROM messages WHERE shop_id=$1 AND id=$2", [shop.shopId, pending?.id]))
        .rows[0],
    ).toMatchObject({ delivery: "delivered_later", sent_at: NOW });
  });
});
