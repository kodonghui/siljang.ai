/**
 * 모델 호출 모듈(TASK-026; REQ-266·138·150, 06 DEC-25·DEC-17, 04 AI-1·SPEC-021). AI 모델은 이 파일에서만 부른다.
 *
 * - 회사(Anthropic·OpenAI)와 모델은 배포 설정(settings.ts의 AI_PROVIDER·AI_MODEL)으로 하나만 고른다. 그래프·도구 코드는
 *   회사 SDK를 직접 부르지 않고 이 모듈의 call()을 부른다(정적 시험 test/ai-model-static.test.ts).
 * - 회사마다 LangChain 채팅 모델(@langchain/anthropic의 ChatAnthropic, @langchain/openai의 ChatOpenAI)을 감싼다(04 AI-1,
 *   동희님 11/11 결정). OpenAI는 Responses API에 store: false(zdrEnabled)로 보낸다(응답을 회사에 두지 않음, REQ-141).
 * - 출력은 06 AiTurnOutput 하나. 회사마다 구조화 출력(JSON 스키마)으로 받고, 받은 뒤 계약 스키마로 다시 확인한다.
 * - 한 번의 호출은 연결 3초(응답 머리를 받기까지), 전체 20초에서 끊는다. 스트리밍으로 받아 머리는 곧 오고 첫 토큰 시각도 잰다.
 *   모델 클라이언트의 자체 다시 하기는 끈다(LangChain·SDK maxRetries 0). 다시 하기는 그래프 층이 retryable을 보고 한다.
 * - 호출마다 ai_calls 한 행(ai-calls.ts): 회사·모델·토큰·금액(ai-prices.ts)·시간·결과. 내용은 남기지 않는다(G6).
 *   토큰 수와 멈춘 사유는 회사 응답의 usage에서 그대로 읽는다(ai-usage.ts). 첫 토큰 시각은 첫 출력 글 조각(추론 제외)이다.
 * - 운영에서 추적 도구(LangSmith)가 켜져 있으면 부르지 않는다(REQ-138). 설정 검사가 먼저 막고, 호출 직전에 한 번 더 본다.
 * - 보내는 곳은 고른 회사의 공식 주소 하나다. 환경 변수(ANTHROPIC_BASE_URL 등)가 주소를 바꾸지 못하게 주소를 정해 둔다.
 */
import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { type AiCallRow, type Attempt, recordAiCall } from "./ai-calls";
import { type AiProvider, type Cost, costOf, type ModelPrice, PriceTierError, priceOf } from "./ai-prices";
import { type AiTurnOutput, checkTurnOutput, normalizeProviderOutput, providerOutputSchema } from "./ai-turn-output";
import { UsageMeter } from "./ai-usage";
import { type AiSettings, type AppEnv, SettingsError, tracingSwitchInProcess } from "./settings";
import type { ShopDb } from "./shop-scope";

/** 04 AI-1: 모델 호출 한 번은 연결 3초, 전체 20초에서 끊는다. */
export const AI_CONNECT_TIMEOUT_MS = 3_000;
export const AI_TOTAL_TIMEOUT_MS = 20_000;
/** 출력(추론 포함)의 최대 토큰. AiTurnOutput은 답 600자와 고칠 값 몇 개라 넉넉하다. */
export const AI_MAX_OUTPUT_TOKENS = 4_096;

/** 회사마다 보내는 곳(공식 API 주소). 이 밖으로 가는 요청은 보내지 않는다. */
export const AI_ORIGINS: Readonly<Record<AiProvider, string>> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com",
};

export interface AiMessage {
  readonly role: "system" | "user" | "assistant";
  /** 마스킹한 글(SPEC-021, TASK-066). 이 모듈은 글을 기록·로그에 남기지 않는다. */
  readonly content: string;
}

export interface AiCallInput {
  /** 가게 범위 연결(ai_calls 행을 이 가게에 남김). */
  readonly db: ShopDb;
  readonly consultationId: string;
  /** 손님 메시지 한 차례의 그래프 실행 ID(ai_calls.trace_id). */
  readonly traceId: string;
  readonly attempt: Attempt;
  readonly promptVersion: string;
  readonly messages: readonly AiMessage[];
}

/** 06 DEC-07 스킬 결과(ai_timeout·ai_unavailable·ai_key_missing·ai_limit_reached)와 AI-1 서버 확인(schema_invalid)에 맞춘 실패. */
export type AiFailure = "timeout" | "unavailable" | "key_missing" | "limit_reached" | "schema_invalid";

export type AiCallOutcome =
  | { readonly ok: true; readonly output: AiTurnOutput; readonly aiCallId: string }
  | {
      readonly ok: false;
      readonly failure: AiFailure;
      /** AI-1이 '1초 뒤 한 번만 다시 하기'를 하는 실패(시간 초과·429·5xx·연결 실패). 다시 할지는 그래프 층이 기한을 보고 정함. */
      readonly retryable: boolean;
      readonly aiCallId: string;
    };

export interface AiModel {
  readonly provider: AiProvider;
  readonly model: string;
  call(input: AiCallInput): Promise<AiCallOutcome>;
}

export interface AiModelOptions {
  /** 회사로 보내는 fetch. 시험은 모의 응답을 넣는다. 없으면 그때의 전역 fetch. */
  readonly fetch?: typeof fetch;
  /** 밀리초 시계(시간 재기). */
  readonly clock?: () => number;
  /** 보낸 시각(ai_calls.sent_at). */
  readonly now?: () => Date;
  readonly connectTimeoutMs?: number;
  readonly totalTimeoutMs?: number;
}

/** 운영에서 추적 도구가 켜져 있어 부르지 않음(REQ-138). 설정 잘못이라 ai_calls 행도 남기지 않는다. */
export class TracingEnabledError extends Error {
  override readonly name = "TracingEnabledError";
}

/** 고른 회사의 주소가 아닌 곳으로 가려던 요청. */
class BlockedHostError extends Error {
  override readonly name = "BlockedHostError";
}

/**
 * 호출 하나의 시간 재기와 끊기, 사용량 읽기. 머리를 받기 전 connectMs, 처음부터 totalMs가 지나면 요청을 끊는다.
 * 받은 본문은 바꾸지 않고 UsageMeter를 거쳐 회사 SDK에 넘긴다.
 */
class CallWatch {
  readonly #ctrl = new AbortController();
  readonly #timers: ReturnType<typeof setTimeout>[] = [];
  #connectTimer: ReturnType<typeof setTimeout> | undefined;
  readonly meter: UsageMeter;
  timedOut: "connect_timeout" | "total_timeout" | null = null;
  status: number | null = null;
  blocked = false;

  constructor(provider: AiProvider, clock: () => number, connectMs: number, totalMs: number) {
    this.meter = new UsageMeter(provider, clock);
    this.#connectTimer = setTimeout(() => this.#abort("connect_timeout"), connectMs);
    this.#timers.push(
      this.#connectTimer,
      setTimeout(() => this.#abort("total_timeout"), totalMs),
    );
  }

  #abort(kind: "connect_timeout" | "total_timeout"): void {
    if (this.timedOut !== null) return;
    this.timedOut = kind;
    this.#ctrl.abort(new DOMException(kind, "TimeoutError"));
  }

  fetch(origin: string, base: () => typeof fetch): typeof fetch {
    return async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== origin) {
        this.blocked = true;
        throw new BlockedHostError("request to a host other than the chosen provider");
      }
      const signals = [this.#ctrl.signal, ...(init?.signal ? [init.signal] : [])];
      const res = await base()(input, { ...init, signal: AbortSignal.any(signals) });
      clearTimeout(this.#connectTimer);
      this.status = res.status;
      if (!res.ok || res.body === null) return res;
      const body = res.body.pipeThrough(this.meter.stream());
      return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
    };
  }

  done(): void {
    for (const t of this.#timers) clearTimeout(t);
  }
}

function toMessages(messages: readonly AiMessage[]): BaseMessage[] {
  return messages.map((m) => {
    if (m.role === "system") return new SystemMessage(m.content);
    if (m.role === "assistant") return new AIMessage(m.content);
    return new HumanMessage(m.content);
  });
}

/**
 * 회사의 LangChain 채팅 모델. 키는 여기서만 꺼낸다. LangChain이 기본으로 켜는 브라우저 허용(dangerouslyAllowBrowser)은
 * 끈다(서버에서만 부름). 주소를 정해 두어 ANTHROPIC_BASE_URL·OPENAI_BASE_URL·LANGSMITH_GATEWAY가 바꾸지 못한다.
 */
function chatModel(ai: AiSettings, key: string, fetchImpl: typeof fetch, totalMs: number): BaseChatModel {
  if (ai.provider === "anthropic") {
    return new ChatAnthropic({
      model: ai.model,
      apiKey: key,
      maxRetries: 0,
      maxTokens: AI_MAX_OUTPUT_TOKENS,
      streaming: true,
      ...(ai.effort !== null ? { outputConfig: { effort: ai.effort } } : {}),
      clientOptions: {
        fetch: fetchImpl,
        baseURL: AI_ORIGINS.anthropic,
        authToken: null,
        maxRetries: 0,
        timeout: totalMs,
        dangerouslyAllowBrowser: false,
      },
    });
  }
  return new ChatOpenAI({
    model: ai.model,
    apiKey: key,
    maxRetries: 0,
    maxTokens: AI_MAX_OUTPUT_TOKENS,
    streaming: true,
    useResponsesApi: true,
    // store: false(Responses의 기본 보관을 끔). 추론 항목은 암호화된 꼴로만 돌려받는다.
    zdrEnabled: true,
    ...(ai.effort !== null ? { reasoning: { effort: ai.effort } } : {}),
    timeout: totalMs,
    configuration: {
      fetch: fetchImpl,
      baseURL: `${AI_ORIGINS.openai}/v1`,
      organization: null,
      project: null,
      maxRetries: 0,
      dangerouslyAllowBrowser: false,
    },
  });
}

interface Classified {
  readonly result: AiCallRow["result"];
  readonly errorKind: string;
  readonly fallbackReason: AiCallRow["fallbackReason"];
  readonly failure: AiFailure;
  readonly retryable: boolean;
}

/** 실패를 나눈다. 회사 SDK의 오류 꼴이 아니라 우리가 본 것(끊은 까닭, 받은 상태 코드)으로 나눠 회사와 상관없이 같다. */
function classify(watch: CallWatch): Classified {
  if (watch.timedOut !== null) {
    return {
      result: "timeout",
      errorKind: watch.timedOut,
      fallbackReason: "timeout",
      failure: "timeout",
      retryable: true,
    };
  }
  if (watch.blocked) {
    return {
      result: "failure",
      errorKind: "blocked_host",
      fallbackReason: "model_error",
      failure: "unavailable",
      retryable: false,
    };
  }
  const s = watch.status;
  if (s === 429 || watch.meter.rateLimited()) {
    return {
      result: "limit_reached",
      errorKind: s === 429 ? "http_429" : "stream_rate_limit",
      fallbackReason: "model_error",
      failure: "limit_reached",
      retryable: true,
    };
  }
  if (s === 401 || s === 403) {
    return {
      result: "failure",
      errorKind: `http_${s}`,
      fallbackReason: "model_error",
      failure: "key_missing",
      retryable: false,
    };
  }
  if (s !== null && s >= 400) {
    const retryable = s >= 500;
    return {
      result: "failure",
      errorKind: `http_${s}`,
      fallbackReason: "model_error",
      failure: "unavailable",
      retryable,
    };
  }
  // 머리는 받았는데 본문이 끊김(스트림 오류) 또는 연결 실패.
  const errorKind = s === null ? "network" : "stream_error";
  return { result: "failure", errorKind, fallbackReason: "model_error", failure: "unavailable", retryable: true };
}

/** 설정으로 고른 회사·모델의 호출 모듈. */
export function createAiModel(appEnv: AppEnv, ai: AiSettings, options: AiModelOptions = {}): AiModel {
  const found = priceOf(ai.provider, ai.model);
  if (found === undefined) throw new SettingsError("AI_MODEL must be a model in the price table for AI_PROVIDER");
  const price: ModelPrice = found;
  const clock = options.clock ?? (() => Date.now());
  const now = options.now ?? (() => new Date());
  const connectMs = options.connectTimeoutMs ?? AI_CONNECT_TIMEOUT_MS;
  const totalMs = options.totalTimeoutMs ?? AI_TOTAL_TIMEOUT_MS;
  const baseFetch = (): typeof fetch => options.fetch ?? globalThis.fetch.bind(globalThis);
  const schema = providerOutputSchema(ai.provider);
  const reasoning = { effort: ai.effort, max_output_tokens: AI_MAX_OUTPUT_TOKENS };

  async function call(input: AiCallInput): Promise<AiCallOutcome> {
    if (appEnv === "production") {
      const on = tracingSwitchInProcess();
      if (on !== null) throw new TracingEnabledError(`${on} is on in production (REQ-138)`);
    }
    const sentAt = now();
    const start = clock();
    const base = {
      consultationId: input.consultationId,
      traceId: input.traceId,
      attempt: input.attempt,
      provider: ai.provider,
      model: ai.model,
      promptVersion: input.promptVersion,
      reasoning,
      sentAt,
    };
    const fail = async (c: Classified, extra: Partial<AiCallRow> = {}): Promise<AiCallOutcome> => {
      const aiCallId = await recordAiCall(input.db, {
        ...base,
        firstTokenMs: null,
        totalMs: Math.max(0, Math.round(clock() - start)),
        tokens: null,
        cost: null,
        stopReason: null,
        ...extra,
        result: c.result,
        errorKind: c.errorKind,
        fallbackReason: c.fallbackReason,
      });
      return { ok: false, failure: c.failure, retryable: c.retryable, aiCallId };
    };

    if (ai.apiKey === null) {
      const missing: Classified = {
        result: "failure",
        errorKind: "key_missing",
        fallbackReason: "model_error",
        failure: "key_missing",
        retryable: false,
      };
      return fail(missing);
    }

    const watch = new CallWatch(ai.provider, clock, connectMs, totalMs);
    let parsed: unknown;
    try {
      const model = chatModel(ai, ai.apiKey.reveal(), watch.fetch(AI_ORIGINS[ai.provider], baseFetch), totalMs);
      const structured = model.withStructuredOutput(schema, {
        name: "ai_turn_output",
        method: "jsonSchema",
        // 출력이 JSON이 아니면 던지지 않고 parsed: null(아래 확인에서 schema_invalid).
        includeRaw: true,
        ...(ai.provider === "openai" ? { strict: true } : {}),
      });
      const result = await structured.invoke(toMessages(input.messages));
      parsed = result.parsed;
    } catch {
      // 오류 글에는 요청 내용이 섞일 수 있어 남기지 않는다(G6). 나누기는 우리가 본 상태로만.
      return fail(classify(watch));
    } finally {
      watch.done();
    }

    const firstOutputAt = watch.meter.firstOutputAt();
    const firstTokenMs = firstOutputAt === null ? null : Math.max(0, Math.round(firstOutputAt - start));
    const totalMsDone = Math.max(0, Math.round(clock() - start));
    const stopReason = watch.meter.stopReason();
    const tokens = watch.meter.tokens();
    const noCost = (errorKind: string): Promise<AiCallOutcome> =>
      fail(
        { result: "failure", errorKind, fallbackReason: "model_error", failure: "unavailable", retryable: false },
        { firstTokenMs, totalMs: totalMsDone, tokens, stopReason },
      );
    if (tokens === null) return noCost("usage_missing");
    // 긴 보관 캐시 쓰기는 요금표에 값이 없어 금액을 맞게 셀 수 없다(이 모듈은 요청하지 않음).
    if (watch.meter.longCacheWrites() > 0) return noCost("price_tier");
    let cost: Cost;
    try {
      cost = costOf(price, tokens, ai.fx);
    } catch (e) {
      if (e instanceof PriceTierError) return noCost("price_tier");
      throw e;
    }

    const check = checkTurnOutput(normalizeProviderOutput(ai.provider, parsed));
    const aiCallId = await recordAiCall(input.db, {
      ...base,
      firstTokenMs,
      totalMs: totalMsDone,
      tokens,
      cost,
      result: "success",
      stopReason,
      errorKind: null,
      fallbackReason: check.ok ? null : "schema_invalid",
    });
    if (check.ok) return { ok: true, output: check.value, aiCallId };
    return { ok: false, failure: "schema_invalid", retryable: false, aiCallId };
  }

  return { provider: ai.provider, model: ai.model, call };
}
