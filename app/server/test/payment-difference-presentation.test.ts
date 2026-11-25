import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { createPaymentRequestNotice } from "../src/customer-notice-store";
import { consumeKakaoCallback } from "../src/kakao-callback-queue";
import type { KakaoCallbackJob } from "../src/kakao-callback-store";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { expectSchema } from "./support/contract";
import { describeDb, newUuid, TEST_HASH_KEY, testEnv } from "./support/db";
import { newFieldKey } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-26T00:00:00Z");
const FIELD_KEY = newFieldKey();
describeDb("저장된 차액의 새 금액 확인 표시(TASK-106)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture, key: string;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    shop = await createShop(isolated.db, "합성 차액 표시 가게");
    await issueTestBookingLink(isolated.db, shop);
    await linkTestChannel(isolated.db, shop.channelId);
    key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
  });
  afterAll(async () => {
    await isolated?.close();
  });
  it.each([
    ["event", "short"],
    ["message", "short"],
    ["event", "long"],
    ["message", "long"],
    ["callback", "short"],
    ["callback", "long"],
  ] as const)("실제 저장 행의 변경 내용/금액/마감과 두 버튼을 보인다(%s/%s)", async (mode, length) => {
    const changeId = newUuid(),
      changeCard = newUuid(),
      amountCard = newUuid(),
      paymentId = newUuid(),
      paid = newUuid();
    const cardKey = `ck_${amountCard}`;
    const changes =
      length === "short"
        ? { lettering: "합성 바꾼 문구", colors: "합성 분홍" }
        : {
            size: "크".repeat(30),
            flavor: "맛".repeat(30),
            design: "도".repeat(30),
            designNotes: "가".repeat(500),
            lettering: "나".repeat(50),
            colors: "다".repeat(100),
            extras: Array.from({ length: 20 }, (_, i) => `${i}`.padStart(2, "0") + "라".repeat(28)),
            courierPickup: false,
          };
    await isolated.db.transaction(async (tx) => {
      await tx.query(
        "UPDATE payment_requests SET status='paid',paid_at=$2,arrived_at=$2,arrived_amount=amount WHERE id=$1",
        [shop.paymentRequestId, NOW],
      );
      await tx.query(
        "INSERT INTO payments(id,shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES($1,$2,$3,$4,35000,$5)",
        [paid, shop.shopId, shop.orderId, shop.paymentRequestId, NOW],
      );
      await tx.query("UPDATE orders SET status='confirmed',confirmed_at=$2,confirmed_payment_id=$3 WHERE id=$1", [
        shop.orderId,
        NOW,
        paid,
      ]);
      for (const [id, kind] of [
        [changeCard, "change_request"],
        [amountCard, "amount_confirm"],
      ]) {
        await tx.query(
          "INSERT INTO confirm_cards(id,shop_id,consultation_id,customer_id,card_key,kind,order_id,order_version,payload,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,1,'{}',$8,$9)",
          [
            id,
            shop.shopId,
            shop.consultationId,
            shop.customerId,
            `ck_${id}`,
            kind,
            shop.orderId,
            NOW,
            new Date(NOW.getTime() + 1800000),
          ],
        );
      }
      await tx.query(
        "INSERT INTO change_requests(id,shop_id,order_id,card_id,base_version,changes,status,amount_delta,decided_at) VALUES($1,$2,$3,$4,1,$5::jsonb,'awaiting_difference',20000,$6)",
        [changeId, shop.shopId, shop.orderId, changeCard, JSON.stringify(changes), NOW],
      );
      await tx.query(
        "INSERT INTO payment_requests SELECT(jsonb_populate_record(NULL::payment_requests,to_jsonb(p)||$2::jsonb)).* FROM payment_requests p WHERE p.id=$1",
        [
          shop.paymentRequestId,
          JSON.stringify({
            id: paymentId,
            kind: "difference",
            change_request_id: changeId,
            event_key: `pay:${changeId}:difference`,
            status: "open",
            amount: 20000,
            requested_amount: null,
            needs_amount_confirm: true,
            amount_confirmed_at: null,
            amount_card_id: amountCard,
            delivered_at: null,
            issued_at: NOW.toISOString(),
            due_at: new Date(NOW.getTime() + 86400000).toISOString(),
            due_cap_at: new Date(NOW.getTime() + 86400000).toISOString(),
            paid_at: null,
            arrived_at: null,
            arrived_amount: null,
          }),
        ],
      );
    });
    const scoped = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "payment_notice" }), isolated.db);
    const notice = await scoped.transaction((tx) => createPaymentRequestNotice(tx, paymentId, NOW));
    if (!notice) throw new Error("합성 차액 안내 없음");
    await isolated.db.query("UPDATE notifications SET status='deferred' WHERE id=$1", [notice.id]);
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("합성 표시 시험에서 실제 발신 금지"));
    try {
      const jobs: KakaoCallbackJob[] = [];
      const env = testEnv({ FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: FIELD_KEY });
      const response = await createApp({
        connect: () => isolated.connect(),
        services: {
          now: () => NOW,
          kakaoCallbackQueue: {
            send: async (job) => {
              jobs.push(job);
            },
          },
        },
        logSink: () => {},
      }).request(
        `/api/kakao/skills/${mode === "callback" ? "message" : mode}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
          body: JSON.stringify({
            bot: { id: shop.botId },
            userRequest: {
              utterance: mode !== "event" ? "합성 차액 안내 확인" : "",
              ...(mode === "callback"
                ? { callbackUrl: "https://bot-api.kakao.com/v1/callback/synthetic_difference" }
                : {}),
              params: mode === "event" ? { noticeKey: notice.id } : {},
              block: { id: "conversation" },
              user: { id: shop.userKey, type: "botUserKey" },
            },
            action: { id: "synthetic-difference-display", params: {} },
          }),
        },
        env,
      );
      expect(response.status).toBe(200);
      let body = await response.json();
      if (mode === "callback") {
        const send = vi.fn<typeof fetch>(async (_url, init) => {
          body = JSON.parse(String(init?.body));
          return Response.json({ status: "SUCCESS" });
        });
        expect(jobs).toHaveLength(1);
        expect(
          await consumeKakaoCallback(jobs[0], env, {
            connect: () => isolated.connect(),
            now: () => new Date(NOW.getTime() + 1000),
            fetch: send,
          }),
        ).toBe("done");
        expect(send).toHaveBeenCalledTimes(1);
      }
      expectSchema("SkillTemplateResponse", body);
      const shown = JSON.stringify(body);
      const renderedText = (
        body as { template: { outputs: ({ simpleText: { text: string } } | { textCard: { description: string } })[] } }
      ).template.outputs
        .map((output) => ("simpleText" in output ? output.simpleText.text : output.textCard.description))
        .join("");
      for (const text of [
        "지금 35,000원",
        "새 금액 55,000원",
        "차액 20,000원",
        "변경 마감",
        "바꿀게요",
        "그대로 둘래요",
        cardKey,
        changes.lettering,
        changes.colors,
      ])
        expect(shown).toContain(text);
      if (length === "long") {
        expect(renderedText).toContain(changes.designNotes);
        for (const extra of changes.extras ?? []) expect(renderedText).toContain(extra);
      }
      for (const text of ["이 금액으로 할게요", "계좌번호", "010-0000-0000", shop.customerId, changeId, paymentId])
        expect(shown).not.toContain(text);
      expect(
        (
          await isolated.db.query("SELECT delivered_at,amount_confirmed_at FROM payment_requests WHERE id=$1", [
            paymentId,
          ])
        ).rows,
      ).toEqual([{ delivered_at: null, amount_confirmed_at: null }]);
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  });
});
