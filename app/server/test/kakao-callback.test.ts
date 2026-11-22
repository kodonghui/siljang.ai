import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AiModel } from "../src/ai-model";
import { createApp } from "../src/app";
import { type DbConnector, pgConnector } from "../src/db";
import { deliverKakaoCallback, kakaoCallback, SKILL_CALLBACK_MS } from "../src/kakao-callback";
import { consumeKakaoCallback } from "../src/kakao-callback-queue";
import {
  claimKakaoCallback,
  type KakaoCallbackJob,
  type KakaoCallbackQueue,
  prepareKakaoCallbackHandoff,
} from "../src/kakao-callback-store";
import { KAKAO_HANDOFF_TEXT } from "../src/kakao-reply";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { anthropicStream, sseResponse } from "./support/ai-mock";
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

describe("콜백 출력의 개수·글자 수 한도(TASK-028)", () => {
  it.each([
    { name: "빈 출력", texts: [] },
    { name: "출력 네 개", texts: ["첫째", "둘째", "셋째", "넷째"] },
    { name: "빈 글", texts: [""] },
    { name: "1001자", texts: ["x".repeat(1001)] },
  ])("$name 는 외부 호출 없이 거절함", async ({ texts }) => {
    const send = vi.fn();
    expect(await deliverKakaoCallback(delivery(), texts, { fetch: send, now: () => NOW.getTime() })).toBe(
      "unavailable",
    );
    expect(send).not.toHaveBeenCalled();
  });
  it("세 출력과 유니코드 1000자를 순서대로 보존함", async () => {
    const send = vi.fn(async (_url: URL, _options: RequestInit) => Response.json({ status: "SUCCESS" }));
    const texts = ["이전 안내 하나", "이전 안내 둘", "😀".repeat(1000)];
    expect(await deliverKakaoCallback(delivery(), texts, { fetch: send, now: () => NOW.getTime() })).toBe("delivered");
    const body = JSON.parse(String(send.mock.calls[0]?.[1]?.body));
    expectSchema("SkillTemplateResponse", body);
    expect(body.template.outputs).toEqual(texts.map((text) => ({ simpleText: { text } })));
  });
});

describeDb("카카오 콜백의 HTTP 응답과 데이터베이스 큐 처리(TASK-028)", () => {
  const db = testDb();
  const env = testEnv({ FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: newFieldKey() });
  let shop: ShopFixture;
  let key: string;

  beforeAll(async () => {
    shop = await createShop(db, "콜백 시험 가게");
    await db.query(
      `INSERT INTO business_calendars (shop_id, daily_capacity, order_cutoff_days, order_cutoff_time)
        VALUES ($1, 10, 2, '18:00')`,
      [shop.shopId],
    );
    await issueTestBookingLink(db, shop);
    await linkTestChannel(db, shop.channelId);
    key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
  });

  afterAll(async () => {
    await db.close();
  });

  async function receive(
    queue: KakaoCallbackQueue,
    raw = VALID,
    userKey = newUuid(),
    utterance = "합성 콜백 메시지",
    connect?: DbConnector,
  ) {
    const app = createApp({
      ...(connect === undefined ? {} : { connect }),
      services: { now: () => NOW, kakaoCallbackQueue: queue },
      logSink: () => {},
    });
    return app.request(
      "/api/kakao/skills/message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
        body: JSON.stringify({
          bot: { id: shop.botId },
          userRequest: {
            utterance,
            callbackUrl: raw,
            block: { id: "conversation" },
            user: { id: userKey, type: "botUserKey" },
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

  async function admittedJob() {
    const queue = mockQueue();
    await receive(queue);
    const job = queue.jobs[0] as KakaoCallbackJob;
    const inbound = await stored(job);
    await db.query(
      "UPDATE consultations SET ai_disclosed_at=$3, ai_disclosed_policy_version=1 WHERE shop_id=$1 AND id=$2",
      [shop.shopId, inbound?.consultation_id, NOW],
    );
    return { job, consultationId: inbound?.consultation_id };
  }

  it.each([
    ["timeout", "ai_timeout"],
    ["unavailable", "ai_unavailable"],
    ["key_missing", "ai_key_missing"],
    ["limit_reached", "ai_limit_reached"],
    ["schema_invalid", "ai_output_rejected"],
  ] as const)("모델 실패 %s를 %s로 구분하고 같은 큐를 다시 처리해도 모델을 반복하지 않음", async (failure, code) => {
    const { job } = await admittedJob();
    const call = vi.fn<AiModel["call"]>(async () => ({ ok: false, failure, retryable: false, aiCallId: newUuid() }));
    const lines: string[] = [];
    const post = vi.fn<typeof fetch>(async () => Response.json({ status: "SUCCESS" }));
    const options = {
      now: () => new Date(NOW.getTime() + 5000),
      fetch: post,
      logSink: (line: string) => lines.push(line),
      services: { aiModel: { provider: "anthropic" as const, model: "claude-haiku-5-5", call } },
    };
    expect(await consumeKakaoCallback(job, env, options)).toBe("done");
    expect(await consumeKakaoCallback(job, env, options)).toBe("done");
    expect(call).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(lines.map((line) => JSON.parse(line))).toContainEqual({
      level: "warn",
      event: "kakao_callback_handoff",
      code,
    });
    const task = await db.query("SELECT id FROM handoffs WHERE shop_id=$1 AND source_message_id=$2", [
      shop.shopId,
      job.messageId,
    ]);
    expect(task.rowCount).toBe(1);
  });

  it("다시 할 수 있는 모델 실패만 1초 뒤 한 번 더 호출함", async () => {
    const { job } = await admittedJob();
    const call = vi.fn<AiModel["call"]>(async () => ({
      ok: false,
      failure: "unavailable",
      retryable: true,
      aiCallId: newUuid(),
    }));
    const wait = vi.fn(async (_ms: number) => {});
    expect(
      await consumeKakaoCallback(job, env, {
        now: () => new Date(NOW.getTime() + 5000),
        fetch: async () => Response.json({ status: "SUCCESS" }),
        logSink: () => {},
        services: { aiModel: { provider: "anthropic", model: "claude-haiku-5-5", call }, wait },
      }),
    ).toBe("done");
    expect(wait).toHaveBeenCalledExactlyOnceWith(1000);
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls.map(([input]) => input.attempt)).toEqual([
      { attempt: 1, callKind: "first" },
      { attempt: 2, callKind: "retry" },
    ]);
  });

  it("AI 고지 전 상담은 모델이 준비돼 있어도 호출하지 않음", async () => {
    const queue = mockQueue();
    await receive(queue);
    const call = vi.fn<AiModel["call"]>();
    expect(
      await consumeKakaoCallback(queue.jobs[0], env, {
        now: () => new Date(NOW.getTime() + 5000),
        fetch: async () => Response.json({ status: "SUCCESS" }),
        logSink: () => {},
        services: { aiModel: { provider: "anthropic", model: "claude-haiku-5-5", call } },
      }),
    ).toBe("done");
    expect(call).not.toHaveBeenCalled();
  });

  it("정상 모델 답은 같은 수신과 큐 세 번에도 AI 호출·초안 변경·콜백이 한 번임", async () => {
    const queue = mockQueue();
    const userKey = newUuid();
    for (let i = 0; i < 3; i++) {
      const response = await receive(queue, VALID, userKey, "문구는 생일 축하로 해 주세요");
      expect(response.headers.get("Siljang-Outcome")).toBe(i === 0 ? "callback_pending" : "duplicate");
    }
    expect(queue.jobs).toHaveLength(1);
    const job = queue.jobs[0] as KakaoCallbackJob;
    const inbound = await stored(job);
    // 모델 연결의 전제: 첫 고지/처리방침 전달 자체는 TASK-064가 맡는다.
    await db.query(
      "UPDATE consultations SET ai_disclosed_at=$3, ai_disclosed_policy_version=1 WHERE shop_id=$1 AND id=$2",
      [shop.shopId, inbound?.consultation_id, NOW],
    );
    const output = { reply: "문구를 생일 축하로 적을게요.", draft_patch: { lettering: "생일 축하" } };
    const vendor = vi.fn<typeof fetch>(async () =>
      sseResponse(
        anthropicStream("claude-haiku-5-5", JSON.stringify(output), {
          input: 1000,
          output: 100,
          cacheRead: 0,
          cacheWrite: 0,
        }),
      ),
    );
    const callback = vi.fn<typeof fetch>(async () => Response.json({ status: "SUCCESS" }));
    const runtime = {
      ...env,
      AI_PROVIDER: "anthropic",
      AI_MODEL: "claude-haiku-5-5",
      AI_USD_KRW: "1450.00",
      AI_USD_KRW_DATE: "2026-11-14",
      ANTHROPIC_API_KEY: "fake-provider-key",
    };
    vi.stubGlobal("fetch", vendor);
    try {
      for (let i = 0; i < 3; i++)
        expect(
          await consumeKakaoCallback(job, runtime, {
            now: () => new Date(NOW.getTime() + 5000),
            fetch: callback,
            logSink: () => {},
          }),
        ).toBe("done");
    } finally {
      vi.unstubAllGlobals();
    }
    expect(vendor).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(callback.mock.calls[0]?.[1]?.body));
    expect(body.template.outputs).toEqual([{ simpleText: { text: output.reply } }]);
    const calls = await db.query<{ n: number }>(
      "SELECT count(*)::integer n FROM ai_calls WHERE shop_id=$1 AND consultation_id=$2 AND result='success'",
      [shop.shopId, inbound?.consultation_id],
    );
    expect(calls.rows[0]?.n).toBe(1);
    const drafts = await db.query<{ lettering: string; revision: number }>(
      "SELECT lettering, revision FROM order_drafts WHERE shop_id=$1 AND consultation_id=$2",
      [shop.shopId, inbound?.consultation_id],
    );
    expect(drafts.rows).toEqual([{ lettering: "생일 축하", revision: 1 }]);
  });

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

  it.each(["sending", "finished", "deferred"] as const)(
    "큐 발행 실패 전에 소비자가 %s이면 즉시 안내를 겹쳐 만들지 않음",
    async (mode) => {
      const jobs: KakaoCallbackJob[] = [];
      const processing: Promise<"done" | "retry">[] = [];
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
        if (mode === "sending") await inFlight;
        return mode === "deferred" ? new Response(null, { status: 503 }) : Response.json({ status: "SUCCESS" });
      });
      const queue: KakaoCallbackQueue = {
        send: async (job) => {
          jobs.push(job);
          const work = consumeKakaoCallback(job, env, {
            now: () => new Date(NOW.getTime() + 5000),
            fetch: send,
            logSink: () => {},
          });
          processing.push(work);
          await (mode === "sending" ? Promise.race([entered, work]) : work);
          throw new Error("합성 큐 발행 결과 불명");
        },
      };
      let response: Response;
      try {
        response = await receive(queue);
      } finally {
        release();
        await Promise.all(processing);
      }
      const job = jobs[0];
      if (job === undefined) throw new Error("시험 큐 작업 없음");
      const consultation = (await stored(job))?.consultation_id;
      expect(
        (
          await db.query(
            "SELECT delivery FROM messages WHERE shop_id = $1 AND consultation_id = $2 AND direction = 'outbound'",
            [job.shopId, consultation],
          )
        ).rows,
      ).toEqual([{ delivery: mode === "deferred" ? "deferred" : "callback" }]);
      expect(response.status).toBe(200);
      expect(response.headers.get("Siljang-Outcome")).toBe("callback_pending");
      expectSchema("SkillCallbackAck", await response.json());
      expect(
        (
          await db.query("SELECT id FROM handoffs WHERE shop_id = $1 AND source_message_id = $2", [
            job.shopId,
            job.messageId,
          ])
        ).rowCount,
      ).toBe(1);
      expect(send).toHaveBeenCalledTimes(mode === "deferred" ? 2 : 1);
    },
  );

  it("AI 미준비 콜백은 외부 발신 전에 사장님 질문/할 일/대기 알림을 커밋함", async () => {
    const queue = mockQueue();
    await receive(queue);
    const job = queue.jobs[0] as KakaoCallbackJob;
    const observed: number[] = [];
    const send = vi.fn<typeof fetch>(async () => {
      const result = await db.query(
        `SELECT t.id FROM owner_tasks t JOIN handoffs h ON h.id = t.handoff_id
        JOIN owner_alerts a ON a.owner_task_id = t.id
        WHERE h.shop_id = $1 AND h.source_message_id = $2 AND a.status = 'pending'`,
        [shop.shopId, job.messageId],
      );
      observed.push(result.rowCount);
      return Response.json({ status: "SUCCESS" });
    });
    expect(await consumeKakaoCallback(job, env, { now: () => new Date(NOW.getTime() + 5000), fetch: send })).toBe(
      "done",
    );
    expect(observed).toEqual([1]);
    expect(JSON.parse(String(send.mock.calls[0]?.[1]?.body)).template.outputs).toEqual([
      { simpleText: { text: KAKAO_HANDOFF_TEXT } },
    ]);
    const { rows } = await db.query(
      `SELECT h.reason, c.status FROM handoffs h
      JOIN consultations c ON c.id = h.consultation_id WHERE h.shop_id = $1 AND h.source_message_id = $2`,
      [shop.shopId, job.messageId],
    );
    expect(rows).toEqual([{ reason: "ai_failure", status: "awaiting_owner" }]);
  });

  it("콜백 발신이 두 번 실패해도 사장님 기록과 다음 대화 안내를 보존함", async () => {
    const queue = mockQueue();
    await receive(queue);
    const job = queue.jobs[0] as KakaoCallbackJob;
    const send = vi.fn<typeof fetch>(async () => new Response(null, { status: 503 }));
    const now = () => new Date(NOW.getTime() + 5000);
    expect(await consumeKakaoCallback(job, env, { now, fetch: send })).toBe("done");
    const { rows } = await db.query(
      `SELECT h.reason, t.wait_status, m.delivery, m.body_masked FROM handoffs h
      JOIN owner_tasks t ON t.handoff_id = h.id
      JOIN messages m ON m.consultation_id = h.consultation_id AND m.direction = 'outbound'
      WHERE h.shop_id = $1 AND h.source_message_id = $2`,
      [shop.shopId, job.messageId],
    );
    expect(rows).toEqual([
      { reason: "ai_failure", wait_status: "waiting", delivery: "deferred", body_masked: KAKAO_HANDOFF_TEXT },
    ]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(await consumeKakaoCallback(job, env, { now, fetch: send })).toBe("done");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])("AI 설정 여부(%s)는 기록 결과 코드만 바꾸고 모델을 호출하지 않음", async (configured) => {
    const queue = mockQueue();
    await receive(queue);
    const job = queue.jobs[0] as KakaoCallbackJob;
    const lines: string[] = [];
    const send = vi.fn<typeof fetch>(async () => Response.json({ status: "SUCCESS" }));
    const runtime = configured
      ? {
          ...env,
          AI_PROVIDER: "anthropic",
          AI_MODEL: "claude-sonnet-5-5",
          AI_USD_KRW: "1450.00",
          AI_USD_KRW_DATE: "2026-11-14",
          ANTHROPIC_API_KEY: ["synthetic", "key", "x".repeat(24)].join("-"),
        }
      : env;
    await consumeKakaoCallback(job, runtime, {
      now: () => new Date(NOW.getTime() + 5000),
      fetch: send,
      logSink: (line) => lines.push(line),
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { level: "warn", event: "kakao_callback_handoff", code: configured ? "ai_unavailable" : "ai_key_missing" },
    ]);
  });

  it.each(["ended", "deleted", "dropped"])("닫힌 상담(%s)은 기한 안에도 발신하거나 다시 열지 않음", async (status) => {
    const queue = mockQueue();
    await receive(queue);
    const job = queue.jobs[0] as KakaoCallbackJob;
    const consultation = (await stored(job))?.consultation_id;
    await db.query(
      `UPDATE consultations SET status = $3, ended_at = $4,
      deleted_at = CASE WHEN $3 = 'deleted' THEN $4::timestamptz ELSE NULL END,
      dropped_at = CASE WHEN $3 = 'dropped' THEN $4::timestamptz ELSE NULL END WHERE shop_id = $1 AND id = $2`,
      [shop.shopId, consultation, status, NOW],
    );
    const send = vi.fn<typeof fetch>();
    const lines: string[] = [];
    await consumeKakaoCallback(job, env, {
      now: () => new Date(NOW.getTime() + 5000),
      fetch: send,
      logSink: (line) => lines.push(line),
    });
    expect(send).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
    expect((await stored(job))?.kakao_callback_enc).toBeNull();
    expect(
      (await db.query("SELECT status FROM consultations WHERE shop_id = $1 AND id = $2", [shop.shopId, consultation]))
        .rows,
    ).toEqual([{ status }]);
    expect(
      (
        await db.query("SELECT id FROM handoffs WHERE shop_id = $1 AND consultation_id = $2", [
          shop.shopId,
          consultation,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await db.query(
          "SELECT id FROM messages WHERE shop_id = $1 AND consultation_id = $2 AND direction = 'outbound'",
          [shop.shopId, consultation],
        )
      ).rowCount,
    ).toBe(0);
  });

  it("선점이 바뀐 소비자는 새 선점과 사장님 기록을 건드리지 않음", async () => {
    const queue = mockQueue();
    await receive(queue);
    const job = queue.jobs[0] as KakaoCallbackJob;
    const scoped = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }), db);
    const now = new Date(NOW.getTime() + 5000);
    const claim = await claimKakaoCallback(scoped, job.messageId, now);
    if (claim === null || claim === "busy") throw new Error("시험 콜백 선점 실패");
    const replaced = new Date(claim.kakao_callback_claim_until.getTime() - 1000);
    await db.query("UPDATE messages SET kakao_callback_claim_until = $3 WHERE shop_id = $1 AND id = $2", [
      shop.shopId,
      job.messageId,
      replaced,
    ]);
    expect(await prepareKakaoCallbackHandoff(scoped, job.messageId, claim, now)).toBe(false);
    expect(
      (
        await db.query("SELECT kakao_callback_claim_until FROM messages WHERE shop_id = $1 AND id = $2", [
          shop.shopId,
          job.messageId,
        ])
      ).rows,
    ).toEqual([{ kakao_callback_claim_until: replaced }]);
    expect(
      (
        await db.query("SELECT id FROM handoffs WHERE shop_id = $1 AND source_message_id = $2", [
          shop.shopId,
          job.messageId,
        ])
      ).rowCount,
    ).toBe(0);
  });

  it("기한 안의 알림 저장 실패는 발신 없이 롤백하고 큐 재시도로 한 번만 복구함", async () => {
    const queue = mockQueue();
    await receive(queue);
    const job = queue.jobs[0] as KakaoCallbackJob;
    const connect: DbConnector = (dsn) => {
      const conn = pgConnector(dsn);
      return {
        query: conn.query.bind(conn),
        abort: conn.abort.bind(conn),
        close: conn.close.bind(conn),
        transaction: (work) =>
          conn.transaction((tx) =>
            work({
              query: (sql, params) => {
                if (/INSERT INTO owner_alerts/.test(sql)) throw new Error("합성 알림 저장 실패");
                return tx.query(sql, params);
              },
            }),
          ),
      };
    };
    const now = () => new Date(NOW.getTime() + 5000);
    const send = vi.fn<typeof fetch>(async () => Response.json({ status: "SUCCESS" }));
    const lines: string[] = [];
    await expect(
      consumeKakaoCallback(job, env, { connect, now, fetch: send, logSink: (line) => lines.push(line) }),
    ).rejects.toThrow("합성 알림 저장 실패");
    expect(send).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
    expect((await stored(job))?.kakao_callback_enc).not.toBeNull();
    expect(
      (
        await db.query("SELECT kakao_callback_claim_until FROM messages WHERE shop_id = $1 AND id = $2", [
          shop.shopId,
          job.messageId,
        ])
      ).rows,
    ).toEqual([{ kakao_callback_claim_until: null }]);
    expect(
      (
        await db.query("SELECT id FROM handoffs WHERE shop_id = $1 AND source_message_id = $2", [
          shop.shopId,
          job.messageId,
        ])
      ).rowCount,
    ).toBe(0);
    await consumeKakaoCallback(job, env, { now, fetch: send, logSink: (line) => lines.push(line) });
    await consumeKakaoCallback(job, env, { now, fetch: send, logSink: (line) => lines.push(line) });
    expect(send).toHaveBeenCalledTimes(1);
    expect(lines).toHaveLength(1);
    expect(
      (
        await db.query(
          `SELECT h.id FROM handoffs h JOIN owner_tasks t ON t.handoff_id = h.id
      JOIN owner_alerts a ON a.owner_task_id = t.id WHERE h.shop_id = $1 AND h.source_message_id = $2`,
          [shop.shopId, job.messageId],
        )
      ).rowCount,
    ).toBe(1);
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

  it("만료된 질문을 사장님에게 넘기고 할 일·대기 알림·다음 대화 안내를 함께 남김", async () => {
    const queue = mockQueue();
    await receive(queue);
    const job = queue.jobs[0] as KakaoCallbackJob;
    const consultation = (await stored(job))?.consultation_id;
    const now = new Date(NOW.getTime() + SKILL_CALLBACK_MS + 1);
    const send = vi.fn<typeof fetch>();
    await consumeKakaoCallback(job, env, { now: () => now, fetch: send });
    const { rows } = await db.query(
      `SELECT h.reason, h.source_message_id, c.status, t.kind, t.wait_status, a.status AS alert_status,
        a.kind AS alert_kind, a.sent_at, m.body_masked, m.delivery
       FROM handoffs h JOIN consultations c ON c.id = h.consultation_id
       JOIN owner_tasks t ON t.handoff_id = h.id JOIN owner_alerts a ON a.owner_task_id = t.id
       JOIN messages m ON m.consultation_id = h.consultation_id AND m.direction = 'outbound'
       WHERE h.shop_id = $1 AND h.consultation_id = $2`,
      [shop.shopId, consultation],
    );
    expect(rows).toEqual([
      {
        reason: "callback_timeout",
        source_message_id: job.messageId,
        status: "awaiting_owner",
        kind: "handoff",
        wait_status: "waiting",
        alert_status: "pending",
        alert_kind: "new_task",
        sent_at: null,
        body_masked: "사장님 확인 뒤 답드릴게요.",
        delivery: "deferred",
      },
    ]);
    expect(send).not.toHaveBeenCalled();
  });

  it("같은 상담의 새 만료 질문은 열린 건에 덧붙이고 새 할 일을 만들지 않음", async () => {
    const queue = mockQueue();
    const user = newUuid();
    await receive(queue, VALID, user, "첫 합성 질문");
    await receive(queue, VALID, user, "두 번째 합성 질문");
    const first = queue.jobs[0] as KakaoCallbackJob;
    const second = queue.jobs[1] as KakaoCallbackJob;
    const consultation = (await stored(first))?.consultation_id;
    const now = () => new Date(NOW.getTime() + SKILL_CALLBACK_MS + 1);
    const send = vi.fn<typeof fetch>();
    await consumeKakaoCallback(first, env, { now, fetch: send });
    await consumeKakaoCallback(second, env, { now, fetch: send });
    const { rows } = await db.query(
      `SELECT h.source_message_id, q.message_id, q.reason FROM handoffs h
        JOIN handoff_questions q ON q.handoff_id = h.id WHERE h.shop_id = $1 AND h.consultation_id = $2`,
      [shop.shopId, consultation],
    );
    expect(rows).toEqual([
      { source_message_id: first.messageId, message_id: second.messageId, reason: "callback_timeout" },
    ]);
    expect(
      (
        await db.query(
          "SELECT id FROM owner_tasks WHERE shop_id = $1 AND handoff_id IN (SELECT id FROM handoffs WHERE consultation_id = $2)",
          [shop.shopId, consultation],
        )
      ).rowCount,
    ).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("같은 만료 질문을 동시에 세 번 받아도 질문·할 일·알림·안내는 한 번임", async () => {
    const queue = mockQueue();
    await receive(queue);
    const job = queue.jobs[0] as KakaoCallbackJob;
    const consultation = (await stored(job))?.consultation_id;
    const now = () => new Date(NOW.getTime() + SKILL_CALLBACK_MS + 1);
    const send = vi.fn<typeof fetch>();
    await Promise.all(Array.from({ length: 3 }, () => consumeKakaoCallback(job, env, { now, fetch: send })));
    const { rows } = await db.query(
      `SELECT h.id, t.id AS task_id, a.id AS alert_id, m.id AS reply_id FROM handoffs h
       JOIN owner_tasks t ON t.handoff_id = h.id JOIN owner_alerts a ON a.owner_task_id = t.id
       JOIN messages m ON m.consultation_id = h.consultation_id AND m.direction = 'outbound'
       WHERE h.shop_id = $1 AND h.consultation_id = $2`,
      [shop.shopId, consultation],
    );
    expect(rows).toHaveLength(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("같은 손님의 서로 다른 만료 질문이 겹쳐도 일반 건과 하루 덧붙임 알림은 하나씩임", async () => {
    const queue = mockQueue();
    const user = newUuid();
    for (let i = 0; i < 3; i += 1) await receive(queue, VALID, user, `합성 새 질문 ${i}`);
    const consultation = (await stored(queue.jobs[0] as KakaoCallbackJob))?.consultation_id;
    const now = () => new Date(NOW.getTime() + SKILL_CALLBACK_MS + 1);
    const send = vi.fn<typeof fetch>();
    await Promise.all(queue.jobs.map((job) => consumeKakaoCallback(job, env, { now, fetch: send })));
    expect(
      (
        await db.query("SELECT id FROM handoffs WHERE shop_id = $1 AND consultation_id = $2", [
          shop.shopId,
          consultation,
        ])
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await db.query(
          "SELECT q.id FROM handoff_questions q JOIN handoffs h ON h.id = q.handoff_id WHERE q.shop_id = $1 AND h.consultation_id = $2",
          [shop.shopId, consultation],
        )
      ).rowCount,
    ).toBe(2);
    const { rows } = await db.query(
      `SELECT a.kind, a.status, a.sent_at FROM owner_alerts a JOIN owner_tasks t ON t.id = a.owner_task_id
       JOIN handoffs h ON h.id = t.handoff_id WHERE a.shop_id = $1 AND h.consultation_id = $2 ORDER BY a.kind`,
      [shop.shopId, consultation],
    );
    expect(rows).toEqual([
      { kind: "handoff_appended", status: "pending", sent_at: null },
      { kind: "new_task", status: "pending", sent_at: null },
    ]);
    expect(send).not.toHaveBeenCalled();
  });

  it("사장님 기다림은 가게 시간대와 답하는 시간 안에서만 셈", async () => {
    const queue = mockQueue();
    await receive(queue);
    const job = queue.jobs[0] as KakaoCallbackJob;
    const now = new Date("2026-11-20T20:30:00+09:00");
    try {
      await db.query("UPDATE shops SET owner_wait_minutes = 90 WHERE id = $1", [shop.shopId]);
      await db.query("UPDATE business_calendars SET reply_start = '10:00', reply_end = '21:00' WHERE shop_id = $1", [
        shop.shopId,
      ]);
      await consumeKakaoCallback(job, env, { now: () => now, fetch: vi.fn() });
      const { rows } = await db.query<{ wait_due_at: Date }>(
        `SELECT t.wait_due_at FROM owner_tasks t JOIN handoffs h ON h.id = t.handoff_id
         WHERE t.shop_id = $1 AND h.source_message_id = $2`,
        [shop.shopId, job.messageId],
      );
      expect(rows[0]?.wait_due_at.toISOString()).toBe(new Date("2026-11-21T11:00:00+09:00").toISOString());
    } finally {
      await db.query("UPDATE shops SET owner_wait_minutes = 120 WHERE id = $1", [shop.shopId]);
      await db.query("UPDATE business_calendars SET reply_start = '09:00', reply_end = '21:00' WHERE shop_id = $1", [
        shop.shopId,
      ]);
    }
  });

  it("다른 가게 범위의 메시지 ID는 콜백과 질문/할 일을 건드리지 않음", async () => {
    const queue = mockQueue();
    await receive(queue);
    const job = queue.jobs[0] as KakaoCallbackJob;
    const other = await createShop(db, "다른 만료 시험 가게");
    const send = vi.fn<typeof fetch>();
    await consumeKakaoCallback({ ...job, shopId: other.shopId }, env, {
      now: () => new Date(NOW.getTime() + SKILL_CALLBACK_MS + 1),
      fetch: send,
    });
    expect((await stored(job))?.kakao_callback_enc).not.toBeNull();
    expect(
      (
        await db.query("SELECT id FROM handoffs WHERE shop_id = $1 AND source_message_id = $2", [
          other.shopId,
          job.messageId,
        ])
      ).rowCount,
    ).toBe(0);
    expect((await db.query("SELECT id FROM owner_tasks WHERE shop_id = $1", [other.shopId])).rowCount).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("끝난 상담은 만료 콜백을 지워도 다시 열거나 새 질문/안내를 만들지 않음", async () => {
    const queue = mockQueue();
    await receive(queue);
    const job = queue.jobs[0] as KakaoCallbackJob;
    const consultation = (await stored(job))?.consultation_id;
    await db.query("UPDATE consultations SET status = 'ended', ended_at = $3 WHERE shop_id = $1 AND id = $2", [
      shop.shopId,
      consultation,
      NOW,
    ]);
    await consumeKakaoCallback(job, env, {
      now: () => new Date(NOW.getTime() + SKILL_CALLBACK_MS + 1),
      fetch: vi.fn(),
    });
    expect((await stored(job))?.kakao_callback_enc).toBeNull();
    expect(
      (await db.query("SELECT status FROM consultations WHERE shop_id = $1 AND id = $2", [shop.shopId, consultation]))
        .rows,
    ).toEqual([{ status: "ended" }]);
    expect(
      (
        await db.query("SELECT id FROM handoffs WHERE shop_id = $1 AND consultation_id = $2", [
          shop.shopId,
          consultation,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await db.query(
          "SELECT id FROM messages WHERE shop_id = $1 AND consultation_id = $2 AND direction = 'outbound'",
          [shop.shopId, consultation],
        )
      ).rowCount,
    ).toBe(0);
  });

  it("알림 저장이 실패하면 질문/할 일과 콜백 제거도 롤백돼 재시도로 복구함", async () => {
    const queue = mockQueue();
    await receive(queue);
    const job = queue.jobs[0] as KakaoCallbackJob;
    const consultation = (await stored(job))?.consultation_id;
    const connect: DbConnector = (secret) => {
      const conn = pgConnector(secret);
      return {
        query: conn.query.bind(conn),
        abort: conn.abort.bind(conn),
        close: conn.close.bind(conn),
        transaction: (work) =>
          conn.transaction((tx) =>
            work({
              query: (sql, params) => {
                if (/INSERT INTO owner_alerts/.test(sql)) throw new Error("합성 알림 저장 실패");
                return tx.query(sql, params);
              },
            }),
          ),
      };
    };
    const now = () => new Date(NOW.getTime() + SKILL_CALLBACK_MS + 1);
    const send = vi.fn<typeof fetch>();
    await expect(consumeKakaoCallback(job, env, { connect, now, fetch: send })).rejects.toThrow("합성 알림 저장 실패");
    expect((await stored(job))?.kakao_callback_enc).not.toBeNull();
    expect(
      (
        await db.query("SELECT id FROM handoffs WHERE shop_id = $1 AND consultation_id = $2", [
          shop.shopId,
          consultation,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await db.query(
          "SELECT id FROM messages WHERE shop_id = $1 AND consultation_id = $2 AND direction = 'outbound'",
          [shop.shopId, consultation],
        )
      ).rowCount,
    ).toBe(0);
    await expect(consumeKakaoCallback(job, env, { now, fetch: send })).resolves.toBe("done");
    expect(
      (
        await db.query("SELECT id FROM handoffs WHERE shop_id = $1 AND consultation_id = $2", [
          shop.shopId,
          consultation,
        ])
      ).rowCount,
    ).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["alert", "reply"] as const)(
    "큐 거절 뒤 %s 저장 실패는 봉투를 보존하고 소비자 재시도로 한 번 복구함",
    async (failure) => {
      let fail = true;
      const connect: DbConnector = (dsn) => {
        const conn = pgConnector(dsn);
        return {
          query: conn.query.bind(conn),
          abort: conn.abort.bind(conn),
          close: conn.close.bind(conn),
          transaction: (work) =>
            conn.transaction((tx) =>
              work({
                query: (sql, params) => {
                  if (
                    fail &&
                    ((failure === "alert" && /INSERT INTO owner_alerts/.test(sql)) ||
                      (failure === "reply" && /INSERT INTO messages/.test(sql) && /'outbound'/.test(sql)))
                  )
                    throw new Error("합성 큐 거절 후 저장 실패");
                  return tx.query(sql, params);
                },
              }),
            ),
        };
      };
      const jobs: KakaoCallbackJob[] = [];
      const queue: KakaoCallbackQueue = {
        send: async (job) => {
          jobs.push(job);
          throw new Error("합성 큐 거절");
        },
      };
      const response = await receive(queue, VALID, newUuid(), "합성 큐 거절 질문", connect);
      expect(response.status).toBe(200);
      expect(response.headers.get("Siljang-Outcome")).toBe("server_error");
      const job = jobs[0];
      if (job === undefined) throw new Error("시험 큐 작업 없음");
      const source = await stored(job);
      expect(source?.kakao_callback_enc).not.toBeNull();
      expect(
        (
          await db.query("SELECT id FROM handoffs WHERE shop_id = $1 AND source_message_id = $2", [
            job.shopId,
            job.messageId,
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await db.query(
            "SELECT id FROM messages WHERE shop_id = $1 AND consultation_id = $2 AND direction = 'outbound'",
            [job.shopId, source?.consultation_id],
          )
        ).rowCount,
      ).toBe(0);
      fail = false;
      const send = vi.fn<typeof fetch>(async () => Response.json({ status: "SUCCESS" }));
      const options = { now: () => new Date(NOW.getTime() + 5000), fetch: send, logSink: () => {} };
      expect(await consumeKakaoCallback(job, env, options)).toBe("done");
      expect(await consumeKakaoCallback(job, env, options)).toBe("done");
      expect(send).toHaveBeenCalledTimes(1);
      expect((await stored(job))?.kakao_callback_enc).toBeNull();
      expect(
        (
          await db.query(
            `SELECT h.reason, a.status, a.sent_at FROM handoffs h
      JOIN owner_tasks t ON t.handoff_id = h.id JOIN owner_alerts a ON a.owner_task_id = t.id
      WHERE h.shop_id = $1 AND h.source_message_id = $2`,
            [job.shopId, job.messageId],
          )
        ).rows,
      ).toEqual([{ reason: "ai_failure", status: "pending", sent_at: null }]);
      expect(
        (
          await db.query(
            "SELECT delivery FROM messages WHERE shop_id = $1 AND consultation_id = $2 AND direction = 'outbound'",
            [job.shopId, source?.consultation_id],
          )
        ).rows,
      ).toEqual([{ delivery: "callback" }]);
    },
  );

  it("큐가 접수를 거절하면 콜백 예고 없이 바로 답하고 주소 봉투를 지움", async () => {
    const send = vi.fn<KakaoCallbackQueue["send"]>(async () => {
      throw new Error("시험 큐 실패");
    });
    const response = await receive({ send });
    expect(response.headers.get("Siljang-Outcome")).toBe("ai_key_missing");
    expectSchema("SkillTemplateResponse", await response.json());
    const job = send.mock.calls[0]?.[0] as KakaoCallbackJob;
    expect((await stored(job))?.kakao_callback_enc).toBeNull();
  });
});
