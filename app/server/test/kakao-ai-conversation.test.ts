import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { recordAiCall } from "../src/ai-calls";
import * as conversation from "../src/ai-conversation";
import type { AiModel } from "../src/ai-model";
import { createApp } from "../src/app";
import { FieldCryptoError, fieldCrypto } from "../src/field-crypto";
import { createHandoffTask } from "../src/handoff-task";
import { consumeKakaoCallback } from "../src/kakao-callback-queue";
import type { KakaoCallbackJob, KakaoCallbackQueue } from "../src/kakao-callback-store";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { openMaskedValue } from "../src/masked-values";
import type { ServiceOverrides } from "../src/services";
import { readSettings, Secret } from "../src/settings";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { describeDb, newUuid, TEST_HASH_KEY, testEnv } from "./support/db";
import { newFieldKey } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-23T10:00:00+09:00");
describeDb("AI에 보내는 최근 대화와 출력 마스킹(TASK-066)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture, key: string;
  let now = NOW;
  const env = testEnv({ FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: newFieldKey() });
  const jobs: KakaoCallbackJob[] = [];
  const enqueue = vi.fn<KakaoCallbackQueue["send"]>(async (job) => {
    jobs.push(job);
  });
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    now = NOW;
    jobs.length = 0;
    enqueue.mockClear();
    shop = await createShop(isolated.db, "합성 수신 가게");
    await issueTestBookingLink(isolated.db, shop);
    await linkTestChannel(isolated.db, shop.channelId);
    key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("합성 수신 시험에서 실제 외부 호출 금지"));
  });
  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await isolated?.close();
  });

  async function send(user: string, utterance: string, friend?: boolean, target = shop, suppliedKey = key) {
    return createApp({
      connect: () => isolated.connect(),
      services: { now: () => now, kakaoCallbackQueue: { send: enqueue } },
      logSink: () => {},
    }).request(
      "/api/kakao/skills/message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Siljang-Skill-Key": suppliedKey },
        body: JSON.stringify({
          bot: { id: target.botId },
          userRequest: {
            utterance,
            callbackUrl: "https://bot-api.kakao.com/v1/callback/synthetic_input",
            block: { id: "input" },
            user: {
              id: user,
              type: "botUserKey",
              ...(friend === undefined ? {} : { properties: { isFriend: friend } }),
            },
          },
          action: { id: "input", params: {} },
        }),
      },
      env,
    );
  }
  function model() {
    const call = vi.fn<AiModel["call"]>(async (input) => {
      const aiCallId = await recordAiCall(input.db, {
        consultationId: input.consultationId,
        traceId: input.traceId,
        attempt: input.attempt,
        provider: "anthropic",
        model: "claude-haiku-5-5",
        promptVersion: input.promptVersion,
        reasoning: {},
        sentAt: now,
        firstTokenMs: 0,
        totalMs: 1,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        cost: { usd: "0.00", krw: "0.00", basis: "synthetic" },
        result: "success",
        stopReason: null,
        errorKind: null,
        fallbackReason: null,
      });
      return { ok: true, aiCallId, output: { reply: "합성 질문을 확인했어요." } };
    });
    return { provider: "anthropic" as const, model: "claude-haiku-5-5", call };
  }
  async function consume(job: KakaoCallbackJob, aiModel: ReturnType<typeof model>, overrides: ServiceOverrides = {}) {
    // 첫 고지 자체는 TASK-064가 맡는다. 이 시험은 고지를 마친 상담의 입력 경계만 확인한다.
    await isolated.db.query(
      `UPDATE consultations SET ai_disclosed_at = $3, ai_disclosed_policy_version = 1
      WHERE shop_id = $1 AND id = (SELECT consultation_id FROM messages WHERE shop_id = $1 AND id = $2)`,
      [shop.shopId, job.messageId, now],
    );
    const callback = vi.fn<typeof fetch>(async () => Response.json({ status: "SUCCESS" }));
    const outcome = await consumeKakaoCallback(job, env, {
      connect: () => isolated.connect(),
      now: () => new Date(now.getTime() + 1000),
      fetch: callback,
      services: { aiModel, ...overrides },
      logSink: () => {},
    });
    expect(outcome).toBe("done");
    expect(callback).toHaveBeenCalledOnce();
    return callback;
  }

  function required<T>(value: T | null | undefined): T {
    if (value === null || value === undefined) throw new Error("합성 시험 자료가 없어요");
    return value;
  }
  it("결제 확인 카드는 모델 출력 뒤 이름을 붙여 전송하고 AI 입력·메시지·카드 저장에는 이름이 없음", async () => {
    const name = "합성결제표시전용손님";
    await isolated.db.query("UPDATE order_details SET customer_name=$2 WHERE order_id=$1", [shop.orderId, name]);
    const ai = model();
    const original = required(ai.call.getMockImplementation());
    ai.call.mockImplementationOnce(async (input) => {
      const result = await original(input);
      if (!result.ok) return result;
      return { ...result, output: { reply: "합성 카드 제안", card: { kind: "payment_claim" } } };
    });
    await send(shop.userKey, "입금했어요");
    const callback = await consume(required(jobs[0]), ai);
    const body = String(required(callback.mock.calls[0])[1]?.body);
    expect(body).toContain(name);
    expect(body).toContain("입금자 이름이 달라요");
    expect(JSON.stringify(required(ai.call.mock.calls[0])[0].messages)).not.toContain(name);
    const saved = await isolated.db.query(
      "SELECT payload::text AS value FROM confirm_cards WHERE shop_id=$1 UNION ALL SELECT body_masked FROM messages WHERE shop_id=$1",
      [shop.shopId],
    );
    expect(JSON.stringify(saved.rows)).not.toContain(name);
    expect(ai.call).toHaveBeenCalledOnce();
  });
  async function withQuote(mode = "valid") {
    const ai = model();
    await send(newUuid(), "현재 견적의 합성 질문");
    const job = required(jobs[0]);
    const consultation = required(
      (
        await isolated.db.query<{ consultation_id: string }>("SELECT consultation_id FROM messages WHERE id=$1", [
          job.messageId,
        ])
      ).rows[0],
    );
    const draftId = newUuid();
    await isolated.db.query(
      "INSERT INTO order_drafts (id,shop_id,consultation_id,price_list_id,revision,created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [draftId, shop.shopId, consultation.consultation_id, shop.priceListId, mode === "stale" ? 2 : 1, NOW],
    );
    let quotePriceId = shop.priceListId;
    if (mode === "current_price") {
      quotePriceId = newUuid();
      await isolated.db.query("UPDATE price_lists SET superseded_at=$2 WHERE id=$1", [shop.priceListId, NOW]);
      await isolated.db.query("INSERT INTO price_lists (id,shop_id,version) VALUES ($1,$2,2)", [
        quotePriceId,
        shop.shopId,
      ]);
    }
    await isolated.db.query(
      "INSERT INTO quotes (shop_id,draft_id,draft_revision,price_list_id,operating_rules_id,order_kind,display_kind,amount,basis,quoted_at,valid_until) VALUES ($1,$2,1,$3,$4,'standard','fixed',45678,$5::jsonb,$6,$7)",
      [
        shop.shopId,
        draftId,
        quotePriceId,
        shop.operatingRulesId,
        JSON.stringify({ allergyAnswer: "땅콩", customerPhone: "010-7777-8888" }),
        new Date(NOW.getTime() - 7200000),
        mode === "expired" ? new Date(NOW.getTime() - 1) : new Date(NOW.getTime() + 72 * 3600000),
      ],
    );
    if (mode === "old_price") {
      await isolated.db.query("UPDATE price_lists SET superseded_at=$2 WHERE id=$1", [shop.priceListId, NOW]);
      await isolated.db.query("INSERT INTO price_lists (shop_id,version) VALUES ($1,2)", [shop.shopId]);
    }
    await consume(job, ai);
    return required(ai.call.mock.calls[0])[0].messages;
  }
  it.each(["valid", "current_price"])(
    "현재 유효 견적의 공개 계산값만 모델에 주고 근거의 개인정보는 읽지 않는다(%s)",
    async (mode) => {
      const messages = await withQuote(mode);
      const quote = required(
        messages.find((m) => m.role === "system" && m.content.startsWith("서버가 계산한 현재 견적: ")),
      );
      expect(JSON.parse(quote.content.slice("서버가 계산한 현재 견적: ".length))).toEqual({
        amount: 45678,
        amountMax: null,
        displayKind: "fixed",
        orderKind: "standard",
        validUntil: new Date(NOW.getTime() + 72 * 3600000).toISOString(),
      });
      expect(JSON.stringify(messages)).not.toContain("땅콩");
      expect(JSON.stringify(messages)).not.toContain("010-7777-8888");
    },
  );
  it.each(["expired", "stale", "old_price"])("유효하지 않은 견적은 모델 문맥에 넣지 않는다(%s)", async (mode) => {
    const messages = await withQuote(mode);
    expect(messages.some((m) => m.content.startsWith("서버가 계산한 현재 견적: "))).toBe(false);
    expect(JSON.stringify(messages)).not.toContain("45678");
  });
  it("사장님 넘김으로 폐기한 AI 답은 다음 모델 문맥에서 제외한다", async () => {
    const ai = model();
    await send(newUuid(), "폐기 뒤 현재 합성 질문");
    const job = required(jobs[0]),
      previousId = newUuid();
    const consultation = required(
      (
        await isolated.db.query<{ consultation_id: string }>("SELECT consultation_id FROM messages WHERE id=$1", [
          job.messageId,
        ])
      ).rows[0],
    );
    await isolated.db.query(
      "INSERT INTO messages (id,shop_id,consultation_id,direction,author,kind,kakao_message_id,body_masked,created_at) VALUES ($1,$2,$3,'inbound','customer','text',$4,'이전 합성 질문',$5)",
      [
        previousId,
        shop.shopId,
        consultation.consultation_id,
        `synthetic-previous:${previousId}`,
        new Date(NOW.getTime() - 2000),
      ],
    );
    await isolated.db.query(
      "INSERT INTO messages (shop_id,consultation_id,direction,author,kind,trace_id,body_masked,delivery,created_at) VALUES ($1,$2,'outbound','ai','text',$3,'폐기한 합성 AI 답','failed',$4)",
      [shop.shopId, consultation.consultation_id, previousId, new Date(NOW.getTime() - 1000)],
    );
    await consume(job, ai);
    const input = JSON.stringify(required(ai.call.mock.calls[0])[0].messages);
    expect(input).toContain("이전 합성 질문");
    expect(input).not.toContain("폐기한 합성 AI 답");
  });
  it("실제 수신부터 모델 입력까지 전화만 가리고 주문번호는 유지하며 같은 가게 사장님 범위에서 원본을 푼다", async () => {
    const user = newUuid(),
      ai = model();
    await send(user, "주문번호 K7Q3M9 연락처 010-1234-5678");
    const job = required(jobs[0]);
    await consume(job, ai);
    const input = JSON.stringify(required(ai.call.mock.calls[0])[0].messages);
    expect(input).toContain("K7Q3M9");
    expect(input).toContain("[전화번호1]");
    expect(input).not.toContain("010-1234-5678");
    expect(input).not.toContain("01012345678");
    const source = required(
      (
        await isolated.db.query<{ consultation_id: string }>("SELECT consultation_id FROM messages WHERE id=$1", [
          job.messageId,
        ])
      ).rows[0],
    );
    const fields = fieldCrypto(required(readSettings(env).fieldKeys));
    const owner = shopRequestDb(createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId }), isolated.db);
    expect(await openMaskedValue(owner, fields, source.consultation_id, "[전화번호1]")).toEqual({
      kind: "phone",
      original: "01012345678",
      last4: "5678",
    });
    const other = await createShop(isolated.db, "다른 원본 가게");
    const wrong = shopRequestDb(createShopScope(other.shopId, { kind: "owner", ownerId: other.ownerId }), isolated.db);
    await expect(openMaskedValue(wrong, fields, source.consultation_id, "[전화번호1]")).rejects.toMatchObject({
      code: "not_found",
    });
  });
  it("직접 친 표시자와 실제 번호를 함께 받아도 AI에는 인용과 마스킹을 구별해 보낸다", async () => {
    const ai = model();
    await send(newUuid(), "직접 쓴 [전화번호1] 연락처 010-1234-5678");
    const job = required(jobs[0]);
    await consume(job, ai);
    const messages = required(ai.call.mock.calls[0])[0].messages;
    expect(messages.find((message) => message.role === "user")?.content).toBe(
      "직접 쓴 ［전화번호1］ 연락처 [전화번호1]",
    );
    expect(JSON.stringify(messages)).not.toContain("010-1234-5678");
  });
  it("수신한 카드번호와 주민번호는 모델에서 가리고 원본을 보관하지 않는다", async () => {
    const ai = model();
    await send(newUuid(), "합성 카드 4111-1111-1111-1111 주민번호 900101-1234567");
    const job = required(jobs[0]);
    await consume(job, ai);
    const input = JSON.stringify(required(ai.call.mock.calls[0])[0].messages);
    expect(input).toContain("[카드번호1]");
    expect(input).toContain("[긴숫자1]");
    for (const raw of ["4111-1111-1111-1111", "4111111111111111", "900101-1234567", "9001011234567"])
      expect(input).not.toContain(raw);
    const rows = (
      await isolated.db.query(
        "SELECT kind,original_enc,value_hmac,last4 FROM masked_values WHERE consultation_id=(SELECT consultation_id FROM messages WHERE id=$1) ORDER BY kind",
        [job.messageId],
      )
    ).rows;
    expect(rows).toEqual([
      { kind: "card", original_enc: null, value_hmac: null, last4: "1111" },
      { kind: "long_number", original_enc: null, value_hmac: null, last4: null },
    ]);
  });
  it("같은 상담의 최근20차례만 시간 순서로 보내고 다른 손님 대화는 넣지 않는다", async () => {
    const user = newUuid(),
      ai = model();
    await send(user, "지금 합성 질문");
    const job = required(jobs[0]);
    const row = required(
      (await isolated.db.query("SELECT consultation_id FROM messages WHERE id=$1", [job.messageId])).rows[0],
    );
    for (let i = 1; i <= 25; i++) {
      const id = newUuid(),
        at = new Date(NOW.getTime() - 60000 + i * 1000);
      await isolated.db.query(
        `INSERT INTO messages (id,shop_id,consultation_id,direction,author,kind,kakao_message_id,body_masked,created_at) VALUES ($1,$2,$3,'inbound','customer','text',$4,$5,$6)`,
        [id, shop.shopId, row.consultation_id, `synthetic:${id}`, `지난 합성 질문 ${i}번`, at],
      );
      await isolated.db.query(
        `INSERT INTO messages (shop_id,consultation_id,direction,author,kind,body_masked,trace_id,delivery,sent_at,created_at) VALUES ($1,$2,'outbound','ai','text',$3,$4,'callback',$5,$5)`,
        [shop.shopId, row.consultation_id, `지난 합성 답 ${i}번`, id, at],
      );
    }
    await isolated.db.query(
      `INSERT INTO messages (shop_id,consultation_id,direction,author,kind,body_masked,delivery,sent_at,created_at) VALUES ($1,$2,'outbound','ai','text','다른 손님 비공개 대화','callback',$3,$3)`,
      [shop.shopId, shop.consultationId, NOW],
    );
    await consume(job, ai);
    const input = JSON.stringify(required(ai.call.mock.calls[0])[0].messages);
    expect(input).toContain("지난 합성 질문 7번");
    expect(input).toContain("지난 합성 답 25번");
    expect(input).toContain("지금 합성 질문");
    expect(input).not.toContain("지난 합성 질문 6번");
    expect(input).not.toContain("다른 손님 비공개 대화");
    expect(input.indexOf("지난 합성 질문 7번")).toBeLessThan(input.indexOf("지난 합성 질문 25번"));
  });
  it("AI 답의 마스킹 플레이스홀더는 원래 값으로 풀지 않고 제거해 저장하고 보낸다", async () => {
    const ai = model(),
      invoke = required(ai.call.getMockImplementation());
    ai.call.mockImplementationOnce(async (input) => {
      const reply = await invoke(input);
      if (!reply.ok) throw new Error("합성 답 실패");
      return { ...reply, output: { reply: "[전화번호1] [계좌번호2] [카드번호3] [긴숫자4] 사장님께 확인해 주세요." } };
    });
    await send(newUuid(), "합성 출력 검사");
    const job = required(jobs[0]);
    const callback = await consume(job, ai);
    const body = JSON.parse(String(callback.mock.calls[0]?.[1]?.body));
    const text = body.template.outputs[0]?.simpleText.text;
    expect(text).toBe("사장님께 확인해 주세요.");
    const rows = (
      await isolated.db.query("SELECT body_masked FROM messages WHERE shop_id=$1 AND trace_id=$2 AND author='ai'", [
        shop.shopId,
        job.messageId,
      ])
    ).rows;
    expect(rows).toEqual([{ body_masked: "사장님께 확인해 주세요." }]);
  });

  it("현재 초안의 필요한 문구만 보내고 전용 주문자·연락처·알레르기 값은 조회하지 않는다", async () => {
    const ai = model();
    await send(newUuid(), "초안이 있는 합성 질문");
    const job = required(jobs[0]);
    const row = required(
      (await isolated.db.query("SELECT consultation_id FROM messages WHERE id=$1", [job.messageId])).rows[0],
    );
    await isolated.db.query(
      `INSERT INTO order_drafts (shop_id,consultation_id,lettering,design_notes,customer_name,customer_phone,allergy_consent,allergy_consent_version,allergy_consent_at,allergy_answer) VALUES ($1,$2,'합성 축하 문구','전화 010-0000-5678을 디자인에 쓰고 싶어요','합성이지우','010-0000-1234','agreed','allergy-v1',$3,'땅콩')`,
      [shop.shopId, row.consultation_id, NOW],
    );
    await consume(job, ai);
    const input = JSON.stringify(required(ai.call.mock.calls[0])[0].messages);
    expect(input).toContain("합성 축하 문구");
    expect(input).toContain("[전화번호1]");
    for (const privateText of ["합성이지우", "010-0000-1234", "010-0000-5678", "땅콩", "allergyAnswer", "customerName"])
      expect(input).not.toContain(privateText);
    expect(
      (
        await isolated.db.query("SELECT customer_name,allergy_answer FROM order_drafts WHERE consultation_id=$1", [
          row.consultation_id,
        ])
      ).rows[0],
    ).toMatchObject({ customer_name: "합성이지우", allergy_answer: "땅콩" });
  });
  it("주문 요청 시각까지의 대화와 제출한 초안의 알레르기는 다음 주문 입력에서 제외한다", async () => {
    const ai = model();
    await isolated.db.query("UPDATE orders SET requested_at=$2 WHERE id=$1", [shop.orderId, NOW]);
    await isolated.db.query(
      "UPDATE order_drafts SET allergy_consent='agreed',allergy_consent_version='allergy-v1',allergy_consent_at=$2,allergy_answer='땅콩' WHERE id=$1",
      [shop.draftId, NOW],
    );
    await isolated.db.query("UPDATE messages SET body_masked='땅콩 알레르기가 있어요',created_at=$2 WHERE id=$1", [
      shop.messageId,
      NOW,
    ]);
    now = new Date(NOW.getTime() + 4000);
    await send(shop.userKey, "새 케이크의 합성 질문");
    const job = required(jobs[0]);
    await consume(job, ai);
    const input = JSON.stringify(required(ai.call.mock.calls[0])[0].messages);
    expect(input).toContain("새 케이크의 합성 질문");
    expect(input).not.toContain("땅콩");
    expect(
      (
        await isolated.db.query(
          "SELECT count(*)::int AS n FROM order_drafts WHERE consultation_id=$1 AND status='active' AND allergy_answer IS NOT NULL",
          [shop.consultationId],
        )
      ).rows[0]?.n,
    ).toBe(0);
  });

  it("입력 초안의 마스킹이 실패하면 모델을 부르지 않고 그 질문을 사장님께 넘긴다", async () => {
    const ai = model();
    await send(newUuid(), "마스킹 실패를 확인할 합성 질문");
    const job = required(jobs[0]);
    const row = required(
      (await isolated.db.query("SELECT consultation_id FROM messages WHERE id=$1", [job.messageId])).rows[0],
    );
    await isolated.db.query(
      "INSERT INTO order_drafts (shop_id,consultation_id,design_notes) VALUES ($1,$2,'연락처 010-0000-5678')",
      [shop.shopId, row.consultation_id],
    );
    const fields = fieldCrypto(required(readSettings(env).fieldKeys));
    vi.spyOn(fields, "seal").mockRejectedValue(new FieldCryptoError("합성 암호화 실패"));
    const callback = await consume(job, ai, { fieldCrypto: fields });
    expect(ai.call).not.toHaveBeenCalled();
    expect(String(callback.mock.calls[0]?.[1]?.body)).not.toContain("010-0000-5678");
    expect(
      (await isolated.db.query("SELECT reason FROM handoffs WHERE consultation_id=$1", [row.consultation_id])).rows,
    ).toEqual([{ reason: "masking_failed" }]);
  });

  it.each(["permission denied", "not_found"])(
    "문맥 조회 오류는 마스킹 실패로 넘기지 않고 재시도한다(%s)",
    async (message) => {
      const ai = model();
      await send(newUuid(), "조회 오류의 합성 질문");
      const job = required(jobs[0]);
      await isolated.db.query(
        "UPDATE consultations SET ai_disclosed_at=$2,ai_disclosed_policy_version=1 WHERE id=(SELECT consultation_id FROM messages WHERE id=$1)",
        [job.messageId, NOW],
      );
      const failure = new Error(message),
        callback = vi.fn<typeof fetch>(async () => Response.json({ status: "SUCCESS" }));
      vi.spyOn(conversation, "readAiConversation").mockRejectedValueOnce(failure);
      await expect(
        consumeKakaoCallback(job, env, {
          connect: () => isolated.connect(),
          now: () => new Date(NOW.getTime() + 1000),
          fetch: callback,
          services: { aiModel: ai },
          logSink: () => {},
        }),
      ).rejects.toBe(failure);
      expect(ai.call).not.toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();
      expect(
        (await isolated.db.query("SELECT kakao_callback_claim_until FROM messages WHERE id=$1", [job.messageId])).rows,
      ).toEqual([{ kakao_callback_claim_until: null }]);
      expect(
        (await isolated.db.query("SELECT id FROM handoffs WHERE source_message_id=$1", [job.messageId])).rows,
      ).toHaveLength(0);
      await consume(job, ai);
      expect(ai.call).toHaveBeenCalledOnce();
    },
  );

  it.each(["[전화번호1]", "010-0000-5678", "１２３４５６７８９０"])(
    "모델 초안에 번호나 플레이스홀더를 저장하지 않는다(%s)",
    async (value) => {
      const ai = model(),
        invoke = required(ai.call.getMockImplementation());
      ai.call.mockImplementationOnce(async (input) => {
        const result = await invoke(input);
        if (!result.ok) throw new Error("합성 답 실패");
        return { ...result, output: { reply: "합성 문구를 확인했어요.", draft_patch: { lettering: value } } };
      });
      await send(newUuid(), "초안 저장의 합성 질문");
      const job = required(jobs[0]);
      await consume(job, ai);
      expect(
        (
          await isolated.db.query(
            "SELECT id FROM order_drafts WHERE consultation_id=(SELECT consultation_id FROM messages WHERE id=$1)",
            [job.messageId],
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (await isolated.db.query("SELECT id FROM messages WHERE trace_id=$1 AND author='ai'", [job.messageId])).rows,
      ).toHaveLength(0);
      expect(
        (await isolated.db.query("SELECT fallback_reason FROM ai_calls WHERE trace_id=$1", [job.messageId])).rows,
      ).toEqual([{ fallback_reason: "schema_invalid" }]);
    },
  );

  it("사장님께 넘긴 질문과 덧붙인 질문은 다음 모델 문맥에 넣지 않는다", async () => {
    const ai = model();
    await send(newUuid(), "현재 안전한 합성 질문");
    const job = required(jobs[0]);
    const consultationId = required(
      (await isolated.db.query("SELECT consultation_id FROM messages WHERE id=$1", [job.messageId])).rows[0],
    ).consultation_id;
    const first = newUuid(),
      second = newUuid(),
      third = newUuid(),
      fourth = newUuid(),
      closed = newUuid(),
      handoff = newUuid();
    for (const [id, text] of [
      [first, "땅콩 알레르기 확인 질문"],
      [second, "우유 알레르기 추가 질문"],
      [third, "처음 마감 확인 질문"],
      [fourth, "마감 건을 재사용한 비공개 질문"],
    ])
      await isolated.db.query(
        "INSERT INTO messages(id,shop_id,consultation_id,direction,author,kind,kakao_message_id,body_masked,created_at) VALUES($1,$2,$3,'inbound','customer','text',$4,$5,$6)",
        [id, shop.shopId, consultationId, `synthetic-handoff:${id}`, text, new Date(NOW.getTime() - 2000)],
      );
    await isolated.db.query(
      "INSERT INTO handoffs(id,shop_id,consultation_id,source_message_id,reason) VALUES($1,$2,$3,$4,'edibility')",
      [handoff, shop.shopId, consultationId, first],
    );
    await isolated.db.query(
      "INSERT INTO handoff_questions(shop_id,handoff_id,message_id,reason) VALUES($1,$2,$3,'edibility')",
      [shop.shopId, handoff, second],
    );
    await isolated.db.query(
      "INSERT INTO handoffs(id,shop_id,consultation_id,source_message_id,reason,requested_day) VALUES($1,$2,$3,$4,'closed_day','2026-11-28')",
      [closed, shop.shopId, consultationId, third],
    );
    await shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }), isolated.db).transaction(
      (tx) => createHandoffTask(tx, closed, NOW, { closedDaySourceIds: [third, fourth] }),
    );
    await consume(job, ai);
    const input = JSON.stringify(required(ai.call.mock.calls[0])[0].messages);
    expect(input).toContain("현재 안전한 합성 질문");
    expect(input).not.toContain("땅콩");
    expect(input).not.toContain("우유");
    expect(input).not.toContain("처음 마감 확인");
    expect(input).not.toContain("재사용한 비공개");
  });
  it("기존 마감 건에 재사용으로 묶인 수신 콜백은 모델을 다시 부르지 않는다", async () => {
    const ai = model();
    await send(newUuid(), "이미 마감 건에 묶인 합성 질문");
    const job = required(jobs[0]);
    const row = required(
      (await isolated.db.query("SELECT consultation_id FROM messages WHERE id=$1", [job.messageId])).rows[0],
    );
    const first = newUuid(),
      handoff = newUuid();
    await isolated.db.query(
      "INSERT INTO messages(id,shop_id,consultation_id,direction,author,kind,kakao_message_id,body_masked) VALUES($1,$2,$3,'inbound','customer','text',$4,'처음 마감 요청')",
      [first, shop.shopId, row.consultation_id, `synthetic-closed:${first}`],
    );
    await isolated.db.query(
      "INSERT INTO handoffs(id,shop_id,consultation_id,source_message_id,reason,requested_day) VALUES($1,$2,$3,$4,'closed_day','2026-11-28')",
      [handoff, shop.shopId, row.consultation_id, first],
    );
    await shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }), isolated.db).transaction(
      (tx) => createHandoffTask(tx, handoff, NOW, { closedDaySourceIds: [first, job.messageId] }),
    );
    await consume(job, ai);
    expect(ai.call).not.toHaveBeenCalled();
    expect(
      (
        await isolated.db.query("SELECT id FROM handoffs WHERE shop_id=$1 AND consultation_id=$2", [
          shop.shopId,
          row.consultation_id,
        ])
      ).rows,
    ).toEqual([{ id: handoff }]);
  });
  it("다른 가게의 내부 연결 목록은 내 수신 글을 AI 문맥에서 빼지 못한다", async () => {
    const ai = model();
    await send(newUuid(), "내 가게의 정상 합성 질문");
    const job = required(jobs[0]),
      other = await createShop(isolated.db, "합성 외부 연결 가게"),
      handoff = newUuid();
    await issueTestBookingLink(isolated.db, other);
    await isolated.db.query(
      "INSERT INTO handoffs(id,shop_id,consultation_id,source_message_id,reason,requested_day) VALUES($1,$2,$3,$4,'closed_day','2026-11-28')",
      [handoff, other.shopId, other.consultationId, other.messageId],
    );
    await shopRequestDb(createShopScope(other.shopId, { kind: "job", job: "kakao_callback" }), isolated.db).transaction(
      (tx) => createHandoffTask(tx, handoff, NOW, { closedDaySourceIds: [job.messageId] }),
    );
    await consume(job, ai);
    expect(ai.call).toHaveBeenCalledOnce();
    expect(JSON.stringify(required(ai.call.mock.calls[0])[0].messages)).toContain("내 가게의 정상 합성 질문");
  });
});
