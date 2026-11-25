import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import {
  type ConfirmCardCommand,
  prepareConfirmCardInTransaction,
  readConfirmCardDelivery,
  showConfirmCard,
} from "../src/confirm-card-store";
import { createPaymentRequestNotice } from "../src/customer-notice-store";
import { deliverKakaoCallback } from "../src/kakao-callback";
import { kakaoConsultationMessage } from "../src/kakao-consultation-message";
import { deferredKakaoBatch, deferredKakaoTexts } from "../src/kakao-deferred";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { expectSchema } from "./support/contract";
import { describeDb, newUuid, TEST_HASH_KEY, testEnv } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-26T01:00:00Z");
describeDb("입금자 전용 블록의 표시와 명령 경계(TASK-107)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture, key: string, clock: Date;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    clock = NOW;
    shop = await createShop(isolated.db, "합성 입금자 입력 가게");
    await issueTestBookingLink(isolated.db, shop);
    await linkTestChannel(isolated.db, shop.channelId);
    key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
    await isolated.db.query(
      "UPDATE payment_requests SET issued_at=$2,delivered_at=$2,due_at=$3,due_cap_at=$4 WHERE id=$1",
      [shop.paymentRequestId, NOW, new Date(NOW.getTime() + 43200000), new Date(NOW.getTime() + 86400000)],
    );
  });
  afterAll(async () => {
    await isolated?.close();
  });
  const show = (kind: "payment_claim" | "cancel" = "payment_claim", sourceMessageId?: string) =>
    showConfirmCard(shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }), isolated.db), {
      customerId: shop.customerId,
      consultationId: shop.consultationId,
      kind,
      ...(sourceMessageId === undefined ? {} : { sourceMessageId }),
      orderId: shop.orderId,
      now: NOW,
    });
  const state = async () => ({
    cards: (
      await isolated.db.query("SELECT id,used_at,outcome,payload FROM confirm_cards WHERE shop_id=$1 ORDER BY id", [
        shop.shopId,
      ])
    ).rows,
    payments: (await isolated.db.query("SELECT * FROM payment_requests WHERE shop_id=$1 ORDER BY id", [shop.shopId]))
      .rows,
    messages: (await isolated.db.query("SELECT * FROM messages WHERE shop_id=$1 ORDER BY id", [shop.shopId])).rows,
  });
  async function call(
    cardKey: string,
    value: unknown,
    execute: ConfirmCardCommand,
    blockId = "depositor",
    userId = shop.userKey,
  ) {
    const logs: unknown[] = [];
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("합성 카드 시험에서 실제 발신 금지"));
    try {
      const response = await createApp({
        connect: () => isolated.connect(),
        services: { now: () => clock, confirmCardCommand: execute },
        logSink: (line) => {
          logs.push(line);
        },
      }).request(
        "/api/kakao/skills/card",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
          body: JSON.stringify({
            bot: { id: shop.botId },
            userRequest: {
              utterance: typeof value === "string" && !value.includes("\0") ? value : "합성 입금자 입력",
              block: { id: blockId },
              user: { id: userId, type: "botUserKey" },
            },
            action: {
              id: "synthetic-depositor-input",
              params: value === undefined ? {} : { depositor_name: value },
              clientExtra: { cardKey, choice: "confirm" },
            },
          }),
        },
        testEnv(),
      );
      expect(network).not.toHaveBeenCalled();
      return { response, logs };
    } finally {
      network.mockRestore();
    }
  }
  it.each([undefined, "", "   ", "가".repeat(31), "🎂".repeat(31), null, 123, "합성\0입금자"])(
    "잘못된 입금자 값은 아무것도 쓰지 않고 같은 전용 버튼으로 다시 묻는다(%j)",
    async (value) => {
      const card = await show(),
        before = await state(),
        execute = vi.fn<ConfirmCardCommand>();
      const { response, logs } = await call(card.cardKey, value, execute);
      expect(response.status).toBe(200);
      expect(response.headers.get("Siljang-Outcome")).toBe("input_invalid");
      const body = await response.json();
      expectSchema("SkillTemplateResponse", body);
      expect(body).toMatchObject({
        template: {
          outputs: [
            {
              textCard: {
                description: "입금자 이름은 1~30자로 넣어 주세요",
                buttons: [{ label: "입금자 이름 넣기", blockId: "depositor", extra: { cardKey: card.cardKey } }],
              },
            },
          ],
        },
      });
      expect(await state()).toEqual(before);
      expect(execute).not.toHaveBeenCalled();
      for (const content of [JSON.stringify(body), JSON.stringify(logs)]) {
        expect(content).not.toContain("시험손님");
        if (typeof value === "string" && value.trim().length > 3) expect(content).not.toContain(value);
      }
    },
  );
  it.each(["합성 전용 입금자", "🎂".repeat(30)])(
    "유효한 전용 입력만 명령에 전달하고 저장 카드/메시지/로그에는 남기지 않는다(%s)",
    async (value) => {
      const card = await show();
      const execute = vi.fn<ConfirmCardCommand>(async () => ({
        outcome: "payment_claimed",
        text: "사장님께 알렸어요. 확인되면 알려 드릴게요",
      }));
      const { response, logs } = await call(card.cardKey, value, execute);
      expect(response.headers.get("Siljang-Outcome")).toBe("payment_claimed");
      const body = await response.json();
      expectSchema("SkillTemplateResponse", body);
      expect(execute).toHaveBeenCalledOnce();
      expect(execute.mock.calls[0]?.[1]).toMatchObject({
        kind: "payment_claim",
        orderId: shop.orderId,
        depositorName: value,
      });
      expect(JSON.stringify(await state())).not.toContain(value);
      expect(JSON.stringify(logs)).not.toContain(value);
      expect(JSON.stringify(body)).not.toContain(value);
      const again = await call(card.cardKey, value, execute);
      expect(again.response.headers.get("Siljang-Outcome")).toBe("card_used");
      expect(await again.response.json()).toEqual(body);
      expect(execute).toHaveBeenCalledOnce();
    },
  );
  it("일반 카드 블록에 넣은 입금자 값은 명령의 이름을 바꾸지 않는다", async () => {
    const card = await show();
    const execute = vi.fn<ConfirmCardCommand>(async () => ({
      outcome: "payment_claimed",
      text: "사장님께 알렸어요. 확인되면 알려 드릴게요",
    }));
    const { response } = await call(card.cardKey, "합성 넣어 바꾼 이름", execute, "blk-card");
    expect(response.headers.get("Siljang-Outcome")).toBe("payment_claimed");
    expect(execute.mock.calls[0]?.[1]).not.toHaveProperty("depositorName");
  });
  it("전용 블록으로 다른 종류의 카드를 실행하거나 다른 사용자의 카드를 누르지 못한다", async () => {
    const card = await show("cancel"),
      execute = vi.fn<ConfirmCardCommand>(),
      before = await state();
    const first = await call(card.cardKey, "합성 입금자", execute);
    const second = await call(card.cardKey, "합성 입금자", execute, "depositor", "합성 다른 사용자");
    expect(first.response.headers.get("Siljang-Outcome")).toBe("card_not_yours");
    expect(await second.response.json()).toEqual(await first.response.json());
    expect(await state()).toEqual(before);
    expect(execute).not.toHaveBeenCalled();
  });
  it("전용 이름 입력도30분 정각이면 새 카드이며 명령을 실행하지 않는다", async () => {
    const card = await show(),
      execute = vi.fn<ConfirmCardCommand>();
    clock = new Date(NOW.getTime() + 1800000);
    const { response } = await call(card.cardKey, "", execute);
    expect(response.headers.get("Siljang-Outcome")).toBe("card_expired");
    expect(JSON.stringify(await response.json())).toContain("시간이 지나 새 카드를 보내 드려요");
    expect(execute).not.toHaveBeenCalled();
  });
  it("전달 뒤 결제 시계가 시작됐어도 잘못된 이름은 카드 결합 자료를 쓰지 않는다", async () => {
    await isolated.db.query("UPDATE payment_requests SET delivered_at=NULL,due_at=due_cap_at WHERE id=$1", [
      shop.paymentRequestId,
    ]);
    const card = await show();
    await isolated.db.query("UPDATE payment_requests SET delivered_at=$2,due_at=$3 WHERE id=$1", [
      shop.paymentRequestId,
      NOW,
      new Date(NOW.getTime() + 43200000),
    ]);
    const before = await state(),
      execute = vi.fn<ConfirmCardCommand>();
    const { response } = await call(card.cardKey, "", execute);
    expect(response.headers.get("Siljang-Outcome")).toBe("input_invalid");
    expect(await state()).toEqual(before);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(["press", "prepare", "replay", "deferred", "callback"] as const)(
    "새 금액 미확인의 결제 확인 표시는 기존 새 금액 카드로 바뀐다(%s)",
    async (mode) => {
      const sourceMessageId = newUuid();
      const original = await show("payment_claim", sourceMessageId);
      const amountId = newUuid(),
        amountKey = `ck_${amountId}`;
      await isolated.db.query(
        "INSERT INTO confirm_cards(id,shop_id,consultation_id,customer_id,card_key,kind,order_id,order_version,payload,created_at,expires_at) VALUES($1,$2,$3,$4,$5,'amount_confirm',$6,2,'{}',$7,$8)",
        [
          amountId,
          shop.shopId,
          shop.consultationId,
          shop.customerId,
          amountKey,
          shop.orderId,
          NOW,
          new Date(NOW.getTime() + 1800000),
        ],
      );
      await isolated.db.query(
        "INSERT INTO order_details SELECT(jsonb_populate_record(NULL::order_details,to_jsonb(d)||$2::jsonb)).* FROM order_details d WHERE d.order_id=$1 AND d.version=1",
        [
          shop.orderId,
          JSON.stringify({
            id: newUuid(),
            version: 2,
            source: "owner_amount_change",
            amount: 55000,
            amount_change_reason: "합성 장식을 추가해요",
          }),
        ],
      );
      await isolated.db.query(
        "UPDATE orders SET kind='custom',version=2,amount=55000,accepted_at=$2,accepted_version=2 WHERE id=$1",
        [shop.orderId, NOW],
      );
      await isolated.db.query(
        "UPDATE payment_requests SET amount=55000,requested_amount=35000,needs_amount_confirm=true,amount_confirmed_at=NULL,delivered_at=NULL,due_at=due_cap_at,amount_card_id=$2 WHERE id=$1",
        [shop.paymentRequestId, amountId],
      );
      const scoped = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }), isolated.db);
      const notice = await scoped.transaction((tx) => createPaymentRequestNotice(tx, shop.paymentRequestId, NOW));
      if (!notice) throw new Error("합성 금액 확인 안내 없음");
      // 새 안내의 전달과 별개로, 이미 보인 결제 확인 카드 자체를 다시 읽는 경로를 가른다.
      await isolated.db.query("UPDATE notifications SET status='delivered_on_reply',sent_at=$2 WHERE id=$1", [
        notice.id,
        NOW,
      ]);
      const beforePayment = (await state()).payments;
      const execute = vi.fn<ConfirmCardCommand>();
      let body: unknown;
      if (mode === "press") {
        const result = await call(original.cardKey, "", execute, "blk-card");
        expect(result.response.headers.get("Siljang-Outcome")).toBe("not_allowed_now");
        body = await result.response.json();
      } else if (mode === "prepare") {
        const prepared = await scoped.transaction((tx) =>
          prepareConfirmCardInTransaction(tx, {
            customerId: shop.customerId,
            consultationId: shop.consultationId,
            orderId: shop.orderId,
            kind: "payment_claim",
            sourceMessageId: newUuid(),
            now: NOW,
          }),
        );
        expect(prepared).not.toHaveProperty("unavailable");
        if ("unavailable" in prepared) throw new Error("새 금액 카드가 필요한데 고정 문구만 반환함");
        body = kakaoConsultationMessage({ state: "normal", contents: [prepared] });
      } else if (mode === "deferred") {
        await isolated.db.query("UPDATE consultations SET ai_disclosed_at=$2 WHERE id=$1", [shop.consultationId, NOW]);
        await isolated.db.query(
          "INSERT INTO messages(id,shop_id,consultation_id,direction,author,kind,trace_id,body_masked,delivery,created_at) VALUES($1,$2,$3,'outbound','system','card',$4,'결제 확인 요청','deferred',$5)",
          [newUuid(), shop.shopId, shop.consultationId, sourceMessageId, NOW],
        );
        const batch = await scoped.transaction((tx) => deferredKakaoBatch(tx, shop.customerId, { now: NOW }));
        body = kakaoConsultationMessage({ state: "normal", contents: deferredKakaoTexts(batch.messages) });
      } else {
        const delivery = await scoped.transaction((tx) =>
          readConfirmCardDelivery(tx, {
            customerId: shop.customerId,
            consultationId: shop.consultationId,
            sourceMessageId,
            now: NOW,
          }),
        );
        const contents = [delivery.card ?? delivery.text];
        body = kakaoConsultationMessage({ state: "normal", contents });
        if (mode === "callback") {
          const expected = body;
          expect(
            await deliverKakaoCallback(
              { url: new URL("https://bot-api.kakao.com/v1/callback/synthetic_amount_redirect"), deadline: 10000 },
              contents,
              {
                now: () => 100,
                fetch: async (_url, init) => {
                  body = JSON.parse(String(init?.body));
                  return Response.json({ status: "SUCCESS" });
                },
              },
            ),
          ).toBe("delivered");
          expect(body).toEqual(expected);
        }
      }
      expectSchema("SkillTemplateResponse", body);
      const shown = JSON.stringify(body);
      for (const text of [
        "새 금액 확인",
        "요청하신 견적 35,000원",
        "55,000원",
        "합성 장식을 추가해요",
        "이 금액으로 할게요",
        "안 할래요",
        amountKey,
      ])
        expect(shown).toContain(text);
      for (const text of ["결제 확인 요청", "입금자 이름이 달라요", "시험손님", "계좌번호", original.cardKey])
        expect(shown).not.toContain(text);
      expect((await state()).payments).toEqual(beforePayment);
      expect(execute).not.toHaveBeenCalled();
      expect(JSON.stringify((await state()).cards)).not.toContain("시험손님");
    },
  );
});
