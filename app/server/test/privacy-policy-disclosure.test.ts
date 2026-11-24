import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { recordAiCall } from "../src/ai-calls";
import type { AiModel } from "../src/ai-model";
import { createApp } from "../src/app";
import { consumeKakaoCallback } from "../src/kakao-callback-queue";
import type { KakaoCallbackJob } from "../src/kakao-callback-store";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import * as template from "../src/privacy-policy-body";
import type { PrivacyPolicySettings } from "../src/privacy-policy-settings";
import { Secret } from "../src/settings";
import { describeDb, newUuid, TEST_HASH_KEY, testEnv } from "./support/db";
import { newFieldKey } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { MemoryLimiter } from "./support/rate-limit";
import { createShop, issueTestBookingLink, linkTestChannel } from "./support/shops";

const NOW = new Date("2026-11-24T00:00:00Z"),
  ORIGIN = "https://siljang.example";
const POLICY: PrivacyPolicySettings = {
  transfers: ["anthropic", "supabase", "cloudflare"].map((recipient) => ({
    recipient: `${recipient} 합성 회사`,
    country: "합성 국가",
    personalData: "마스킹한 상담 대화",
    whenAndHow: "상담 때 암호화 전송",
    purposeAndRetention: "합성 상담 목적과 기간",
    howToRefuse: "가게에 거부하면 온라인 상담을 쓰지 않습니다.",
  })),
};
describeDb("TASK-184 새 배포의 첫 AI 고지와 공개 정책 버전", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>,
    now = NOW;
  const env = testEnv({ FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: newFieldKey() });
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(() => {
    now = NOW;
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("합성 정책 시험에서 실제 외부 호출 금지"));
  });
  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await isolated?.close();
  });
  async function fixture() {
    const shop = await createShop(isolated.db, "합성 고지 재발행 가게");
    await issueTestBookingLink(isolated.db, shop);
    await linkTestChannel(isolated.db, shop.channelId);
    await isolated.db.query("UPDATE privacy_policies SET published_at=$2 WHERE shop_id=$1", [shop.shopId, NOW]);
    const row = (
      await isolated.db.query<{ booking_slug: string }>("SELECT booking_slug FROM shops WHERE id=$1", [shop.shopId])
    ).rows[0];
    if (!row) throw new Error("합성 주소가 없어요");
    const slug = row.booking_slug;
    const url = `${ORIGIN}/api/public/shops/${slug}/privacy-policy`,
      jobs: KakaoCallbackJob[] = [];
    const app = (policy: PrivacyPolicySettings) =>
      createApp({
        connect: () => isolated.connect(),
        services: {
          now: () => now,
          privacyPolicy: policy,
          publicAppOrigin: ORIGIN,
          kakaoCallbackQueue: {
            send: async (job) => {
              jobs.push(job);
            },
          },
          limiters: { PUBLIC_PRIVACY_RATE_LIMITER: new MemoryLimiter(1000) },
        },
        logSink: () => {},
      });
    const publicGet = async (policy: PrivacyPolicySettings) => {
      const r = await app(policy).request(url, {}, env);
      expect(r.status, await r.clone().text()).toBe(200);
      return r.json() as Promise<{ version: number; body: string; overseasTransfers: unknown[] }>;
    };
    const before = await publicGet(POLICY);
    const versions = () =>
      isolated.db.query<{ version: number; body: string; overseas_transfers: unknown; published_at: Date }>(
        "SELECT version,body,overseas_transfers,published_at FROM privacy_policies WHERE shop_id=$1 ORDER BY version",
        [shop.shopId],
      );
    const key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
    async function firstAi(policy: PrivacyPolicySettings) {
      const user = newUuid();
      const response = await app(policy).request(
        `${ORIGIN}/api/kakao/skills/message`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
          body: JSON.stringify({
            bot: { id: shop.botId },
            userRequest: {
              utterance: "새 배포의 합성 첫 질문",
              callbackUrl: "https://bot-api.kakao.com/v1/callback/synthetic_reissue",
              user: { id: user, type: "botUserKey" },
            },
            action: { id: "input", params: {} },
          }),
        },
        env,
      );
      expect(response.headers.get("Siljang-Outcome")).toBe("callback_pending");
      const job = jobs.at(-1);
      if (!job) throw new Error("합성 큐 작업이 없어요");
      const call: AiModel["call"] = async (input) => {
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
        return { ok: true, aiCallId, output: { reply: "합성 첫 질문을 확인했어요." } };
      };
      const callback = vi.fn<typeof fetch>(async () => Response.json({ status: "SUCCESS" }));
      now = new Date(NOW.getTime() + 1000);
      expect(
        await consumeKakaoCallback(job, env, {
          connect: () => isolated.connect(),
          now: () => now,
          fetch: callback,
          services: {
            aiModel: { provider: "anthropic", model: "claude-haiku-5-5", call },
            privacyPolicy: policy,
            publicAppOrigin: ORIGIN,
          },
          logSink: () => {},
        }),
      ).toBe("done");
      expect(callback).toHaveBeenCalledOnce();
      const body = JSON.parse(String(callback.mock.calls[0]?.[1]?.body));
      expect(body.template.outputs[0].simpleText.text).toContain("AI가 상담합니다");
      expect(body.template.outputs[0].simpleText.text).toContain(`${ORIGIN}/s/${slug}/privacy`);
      const result = (
        await isolated.db.query<{ ai_disclosed_policy_version: number }>(
          "SELECT ai_disclosed_policy_version FROM consultations WHERE id=(SELECT consultation_id FROM messages WHERE id=$1)",
          [job.messageId],
        )
      ).rows[0];
      if (!result) throw new Error("합성 고지 기록이 없어요");
      return result.ai_disclosed_policy_version;
    }
    return { shop, before, versions, publicGet, firstAi };
  }
  it("회사·나라·기간이 바뀐 배포의 첫 고지와 공개 주소가 같은 새 버전이며 지난 버전은 보존한다", async () => {
    const h = await fixture(),
      old = (await h.versions()).rows;
    const policy: PrivacyPolicySettings = {
      transfers: POLICY.transfers.map((x, i) => ({
        ...x,
        recipient: `바뀐 합성 회사 ${i}`,
        country: `바뀐 국가 ${i}`,
        whenAndHow: "바뀐 시기/방법",
        purposeAndRetention: "바뀐 목적/기간",
        howToRefuse: "바뀐 거부 절차",
      })),
    };
    const disclosed = await h.firstAi(policy),
      current = await h.publicGet(policy);
    expect(current.version).toBe(disclosed);
    expect(current.version).toBe(h.before.version + 1);
    expect(current.body).toContain("바뀐 합성 회사");
    for (const row of current.overseasTransfers) expect(JSON.stringify(row)).toContain("바뀐");
    expect((await h.versions()).rows.slice(0, old.length)).toEqual(old);
    expect((await h.versions()).rows).toHaveLength(old.length + 1);
    expect((await h.publicGet(policy)).version).toBe(disclosed);
    expect((await h.versions()).rows).toHaveLength(old.length + 1);
    expect(
      (
        await isolated.db.query("SELECT ai_disclosed_policy_version FROM consultations WHERE id=$1", [
          h.shop.consultationId,
        ])
      ).rows[0]?.ai_disclosed_policy_version,
    ).toBe(1);
  });
  it("고정 문장만 바뀐 배포도 첫 고지에서 새 버전을 만들고 공개 읽기가 그대로 잇는다", async () => {
    const h = await fixture(),
      old = (await h.versions()).rows,
      original = template.privacyPolicyBody;
    vi.spyOn(template, "privacyPolicyBody").mockImplementation(
      (shop, transfers) => `${original(shop, transfers)}\n추가된 합성 고정 문장`,
    );
    const disclosed = await h.firstAi(POLICY),
      current = await h.publicGet(POLICY);
    expect(current.version).toBe(disclosed);
    expect(current.version).toBe(h.before.version + 1);
    expect(current.body).toContain("추가된 합성 고정 문장");
    expect((await h.versions()).rows.slice(0, old.length)).toEqual(old);
    expect((await h.versions()).rows).toHaveLength(old.length + 1);
  });
});
