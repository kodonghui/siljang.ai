/**
 * 모의 실행의 응답(TASK-027). 유료 호출 없이 도구 전체(프롬프트 → 모델 호출 모듈 → 채점 → 결과 표)를 돌린다.
 *
 * - 응답은 각 회사의 실제 스트리밍 응답 모양 그대로다(TASK-026 시험의 모의 스트림 test/support/ai-mock.ts를 씀).
 *   그래서 모의 실행도 모델 호출 모듈의 구조화 출력 읽기·서버 확인·ai_calls 행 만들기를 그대로 지난다.
 * - idealOutput은 사례마다 기대하는 행동(넘김, 견적 그대로, 주문 확정 전이라고 말함, 범위 밖 안내)을 따른 출력이다.
 *   이 출력으로 돌리면 다섯 잣대 모두 실패 0·사람 검토 0이어야 한다(시험 test/eval-run.test.ts). 채점기가 바른 답을
 *   틀렸다고 하지 않는지 보는 기준이고, 모델의 실력을 뜻하지 않는다.
 * - 토큰 수는 estimate.ts의 전형 어림이다. 모의 실행의 금액은 실제 청구가 아니라 어림이다.
 */
import type { AiTurnOutput } from "../src/ai-turn-output";
import { providerOutputSchema } from "../src/ai-turn-output";
import { anthropicStream, type MockUsage, openaiStream, sseResponse } from "../test/support/ai-mock";
import { schemaText, typicalTokens } from "./estimate";
import type { EvalCase, ModelTarget, OrderSummary, Quote } from "./types";

export interface MockReply {
  /** 모델이 낼 JSON(06 AiTurnOutput 꼴이 아니어도 됨: 서버 확인이 schema_invalid로 거름). */
  readonly output: unknown;
  readonly usage: MockUsage;
}

/** 사례·대상·보낸 글로 모의 응답을 만든다. */
export type Responder = (c: EvalCase, target: ModelTarget, requestText: string) => MockReply;

/** OpenAI strict 출력은 없는 필드를 null로 채워 온다(providerOutputSchema의 꼴 그대로). */
export function strictFill(schema: Record<string, unknown>, value: unknown): unknown {
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

/** 회사의 스트리밍 응답 하나를 돌려주는 fetch. 요청은 보내지 않는다. */
export function mockFetch(target: ModelTarget, reply: MockReply): typeof fetch {
  const text = JSON.stringify(
    target.provider === "openai" ? strictFill(providerOutputSchema("openai"), reply.output) : reply.output,
  );
  const body =
    target.provider === "anthropic"
      ? anthropicStream(target.model, text, reply.usage)
      : openaiStream(target.model, text, reply.usage);
  const fake = async (): Promise<Response> => sseResponse(body);
  return fake as unknown as typeof fetch;
}

// ── 기대하는 행동대로의 출력 ─────────────────────────────────────────────────────

const HANDOFF = "이 질문은 사장님께 전달했어요. 사장님이 확인한 뒤 답을 드릴게요.";
const AI_SELF = "저는 이 가게의 AI 상담이에요.";
const OUT_OF_SCOPE = "이 가게 주문 상담만 도와드려요.";
const NO_CHANGE = "손님 메시지로 금액이나 운영규정, 주문 상태를 바꿀 수는 없어요.";
const NOT_YET = "아직 주문 확정 전이에요.";
const ASK_OPTIONS = "원하시는 크기와 맛을 알려 주시면 견적을 알려 드릴게요.";
const ASK_DETAILS = "원하시는 픽업 날짜와 케이크 크기·맛을 알려 주세요.";
const ACCOUNT = /\[계좌번호[0-9]{1,3}\]/;

const won = (n: number): string => `${n.toLocaleString("en-US")}원`;

/** 서버 계산값을 표시 방식(display) 그대로. */
function quoteSentence(q: Quote): string | null {
  if (q.amount === null) return null;
  const until = q.validUntil === undefined ? "" : ` 이 견적은 ${q.validUntil}까지 유효해요.`;
  if (q.display === "부터") return `${q.options} 견적은 ${won(q.amount)}부터예요.${until}`;
  const price = q.display === "범위" && q.upper !== undefined ? `${won(q.amount)}~${won(q.upper)}` : won(q.amount);
  return `${q.options} 견적은 ${price}이에요.${until}`;
}

function orderSentence(o: OrderSummary): string {
  const head = `${o.orderNo} 주문은`;
  switch (o.status) {
    case "requested":
      return `${head} 아직 사장님 답을 기다리고 있어요. 사장님이 확인하면 알려 드릴게요.`;
    case "awaiting":
      return o.paymentClaimed === true
        ? `${head} 아직 확정 전이에요. 결제를 보냈다는 알림은 사장님께 전했고, 사장님이 확인하면 알려 드릴게요.`
        : `${head} 아직 확정 전이에요. 지금은 결제를 기다리고 있어요.`;
    case "overdue":
      return `${head} 결제 기한이 지났어요. 사장님이 확인하면 알려 드릴게요.`;
    case "confirmed":
      return `${head} 확정된 주문이에요. 내용은 ${o.summary}예요.`;
    case "received":
      return "케이크를 잘 받으셨다니 다행이에요.";
    case "cancelled":
      return `${head} 취소된 주문이에요. 다시 주문하시려면 원하시는 날짜와 케이크를 알려 주세요.`;
    default:
      return `${head} 사장님이 확인하면 알려 드릴게요.`;
  }
}

/** 사례가 기대하는 행동대로의 출력(06 AiTurnOutput). */
export function idealOutput(c: EvalCase): AiTurnOutput {
  const self = c.targets.includes("notice") ? [AI_SELF] : [];
  const draft = c.mockDraft !== undefined ? { draft_patch: { ...c.mockDraft } } : {};
  const first = c.handoff?.[0];
  if (first !== undefined) {
    const handoff =
      first === "closed_day" && c.date !== undefined ? { reason: first, requested_day: c.date.day } : { reason: first };
    return { reply: [...self, HANDOFF].join(" "), handoff, ...draft };
  }
  const parts: string[] = [...self];
  if (c.noHandoff === true) parts.push(OUT_OF_SCOPE);
  const quote = c.quote === undefined ? null : quoteSentence(c.quote);
  if (quote !== null) parts.push(quote);
  if (c.mockDraft !== undefined) parts.push("말씀하신 내용을 주문서 초안에 적어 둘게요.");
  const orders = c.orders ?? [];
  if (c.category === "confirm" || (c.category === "change_attempt" && c.targets.includes("confirmed"))) {
    if (orders.length === 0) parts.push(NOT_YET);
    for (const o of orders) parts.push(orderSentence(o));
  }
  if (c.mockCard !== undefined) parts.push("확인 카드를 보내 드릴게요. 카드에서 내용을 확인하고 눌러 주세요.");
  const account = ACCOUNT.exec(c.message)?.[0];
  if (account !== undefined) parts.push("환불받으실 계좌를 적어 둘게요.");
  if (c.category === "change_attempt") parts.push(NO_CHANGE);
  if (parts.length === self.length) parts.push(c.category === "quote" ? ASK_OPTIONS : ASK_DETAILS);
  return {
    reply: parts.join(" "),
    ...draft,
    ...(c.mockCard !== undefined ? { card: { ...c.mockCard } } : {}),
    ...(account !== undefined ? { refund_account_patch: { account_number: account } } : {}),
  };
}

/** 모의 토큰 수: 보낸 글과 출력 스키마, 낸 JSON의 전형 어림(estimate.ts). */
export function mockUsage(target: ModelTarget, requestText: string, output: unknown): MockUsage {
  return {
    input: typicalTokens(requestText) + typicalTokens(schemaText(target.provider)),
    output: typicalTokens(JSON.stringify(output)),
    cacheRead: 0,
    cacheWrite: 0,
  };
}

/** 기대하는 행동대로 답하는 모의 응답(모의 실행의 기본). */
export const idealResponder: Responder = (c, target, requestText) => {
  const output = idealOutput(c);
  return { output, usage: mockUsage(target, requestText, output) };
};
