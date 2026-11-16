import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { FIRST_ATTEMPT, nextAttempt } from "../src/ai-calls";
import {
  AI_ORIGINS,
  type AiCallOutcome,
  type AiModelOptions,
  createAiModel,
  TracingEnabledError,
} from "../src/ai-model";
import type { AiProvider } from "../src/ai-prices";
import { providerOutputSchema } from "../src/ai-turn-output";
import { type AiSettings, type AppEnv, Secret } from "../src/settings";
import { createShopScope, type ShopRequestDb, shopRequestDb } from "../src/shop-scope";
import {
  anthropicStream,
  delayedStream,
  jsonResponse,
  type MockUsage,
  never,
  openaiStream,
  type Reply,
  recordingFetch,
  sseResponse,
  stalledStream,
} from "./support/ai-mock";
import { describeDb, newUuid, testDb } from "./support/db";
import { createShop, type ShopFixture } from "./support/shops";

// TASK-026 모델 호출 모듈(REQ-266·138·150, 06 DEC-25·DEC-17, 04 AI-1). 유료 호출 0번: 모든 응답은 각 회사의 실제 스트리밍
// 응답 모양을 따른 모의 응답이다. 키는 시험 안에서 만든 가짜 값이다.

const MODELS: Readonly<Record<AiProvider, string>> = { anthropic: "claude-sonnet-5-5", openai: "gpt-6.1-terra" };
const PROVIDERS = ["anthropic", "openai"] as const;
const FX = { rate: "1450.00", date: "2026-11-14" };
/** 추적 도구 주소 대신 쓰는 풀리지 않는 이름(RFC 2606 .invalid). */
const TRACE_ORIGIN = "https://tracing.test.invalid";
const USAGE: MockUsage = { input: 1000, output: 150, cacheRead: 800, cacheWrite: 100 };
/** 06 AiTurnOutput에 맞는 출력(합성 시험 글). */
const OUTPUT = {
  reply: "1호 생크림은 35,000원이에요. 픽업 날짜를 알려 주시겠어요?",
  draft_patch: { size: "1호", flavor: "생크림", extras: ["초"] },
  quote_request: { size: "1호", flavor: "생크림" },
};
const MESSAGES = [
  { role: "system", content: "시험 가게의 상담 도우미입니다(합성 시험 글)." },
  { role: "user", content: "1호 생크림 얼마예요?" },
] as const;

function settings(provider: AiProvider, key: boolean = true): AiSettings {
  return {
    provider,
    model: MODELS[provider],
    effort: null,
    fx: FX,
    apiKey: key ? new Secret(["test", "only", "not", "a", "key"].join("-")) : null,
  };
}

/** OpenAI strict 출력은 없는 필드를 null로 채워 온다(providerOutputSchema의 꼴 그대로). */
function strictFill(schema: Record<string, unknown>, value: unknown): unknown {
  const props = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (props === undefined || typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [name, prop] of Object.entries(props)) {
    const inner = (prop.anyOf as Record<string, unknown>[] | undefined)?.[0] ?? prop;
    const v = (value as Record<string, unknown>)[name];
    out[name] = v === undefined ? null : strictFill(inner, v);
  }
  return out;
}

/** 회사의 실제 응답 모양(SSE 본문)으로 text를 담는다. */
function streamBody(provider: AiProvider, text: string, usage: MockUsage = USAGE): string {
  return provider === "anthropic"
    ? anthropicStream(MODELS[provider], text, usage)
    : openaiStream(MODELS[provider], text, usage);
}

function streamReply(provider: AiProvider, text: string, usage: MockUsage = USAGE): Reply {
  return () => sseResponse(streamBody(provider, text, usage));
}

function outputText(provider: AiProvider, output: unknown): string {
  return JSON.stringify(provider === "openai" ? strictFill(providerOutputSchema("openai"), output) : output);
}

/** 스트림 본문에서 첫 출력 글 조각 이벤트가 시작하는 곳. */
function firstTextEvent(provider: AiProvider, body: string): number {
  const marker = provider === "anthropic" ? '"type":"text_delta"' : "event: response.output_text.delta";
  const at = body.indexOf(marker);
  if (at < 0) throw new Error("no text event");
  return body.lastIndexOf("event:", at);
}

interface AiCallDbRow {
  provider: string;
  model: string;
  attempt: number;
  call_kind: string;
  prompt_version: string;
  reasoning: Record<string, unknown> | null;
  first_token_ms: number | null;
  total_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  cost_usd: string | null;
  cost_krw: string | null;
  cost_basis: string | null;
  result: string;
  stop_reason: string | null;
  error_kind: string | null;
  fallback_reason: string | null;
}

describeDb("모델 호출 모듈(TASK-026)", () => {
  const db = testDb();
  let f: ShopFixture;
  let shopDb: ShopRequestDb;

  beforeAll(async () => {
    f = await createShop(db, "AI시험가게");
    shopDb = shopRequestDb(createShopScope(f.shopId, { kind: "customer", channelId: f.channelId }), db);
  });

  afterAll(async () => {
    await db.close();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function run(
    provider: AiProvider,
    reply: Reply,
    opts: { appEnv?: AppEnv; key?: boolean; model?: AiModelOptions } = {},
  ): Promise<{ outcome: AiCallOutcome; row: AiCallDbRow; seen: ReturnType<typeof recordingFetch>["seen"] }> {
    const rec = recordingFetch(reply);
    const model = createAiModel(opts.appEnv ?? "development", settings(provider, opts.key ?? true), {
      fetch: rec.fetch,
      ...opts.model,
    });
    const outcome = await model.call({
      db: shopDb,
      consultationId: f.consultationId,
      traceId: `t-${newUuid()}`,
      attempt: FIRST_ATTEMPT,
      promptVersion: "ai1-test-v1",
      messages: MESSAGES,
    });
    const { rows } = await db.query<AiCallDbRow>("SELECT * FROM ai_calls WHERE id = $1", [outcome.aiCallId]);
    const row = rows[0];
    if (row === undefined) throw new Error("no ai_calls row");
    return { outcome, row, seen: rec.seen };
  }

  it("같은 입력을 설정만 바꿔 두 회사에 보내면 같은 AiTurnOutput이 나옴(REQ-266, DEC-17)", async () => {
    const outputs: unknown[] = [];
    for (const provider of PROVIDERS) {
      const { outcome, seen } = await run(provider, streamReply(provider, outputText(provider, OUTPUT)));
      expect(outcome.ok, provider).toBe(true);
      if (outcome.ok) outputs.push(outcome.output);
      // 요청은 고른 회사의 공식 주소 한 곳으로 한 번만.
      expect(seen.map((s) => new URL(s.url).origin)).toEqual([AI_ORIGINS[provider]]);
    }
    expect(outputs[0]).toEqual(OUTPUT);
    expect(outputs[1]).toEqual(outputs[0]);
  });

  it("회사마다 요청 모양: 구조화 출력·스트리밍·키 머리, OpenAI는 Responses API에 store: false", async () => {
    const a = await run("anthropic", streamReply("anthropic", outputText("anthropic", OUTPUT)));
    const ab = a.seen[0]?.body ?? {};
    expect(new URL(a.seen[0]?.url ?? "").pathname).toBe("/v1/messages");
    expect(ab.model).toBe("claude-sonnet-5-5");
    expect(ab.stream).toBe(true);
    expect(ab.max_tokens).toBe(4096);
    expect((ab.output_config as { format?: { type?: string } }).format?.type).toBe("json_schema");
    expect(a.seen[0]?.headerNames).toEqual(expect.arrayContaining(["authorization", "anthropic-version"]));

    const o = await run("openai", streamReply("openai", outputText("openai", OUTPUT)));
    const ob = o.seen[0]?.body ?? {};
    expect(new URL(o.seen[0]?.url ?? "").pathname).toBe("/v1/responses");
    expect(ob.model).toBe("gpt-6.1-terra");
    expect(ob.store).toBe(false);
    expect(ob.stream).toBe(true);
    expect(ob.max_output_tokens).toBe(4096);
    const format = (ob.text as { format?: { type?: string; strict?: boolean; schema?: unknown } }).format;
    expect(format?.type).toBe("json_schema");
    expect(format?.strict).toBe(true);
    expect(format?.schema).toEqual(providerOutputSchema("openai"));
    expect(o.seen[0]?.headerNames).toContain("authorization");

    // 서버에서만 부르므로 브라우저 허용 머리는 보내지 않는다(LangChain 기본값 dangerouslyAllowBrowser를 끔).
    expect(a.seen[0]?.headerNames).not.toContain("anthropic-dangerous-direct-browser-access");
  });

  it("첫 토큰 시각은 첫 출력 글 조각까지(시작 이벤트·추론은 세지 않음)", async () => {
    for (const provider of PROVIDERS) {
      const text = streamBody(provider, outputText(provider, OUTPUT));
      const cut = firstTextEvent(provider, text);
      const { row } = await run(provider, (_req, signal) =>
        delayedStream([text.slice(0, cut), text.slice(cut)], 60, signal),
      );
      expect(row.result, provider).toBe("success");
      expect(row.first_token_ms, provider).toBeGreaterThanOrEqual(50);
      expect(row.total_ms, provider).toBeGreaterThanOrEqual(row.first_token_ms ?? 0);
    }
  });

  it("호출마다 ai_calls에 회사·모델·토큰·금액이 남음(REQ-150, TBL-048)", async () => {
    // 금액: 네 토큰 × 요금표(백만 토큰당 달러) → 올림. 원은 환율 1450.00으로.
    const expected: Record<AiProvider, { usd: string; krw: string }> = {
      // sonnet-5-5: 1000×2 + 800×0.10 + 100×2.50 + 150×10 = 3830 → $0.003830, ×1450 = 5.5535원 → 5.56
      anthropic: { usd: "0.003830", krw: "5.56" },
      // gpt-6.1-terra: 1000×1 + 800×0.05 + 100×1.25 + 150×5 = 1915 → $0.001915, ×1450 = 2.77675원 → 2.78
      openai: { usd: "0.001915", krw: "2.78" },
    };
    for (const provider of PROVIDERS) {
      const { row } = await run(provider, streamReply(provider, outputText(provider, OUTPUT)));
      expect(row).toMatchObject({
        provider,
        model: MODELS[provider],
        attempt: 1,
        call_kind: "first",
        prompt_version: "ai1-test-v1",
        reasoning: { effort: null, max_output_tokens: 4096 },
        input_tokens: 1000,
        output_tokens: 150,
        cache_read_tokens: 800,
        cache_write_tokens: 100,
        cost_usd: expected[provider].usd,
        cost_krw: expected[provider].krw,
        result: "success",
        error_kind: null,
        fallback_reason: null,
      });
      expect(row.stop_reason).toBe(provider === "anthropic" ? "end_turn" : "completed");
      expect(row.cost_basis).toContain("prices 2026-11-16");
      expect(row.cost_basis).toContain("usd-krw 1450.00 (2026-11-14)");
      expect(row.first_token_ms).not.toBeNull();
      expect(row.total_ms).not.toBeNull();
    }
  });

  it("스키마에 맞지 않는 출력은 schema_invalid(토큰·금액은 남김), JSON이 아니어도 같음", async () => {
    const bad = { ...OUTPUT, reply: "가".repeat(601) };
    for (const provider of PROVIDERS) {
      for (const text of [outputText(provider, bad), "{not json"]) {
        const { outcome, row } = await run(provider, streamReply(provider, text));
        expect(outcome).toMatchObject({ ok: false, failure: "schema_invalid", retryable: false });
        expect(row).toMatchObject({ result: "success", fallback_reason: "schema_invalid", output_tokens: 150 });
        expect(row.cost_krw).not.toBeNull();
      }
    }
  });

  it("모델 클라이언트의 자체 다시 하기는 꺼짐: 오류마다 요청 한 번, 실패 종류와 한 행(AI-1)", async () => {
    const cases = [
      { status: 500, result: "failure", failure: "unavailable", retryable: true },
      { status: 529, result: "failure", failure: "unavailable", retryable: true },
      { status: 429, result: "limit_reached", failure: "limit_reached", retryable: true },
      { status: 401, result: "failure", failure: "key_missing", retryable: false },
      { status: 400, result: "failure", failure: "unavailable", retryable: false },
    ] as const;
    for (const provider of PROVIDERS) {
      for (const c of cases) {
        const body = { type: "error", error: { type: "test_error", message: "synthetic test error" } };
        const { outcome, row, seen } = await run(provider, () => jsonResponse(body, c.status));
        expect(seen.length, `${provider} ${c.status}`).toBe(1);
        expect(outcome).toMatchObject({ ok: false, failure: c.failure, retryable: c.retryable });
        expect(row).toMatchObject({
          result: c.result,
          error_kind: `http_${c.status}`,
          fallback_reason: "model_error",
          input_tokens: null,
          cost_krw: null,
        });
      }
    }
  });

  it("연결 3초·전체 20초에서 끊고 result timeout(시험은 짧은 값으로)", async () => {
    for (const provider of PROVIDERS) {
      const connect = await run(provider, (_req, signal) => never(signal), {
        model: { connectTimeoutMs: 30, totalTimeoutMs: 5_000 },
      });
      expect(connect.outcome).toMatchObject({ ok: false, failure: "timeout", retryable: true });
      expect(connect.row).toMatchObject({
        result: "timeout",
        error_kind: "connect_timeout",
        fallback_reason: "timeout",
      });

      // 머리는 곧 오지만 본문(생성)이 끝나지 않음 → 전체 기한에서 끊김.
      const first = provider === "anthropic" ? anthropicStream(MODELS.anthropic, "", USAGE).split("\n\n")[0] : "";
      const total = await run(provider, (_req, signal) => stalledStream(`${first}\n\n`, signal), {
        model: { connectTimeoutMs: 5_000, totalTimeoutMs: 80 },
      });
      expect(total.outcome).toMatchObject({ ok: false, failure: "timeout", retryable: true });
      expect(total.row).toMatchObject({ result: "timeout", error_kind: "total_timeout", fallback_reason: "timeout" });
    }
  });

  it("연결 실패는 network, 키가 없으면 보내지 않고 key_missing 한 행", async () => {
    for (const provider of PROVIDERS) {
      const down = await run(provider, () => {
        throw new TypeError("fetch failed");
      });
      expect(down.outcome).toMatchObject({ ok: false, failure: "unavailable", retryable: true });
      expect(down.row).toMatchObject({ result: "failure", error_kind: "network" });

      const noKey = await run(provider, streamReply(provider, outputText(provider, OUTPUT)), { key: false });
      expect(noKey.seen).toEqual([]);
      expect(noKey.outcome).toMatchObject({ ok: false, failure: "key_missing", retryable: false });
      expect(noKey.row).toMatchObject({ result: "failure", error_kind: "key_missing", fallback_reason: "model_error" });
    }
  });

  it("운영 설정에서 바깥 요청을 모두 모아도 추적 도구 주소로 간 요청은 0건(REQ-138)", async () => {
    for (const provider of PROVIDERS) {
      const rec = recordingFetch(streamReply(provider, outputText(provider, OUTPUT)));
      vi.stubGlobal("fetch", rec.fetch);
      const model = createAiModel("production", settings(provider)); // 회사 fetch도 전역 fetch(가짜)를 거침
      const outcome = await model.call({
        db: shopDb,
        consultationId: f.consultationId,
        traceId: `t-${newUuid()}`,
        attempt: FIRST_ATTEMPT,
        promptVersion: "ai1-test-v1",
        messages: MESSAGES,
      });
      expect(outcome.ok).toBe(true);
      await new Promise((r) => setTimeout(r, 50)); // 뒤에서 보내는 요청이 있다면 기다림
      expect(rec.seen.map((s) => new URL(s.url).origin)).toEqual([AI_ORIGINS[provider]]);
      expect(rec.seen.filter((s) => /langchain|langsmith|smith\./.test(s.url))).toEqual([]);
    }
  });

  it("운영에서 프로세스 환경에 추적이 켜져 있으면 부르지 않음(요청 0건, 행 0건)", async () => {
    vi.stubEnv("LANGSMITH_TRACING", "true");
    const rec = recordingFetch(streamReply("anthropic", outputText("anthropic", OUTPUT)));
    vi.stubGlobal("fetch", rec.fetch);
    const traceId = `t-${newUuid()}`;
    const model = createAiModel("production", settings("anthropic"));
    await expect(
      model.call({
        db: shopDb,
        consultationId: f.consultationId,
        traceId,
        attempt: FIRST_ATTEMPT,
        promptVersion: "ai1-test-v1",
        messages: MESSAGES,
      }),
    ).rejects.toBeInstanceOf(TracingEnabledError);
    expect(rec.seen).toEqual([]);
    const { rows } = await db.query("SELECT 1 FROM ai_calls WHERE trace_id = $1", [traceId]);
    expect(rows).toEqual([]);
  });

  it("시험이 추적 요청을 잡을 수 있음: 개발에서 추적을 켜면 추적 도구로 가는 요청이 보임", async () => {
    // 위 '0건' 시험이 헛돌지 않는다는 확인. 추적 주소는 풀리지 않는 .invalid 이름(RFC 2606)이라 가짜 fetch를
    // 벗어난 요청이 있어도 어디에도 닿지 않는다.
    vi.stubEnv("LANGSMITH_TRACING", "true");
    vi.stubEnv("LANGSMITH_ENDPOINT", TRACE_ORIGIN);
    const rec = recordingFetch((req) =>
      new URL(req.url).origin === AI_ORIGINS.openai
        ? streamReply("openai", outputText("openai", OUTPUT))(req, undefined)
        : jsonResponse({}, 200),
    );
    vi.stubGlobal("fetch", rec.fetch);
    const model = createAiModel("development", settings("openai"));
    const outcome = await model.call({
      db: shopDb,
      consultationId: f.consultationId,
      traceId: `t-${newUuid()}`,
      attempt: FIRST_ATTEMPT,
      promptVersion: "ai1-test-v1",
      messages: MESSAGES,
    });
    expect(outcome.ok).toBe(true);
    const { awaitAllCallbacks } = await import("@langchain/core/callbacks/promises");
    await awaitAllCallbacks();
    await vi.waitFor(() => expect(rec.seen.some((s) => new URL(s.url).origin === TRACE_ORIGIN)).toBe(true), {
      timeout: 3_000,
      interval: 50,
    });
  });

  it("순번과 다시 한 종류: 같은 차례·순번은 한 행(ai_calls_attempt_uq), first는 순번 1에만(ai_calls_kind_chk)", async () => {
    const traceId = `t-${newUuid()}`;
    const rec = recordingFetch(streamReply("anthropic", outputText("anthropic", OUTPUT)));
    const model = createAiModel("development", settings("anthropic"), { fetch: rec.fetch });
    const input = {
      db: shopDb,
      consultationId: f.consultationId,
      traceId,
      promptVersion: "ai1-test-v1",
      messages: MESSAGES,
    };
    await model.call({ ...input, attempt: FIRST_ATTEMPT });
    const second = nextAttempt(FIRST_ATTEMPT, "retry");
    expect(second).toEqual({ attempt: 2, callKind: "retry" });
    await model.call({ ...input, attempt: second });
    await expect(model.call({ ...input, attempt: second })).rejects.toMatchObject({ code: "23505" });
    await expect(model.call({ ...input, attempt: { attempt: 3, callKind: "first" } })).rejects.toMatchObject({
      code: "23514",
    });
    const { rows } = await db.query<{ attempt: number; call_kind: string }>(
      "SELECT attempt, call_kind FROM ai_calls WHERE trace_id = $1 ORDER BY attempt",
      [traceId],
    );
    expect(rows).toEqual([
      { attempt: 1, call_kind: "first" },
      { attempt: 2, call_kind: "retry" },
    ]);
  });

  it("ai_calls에는 대화 글·키가 남지 않음(G6, REQ-135)", async () => {
    const traceId = `t-${newUuid()}`;
    const rec = recordingFetch(streamReply("openai", outputText("openai", OUTPUT)));
    const model = createAiModel("development", settings("openai"), { fetch: rec.fetch });
    await model.call({
      db: shopDb,
      consultationId: f.consultationId,
      traceId,
      attempt: FIRST_ATTEMPT,
      promptVersion: "ai1-test-v1",
      messages: MESSAGES,
    });
    const { rows } = await db.query("SELECT row_to_json(a)::text AS j FROM ai_calls a WHERE trace_id = $1", [traceId]);
    const text = String((rows[0] as { j: string }).j);
    for (const piece of ["생크림", "35,000", "합성 시험 글", "test-only-not-a-key"]) expect(text).not.toContain(piece);
  });
});
