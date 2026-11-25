import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { sealAccountNumber } from "../src/account-number";
import { createApp } from "../src/app";
import { consumeKakaoCallback } from "../src/kakao-callback-queue";
import type { KakaoCallbackJob } from "../src/kakao-callback-store";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { expectSchema } from "./support/contract";
import { describeDb, newUuid, TEST_HASH_KEY, testEnv } from "./support/db";
import { singleKeyCrypto } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-25T00:00:00Z"),
  HOUR = 3600000,
  ACCOUNT = "123456789012";
describeDb("다음 대화의 결제 안내 전달(TASK-104)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture, id: string, key: string;
  let clock: Date, jobs: KakaoCallbackJob[];
  const { fc, keys } = singleKeyCrypto();
  const fieldKey = keys.get(1);
  if (fieldKey === undefined) throw new Error("missing synthetic field key");
  const env = testEnv({ FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: fieldKey });
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    clock = NOW;
    jobs = [];
    shop = await createShop(isolated.db, "합성 다음 결제 안내 가게");
    await issueTestBookingLink(isolated.db, shop);
    await linkTestChannel(isolated.db, shop.channelId);
    key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
    const sealed = await sealAccountNumber(fc, ACCOUNT, "payment_accounts.account_number", shop.shopId);
    await isolated.db.query("UPDATE payment_accounts SET account_number_enc=$2,account_last4=$3 WHERE id=$1", [
      shop.paymentAccountId,
      sealed.enc,
      sealed.last4,
    ]);
    await isolated.db.query(
      "UPDATE payment_requests SET delivered_at=NULL,issued_at=$2,due_at=$3,due_cap_at=$3 WHERE id=$1",
      [shop.paymentRequestId, new Date(NOW.getTime() - HOUR), new Date(NOW.getTime() + 24 * HOUR)],
    );
    id = newUuid();
    await isolated.db.query(
      "INSERT INTO notifications(id,shop_id,customer_id,consultation_id,order_id,kind,event_key,template_key,body,status) VALUES($1,$2,$3,$4,$5,'payment_request',$6,'payment_request:v1','결제 안내를 확인해 주세요','deferred')",
      [
        id,
        shop.shopId,
        shop.customerId,
        shop.consultationId,
        shop.orderId,
        `notice:${shop.paymentRequestId}:payment_request`,
      ],
    );
  });
  afterAll(async () => {
    await isolated?.close();
  });
  const call = (utterance: string, callbackUrl?: string) =>
    createApp({
      connect: () => isolated.connect(),
      services: {
        now: () => clock,
        fieldCrypto: fc,
        kakaoCallbackQueue: {
          send: async (job) => {
            jobs.push(job);
          },
        },
      },
      logSink: () => {},
    }).request(
      "/api/kakao/skills/message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
        body: JSON.stringify({
          bot: { id: shop.botId },
          userRequest: {
            utterance,
            ...(callbackUrl ? { callbackUrl } : {}),
            block: { id: "conversation" },
            user: { id: shop.userKey, type: "botUserKey" },
          },
          action: { id: "synthetic-payment-notice", params: {} },
        }),
      },
      env,
    );
  const state = async () =>
    (await isolated.db.query("SELECT delivered_at,due_at FROM payment_requests WHERE id=$1", [shop.paymentRequestId]))
      .rows[0];
  it("친구 아닌 손님에게 계좌 안내를 먼저 전한 때부터 기한을 세고 평문을 대화에 저장하지 않는다", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("합성 시험 실제 발신 금지"));
    try {
      const value = await (await call("합성 결제 안내 첫 질문")).json();
      expectSchema("SkillTemplateResponse", value);
      expect(JSON.stringify(value)).toContain(ACCOUNT);
      expect(await state()).toEqual({ delivered_at: NOW, due_at: new Date(NOW.getTime() + 12 * HOUR) });
      expect((await isolated.db.query("SELECT status,sent_at,body FROM notifications WHERE id=$1", [id])).rows).toEqual(
        [{ status: "delivered_on_reply", sent_at: NOW, body: "결제 안내를 확인해 주세요" }],
      );
      expect(JSON.stringify(await (await call("합성 결제 안내 둘째 질문")).json())).not.toContain(ACCOUNT);
      expect(
        JSON.stringify(
          (await isolated.db.query("SELECT body_masked FROM messages WHERE shop_id=$1", [shop.shopId])).rows,
        ),
      ).not.toContain(ACCOUNT);
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  });
  it("콜백 전송이 실패하면 결제 시계를 보존하고 다음 즉시 응답에서 처음 전달한다", async () => {
    const ack = await call(
      "합성 결제 안내 콜백 질문",
      "https://bot-api.kakao.com/v1/callback/synthetic_payment_notice",
    );
    expect(ack.headers.get("Siljang-Outcome")).toBe("callback_pending");
    expect((await state())?.delivered_at).toBeNull();
    const send = vi.fn<typeof fetch>(async () => new Response(null, { status: 503 }));
    clock = new Date(NOW.getTime() + 5000);
    expect(
      await consumeKakaoCallback(jobs[0], env, {
        connect: () => isolated.connect(),
        services: { fieldCrypto: fc },
        now: () => clock,
        fetch: send,
        logSink: () => {},
      }),
    ).toBe("done");
    expect(String(send.mock.calls[0]?.[1]?.body)).toContain(ACCOUNT);
    expect((await state())?.delivered_at).toBeNull();
    clock = new Date(NOW.getTime() + 10000);
    expect(JSON.stringify(await (await call("합성 콜백 실패 뒤 결제 안내 질문")).json())).toContain(ACCOUNT);
    expect(await state()).toEqual({ delivered_at: clock, due_at: new Date(clock.getTime() + 12 * HOUR) });
  });
});
