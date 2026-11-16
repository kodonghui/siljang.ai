/**
 * 회사 응답 스트림에서 사용량·멈춘 사유·첫 출력 시각을 그대로 읽는다(TASK-026; REQ-150, 05 TBL-048 ai_calls).
 *
 * - 금액의 근거인 토큰 수는 LangChain이 모아 주는 usage_metadata가 아니라 회사 응답의 usage에서 읽는다. LangChain은
 *   Anthropic 스트림의 message_start output_tokens와 message_delta의 누적 output_tokens를 더해 출력 토큰을 더 센다
 *   (Anthropic 'Streaming Messages': message_delta의 usage는 누적). 회사 문서의 뜻대로 읽으면 회사와 상관없이 맞다.
 * - Anthropic Messages 스트림: message_start.message.usage(input_tokens는 캐시를 뺀 입력, cache_creation_input_tokens,
 *   cache_read_input_tokens, output_tokens). message_delta.usage는 누적이라 온 값으로 바꾼다. 멈춘 사유는 delta.stop_reason.
 *   시작의 output_tokens는 1 같은 중간 값이라, output_tokens가 든 message_delta 없이 끝난 스트림은 사용량 없음(null)으로 본다.
 * - OpenAI Responses 스트림: response.completed·response.incomplete·response.failed의 response.usage. input_tokens는
 *   캐시 읽기(input_tokens_details.cached_tokens)·캐시 쓰기(cache_write_tokens)를 포함한 입력이라 둘을 뺀다
 *   (OpenAI 'Prompt caching': 입력 토큰 하나는 보통 입력·캐시 읽기·캐시 쓰기 값 가운데 하나로만 매긴다).
 *   멈춘 사유는 incomplete_details.reason, 없으면 status.
 * - 요금표(ai-prices.ts)의 캐시 쓰기 값은 짧은 보관(Anthropic 5분, OpenAI 30분)의 값이다. 긴 보관(Anthropic 1시간,
 *   OpenAI 12시간) 쓰기는 값이 달라 longCacheWrites()로 따로 알린다. 이 모듈은 긴 보관을 요청하지 않는다.
 * - 첫 출력 시각: 손님에게 보일 출력(글·도구 입력)의 첫 조각이 온 때. 추론 조각·서명·시작 이벤트는 세지 않는다.
 * - 글 조각의 내용은 읽어 두지 않는다. 사용량이 든 이벤트와, 첫 출력 전의 Anthropic 조각 이벤트만 JSON으로 푼다.
 */
import type { AiProvider, TokenCounts } from "./ai-prices";

/** 회사마다 사용량·멈춘 사유가 든 SSE 이벤트. */
const USAGE_EVENTS: Readonly<Record<AiProvider, ReadonlySet<string>>> = {
  anthropic: new Set(["message_start", "message_delta"]),
  openai: new Set(["response.completed", "response.incomplete", "response.failed"]),
};

/** 출력 조각 이벤트. Anthropic은 조각의 delta.type을 보고 글·도구 입력만 센다. */
const OUTPUT_EVENTS: Readonly<Record<AiProvider, ReadonlySet<string>>> = {
  anthropic: new Set(["content_block_delta"]),
  openai: new Set(["response.output_text.delta", "response.refusal.delta", "response.function_call_arguments.delta"]),
};
const ANTHROPIC_OUTPUT_DELTAS: ReadonlySet<string> = new Set(["text_delta", "input_json_delta"]);

type Json = Readonly<Record<string, unknown>>;

function obj(value: unknown): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** 응답 바이트를 그대로 넘기며 읽는다. 호출 하나에 하나. */
export class UsageMeter {
  readonly #provider: AiProvider;
  readonly #clock: () => number;
  readonly #decoder = new TextDecoder();
  #buffer = "";
  #input: number | undefined;
  #output: number | undefined;
  #cacheRead = 0;
  #cacheWrite = 0;
  #longCacheWrite = 0;
  /** 끝 사용량(Anthropic message_delta, OpenAI 끝 이벤트의 output_tokens)을 받았는지. */
  #final = false;
  #stopReason: string | null = null;
  #firstOutputAt: number | null = null;

  constructor(provider: AiProvider, clock: () => number) {
    this.#provider = provider;
    this.#clock = clock;
  }

  /** 바이트는 바꾸지 않고 넘기는 스트림. */
  stream(): TransformStream<Uint8Array, Uint8Array> {
    return new TransformStream<Uint8Array, Uint8Array>({
      transform: (chunk, controller) => {
        controller.enqueue(chunk);
        this.#feed(this.#decoder.decode(chunk, { stream: true }));
      },
      flush: () => {
        this.#feed(`${this.#decoder.decode()}\n\n`);
      },
    });
  }

  /** 네 토큰 수(겹치지 않음). 끝 사용량이 오지 않았거나 입력·출력 가운데 하나라도 못 읽었으면 null. */
  tokens(): TokenCounts | null {
    if (!this.#final || this.#input === undefined || this.#output === undefined) return null;
    return { input: this.#input, output: this.#output, cacheRead: this.#cacheRead, cacheWrite: this.#cacheWrite };
  }

  /** 긴 보관 캐시 쓰기 토큰(요금표에 값이 없음). */
  longCacheWrites(): number {
    return this.#longCacheWrite;
  }

  /** 회사가 준 멈춘 사유(짧은 이름). */
  stopReason(): string | null {
    return this.#stopReason === null ? null : this.#stopReason.slice(0, 40);
  }

  /** 첫 출력 조각이 온 시각(clock 값). 없으면 null. */
  firstOutputAt(): number | null {
    return this.#firstOutputAt;
  }

  #feed(text: string): void {
    this.#buffer += text;
    for (;;) {
      const end = /\r?\n\r?\n/.exec(this.#buffer);
      if (end === null) return;
      const block = this.#buffer.slice(0, end.index);
      this.#buffer = this.#buffer.slice(end.index + end[0].length);
      this.#event(block);
    }
  }

  #event(block: string): void {
    let name: string | null = null;
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length === 0) return;
    const usage = USAGE_EVENTS[this.#provider];
    const output = OUTPUT_EVENTS[this.#provider];
    const wantOutput = this.#firstOutputAt === null;
    if (name !== null) {
      if (!usage.has(name) && !(wantOutput && output.has(name))) return;
      // OpenAI의 출력 조각은 이름만으로 안다(내용은 풀지 않음).
      if (this.#provider === "openai" && output.has(name)) {
        this.#firstOutputAt = this.#clock();
        return;
      }
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.join("\n"));
    } catch {
      return;
    }
    const event = obj(parsed);
    const type = typeof event?.type === "string" ? event.type : name;
    if (event === undefined || type === null) return;
    if (wantOutput && output.has(type) && this.#isOutput(event)) this.#firstOutputAt = this.#clock();
    if (!usage.has(type)) return;
    if (this.#provider === "anthropic") this.#anthropic(type, event);
    else this.#openai(event);
  }

  #isOutput(event: Json): boolean {
    if (this.#provider === "openai") return true;
    const kind = obj(event.delta)?.type;
    return typeof kind === "string" && ANTHROPIC_OUTPUT_DELTAS.has(kind);
  }

  #anthropic(type: string, event: Json): void {
    const usage = obj(type === "message_start" ? obj(event.message)?.usage : event.usage);
    if (usage !== undefined) {
      this.#input = count(usage.input_tokens) ?? this.#input;
      this.#output = count(usage.output_tokens) ?? this.#output;
      this.#cacheWrite = count(usage.cache_creation_input_tokens) ?? this.#cacheWrite;
      this.#cacheRead = count(usage.cache_read_input_tokens) ?? this.#cacheRead;
      this.#longCacheWrite = count(obj(usage.cache_creation)?.ephemeral_1h_input_tokens) ?? this.#longCacheWrite;
      if (type === "message_delta" && count(usage.output_tokens) !== undefined) this.#final = true;
    }
    const stop = obj(event.delta)?.stop_reason;
    if (type === "message_delta" && typeof stop === "string") this.#stopReason = stop;
  }

  #openai(event: Json): void {
    const response = obj(event.response);
    if (response === undefined) return;
    const usage = obj(response.usage);
    if (usage !== undefined) {
      const details = obj(usage.input_tokens_details);
      const total = count(usage.input_tokens);
      if (total !== undefined) {
        this.#cacheRead = count(details?.cached_tokens) ?? 0;
        this.#cacheWrite = count(details?.cache_write_tokens) ?? 0;
        this.#input = Math.max(0, total - this.#cacheRead - this.#cacheWrite);
      }
      this.#output = count(usage.output_tokens) ?? this.#output;
      this.#longCacheWrite = count(obj(details?.cache_write_tokens_details)?.ttl_12h_tokens) ?? this.#longCacheWrite;
      // 이 이벤트들은 모두 끝 이벤트라 여기의 usage가 끝 값이다.
      if (count(usage.output_tokens) !== undefined) this.#final = true;
    }
    const reason = obj(response.incomplete_details)?.reason;
    const status = response.status;
    if (typeof reason === "string") this.#stopReason = reason;
    else if (typeof status === "string") this.#stopReason = status;
  }
}
