// 명령 하나의 요청 키와 상태(04 G2·G7, 06 DEC-04). 가짜 send와 시계로 잰다(TASK-029).
import { describe, expect, it, vi } from "vitest";
import type { ApiResult } from "./api";
import {
  type Clock,
  CommandRunner,
  type CommandState,
  IN_PROGRESS_DELAY_MS,
  IN_PROGRESS_LIMIT_MS,
  type Send,
  withConfirm,
} from "./command";
import { ERROR_CODES, type ErrorCode, parseProblem } from "./problems";

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const KEY = /^[A-Za-z0-9_-]{16,64}$/;

class FakeClock implements Clock {
  t = 0;
  #timers: { at: number; fn: () => void; id: number }[] = [];
  #next = 1;
  now = () => this.t;
  setTimeout = (fn: () => void, ms: number) => {
    const id = this.#next++;
    this.#timers.push({ at: this.t + ms, fn, id });
    return id;
  };
  clearTimeout = (handle: unknown) => {
    this.#timers = this.#timers.filter((x) => x.id !== handle);
  };
  get pending() {
    return this.#timers.length;
  }
  /** ms만큼 지나며 때가 된 타이머를 부르고, 그 뒤의 약속(promise)까지 끝냄 */
  async advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      const due = this.#timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      this.#timers = this.#timers.filter((x) => x !== due);
      this.t = due.at;
      due.fn();
      await settle();
    }
    this.t = end;
  }
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const ok = <O>(data: O, replayed = false): ApiResult<O> => ({ ok: true, status: 200, data, replayed });
const fail = (code: ErrorCode, extra: Record<string, unknown> = {}, retryAfterSeconds: number | null = null) => {
  const status = ERROR_CODES[code].status;
  return {
    ok: false,
    status,
    problem: parseProblem({ code, traceId: TRACE, ...extra }, status),
    retryAfterSeconds,
  } as const;
};
const offline = { ok: false, status: 0, problem: null, retryAfterSeconds: null } as const;

interface Call {
  readonly input: unknown;
  readonly key: string;
}

/** 부를 때마다 results를 차례로 돌려주는 send(남은 것이 없으면 마지막 것) */
function script<I>(...results: ApiResult<unknown>[]) {
  const calls: Call[] = [];
  const send: Send<I, unknown> = async (input, key) => {
    calls.push({ input, key });
    return results[Math.min(calls.length - 1, results.length - 1)] ?? ok(null);
  };
  return { send, calls };
}

function runner<I>(send: Send<I, unknown>, onClientBug = vi.fn()) {
  const clock = new FakeClock();
  let n = 0;
  const r = new CommandRunner<I, unknown>(send, {
    clock,
    newKey: () => `key-${String(++n).padStart(16, "0")}`,
    onClientBug,
  });
  const states: CommandState<unknown>["kind"][] = [];
  r.subscribe(() => states.push(r.getState().kind));
  return { r, clock, states, onClientBug };
}

describe("새 명령은 새 요청 키", () => {
  it("누를 때마다 새 키로 보내고, 보내는 동안 다시 누르면 무시한다(두 번 보내지 않음)", async () => {
    const { send, calls } = script(ok({ saved: true }));
    const { r, states } = runner(send);
    expect(r.submit({ name: "달빛" })).toBe(true);
    expect(r.getState().kind).toBe("submitting");
    expect(r.submit({ name: "달빛" })).toBe(false);
    await settle();
    expect(calls).toHaveLength(1);
    expect(r.getState()).toEqual({ kind: "done", data: { saved: true }, replayed: false });
    expect(r.submit({ name: "달빛" })).toBe(true);
    await settle();
    expect(calls.map((c) => c.key)).toEqual(["key-0000000000000001", "key-0000000000000002"]);
    expect(states).toEqual(["submitting", "done", "submitting", "done"]);
  });

  it("실제 키는 06 IdempotencyKey 꼴이고 매번 다르다", async () => {
    const { send, calls } = script(ok(null));
    const r = new CommandRunner(send);
    r.submit({});
    await settle();
    r.submit({});
    await settle();
    expect(calls[0]?.key).toMatch(KEY);
    expect(calls[1]?.key).toMatch(KEY);
    expect(calls[0]?.key).not.toBe(calls[1]?.key);
  });

  it("같은 키로 다시 온 응답(Idempotency-Replayed)을 상태에 남긴다", async () => {
    const { send } = script(ok({ saved: true }, true));
    const { r } = runner(send);
    r.submit({});
    await settle();
    expect(r.getState()).toMatchObject({ kind: "done", replayed: true });
  });
});

describe("'다시 시도'는 같은 요청 키", () => {
  it("서버 실패(500) 뒤 다시 시도는 같은 키·같은 본문", async () => {
    const { send, calls } = script(fail("internal"), ok({ saved: true }));
    const { r } = runner(send);
    r.submit({ name: "달빛" });
    await settle();
    expect(r.getState()).toMatchObject({
      kind: "failed",
      failure: { outcome: "server", retry: "same", traceId: TRACE },
    });
    expect(r.retry()).toBe(true);
    await settle();
    expect(calls).toEqual([
      { input: { name: "달빛" }, key: "key-0000000000000001" },
      { input: { name: "달빛" }, key: "key-0000000000000001" },
    ]);
    expect(r.getState().kind).toBe("done");
  });

  it("연결 실패(던짐·status 0)도 같은 키로 다시 시도", async () => {
    let n = 0;
    const keys: string[] = [];
    const send: Send<object, unknown> = async (_input, key) => {
      keys.push(key);
      n++;
      if (n === 1) throw new TypeError("Failed to fetch");
      return n === 2 ? offline : ok(null);
    };
    const { r } = runner(send);
    r.submit({});
    await settle();
    expect(r.getState()).toMatchObject({ kind: "failed", failure: { outcome: "server", status: 0, retry: "same" } });
    r.retry();
    await settle();
    r.retry();
    await settle();
    expect(new Set(keys).size).toBe(1);
    expect(r.getState().kind).toBe("done");
  });

  it("다시 보내지 않는 실패(찾을 수 없음·필드 오류·이미 바뀜)는 retry가 false", async () => {
    for (const code of ["not_found", "validation_failed", "version_conflict", "already_decided"] as const) {
      const { send, calls } = script(fail(code));
      const { r } = runner(send);
      r.submit({});
      await settle();
      expect(r.retry(), code).toBe(false);
      expect(calls).toHaveLength(1);
    }
  });

  it("같은 키에 다른 본문(422 idempotency_key_reused)은 화면의 잘못: 알리고 다시 시도는 새 키", async () => {
    const { send, calls } = script(fail("idempotency_key_reused"), ok(null));
    const { r, onClientBug } = runner(send);
    r.submit({ a: 1 });
    await settle();
    expect(onClientBug).toHaveBeenCalledWith({ code: "idempotency_key_reused", traceId: TRACE });
    expect(r.retry()).toBe(true);
    await settle();
    expect(calls[1]).toEqual({ input: { a: 1 }, key: "key-0000000000000002" });
  });
});

describe("확인 창(409 confirmation_required)", () => {
  const needed = fail("confirmation_required", {
    confirm: [{ kind: "closed_day_with_orders", count: 2, day: "2026-11-20" }, { kind: "overbooking" }],
  });

  it("확인하면 같은 본문에 confirm 값을 담아 새 요청 키로 보낸다", async () => {
    const { send, calls } = script(needed, ok({ closed: true }));
    const { r } = runner(send);
    r.submit({ closed: true });
    await settle();
    expect(r.getState()).toEqual({
      kind: "confirm",
      items: [{ kind: "closed_day_with_orders", count: 2, day: "2026-11-20" }, { kind: "overbooking" }],
    });
    expect(r.confirm()).toBe(true);
    await settle();
    expect(calls[1]).toEqual({
      input: { closed: true, confirm: ["closed_day_with_orders", "overbooking"] },
      key: "key-0000000000000002",
    });
    expect(calls[1]?.key).not.toBe(calls[0]?.key);
    expect(r.getState().kind).toBe("done");
  });

  it("'돌아가기'는 아무것도 보내지 않고 처음으로", async () => {
    const { send, calls } = script(needed);
    const { r } = runner(send);
    r.submit({ closed: true });
    await settle();
    r.cancelConfirm();
    expect(r.getState().kind).toBe("idle");
    expect(r.confirm()).toBe(false);
    r.cancelConfirm();
    expect(r.getState().kind).toBe("idle");
    expect(calls).toHaveLength(1);
  });

  it("확인할 것이 없는 409 confirmation_required는 계약 밖: 서버 실패, 다시 보내지 않음", async () => {
    const { send } = script(fail("confirmation_required"));
    const { r } = runner(send);
    r.submit({});
    await settle();
    expect(r.getState()).toMatchObject({ kind: "failed", failure: { outcome: "server", retry: "none" } });
  });

  it("confirm 값은 JSON 객체 본문에만, 이미 있던 값과 겹치지 않게", () => {
    expect(withConfirm({ a: 1, confirm: ["overbooking", "nope"] }, ["overbooking", "closed_day"])).toEqual({
      a: 1,
      confirm: ["overbooking", "closed_day"],
    });
    expect(() => withConfirm([1], ["overbooking"])).toThrow();
    expect(() => withConfirm("x", ["overbooking"])).toThrow();
  });
});

describe("처리 중(409 request_in_progress)", () => {
  it("1초 뒤 같은 키로 다시 보내고, 끝나면 됨", async () => {
    const { send, calls } = script(fail("request_in_progress"), fail("request_in_progress"), ok({ saved: true }));
    const { r, clock } = runner(send);
    r.submit({});
    await settle();
    expect(r.getState().kind).toBe("submitting");
    expect(r.submit({})).toBe(false);
    await clock.advance(IN_PROGRESS_DELAY_MS);
    await clock.advance(IN_PROGRESS_DELAY_MS);
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((c) => c.key)).size).toBe(1);
    expect(r.getState().kind).toBe("done");
  });

  it("70초가 넘으면 그만 기다리고 서버 실패(다시 시도는 같은 키)", async () => {
    const { send, calls } = script(fail("request_in_progress"));
    const { r, clock } = runner(send);
    r.submit({});
    await settle();
    await clock.advance(IN_PROGRESS_LIMIT_MS + IN_PROGRESS_DELAY_MS);
    expect(r.getState()).toMatchObject({
      kind: "failed",
      failure: { outcome: "server", retry: "same", message: ERROR_CODES.internal.message },
    });
    expect(clock.pending).toBe(0);
    const before = calls.length;
    r.retry();
    await settle();
    expect(calls).toHaveLength(before + 1);
    expect(new Set(calls.map((c) => c.key)).size).toBe(1);
  });
});

describe("요청 빈도 한도(429)", () => {
  it("rate_limited: Retry-After 동안 막고(누름·다시 시도 무시) 지나면 같은 키로 다시 부른다", async () => {
    const { send, calls } = script(fail("rate_limited", {}, 30), ok({ saved: true }));
    const { r, clock } = runner(send);
    r.submit({});
    await settle();
    expect(r.getState()).toMatchObject({ kind: "failed", blockedUntil: 30_000, failure: { outcome: "wait" } });
    expect(r.submit({})).toBe(false);
    expect(r.retry()).toBe(false);
    await clock.advance(29_999);
    expect(calls).toHaveLength(1);
    await clock.advance(1);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.key).toBe(calls[0]?.key);
    expect(r.getState().kind).toBe("done");
  });

  it("too_many_attempts: Retry-After 동안 막기만 하고, 지나면 새로 누를 수 있다", async () => {
    const { send, calls } = script(fail("too_many_attempts", { retryAfterSeconds: 60 }), ok(null));
    const { r, clock } = runner(send);
    r.submit({});
    await settle();
    expect(r.getState()).toMatchObject({ kind: "failed", blockedUntil: 60_000 });
    expect(r.submit({})).toBe(false);
    await clock.advance(60_000);
    expect(calls).toHaveLength(1);
    expect(r.getState()).toMatchObject({ kind: "failed", blockedUntil: null });
    expect(r.submit({})).toBe(true);
    await settle();
    expect(calls[1]?.key).not.toBe(calls[0]?.key);
  });
});

describe("send와 처음으로", () => {
  it("submit은 그때의 send로, 다시 시도·확인은 누른 때의 send로 보낸다", async () => {
    const first = script(fail("internal"), ok("first"));
    const second = script(ok("second"));
    const { r } = runner(first.send);
    r.submit({ id: 1 });
    await settle();
    r.setSend(second.send);
    r.retry();
    await settle();
    expect(first.calls).toHaveLength(2);
    expect(second.calls).toHaveLength(0);
    expect(r.getState()).toMatchObject({ kind: "done", data: "first" });
    r.submit({ id: 2 });
    await settle();
    expect(second.calls).toEqual([{ input: { id: 2 }, key: "key-0000000000000002" }]);
  });

  it("reset 뒤에 온 늦은 결과는 버린다", async () => {
    let resolve: (r: ApiResult<unknown>) => void = () => {};
    const send: Send<object, unknown> = () => new Promise((res) => (resolve = res));
    const { r } = runner(send);
    r.submit({});
    r.reset();
    resolve(ok("late"));
    await settle();
    expect(r.getState().kind).toBe("idle");
  });

  it("stopTimers는 기다리던 다시 보내기를 멈춘다", async () => {
    const { send, calls } = script(fail("request_in_progress"), ok(null));
    const { r, clock } = runner(send);
    r.submit({});
    await settle();
    r.stopTimers();
    await clock.advance(10_000);
    expect(calls).toHaveLength(1);
  });
});
