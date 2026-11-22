import { describe, expect, it, vi } from "vitest";
import { createEvalPacer, retryAfterTime } from "../eval/pacing";

const START = Date.parse("2026-11-22T13:30:00.000Z");

function clock() {
  let time = START;
  const sleep = vi.fn(async (ms: number) => {
    time += ms;
  });
  return { now: () => new Date(time), sleep };
}

describe("TASK-027 요청 간격과 Retry-After", () => {
  it.each([
    ["12", START + 12_000],
    ["Sun, 22 Nov 2026 13:31:00 GMT", START + 60_000],
    ["Sun, 22 Nov 2026 13:29:00 GMT", START],
    [null, null],
    ["wrong", null],
    ["-1", null],
    ["1.5", null],
    ["999999999999999999999999", null],
  ] as const)("Retry-After %s를 안전하게 해석", (value, expected) => {
    expect(retryAfterTime(value, START)).toBe(expected);
  });

  it("첫 요청은 바로 시작하고 다음 시작은 정한 간격 뒤", async () => {
    const c = clock();
    const pacer = createEvalPacer({ ...c, intervalMs: 1000, maxWaitMs: 60_000 });
    expect(await pacer.beforeCall()).toBeNull();
    expect(c.sleep).not.toHaveBeenCalled();
    expect(pacer.notBefore()).toBe(new Date(START + 1000).toISOString());
    expect(await pacer.beforeCall()).toBeNull();
    expect(c.sleep).toHaveBeenCalledExactlyOnceWith(1000);
  });

  it("429의 Retry-After가 기본 간격보다 길면 그 시각까지 기다림", async () => {
    const c = clock();
    const pacer = createEvalPacer({ ...c, intervalMs: 1000, maxWaitMs: 60_000 });
    await pacer.beforeCall();
    pacer.observe(new Response(null, { status: 429, headers: { "retry-after": "12" } }));
    expect(await pacer.beforeCall()).toBeNull();
    expect(c.sleep).toHaveBeenCalledExactlyOnceWith(12_000);
  });

  it("긴 대기는 다음 호출을 시작하지 않고 재개 가능한 시각을 반환", async () => {
    const c = clock();
    const pacer = createEvalPacer({ ...c, intervalMs: 1000, maxWaitMs: 60_000 });
    await pacer.beforeCall();
    pacer.observe(new Response(null, { status: 429, headers: { "retry-after": "54000" } }));
    expect(await pacer.beforeCall()).toEqual({ retryAt: new Date(START + 54_000_000).toISOString() });
    expect(c.sleep).not.toHaveBeenCalled();
  });

  it("보존한 대기 시각은 새 실행에서도 줄이지 않음", async () => {
    const c = clock();
    const until = new Date(START + 120_000).toISOString();
    const pacer = createEvalPacer({ ...c, intervalMs: 1000, maxWaitMs: 60_000, notBefore: until });
    expect(await pacer.beforeCall()).toEqual({ retryAt: until });
    expect(pacer.notBefore()).toBe(until);
    expect(c.sleep).not.toHaveBeenCalled();
  });

  it("성공 응답의 임의 Retry-After와 깨진 실패 헤더는 간격을 바꾸지 않음", async () => {
    const c = clock();
    const pacer = createEvalPacer({ ...c, intervalMs: 1000, maxWaitMs: 60_000 });
    await pacer.beforeCall();
    pacer.observe(new Response(null, { status: 200, headers: { "retry-after": "54000" } }));
    pacer.observe(new Response(null, { status: 429, headers: { "retry-after": "wrong" } }));
    expect(await pacer.beforeCall()).toBeNull();
    expect(c.sleep).toHaveBeenCalledExactlyOnceWith(1000);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 0.5])("잘못된 간격 %s는 호출 전에 거절", (intervalMs) => {
    expect(() => createEvalPacer({ ...clock(), intervalMs, maxWaitMs: 60_000 })).toThrow(RangeError);
  });
});
