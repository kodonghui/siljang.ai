import { describe, expect, it } from "vitest";
import { AI_PRICE_TABLE_VERSION, AI_PRICES, costOf, PriceTierError, priceOf } from "../src/ai-prices";
import { MissingSettingError } from "../src/request-key";
import { createServices } from "../src/services";
import {
  AI_VAR_NAMES,
  readSettings,
  Secret,
  SettingsError,
  TRACING_KEY_NAMES,
  TRACING_SWITCH_NAMES,
} from "../src/settings";

// 모델 호출 설정·요금표·금액 셈(TASK-026; REQ-266·138·150, 06 DEC-25). 키는 실행 중에 만든 가짜 값.

const fakeKey = (prefix: string) => `${prefix}${"Zq7".repeat(16)}`;
const AI = {
  AI_PROVIDER: "anthropic",
  AI_MODEL: "claude-sonnet-5-5",
  AI_USD_KRW: "1450.00",
  AI_USD_KRW_DATE: "2026-11-14",
};

function caught(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error("did not throw");
}

describe("모델 호출 설정(AI_*)", () => {
  it("다섯 AI_ 변수가 모두 없으면 null(모델 호출만 설정 없음)", () => {
    expect(readSettings({}).ai).toBeNull();
    expect(readSettings({ ANTHROPIC_API_KEY: fakeKey("k-") }).ai).toBeNull();
  });

  it("고른 회사의 키만 쓴다: 설정만 바꾸면 회사가 바뀐다(REQ-266)", () => {
    const keys = { ANTHROPIC_API_KEY: fakeKey("a-"), OPENAI_API_KEY: fakeKey("o-") };
    const a = readSettings({ ...keys, ...AI }).ai;
    expect(a).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      effort: null,
      fx: { rate: "1450.00", date: "2026-11-14" },
    });
    expect(a?.apiKey?.reveal()).toBe(keys.ANTHROPIC_API_KEY);
    const o = readSettings({ ...keys, ...AI, AI_PROVIDER: "openai", AI_MODEL: "gpt-6.1-terra", AI_EFFORT: "low" }).ai;
    expect(o).toMatchObject({ provider: "openai", model: "gpt-6.1-terra", effort: "low" });
    expect(o?.apiKey?.reveal()).toBe(keys.OPENAI_API_KEY);
    // 키는 Secret으로 감싸 글·JSON에 나오지 않는다.
    expect(o?.apiKey).toBeInstanceOf(Secret);
    expect(JSON.stringify(o)).not.toContain(keys.OPENAI_API_KEY);
    // 다른 회사의 키만 있으면 키 없음(호출 때 key_missing 한 행, DEC-07 ai_key_missing).
    expect(readSettings({ OPENAI_API_KEY: keys.OPENAI_API_KEY, ...AI }).ai?.apiKey).toBeNull();
  });

  it("요금표에 없는 모델·회사와 맞지 않는 모델·틀린 effort·환율·날짜는 시작에서 멈추고 값은 싣지 않는다", () => {
    const wrong: Record<string, string>[] = [
      { ...AI, AI_PROVIDER: "google" },
      { ...AI, AI_PROVIDER: "" },
      { ...AI, AI_MODEL: "claude-sonnet-9-secretmodel" },
      { ...AI, AI_MODEL: "gpt-6.1-terra" },
      { ...AI, AI_PROVIDER: "openai", AI_MODEL: "claude-sonnet-5-5" },
      { ...AI, AI_EFFORT: "max" },
      { ...AI, AI_USD_KRW: "" },
      { ...AI, AI_USD_KRW: "0" },
      { ...AI, AI_USD_KRW: "1450.255" },
      { ...AI, AI_USD_KRW: "1,450" },
      { ...AI, AI_USD_KRW_DATE: "" },
      { ...AI, AI_USD_KRW_DATE: "2026-02-30" },
      { ...AI, AI_USD_KRW_DATE: "2026/11/14" },
      { AI_EFFORT: "low" },
    ];
    for (const env of wrong) {
      const e = caught(() => readSettings(env));
      expect(e, JSON.stringify(env)).toBeInstanceOf(SettingsError);
      expect(e.message).not.toContain("secretmodel");
      expect(e.message).not.toContain("1450.255");
    }
    expect(AI_VAR_NAMES).toEqual(["AI_PROVIDER", "AI_MODEL", "AI_EFFORT", "AI_USD_KRW", "AI_USD_KRW_DATE"]);
  });
});

describe("운영에서 추적 도구 꺼짐(REQ-138)", () => {
  it("운영에서 추적·자세한 기록·중계 변수가 켜져 있으면 시작에서 멈춘다(값은 싣지 않음)", () => {
    for (const name of TRACING_SWITCH_NAMES) {
      for (const value of ["true", "TRUE", "1", "yes", "on"]) {
        const e = caught(() => readSettings({ APP_ENV: "production", [name]: value }));
        expect(e, `${name}=${value}`).toBeInstanceOf(SettingsError);
        expect(e.message).toBe(`${name} must be unset or false in production (REQ-138)`);
      }
      for (const off of ["", "false", "False", " false "]) {
        expect(() => readSettings({ APP_ENV: "production", [name]: off }), `${name}=${off}`).not.toThrow();
      }
    }
    expect(TRACING_SWITCH_NAMES).toEqual(
      expect.arrayContaining(["LANGSMITH_TRACING", "LANGCHAIN_TRACING_V2", "LANGCHAIN_VERBOSE", "LANGSMITH_GATEWAY"]),
    );
  });

  it("운영에서 추적 도구 키를 두면 멈춘다(값은 싣지 않음)", () => {
    for (const name of TRACING_KEY_NAMES) {
      const key = fakeKey("ls-");
      const e = caught(() => readSettings({ APP_ENV: "production", [name]: key }));
      expect(e).toBeInstanceOf(SettingsError);
      expect(e.message).toBe(`${name} must not be set in production (REQ-138)`);
      expect(e.message).not.toContain(key);
      expect(() => readSettings({ APP_ENV: "production", [name]: "  " })).not.toThrow();
    }
  });

  it("개발·시험 환경은 추적을 켤 수 있다(평가·고치기용)", () => {
    for (const appEnv of ["development", "staging"]) {
      expect(() =>
        readSettings({ APP_ENV: appEnv, LANGSMITH_TRACING: "true", LANGSMITH_API_KEY: fakeKey("ls-") }),
      ).not.toThrow();
    }
  });
});

describe("요금표와 금액(REQ-150)", () => {
  it("요금표: 회사·모델이 겹치지 않고, 값은 소수 여섯째 자리까지, 확인 날짜가 있다", () => {
    const seen = new Set<string>();
    for (const p of AI_PRICES) {
      const id = `${p.provider}/${p.model}`;
      expect(seen.has(id), id).toBe(false);
      seen.add(id);
      for (const v of [p.input, p.cacheWrite, p.cacheRead, p.output]) expect(v, id).toMatch(/^[0-9]+(\.[0-9]{1,6})?$/);
      expect(p.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(priceOf(p.provider, p.model)).toBe(p);
      // 캐시 쓰기는 입력보다 비싸고 캐시 읽기는 싸다(짧은 보관 값).
      expect(Number(p.cacheWrite)).toBeGreaterThan(Number(p.input));
      expect(Number(p.cacheRead)).toBeLessThan(Number(p.input));
    }
    expect(priceOf("openai", "claude-sonnet-5-5")).toBeUndefined();
    expect(AI_PRICE_TABLE_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("금액은 네 토큰 × 백만 토큰당 값, 달러는 백만분의 1·원은 100분의 1로 올림", () => {
    const fx = { rate: "1450.00", date: "2026-11-14" };
    const sonnet = priceOf("anthropic", "claude-sonnet-5-5");
    const terra = priceOf("openai", "gpt-6.1-terra");
    if (sonnet === undefined || terra === undefined) throw new Error("price rows");
    const tokens = { input: 1000, output: 150, cacheRead: 800, cacheWrite: 100 };
    // 1000×2 + 150×10 + 800×0.10 + 100×2.50 = 3830 µ$ → $0.003830, ×1450 = 5.5535원 → 5.56
    expect(costOf(sonnet, tokens, fx)).toEqual({
      usd: "0.003830",
      krw: "5.56",
      basis: "prices 2026-11-16 (claude-sonnet-5-5 checked 2026-11-16); usd-krw 1450.00 (2026-11-14)",
    });
    expect(costOf(terra, tokens, fx)).toMatchObject({ usd: "0.001915", krw: "2.78" });
    // 토큰 하나도 0이 되지 않게 올림: 2달러/백만 × 1 = 0.000002, ×1450 = 0.0029원 → 0.01
    expect(costOf(sonnet, { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 }, fx)).toMatchObject({
      usd: "0.000002",
      krw: "0.01",
    });
    // 0.01달러/백만 × 1 = 0.00000001달러 → 0.000001로 올림
    const haiku = priceOf("anthropic", "claude-haiku-5-5");
    if (haiku === undefined) throw new Error("haiku row");
    expect(costOf(haiku, { input: 0, output: 0, cacheRead: 1, cacheWrite: 0 }, fx)).toMatchObject({
      usd: "0.000001",
      krw: "0.01",
    });
    expect(costOf(sonnet, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, fx)).toMatchObject({
      usd: "0.000000",
      krw: "0.00",
    });
    // 환율의 소수
    expect(
      costOf(
        sonnet,
        { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
        { rate: "1450.25", date: "2026-11-14" },
      ),
    ).toMatchObject({
      usd: "2.000000",
      krw: "2900.50",
    });
  });

  it("긴 문맥 요금 구간(Haiku 5.5 입력 10만 넘음, OpenAI 27만 2천 넘음)은 세지 않고 막는다", () => {
    const fx = { rate: "1450.00", date: "2026-11-14" };
    const haiku = priceOf("anthropic", "claude-haiku-5-5");
    const terra = priceOf("openai", "gpt-6.1-terra");
    const opus = priceOf("anthropic", "claude-opus-5-5");
    if (haiku === undefined || terra === undefined || opus === undefined) throw new Error("price rows");
    // 문턱은 캐시 읽기·쓰기를 포함한 입력 전체
    expect(() => costOf(haiku, { input: 100_000, output: 10, cacheRead: 0, cacheWrite: 0 }, fx)).not.toThrow();
    expect(() => costOf(haiku, { input: 90_000, output: 10, cacheRead: 5_000, cacheWrite: 5_001 }, fx)).toThrow(
      PriceTierError,
    );
    expect(() => costOf(terra, { input: 272_000, output: 10, cacheRead: 0, cacheWrite: 0 }, fx)).not.toThrow();
    expect(() => costOf(terra, { input: 272_001, output: 10, cacheRead: 0, cacheWrite: 0 }, fx)).toThrow(
      PriceTierError,
    );
    // Opus·Sonnet 5.5는 1M 문맥까지 같은 값
    expect(() => costOf(opus, { input: 900_000, output: 10, cacheRead: 0, cacheWrite: 0 }, fx)).not.toThrow();
  });

  it("토큰 수가 음수·소수면 셈하지 않는다", () => {
    const sonnet = priceOf("anthropic", "claude-sonnet-5-5");
    if (sonnet === undefined) throw new Error("price row");
    const fx = { rate: "1450.00", date: "2026-11-14" };
    expect(() => costOf(sonnet, { input: -1, output: 0, cacheRead: 0, cacheWrite: 0 }, fx)).toThrow(TypeError);
    expect(() => costOf(sonnet, { input: 1.5, output: 0, cacheRead: 0, cacheWrite: 0 }, fx)).toThrow(TypeError);
  });
});

describe("서비스의 모델 호출 모듈", () => {
  it("AI_ 설정이 없으면 모델 호출이 필요한 곳만 MissingSettingError(500 internal)", () => {
    expect(() => createServices({}, readSettings({})).aiModel()).toThrow(MissingSettingError);
  });

  it("설정한 회사·모델의 모듈을 한 번 만들어 씀, 설정만 바꾸면 회사가 바뀜", () => {
    const anthropic = createServices({}, readSettings({ ...AI, ANTHROPIC_API_KEY: fakeKey("a-") }));
    const m = anthropic.aiModel();
    expect(anthropic.aiModel()).toBe(m);
    expect(m).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5-5" });
    const openai = createServices({}, readSettings({ ...AI, AI_PROVIDER: "openai", AI_MODEL: "gpt-6-luna" }));
    expect(openai.aiModel()).toMatchObject({ provider: "openai", model: "gpt-6-luna" });
  });
});
