import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { recordAiCall } from "../src/ai-calls";
import type { AiModel } from "../src/ai-model";
import { createApp } from "../src/app";
import { consumeKakaoCallback } from "../src/kakao-callback-queue";
import type { KakaoCallbackJob, KakaoCallbackQueue } from "../src/kakao-callback-store";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
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
  async function consume(job: KakaoCallbackJob, aiModel: ReturnType<typeof model>) {
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
      services: { aiModel },
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
});
