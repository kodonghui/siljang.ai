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
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture, snapshotShop } from "./support/shops";

const NOW = new Date("2026-11-23T10:00:00+09:00");
describeDb("손님 메시지 수신의 친구 여부·글 길이·상담 경계(TASK-063)", () => {
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
  async function consultation(user: string) {
    return (
      await isolated.db.query<{ id: string; status: string }>(
        `SELECT c.id, c.status FROM consultations c JOIN customers u ON u.id = c.customer_id
        WHERE c.shop_id = $1 AND u.kakao_user_key = $2 ORDER BY c.opened_at, c.id`,
        [shop.shopId, user],
      )
    ).rows;
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

  it("친구 값이 없으면 false로 고치며 늦게 온 옛 값은 최신 여부를 되돌리지 않는다", async () => {
    const user = newUuid();
    expect((await send(user, "첫 합성 질문", true)).headers.get("Siljang-Outcome")).toBe("callback_pending");
    now = new Date(NOW.getTime() + 4000);
    expect((await send(user, "둘째 합성 질문")).status).toBe(200);
    const latest = now;
    now = new Date(NOW.getTime() + 2000);
    expect((await send(user, "늦게 도착한 합성 질문", true)).status).toBe(200);
    expect(
      (
        await isolated.db.query(
          `SELECT channel_friend, friend_checked_at FROM customers
      WHERE shop_id = $1 AND kakao_user_key = $2`,
          [shop.shopId, user],
        )
      ).rows,
    ).toEqual([{ channel_friend: false, friend_checked_at: latest }]);
    expect(await consultation(user)).toHaveLength(1);
  });
  it("친구 여부 누락 뒤 남은 안내는 같은 손님의 다음 콜백에서 먼저 한 번 전한다", async () => {
    const user = newUuid(),
      ai = model();
    await send(user, "친구였을 때 합성 질문", true);
    now = new Date(NOW.getTime() + 4000);
    await send(user, "친구 값이 빠진 합성 질문");
    const row = (
      await isolated.db.query<{ id: string; customer_id: string }>(
        `SELECT c.id,c.customer_id FROM consultations c JOIN customers u ON u.shop_id=c.shop_id AND u.id=c.customer_id WHERE c.shop_id=$1 AND u.kakao_user_key=$2`,
        [shop.shopId, user],
      )
    ).rows[0];
    if (!row) throw new Error("합성 상담이 없어요");
    const noticeId = newUuid(),
      text = "친구가 아닌 동안 남긴 합성 안내";
    await isolated.db.query(
      `INSERT INTO notifications (id,shop_id,customer_id,consultation_id,kind,event_key,template_key,body,status,created_at)
      VALUES ($1,$2,$3,$4,'owner_reply',$5,'owner_reply',$6,'deferred',$7)`,
      [noticeId, shop.shopId, row.customer_id, row.id, `notice:${noticeId}`, text, NOW],
    );
    expect(
      (await isolated.db.query("SELECT channel_friend FROM customers WHERE id=$1", [row.customer_id])).rows[0]
        ?.channel_friend,
    ).toBe(false);
    const job = jobs[1];
    if (!job) throw new Error("합성 큐 작업이 없어요");
    const callback = await consume(job, ai);
    const body = JSON.parse(String(callback.mock.calls[0]?.[1]?.body));
    expect(body.template.outputs.map((x: { simpleText: { text: string } }) => x.simpleText.text)).toEqual([
      text,
      "합성 질문을 확인했어요.",
    ]);
    expect((await isolated.db.query("SELECT status FROM notifications WHERE id=$1", [noticeId])).rows[0]?.status).toBe(
      "delivered_on_reply",
    );
    now = new Date(NOW.getTime() + 8000);
    await send(user, "다음 합성 질문");
    const nextJob = jobs[2];
    if (!nextJob) throw new Error("다음 합성 큐 작업이 없어요");
    const next = await consume(nextJob, ai);
    expect(String(next.mock.calls[0]?.[1]?.body)).not.toContain(text);
  });
  it("열린 상담은 이어가고 끝난 상담은 새로 열어 지난 상담을 다시 열지 않는다", async () => {
    const user = newUuid();
    await send(user, "합성 첫 상담");
    const first = (await consultation(user))[0];
    if (!first) throw new Error("첫 상담이 없어요");
    await send(user, "이어지는 합성 질문");
    expect(await consultation(user)).toEqual([first]);
    await isolated.db.query("UPDATE consultations SET status = 'ended', ended_at = $3 WHERE shop_id = $1 AND id = $2", [
      shop.shopId,
      first.id,
      NOW,
    ]);
    now = new Date(NOW.getTime() + 4000);
    await send(user, "새로 여는 합성 질문");
    const rows = await consultation(user);
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual({ id: first.id, status: "ended" });
    expect(rows.filter((row) => row.status === "open")).toHaveLength(1);
  });
  it("1000자를 넘는 유니코드 글은 기록에 남기고 모의 모델에는 앞1000자만 보낸다", async () => {
    const prefix = "😀".repeat(1000),
      text = `${prefix}기록에 남길 합성 뒷부분`;
    expect((await send(newUuid(), text)).headers.get("Siljang-Outcome")).toBe("callback_pending");
    const job = jobs[0];
    if (!job) throw new Error("콜백 작업이 없어요");
    const ai = model();
    await consume(job, ai);
    expect(ai.call).toHaveBeenCalledOnce();
    expect(ai.call.mock.calls[0]?.[0].messages.find((message) => message.role === "user")?.content).toBe(prefix);
    expect(
      (
        await isolated.db.query("SELECT body_masked FROM messages WHERE shop_id = $1 AND id = $2", [
          shop.shopId,
          job.messageId,
        ])
      ).rows,
    ).toEqual([{ body_masked: text }]);
  });
  it("한 상담1000원 한도는 그 질문만 넘기고 같은 가게의 다른 상담에는 모의 AI가 답한다", async () => {
    await isolated.db.query(
      `INSERT INTO ai_calls (shop_id, consultation_id, trace_id, provider, model, prompt_version, sent_at, cost_krw, result)
      VALUES ($1, $2, $3, 'synthetic', 'synthetic', 'synthetic', $4, 1000, 'failure')`,
      [shop.shopId, shop.consultationId, newUuid(), NOW],
    );
    expect((await send(shop.userKey, "한도에 닿은 합성 질문")).headers.get("Siljang-Outcome")).toBe(
      "ai_cost_limit_reached",
    );
    expect(enqueue).not.toHaveBeenCalled();
    const user = newUuid();
    expect((await send(user, "다른 상담의 합성 질문")).headers.get("Siljang-Outcome")).toBe("callback_pending");
    const job = jobs[0];
    if (!job) throw new Error("다른 상담의 콜백 작업이 없어요");
    const ai = model(),
      callback = await consume(job, ai);
    expect(ai.call).toHaveBeenCalledOnce();
    expect(ai.call.mock.calls[0]?.[0].consultationId).not.toBe(shop.consultationId);
    expect(JSON.parse(String(callback.mock.calls[0]?.[1]?.body)).template.outputs).toEqual([
      { simpleText: { text: "합성 질문을 확인했어요." } },
    ]);
    expect(
      (
        await isolated.db.query("SELECT reason FROM handoffs WHERE shop_id = $1 AND consultation_id = $2", [
          shop.shopId,
          shop.consultationId,
        ])
      ).rows,
    ).toEqual([{ reason: "ai_cost_limit" }]);
  });
  it("다른 가게의 스킬 키는 두 가게의 모든 기록을 바꾸지 못한다", async () => {
    const other = await createShop(isolated.db, "다른 합성 수신 가게");
    await issueTestBookingLink(isolated.db, other);
    await linkTestChannel(isolated.db, other.channelId);
    const before = await Promise.all([snapshotShop(isolated.db, shop), snapshotShop(isolated.db, other)]);
    expect((await send(newUuid(), "가게를 넘는 합성 질문", undefined, other, key)).status).toBe(401);
    expect(await Promise.all([snapshotShop(isolated.db, shop), snapshotShop(isolated.db, other)])).toEqual(before);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
