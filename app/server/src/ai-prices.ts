/**
 * 모델별 요금표와 금액 셈(TASK-026; REQ-150·163, 05 TBL-048 cost_usd·cost_krw·cost_basis).
 *
 * - 값은 백만 토큰당 달러, 각 회사 공식 요금 문서에서 옮겼다(확인 날짜는 행마다, app/README.md 48).
 *   Anthropic: https://platform.claude.com/docs/en/about-claude/pricing (입력, 5분 캐시 쓰기, 캐시 읽기, 출력)
 *   OpenAI: https://developers.openai.com/api/docs/pricing (Standard 처리의 입력, 30분 캐시 쓰기, 캐시 입력, 출력)
 * - 우리는 캐시 유지 시간을 늘려 쓰지 않으므로 캐시 쓰기는 가장 짧은 단계(Anthropic 5분, OpenAI 30분) 값이다.
 *   긴 보관 쓰기가 응답에 보이면 금액을 세지 않고 막는다(ai-usage.ts longCacheWrites, ai-model.ts price_tier).
 * - 기본 처리 값만 적는다. Anthropic inference_geo(미국 안 처리, 1.1배)·OpenAI Batch·Fast·Ultrafast 처리는 쓰지 않는다.
 * - 요금표에 없는 모델은 설정 검사(settings.ts)가 막는다. 금액을 셀 수 없으면 가게 하루 한도(REQ-163)를 지킬 수 없다.
 * - 금액은 정수로 셈해 올림한다(달러는 백만분의 1, 원은 100분의 1). 한도 셈이 실제보다 작게 나오지 않게 한다.
 */

export const AI_PROVIDERS = ["anthropic", "openai"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** 요금표 판. 값을 바꾸면 이 판과 행의 확인 날짜를 함께 바꾼다(ai_calls.cost_basis에 남음). */
export const AI_PRICE_TABLE_VERSION = "2026-11-16";

export interface ModelPrice {
  readonly provider: AiProvider;
  readonly model: string;
  /** 백만 토큰당 달러(문자열 그대로 두고 정수로 바꿔 셈). */
  readonly input: string;
  readonly cacheWrite: string;
  readonly cacheRead: string;
  readonly output: string;
  /** 이 값을 넘는 입력(캐시 포함)은 이 요금이 아니다(긴 문맥 요금). 공식 문서에 숫자가 있을 때만 적는다. */
  readonly maxPromptTokens?: number;
  readonly checkedOn: string;
}

export const AI_PRICES: readonly ModelPrice[] = [
  {
    provider: "anthropic",
    model: "claude-opus-5-5",
    input: "4",
    cacheWrite: "5",
    cacheRead: "0.20",
    output: "20",
    checkedOn: "2026-11-16",
  },
  {
    provider: "anthropic",
    model: "claude-sonnet-5-5",
    input: "2",
    cacheWrite: "2.50",
    cacheRead: "0.10",
    output: "10",
    checkedOn: "2026-11-16",
  },
  // Haiku 5.5는 입력 10만 토큰까지의 값. 넘으면 다른 요금이라 셀 때 막는다(maxPromptTokens).
  {
    provider: "anthropic",
    model: "claude-haiku-5-5",
    input: "0.10",
    cacheWrite: "0.125",
    cacheRead: "0.01",
    output: "0.50",
    maxPromptTokens: 100_000,
    checkedOn: "2026-11-16",
  },
  // OpenAI 대표 모델 표는 입력 27만 2천 토큰 이하(Short)의 값. 넘으면(Long) 다른 요금이라 셀 때 막는다.
  {
    provider: "openai",
    model: "gpt-6-astra",
    input: "10",
    cacheWrite: "12.50",
    cacheRead: "1",
    output: "50",
    maxPromptTokens: 272_000,
    checkedOn: "2026-11-16",
  },
  {
    provider: "openai",
    model: "gpt-6.1-sol",
    input: "2",
    cacheWrite: "2.50",
    cacheRead: "0.10",
    output: "10",
    maxPromptTokens: 272_000,
    checkedOn: "2026-11-16",
  },
  {
    provider: "openai",
    model: "gpt-6.1-terra",
    input: "1",
    cacheWrite: "1.25",
    cacheRead: "0.05",
    output: "5",
    maxPromptTokens: 272_000,
    checkedOn: "2026-11-16",
  },
  {
    provider: "openai",
    model: "gpt-6-luna",
    input: "0.10",
    cacheWrite: "0.125",
    cacheRead: "0.01",
    output: "0.50",
    maxPromptTokens: 272_000,
    checkedOn: "2026-11-16",
  },
];

export function priceOf(provider: AiProvider, model: string): ModelPrice | undefined {
  return AI_PRICES.find((p) => p.provider === provider && p.model === model);
}

/** 서로 겹치지 않는 네 토큰 수(ai_calls의 네 열과 같음). input은 캐시를 뺀 입력이다. */
export interface TokenCounts {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

/** 원 환산 기준(설정 AI_USD_KRW·AI_USD_KRW_DATE). rate는 "1450.25" 꼴. */
export interface FxRate {
  readonly rate: string;
  readonly date: string;
}

export interface Cost {
  /** numeric(12,6) 문자열(달러, 올림). */
  readonly usd: string;
  /** numeric(12,2) 문자열(원, 올림). */
  readonly krw: string;
  /** 요금표 판·모델 확인 날짜·환율과 그 날짜. */
  readonly basis: string;
}

export class PriceTierError extends Error {
  override readonly name = "PriceTierError";
}

/** "0.125" → 백만분의 1 단위 정수(125000). 소수 여섯째 자리까지만. */
function micros(value: string): bigint {
  const m = /^([0-9]+)(?:\.([0-9]{1,6}))?$/.exec(value);
  if (m === null) throw new TypeError("price must be a decimal with up to 6 places");
  return BigInt(m[1] ?? "0") * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0"));
}

/** "1450.25" → 100분의 1 원 단위 정수(145025). */
function cents(value: string): bigint {
  const m = /^([0-9]+)(?:\.([0-9]{1,2}))?$/.exec(value);
  if (m === null) throw new TypeError("rate must be a decimal with up to 2 places");
  return BigInt(m[1] ?? "0") * 100n + BigInt((m[2] ?? "").padEnd(2, "0"));
}

function ceilDiv(a: bigint, b: bigint): bigint {
  return a === 0n ? 0n : (a + b - 1n) / b;
}

function fixed(value: bigint, places: number): string {
  const unit = 10n ** BigInt(places);
  return `${value / unit}.${(value % unit).toString().padStart(places, "0")}`;
}

/** 호출 하나의 금액. 토큰은 0 이상의 정수여야 한다. */
export function costOf(price: ModelPrice, tokens: TokenCounts, fx: FxRate): Cost {
  for (const n of [tokens.input, tokens.output, tokens.cacheRead, tokens.cacheWrite]) {
    if (!Number.isSafeInteger(n) || n < 0) throw new TypeError("token counts must be non-negative integers");
  }
  const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite;
  if (price.maxPromptTokens !== undefined && prompt > price.maxPromptTokens) {
    throw new PriceTierError(`${price.model} prompt is over ${price.maxPromptTokens} tokens (long context price)`);
  }
  // 백만분의 1 달러 × 토큰 = 달러 × 10^12 / 10^6 … 정수 그대로 모은 뒤 한 번만 나눈다.
  const scaled =
    micros(price.input) * BigInt(tokens.input) +
    micros(price.output) * BigInt(tokens.output) +
    micros(price.cacheRead) * BigInt(tokens.cacheRead) +
    micros(price.cacheWrite) * BigInt(tokens.cacheWrite);
  // scaled는 (백만분의 1 달러) × (토큰) = 10^-12 달러 단위(백만 토큰당 값이라).
  const usdMicros = ceilDiv(scaled, 1_000_000n);
  const krwCents = ceilDiv(scaled * cents(fx.rate), 1_000_000_000_000n);
  return {
    usd: fixed(usdMicros, 6),
    krw: fixed(krwCents, 2),
    basis: `prices ${AI_PRICE_TABLE_VERSION} (${price.model} checked ${price.checkedOn}); usd-krw ${fx.rate} (${fx.date})`,
  };
}
