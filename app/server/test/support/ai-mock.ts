/**
 * 모델 회사의 모의 응답(TASK-026). 진짜 키·유료 호출 없이 각 회사의 실제 스트리밍 응답 모양 그대로 돌려준다.
 * - Anthropic Messages API 스트림(SSE): message_start → (추론 블록, 표시 생략) → 글 블록 → message_delta → message_stop.
 * - OpenAI Responses API 스트림(SSE): response.created → 추론 항목 → 메시지 항목의 output_text 조각 → response.completed.
 * 모양은 각 회사의 스트리밍 문서(Anthropic 'Streaming Messages', OpenAI 'Streaming API responses')를 따른다.
 * 모의 글은 합성 시험 글이다(실제 손님 대화 아님).
 */

export interface MockUsage {
  /** 캐시를 뺀 입력. */
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

function sse(events: readonly (readonly [string, unknown])[]): string {
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

/** 글을 몇 조각으로 나눈다(스트림 조각처럼). */
function pieces(text: string, n = 3): string[] {
  const size = Math.max(1, Math.ceil(text.length / n));
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

/** Anthropic Messages API 스트림 본문. usage.input_tokens는 캐시를 뺀 입력(Anthropic의 뜻 그대로). */
export function anthropicStream(model: string, text: string, usage: MockUsage, stopReason = "end_turn"): string {
  return sse([
    [
      "message_start",
      {
        type: "message_start",
        message: {
          id: "msg_test_0001",
          type: "message",
          role: "assistant",
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: usage.input,
            cache_creation_input_tokens: usage.cacheWrite,
            cache_read_input_tokens: usage.cacheRead,
            output_tokens: 1,
          },
        },
      },
    ],
    // 적응형 추론(표시 생략이 기본): 빈 추론 글과 서명만 온다.
    [
      "content_block_start",
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
    ],
    [
      "content_block_delta",
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "c2lnLXRlc3Q=" } },
    ],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }],
    ...pieces(text).map(
      (t) =>
        [
          "content_block_delta",
          { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: t } },
        ] as const,
    ),
    ["content_block_stop", { type: "content_block_stop", index: 1 }],
    [
      "message_delta",
      {
        type: "message_delta",
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: usage.output },
      },
    ],
    ["message_stop", { type: "message_stop" }],
  ]);
}

/** OpenAI Responses API 스트림 본문. usage.input_tokens는 캐시를 포함한 입력(OpenAI의 뜻 그대로). */
export function openaiStream(model: string, text: string, usage: MockUsage, status = "completed"): string {
  const base = {
    id: "resp_test_0001",
    object: "response",
    created_at: 1_763_251_200,
    model,
    store: false,
    error: null,
    incomplete_details: null,
  };
  const reasoning = { id: "rs_test_0001", type: "reasoning", summary: [], encrypted_content: "ZW5jLXRlc3Q=" };
  const message = (t: string, itemStatus: string) => ({
    id: "msg_test_0001",
    type: "message",
    status: itemStatus,
    role: "assistant",
    content: t === "" ? [] : [{ type: "output_text", text: t, annotations: [] }],
  });
  let seq = 0;
  const ev = (type: string, data: Record<string, unknown>) =>
    [type, { type, sequence_number: seq++, ...data }] as const;
  return sse([
    ev("response.created", { response: { ...base, status: "in_progress", output: [], usage: null } }),
    ev("response.in_progress", { response: { ...base, status: "in_progress", output: [], usage: null } }),
    ev("response.output_item.added", { output_index: 0, item: { ...reasoning, encrypted_content: null } }),
    ev("response.output_item.done", { output_index: 0, item: reasoning }),
    ev("response.output_item.added", { output_index: 1, item: message("", "in_progress") }),
    ev("response.content_part.added", {
      item_id: "msg_test_0001",
      output_index: 1,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    }),
    ...pieces(text).map((t) =>
      ev("response.output_text.delta", {
        item_id: "msg_test_0001",
        output_index: 1,
        content_index: 0,
        delta: t,
        logprobs: [],
      }),
    ),
    ev("response.output_text.done", {
      item_id: "msg_test_0001",
      output_index: 1,
      content_index: 0,
      text,
      logprobs: [],
    }),
    ev("response.content_part.done", {
      item_id: "msg_test_0001",
      output_index: 1,
      content_index: 0,
      part: { type: "output_text", text, annotations: [] },
    }),
    ev("response.output_item.done", { output_index: 1, item: message(text, "completed") }),
    ev(`response.${status}`, {
      response: {
        ...base,
        status,
        output: [reasoning, message(text, "completed")],
        usage: {
          input_tokens: usage.input + usage.cacheRead + usage.cacheWrite,
          input_tokens_details: { cached_tokens: usage.cacheRead, cache_write_tokens: usage.cacheWrite },
          output_tokens: usage.output,
          output_tokens_details: { reasoning_tokens: Math.min(usage.output, 40) },
          total_tokens: usage.input + usage.cacheRead + usage.cacheWrite + usage.output,
        },
      },
    }),
  ]);
}

export interface SeenRequest {
  readonly url: string;
  readonly method: string;
  /** JSON 본문(없으면 null). */
  readonly body: Record<string, unknown> | null;
  /** 머리 이름(값은 싣지 않음, 키가 시험 출력에 나오지 않게). */
  readonly headerNames: readonly string[];
}

export type Reply = (req: SeenRequest, signal: AbortSignal | undefined) => Promise<Response> | Response;

/** 받은 요청을 모으고 reply로 답하는 가짜 fetch. */
export function recordingFetch(reply: Reply): { readonly fetch: typeof fetch; readonly seen: SeenRequest[] } {
  const seen: SeenRequest[] = [];
  const fake = async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const text = request.method === "GET" ? "" : await request.text();
    let body: Record<string, unknown> | null = null;
    try {
      body = text === "" ? null : (JSON.parse(text) as Record<string, unknown>);
    } catch {
      body = null;
    }
    const req: SeenRequest = {
      url: request.url,
      method: request.method,
      body,
      headerNames: [...request.headers.keys()],
    };
    seen.push(req);
    return reply(req, init?.signal ?? undefined);
  };
  return { fetch: fake as typeof fetch, seen };
}

export function sseResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
}

export function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** signal이 끊길 때까지 기다리는 응답(느린 회사). */
export function never(signal: AbortSignal | undefined): Promise<Response> {
  return new Promise((_, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), { once: true });
  });
}

/** 본문 조각 사이에 delayMs씩 쉬는 스트림(추론 뒤에 글이 나오는 생성). */
export function delayedStream(parts: readonly string[], delayMs: number, signal: AbortSignal | undefined): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const [i, part] of parts.entries()) {
        if (i > 0) await new Promise((r) => setTimeout(r, delayMs));
        if (signal?.aborted) return controller.error(signal.reason);
        controller.enqueue(encoder.encode(part));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** 머리는 곧 주고 본문은 끊길 때까지 오지 않는 스트림(느린 생성). */
export function stalledStream(first: string, signal: AbortSignal | undefined): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(first));
      signal?.addEventListener("abort", () => controller.error(signal.reason ?? new Error("aborted")), { once: true });
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}
