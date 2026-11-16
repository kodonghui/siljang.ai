/**
 * 실제 실행의 토큰·금액 어림(TASK-027). 금액은 TASK-026의 요금표와 셈(ai-prices.ts의 costOf, 올림)을 그대로 쓴다.
 *
 * - 전형 어림: 한글 글자 하나를 1토큰, 그 밖의 글자 3개를 1토큰으로 센 입력(보내는 글 + 출력 스키마)과
 *   차례마다 출력 600토큰(추론 포함). 실제 토크나이저 값이 아니라 크기를 가늠하는 값이다.
 * - 위 끝: 보내는 글과 출력 스키마의 UTF-8 바이트 수에 메시지 꾸밈 1,000토큰을 더한 입력(바이트 단위 BPE는 한 토큰이
 *   1바이트 이상이라 바이트 수를 넘지 않음)을 캐시 쓰기 값(입력 값보다 비싼 쪽)으로 셈하고, 출력은 최대 출력
 *   토큰(4,096)으로 센다. 대상이 한 차례에 여러 번 호출하면 그 횟수를 곱한다.
 * - 실제 실행은 위 끝 합계가 비용 상한(--max-krw)을 넘으면 시작하지 않는다(run.ts).
 */
import { AI_MAX_OUTPUT_TOKENS } from "../src/ai-model";
import { type AiProvider, costOf, type FxRate, priceOf, type TokenCounts } from "../src/ai-prices";
import { providerOutputSchema } from "../src/ai-turn-output";
import type { Subject } from "./subject";
import { type EvalCase, type ModelTarget, targetName } from "./types";

export const TYPICAL_OUTPUT_TOKENS = 600;
export const MESSAGE_MARGIN_TOKENS = 1_000;

const HANGUL = /[가-힣ㄱ-ㅎㅏ-ㅣ]/;

/** 전형 어림 토큰 수. */
export function typicalTokens(text: string): number {
  let hangul = 0;
  let other = 0;
  for (const ch of text) {
    if (HANGUL.test(ch)) hangul += 1;
    else other += 1;
  }
  return hangul + Math.ceil(other / 3);
}

/** 위 끝 토큰 수(UTF-8 바이트 수). */
export function upperTokens(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** 회사에 보내는 출력 스키마 글(입력 토큰에 들어감). */
export function schemaText(provider: AiProvider): string {
  return JSON.stringify(providerOutputSchema(provider));
}

/** "1234.56" → 100분의 1 원 정수. */
export function krwCents(krw: string): bigint {
  const m = /^([0-9]+)(?:\.([0-9]{1,2}))?$/.exec(krw);
  if (m === null) throw new TypeError("krw must be a decimal with up to 2 places");
  return BigInt(m[1] ?? "0") * 100n + BigInt((m[2] ?? "").padEnd(2, "0"));
}

export function formatKrw(cents: bigint): string {
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

export interface TokenEstimate {
  readonly calls: number;
  readonly input: number;
  readonly output: number;
  /** 원(소수 둘째 자리, 올림한 호출 금액의 합). */
  readonly krw: string;
}

export interface TargetEstimate {
  readonly target: string;
  readonly typical: TokenEstimate;
  readonly upper: TokenEstimate;
}

export interface RunEstimate {
  readonly fx: FxRate;
  readonly cases: number;
  readonly targets: readonly TargetEstimate[];
  readonly typicalKrw: string;
  readonly upperKrw: string;
}

function cost(target: ModelTarget, tokens: TokenCounts, fx: FxRate): bigint {
  const price = priceOf(target.provider, target.model);
  if (price === undefined) throw new TypeError(`${targetName(target)} is not in the price table`);
  return krwCents(costOf(price, tokens, fx).krw);
}

/** 사례 하나·대상 하나의 위 끝(원, 100분의 1 단위). 실행 중 상한 확인에 씀. */
export function upperCallCents(subject: Subject, c: EvalCase, target: ModelTarget, fx: FxRate): bigint {
  const input = upperTokens(subject.requestText(c)) + upperTokens(schemaText(target.provider)) + MESSAGE_MARGIN_TOKENS;
  const one = cost(target, { input: 0, cacheWrite: input, cacheRead: 0, output: AI_MAX_OUTPUT_TOKENS }, fx);
  return one * BigInt(subject.maxCallsPerTurn);
}

export function estimateRun(
  subject: Subject,
  cases: readonly EvalCase[],
  targets: readonly ModelTarget[],
  fx: FxRate,
): RunEstimate {
  let typicalAll = 0n;
  let upperAll = 0n;
  const rows: TargetEstimate[] = targets.map((target) => {
    const schema = schemaText(target.provider);
    const typical = { calls: 0, input: 0, output: 0, cents: 0n };
    const upper = { calls: 0, input: 0, output: 0, cents: 0n };
    for (const c of cases) {
      const text = subject.requestText(c);
      const tIn = typicalTokens(text) + typicalTokens(schema);
      typical.calls += 1;
      typical.input += tIn;
      typical.output += TYPICAL_OUTPUT_TOKENS;
      typical.cents += cost(target, { input: tIn, output: TYPICAL_OUTPUT_TOKENS, cacheRead: 0, cacheWrite: 0 }, fx);
      const uIn = upperTokens(text) + upperTokens(schema) + MESSAGE_MARGIN_TOKENS;
      upper.calls += subject.maxCallsPerTurn;
      upper.input += uIn * subject.maxCallsPerTurn;
      upper.output += AI_MAX_OUTPUT_TOKENS * subject.maxCallsPerTurn;
      upper.cents += upperCallCents(subject, c, target, fx);
    }
    typicalAll += typical.cents;
    upperAll += upper.cents;
    const done = (e: typeof typical): TokenEstimate => ({
      calls: e.calls,
      input: e.input,
      output: e.output,
      krw: formatKrw(e.cents),
    });
    return { target: targetName(target), typical: done(typical), upper: done(upper) };
  });
  return {
    fx,
    cases: cases.length,
    targets: rows,
    typicalKrw: formatKrw(typicalAll),
    upperKrw: formatKrw(upperAll),
  };
}
