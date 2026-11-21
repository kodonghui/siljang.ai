import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { deliverKakaoCallback, kakaoCallback, SKILL_CALLBACK_MS } from "../src/kakao-callback";
import { consumeKakaoCallback } from "../src/kakao-callback-queue";
import type { KakaoCallbackJob, KakaoCallbackQueue } from "../src/kakao-callback-store";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { expectSchema } from "./support/contract";
import { describeDb, newUuid, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { newFieldKey } from "./support/field-keys";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-20T00:00:00.000+09:00");
const PATH = "/v1/callback/synthetic_callback_token";
const VALID = `https://bot-api.kakao.com${PATH}`;

function delivery() {
  const callback = kakaoCallback(VALID, NOW);
  if (callback === null) throw new Error("시험 콜백 주소를 읽지 못함");
  return callback;
}

describe("카카오 콜백 주소와 서비스 기한(TASK-028, DEC-29)", () => {
  it("콜백 주소의 만료와 서비스 기한 가운데 앞선 시각을 사용함", () => {
    expect(delivery().deadline).toBe(NOW.getTime() + SKILL_CALLBACK_MS);
    const early = NOW.getTime() + 15_000;
    expect(kakaoCallback(`${VALID}?expires=${early / 1000}`, NOW)?.deadline).toBe(early);
    expect(kakaoCallback(`${VALID}?expires=${NOW.getTime() / 1000}`, NOW)).toBeNull();
  });

  it.each([
    undefined,
    `https://example.invalid${PATH}`,
    `http://bot-api.kakao.com${PATH}`,
    `https://bot-api.kakao.com:8443${PATH}`,
    "https://bot-api.kakao.com/v1/other",
    `${VALID}#fragment`,
    `${VALID}?expires=bad`,
  ])("등록된 콜백 주소 형식만 허용함(%s)", (raw) => {
    expect(kakaoCallback(raw, NOW)).toBeNull();
  });

  it("성공한 카카오 콜백은 다시 보내지 않고 답 형식을 유지함", async () => {
    const post = vi.fn(async (_url: URL, _options: RequestInit) => Response.json({ status: "SUCCESS" }));
    expect(await deliverKakaoCallback(delivery(), "합성 답변", { fetch: post, now: () => NOW.getTime() })).toBe(
      "delivered",
    );
    expect(post).toHaveBeenCalledTimes(1);
    const [url, request] = post.mock.calls[0] ?? [];
    expect(url?.origin).toBe("https://bot-api.kakao.com");
    expect(request?.redirect).toBe("error");
    expect(JSON.parse(String(request?.body))).toEqual({
      version: "2.0",
      template: { outputs: [{ simpleText: { text: "합성 답변" } }] },
    });
  });

  it("잠깐 실패하면 한 번만 다시 보내고 카카오 거절은 같은 내용으로 보내지 않음", async () => {
    const send = vi.fn<(_url: URL, _options: RequestInit) => Promise<Response>>();
    send.mockResolvedValueOnce(new Response(null, { status: 503 }));
    send.mockResolvedValueOnce(Response.json({ status: "SUCCESS" }));
    expect(await deliverKakaoCallback(delivery(), "합성 답변", { fetch: send, now: () => NOW.getTime() })).toBe(
      "delivered",
    );
    expect(send).toHaveBeenCalledTimes(2);
    send.mockClear();
    send.mockResolvedValueOnce(Response.json({ status: "FAIL" }));
    expect(await deliverKakaoCallback(delivery(), "합성 답변", { fetch: send, now: () => NOW.getTime() })).toBe(
      "unavailable",
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("서비스 기한에 닿으면 외부로 보내지 않음", async () => {
    const send = vi.fn();
    const target = delivery();
    expect(await deliverKakaoCallback(target, "합성 답변", { fetch: send, now: () => target.deadline })).toBe(
      "expired",
    );
    expect(send).not.toHaveBeenCalled();
  });
});

describeDb("카카오 콜백의 HTTP 응답과 데이터베이스 큐 처리(TASK-028)", () => {
  const db = testDb();
  const env = testEnv({ FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: newFieldKey() });
  let shop: ShopFixture;
  let key: string;

  beforeAll(async () => {
    shop = await createShop(db, "콜백 시험 가게");
    await issueTestBookingLink(db, shop);
    await linkTestChannel(db, shop.channelId);
    key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
  });

  afterAll(async () => {
    await db.close();
  });

  async function receive(queue: KakaoCallbackQueue, raw = VALID) {
    const app = createApp({ services: { now: () => NOW, kakaoCallbackQueue: queue }, logSink: () => {} });
    return app.request(
      "/api/kakao/skills/message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
        body: JSON.stringify({
          bot: { id: shop.botId },
          userRequest: {
            utterance: "합성 콜백 메시지",
            callbackUrl: raw,
            block: { id: "conversation" },
            user: { id: newUuid(), type: "botUserKey" },
          },
          action: { id: "test", params: {} },
        }),
      },
      env,
    );
  }

  function mockQueue() {
    const jobs: KakaoCallbackJob[] = [];
    const send = vi.fn<KakaoCallbackQueue["send"]>(async (job) => {
      jobs.push(job);
    });
    return { send, jobs };
  }

  async function stored(job: KakaoCallbackJob) {
    const { rows } = await db.query<{ consultation_id: string; kakao_callback_enc: string | null }>(
      "SELECT consultation_id, kakao_callback_enc FROM messages WHERE shop_id = $1 AND id = $2",
      [job.shopId, job.messageId],
    );
    return rows[0];
  }

  it("수신 응답은 콜백을 예고하고 큐에는 식별자만 전달함", async () => {
    const queue = mockQueue();
    const response = await receive(queue);
    expect(response.headers.get("Siljang-Outcome")).toBe("callback_pending");
    expectSchema("SkillCallbackAck", await response.json());
    const job = queue.jobs[0] as KakaoCallbackJob;
    expect(queue.send).toHaveBeenCalledExactlyOnceWith(
      { shopId: shop.shopId, messageId: job.messageId },
      { delaySeconds: 1 },
    );
    const inbound = await stored(job);
    expect(inbound?.kakao_callback_enc).toMatch(/^v1:/);
    expect(inbound?.kakao_callback_enc).not.toContain("synthetic_callback_token");

    let started: () => void = () => {};
    let release: () => void = () => {};
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = vi.fn<typeof fetch>(async () => {
      started();
      await inFlight;
      return Response.json({ status: "SUCCESS" });
    });

    const now = () => new Date(NOW.getTime() + 5_000);
    const first = consumeKakaoCallback(job, env, { now, fetch: send });
    try {
      await Promise.race([entered, first]);
      expect(send).toHaveBeenCalledTimes(1);
      expect(await consumeKakaoCallback(job, env, { now, fetch: send })).toBe("retry");
    } finally {
      release();
      await first;
    }
    expect(await first).toBe("done");
    expect(await consumeKakaoCallback(job, env, { now, fetch: send })).toBe("done");
    expect(send).toHaveBeenCalledTimes(1);
    expect((await stored(job))?.kakao_callback_enc).toBeNull();
    const { rows } = await db.query<{ delivery: string }>(
      "SELECT delivery FROM messages WHERE shop_id = $1 AND consultation_id = $2 AND direction = 'outbound'",
      [shop.shopId, inbound?.consultation_id],
    );
    expect(rows).toEqual([{ delivery: "callback" }]);
  });

  it("기한이 지난 콜백은 발신 없이 다음 대화에 전할 답으로 기록함", async () => {
    const queue = mockQueue();
    expect((await receive(queue)).headers.get("Siljang-Outcome")).toBe("callback_pending");
    const job = queue.jobs[0] as KakaoCallbackJob;
    const consultation = (await stored(job))?.consultation_id;
    const send = vi.fn<typeof fetch>();
    const expiredAt = () => new Date(NOW.getTime() + SKILL_CALLBACK_MS + 1);
    expect(await consumeKakaoCallback(job, env, { now: expiredAt, fetch: send })).toBe("done");
    expect(send).not.toHaveBeenCalled();
    expect((await stored(job))?.kakao_callback_enc).toBeNull();
    const { rows } = await db.query<{ delivery: string }>(
      "SELECT delivery FROM messages WHERE shop_id = $1 AND consultation_id = $2 AND direction = 'outbound'",
      [shop.shopId, consultation],
    );
    expect(rows).toEqual([{ delivery: "deferred" }]);
  });

  it("큐가 접수를 거절하면 콜백 예고 없이 바로 답하고 주소 봉투를 지움", async () => {
    const send = vi.fn<KakaoCallbackQueue["send"]>(async () => {
      throw new Error("시험 큐 실패");
    });
    const response = await receive({ send });
    expect(response.headers.get("Siljang-Outcome")).toBe("not_accepting");
    expectSchema("SkillTemplateResponse", await response.json());
    const job = send.mock.calls[0]?.[0] as KakaoCallbackJob;
    expect((await stored(job))?.kakao_callback_enc).toBeNull();
  });
});
