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

const ORIGIN = "https://siljang.example";
const POLICY = {
  transfers: ["anthropic", "supabase", "cloudflare"].map((recipient) => ({
    recipient: `${recipient} 합성 회사`,
    country: "합성 국가",
    personalData: "개인정보를 가린 상담 대화",
    whenAndHow: "상담 때 암호화 전송",
    purposeAndRetention: "합성 상담 목적과 기간",
    howToRefuse: "가게에 거부를 알리면 온라인 상담을 쓰지 않아요",
  })),
};
const NOW = new Date("2026-11-23T10:00:00+09:00");
describeDb("첫 AI 고지의 전달과 처리방침 버전(TASK-064)", () => {
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
    await isolated.db.query("UPDATE privacy_policies SET published_at=$2 WHERE shop_id=$1", [shop.shopId, NOW]);
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
      services: {
        now: () => now,
        kakaoCallbackQueue: { send: enqueue },
        privacyPolicy: POLICY,
        publicAppOrigin: ORIGIN,
      },
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
  function required<T>(value: T | null | undefined): T {
    if (value === null || value === undefined) throw new Error("필요한 합성 시험 자료가 없어요");
    return value;
  }
  async function consume(job: KakaoCallbackJob, aiModel: ReturnType<typeof model>, success = true, policy = POLICY) {
    const callback = vi.fn<typeof fetch>(async () => Response.json({ status: success ? "SUCCESS" : "FAIL" }));
    expect(
      await consumeKakaoCallback(job, env, {
        connect: () => isolated.connect(),
        now: () => new Date(now.getTime() + 1000),
        fetch: callback,
        services: { aiModel, privacyPolicy: policy, publicAppOrigin: ORIGIN },
        logSink: () => {},
      }),
    ).toBe("done");
    return callback;
  }
  const texts = (callback: ReturnType<typeof vi.fn<typeof fetch>>) =>
    callback.mock.calls.flatMap(([, init]) =>
      (JSON.parse(String(init?.body)).template.outputs as { simpleText: { text: string } }[]).map(
        (x) => x.simpleText.text,
      ),
    );
  async function record(user: string) {
    return (
      await isolated.db.query<{ id: string; ai_disclosed_at: Date | null; ai_disclosed_policy_version: number | null }>(
        `SELECT c.id,c.ai_disclosed_at,c.ai_disclosed_policy_version FROM consultations c JOIN customers u ON u.shop_id=c.shop_id AND u.id=c.customer_id
       WHERE c.shop_id=$1 AND u.kakao_user_key=$2 ORDER BY c.opened_at,c.id`,
        [shop.shopId, user],
      )
    ).rows;
  }
  it("새 손님의 첫 답은 고지·처리방침 링크·AI 답 순서이며 성공 뒤 게시 버전을 남긴다", async () => {
    const user = newUuid(),
      ai = model();
    await send(user, "합성 첫 질문");
    const job = required(jobs[0]);
    const callback = await consume(job, ai);
    expect(ai.call).toHaveBeenCalledOnce();
    expect(texts(callback)).toHaveLength(2);
    expect(texts(callback)[0]).toContain("AI가 상담합니다");
    const slug = required(
      (await isolated.db.query("SELECT booking_slug FROM shops WHERE id=$1", [shop.shopId])).rows[0],
    ).booking_slug;
    expect(texts(callback)[0]).toContain(`${ORIGIN}/s/${slug}/privacy`);
    expect(texts(callback)[1]).toBe("합성 질문을 확인했어요.");
    const row = required((await record(user))[0]);
    const latest = required(
      (
        await isolated.db.query(
          "SELECT max(version)::int AS version FROM privacy_policies WHERE shop_id=$1 AND published_at <= $2",
          [shop.shopId, new Date(now.getTime() + 1000)],
        )
      ).rows[0],
    ).version;
    expect(row.ai_disclosed_at).toEqual(new Date(now.getTime() + 1000));
    expect(row.ai_disclosed_policy_version).toBe(latest);
    const repeated = await consume(job, ai);
    expect(repeated).not.toHaveBeenCalled();
    expect(ai.call).toHaveBeenCalledOnce();
  });
  it("이어가는 상담에는 고지를 반복하지 않고 끝난 상담 뒤 새 상담에는 다시 고지한다", async () => {
    const user = newUuid(),
      ai = model();
    await send(user, "합성 첫 질문");
    expect(texts(await consume(required(jobs[0]), ai))[0]).toContain("AI가 상담합니다");
    const first = required((await record(user))[0]);
    now = new Date(NOW.getTime() + 4000);
    await send(user, "합성 이어지는 질문");
    expect(texts(await consume(required(jobs[1]), ai))).toEqual(["합성 질문을 확인했어요."]);
    expect((await record(user))[0]).toEqual(first);
    await isolated.db.query("UPDATE consultations SET status='ended',ended_at=$2 WHERE id=$1", [first.id, now]);
    now = new Date(NOW.getTime() + 8000);
    await send(user, "새 합성 상담");
    expect(texts(await consume(required(jobs[2]), ai))[0]).toContain("AI가 상담합니다");
    expect(await record(user)).toHaveLength(2);
    expect((await record(user)).find((x) => x.id === first.id)).toEqual(first);
  });
  it("카카오 실패 때 고지 완료를 남기지 않고 다음 응답에도 고지를 먼저 붙인다", async () => {
    const user = newUuid(),
      ai = model();
    await send(user, "발신이 실패할 합성 질문");
    const failed = await consume(required(jobs[0]), ai, false);
    expect(texts(failed)[0]).toContain("AI가 상담합니다");
    expect((await record(user))[0]).toMatchObject({ ai_disclosed_at: null, ai_disclosed_policy_version: null });
    now = new Date(NOW.getTime() + 4000);
    await send(user, "다음 합성 질문");
    const recovered = texts(await consume(required(jobs[1]), ai));
    expect(recovered[0]).toContain("AI가 상담합니다");
    expect(recovered.slice(1)).toContain("합성 질문을 확인했어요.");
    expect((await record(user))[0]?.ai_disclosed_at).not.toBeNull();
  });

  it("발신 전에 바뀐 설정은 새 게시 버전을 쓰고 지난 상담 버전은 보존한다", async () => {
    const user = newUuid(),
      ai = model(),
      policy = structuredClone(POLICY);
    const invoke = required(ai.call.getMockImplementation());
    ai.call.mockImplementationOnce(async (input) => {
      const answer = await invoke(input);
      required(policy.transfers[0]).recipient = "바뀐 합성 모델 회사";
      return answer;
    });
    await send(user, "배포 설정이 바뀌는 동안의 합성 질문");
    expect(texts(await consume(required(jobs[0]), ai, true, policy))[0]).toContain("AI가 상담합니다");
    const version = (await record(user))[0]?.ai_disclosed_policy_version;
    const rows = (
      await isolated.db.query("SELECT version,body FROM privacy_policies WHERE shop_id=$1 ORDER BY version", [
        shop.shopId,
      ])
    ).rows;
    expect(version).toBe(rows.at(-1)?.version);
    expect(rows.at(-1)?.body).toContain("바뀐 합성 모델 회사");
    expect(rows[0]?.version).toBe(1);
    expect(
      (
        await isolated.db.query("SELECT ai_disclosed_policy_version FROM consultations WHERE id=$1", [
          shop.consultationId,
        ])
      ).rows[0]?.ai_disclosed_policy_version,
    ).toBe(1);
  });
  it("같은 가게의 두 첫 상담이 겹쳐도 동일한 새 정책 버전을 쓴다", async () => {
    const ai = model(),
      users = [newUuid(), newUuid()];
    for (const user of users) await send(user, "동시에 고지할 합성 질문");
    const callbacks = await Promise.all(jobs.map((job) => consume(job, ai)));
    for (const callback of callbacks) expect(texts(callback)[0]).toContain("AI가 상담합니다");
    const versions = await Promise.all(users.map(async (user) => (await record(user))[0]?.ai_disclosed_policy_version));
    expect(versions[0]).toBe(versions[1]);
    expect(
      (await isolated.db.query("SELECT count(*)::int AS n FROM privacy_policies WHERE shop_id=$1", [shop.shopId]))
        .rows[0]?.n,
    ).toBe(2);
  });

  it("문의 끊김으로 닫힌 상담은 고지 기록을 유지하고 다시 고지하지 않는다", async () => {
    const user = newUuid(),
      ai = model();
    await send(user, "고지를 받을 합성 질문");
    await consume(required(jobs[0]), ai);
    const first = required((await record(user))[0]);
    await isolated.db.query("UPDATE consultations SET status='dropped',dropped_at=$2 WHERE id=$1", [first.id, now]);
    now = new Date(NOW.getTime() + 4000);
    await send(user, "문의 끊김 뒤 다시 온 합성 질문");
    const callback = await consume(required(jobs[1]), ai);
    expect(callback).not.toHaveBeenCalled();
    expect((await record(user))[0]).toEqual(first);
    expect(ai.call).toHaveBeenCalledOnce();
  });
  it("고지 실패로 남은 AI 답은 고지 없는 즉시 안내에서 전하지 않는다", async () => {
    const user = newUuid(),
      ai = model();
    await send(user, "카카오 실패로 남을 합성 질문");
    await consume(required(jobs[0]), ai, false);
    now = new Date(NOW.getTime() + 4000);
    const noCallback = createApp({
      connect: () => isolated.connect(),
      services: { now: () => now },
      logSink: () => {},
    });
    const response = await noCallback.request(
      "/api/kakao/skills/message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
        body: JSON.stringify({
          bot: { id: shop.botId },
          userRequest: { utterance: "콜백 주소 없는 합성 질문", user: { id: user, type: "botUserKey" } },
          action: { id: "input", params: {} },
        }),
      },
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("합성 질문을 확인했어요.");
    expect((await record(user))[0]).toMatchObject({ ai_disclosed_at: null, ai_disclosed_policy_version: null });
  });
  it("고지와 이전 안내 두 개가 출력 한도를 채우면 AI 답은 다음 대화에 남긴다", async () => {
    const user = newUuid(),
      ai = model();
    await send(user, "이전 안내도 있는 합성 질문");
    const row = required(
      (
        await isolated.db.query(
          "SELECT id,customer_id FROM consultations WHERE id=(SELECT consultation_id FROM messages WHERE id=$1)",
          [required(jobs[0]).messageId],
        )
      ).rows[0],
    );
    for (const [i, text] of ["먼저 전할 합성 안내 하나", "먼저 전할 합성 안내 둘"].entries()) {
      const id = newUuid();
      await isolated.db.query(
        `INSERT INTO notifications (id,shop_id,customer_id,consultation_id,kind,event_key,template_key,body,status,created_at) VALUES ($1,$2,$3,$4,'owner_reply',$5,'owner_reply',$6,'deferred',$7)`,
        [id, shop.shopId, row.customer_id, row.id, `notice:${id}`, text, new Date(NOW.getTime() + i)],
      );
    }
    const first = texts(await consume(required(jobs[0]), ai));
    expect(first).toHaveLength(3);
    expect(first[0]).toContain("AI가 상담합니다");
    expect(first.slice(1)).toEqual(["먼저 전할 합성 안내 하나", "먼저 전할 합성 안내 둘"]);
    expect(
      (
        await isolated.db.query("SELECT delivery,sent_at FROM messages WHERE consultation_id=$1 AND author='ai'", [
          row.id,
        ])
      ).rows,
    ).toEqual([{ delivery: "deferred", sent_at: null }]);
    now = new Date(NOW.getTime() + 4000);
    await send(user, "미전달 AI 답을 받을 합성 질문");
    const next = texts(await consume(required(jobs[1]), ai));
    expect(next).toEqual(["합성 질문을 확인했어요.", "합성 질문을 확인했어요."]);
  });
});
