import { describe, expect, it } from "vitest";
import type { AiProvider } from "../src/ai-prices";
import { UsageMeter } from "../src/ai-usage";
import { anthropicStream, type MockUsage, openaiStream } from "./support/ai-mock";

// 회사 응답 스트림에서 사용량·멈춘 사유·첫 출력 시각 읽기(TASK-026, REQ-150). 모양은 각 회사 스트리밍 문서를 따른
// 모의 응답이다(test/support/ai-mock.ts). 글은 합성 시험 글.

const USAGE: MockUsage = { input: 1000, output: 150, cacheRead: 800, cacheWrite: 100 };
const TEXT = '{"reply":"1호 생크림은 35,000원이에요 🎂"}';

function body(provider: AiProvider, text = TEXT, usage = USAGE): string {
  return provider === "anthropic"
    ? anthropicStream("claude-sonnet-5-5", text, usage)
    : openaiStream("gpt-6.1-terra", text, usage);
}

/** 본문을 cuts 자리(바이트)에서 나눠 흘려 보내고, 넘어온 바이트와 읽은 값을 돌려준다. */
async function meter(provider: AiProvider, text: string, cuts: readonly number[] = []) {
  const bytes = new TextEncoder().encode(text);
  const edges = [0, ...cuts, bytes.length];
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i + 1 < edges.length; i += 1) controller.enqueue(bytes.slice(edges[i], edges[i + 1]));
      controller.close();
    },
  });
  let tick = 0;
  const m = new UsageMeter(provider, () => {
    tick += 1;
    return tick;
  });
  const passed = new Uint8Array(await new Response(source.pipeThrough(m.stream())).arrayBuffer());
  return { m, passed, bytes };
}

function sse(events: readonly (readonly [string, unknown])[]): string {
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

describe("UsageMeter", () => {
  it("Anthropic: message_delta의 usage는 누적이라 시작의 output_tokens에 더하지 않는다(LangChain 합산과 다름)", async () => {
    const { m } = await meter("anthropic", body("anthropic"));
    expect(m.tokens()).toEqual({ input: 1000, output: 150, cacheRead: 800, cacheWrite: 100 });
    expect(m.stopReason()).toBe("end_turn");
  });

  it("OpenAI: input_tokens는 캐시 읽기·쓰기를 포함하므로 빼서 겹치지 않는 네 수로", async () => {
    const { m } = await meter("openai", body("openai"));
    expect(m.tokens()).toEqual({ input: 1000, output: 150, cacheRead: 800, cacheWrite: 100 });
    expect(m.stopReason()).toBe("completed");
  });

  it("바이트는 그대로 넘기고, 어디서 나뉘어 와도(한글·그림 글자 가운데 포함) 같은 값", async () => {
    for (const provider of ["anthropic", "openai"] as const) {
      const text = body(provider);
      const whole = await meter(provider, text);
      expect(whole.passed).toEqual(whole.bytes);
      for (let cut = 1; cut < whole.bytes.length; cut += 1) {
        const split = await meter(provider, text, [cut]);
        expect(split.m.tokens(), `${provider} ${cut}`).toEqual(whole.m.tokens());
        expect(split.m.stopReason()).toBe(whole.m.stopReason());
        expect(split.passed.length).toBe(whole.bytes.length);
      }
      // 한 바이트씩
      const bytes = await meter(
        provider,
        text,
        Array.from({ length: whole.bytes.length - 1 }, (_, i) => i + 1),
      );
      expect(bytes.m.tokens()).toEqual(whole.m.tokens());
      expect(bytes.passed).toEqual(whole.bytes);
    }
  });

  it("Anthropic 문서의 공백 있는 JSON·CRLF 줄바꿈·누적 입력(서버 도구 예)도 읽는다", async () => {
    const text = [
      'event: message_start\r\ndata: {"type": "message_start", "message": {"id": "msg_1", "type": "message", "role": "assistant", "content": [], "model": "claude-opus-5-5", "stop_reason": null, "stop_sequence": null, "usage": {"input_tokens": 2679, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0, "output_tokens": 3}}}\r\n\r\n',
      'event: content_block_start\r\ndata: {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}\r\n\r\n',
      'event: content_block_delta\r\ndata: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "안녕"}}\r\n\r\n',
      'event: message_delta\r\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"input_tokens":10682,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":510,"server_tool_use":{"web_search_requests":1}}}\r\n\r\n',
      'event: message_stop\r\ndata: {"type": "message_stop"}\r\n\r\n',
    ].join("");
    const { m } = await meter("anthropic", text);
    expect(m.tokens()).toEqual({ input: 10682, output: 510, cacheRead: 0, cacheWrite: 0 });
    expect(m.stopReason()).toBe("end_turn");
    expect(m.firstOutputAt()).not.toBeNull();
  });

  it("OpenAI: 덜 끝난 응답(incomplete)은 그 까닭을 멈춘 사유로", async () => {
    const incomplete = openaiStream("gpt-6.1-terra", TEXT, USAGE, "incomplete");
    expect((await meter("openai", incomplete)).m.stopReason()).toBe("incomplete");
    const reasoned = incomplete.replace(
      '"incomplete_details":null,"status":"incomplete"',
      '"incomplete_details":{"reason":"max_output_tokens"},"status":"incomplete"',
    );
    expect(reasoned).not.toBe(incomplete);
    const { m } = await meter("openai", reasoned);
    expect(m.stopReason()).toBe("max_output_tokens");
    expect(m.tokens()).toEqual({ input: 1000, output: 150, cacheRead: 800, cacheWrite: 100 });
  });

  it("사용량이 없으면(끊긴 스트림) tokens는 null", async () => {
    const text = body("anthropic");
    const cut = text.indexOf("event: message_start");
    const { m } = await meter("anthropic", `${text.slice(0, cut)}`);
    expect(m.tokens()).toBeNull();
    const openai = body("openai");
    const done = openai.indexOf("event: response.completed");
    expect((await meter("openai", openai.slice(0, done))).m.tokens()).toBeNull();
  });

  it("Anthropic: 끝 사용량(message_delta)이 오기 전에 스트림이 끝나면 시작의 output_tokens를 끝 값으로 쓰지 않고 null", async () => {
    const text = body("anthropic");
    const cut = text.indexOf("event: message_delta");
    expect(cut).toBeGreaterThan(text.indexOf('"type":"text_delta"'));
    // 글은 다 왔고 시작의 usage(output_tokens 1)만 있음.
    const { m } = await meter("anthropic", text.slice(0, cut));
    expect(m.firstOutputAt()).not.toBeNull();
    expect(m.tokens()).toBeNull();
    expect(m.stopReason()).toBeNull();
    // message_delta가 와도 usage가 없으면 끝 값이 아님.
    const noUsage = text.replace(/,"usage":\{"output_tokens":150\}/, "");
    expect(noUsage).not.toBe(text);
    expect((await meter("anthropic", noUsage)).m.tokens()).toBeNull();
  });

  it("긴 보관 캐시 쓰기(Anthropic 1시간, OpenAI 12시간)는 따로 알린다(요금표에 값 없음)", async () => {
    const a = sse([
      [
        "message_start",
        {
          type: "message_start",
          message: {
            usage: {
              input_tokens: 10,
              cache_creation_input_tokens: 2048,
              cache_read_input_tokens: 0,
              cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 2048 },
              output_tokens: 1,
            },
          },
        },
      ],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } }],
    ]);
    expect((await meter("anthropic", a)).m.longCacheWrites()).toBe(2048);
    const o = sse([
      [
        "response.completed",
        {
          type: "response.completed",
          response: {
            status: "completed",
            usage: {
              input_tokens: 3000,
              input_tokens_details: {
                cached_tokens: 0,
                cache_write_tokens: 2048,
                cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 2048 },
              },
              output_tokens: 5,
            },
          },
        },
      ],
    ]);
    const om = (await meter("openai", o)).m;
    expect(om.longCacheWrites()).toBe(2048);
    expect(om.tokens()).toEqual({ input: 952, output: 5, cacheRead: 0, cacheWrite: 2048 });
    expect((await meter("anthropic", body("anthropic"))).m.longCacheWrites()).toBe(0);
  });

  it("event 줄이 없어도 data의 type으로 읽는다", async () => {
    const text = body("openai").replace(/^event: .*\n/gm, "");
    const { m } = await meter("openai", text);
    expect(m.tokens()).toEqual({ input: 1000, output: 150, cacheRead: 800, cacheWrite: 100 });
    expect(m.firstOutputAt()).not.toBeNull();
  });

  it("첫 출력 시각: 시작 이벤트·추론·서명 조각은 세지 않고 첫 글 조각에서 잰다", async () => {
    for (const provider of ["anthropic", "openai"] as const) {
      const text = body(provider);
      const marker = provider === "anthropic" ? '"type":"text_delta"' : "event: response.output_text.delta";
      const cut = text.lastIndexOf("event:", text.indexOf(marker));
      let now = 1;
      const m = new UsageMeter(provider, () => now);
      const stream = m.stream();
      const writer = stream.writable.getWriter();
      const reader = stream.readable.getReader();
      const encoder = new TextEncoder();
      const r1 = reader.read();
      await writer.write(encoder.encode(text.slice(0, cut)));
      await r1;
      expect(m.firstOutputAt(), provider).toBeNull();
      now = 2;
      const r2 = reader.read();
      await writer.write(encoder.encode(text.slice(cut)));
      await r2;
      expect(m.firstOutputAt(), provider).toBe(2);
      now = 3;
      const rest = (async () => {
        for (;;) if ((await reader.read()).done) return;
      })();
      await writer.close();
      await rest;
      expect(m.firstOutputAt(), provider).toBe(2);
    }
  });

  it("사용량이 든 이벤트의 숫자가 이상하면(음수·소수·글) 그 값은 쓰지 않는다", async () => {
    const text = sse([
      ["message_start", { type: "message_start", message: { usage: { input_tokens: -1, output_tokens: 1.5 } } }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: "7" } }],
    ]);
    expect((await meter("anthropic", text)).m.tokens()).toBeNull();
  });
});
