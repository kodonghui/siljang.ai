// 사장님·운영자 화면의 명령 하나(버튼 하나)를 보내고 결과를 G7로 알리는 도구. React와 상관없이 돌고(useCommand.ts가 감쌈)
// 시험은 가짜 send와 시계로 한다(command.test.ts).
//
// 요청 키(04 G2, 06 DEC-04):
// - 명령을 누를 때마다 새 키. 보내는 동안 다시 누르면 무시(두 번 보내지 않음).
// - 같은 요청을 다시 보낼 때만 같은 키: '다시 시도'(연결 실패·5xx), 처리 중(409 request_in_progress)이면 1초 뒤,
//   요청 빈도 한도(429 rate_limited)면 Retry-After 초 뒤.
// - 확인 창(409 confirmation_required)에서 확인하면 같은 본문에 confirm 값을 담아 새 키로 보냄(본문이 바뀌어 같은 키면
//   06이 422 idempotency_key_reused를 줌). 422 idempotency_key_reused의 '다시 시도'도 새 키(06, 화면의 잘못이라 알림).
import { type ApiResult, newRequestKey } from "./api";
import {
  type ConfirmationKind,
  type ConfirmationNeeded,
  classify,
  ERROR_CODES,
  type Failure,
  isConfirmationKind,
} from "./problems";

export type CommandState<O> =
  | { readonly kind: "idle" }
  | { readonly kind: "submitting" }
  | { readonly kind: "confirm"; readonly items: readonly ConfirmationNeeded[] }
  | { readonly kind: "done"; readonly data: O; readonly replayed: boolean }
  | {
      readonly kind: "failed";
      readonly failure: Failure;
      /** 이 시각(ms)까지 보내기·다시 시도를 막음(429). 지나면 null인 새 상태로 바뀜 */
      readonly blockedUntil: number | null;
    };

/** 명령 하나를 보내는 함수. 화면이 api.ts의 request로 만든다(예: (input, key) => request(path, { method: "PUT", body: input, key })). */
export type Send<I, O> = (input: I, key: string) => Promise<ApiResult<O>>;

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ClientBug {
  readonly code: string;
  readonly traceId: string | null;
}

export interface CommandOptions {
  readonly clock?: Clock;
  readonly newKey?: () => string;
  /** 화면 코드의 잘못(06: idempotency_key_reused·method_not_allowed). 코드와 추적 ID만 넘김 */
  readonly onClientBug?: (bug: ClientBug) => void;
}

/** 409 request_in_progress면 이만큼 뒤에 같은 키로 다시 보냄(06) */
export const IN_PROGRESS_DELAY_MS = 1000;
/**
 * 처리 중이 이만큼 이어지면 그만 기다리고 서버 실패('다시 시도', 같은 키)로 알림.
 * 06 DEC-04: 첫 요청이 60초 안에 끝나지 않으면 다음 요청이 이어받으므로 그보다 조금 길게.
 */
export const IN_PROGRESS_LIMIT_MS = 70_000;

const IDLE = { kind: "idle" } as const;
const SUBMITTING = { kind: "submitting" } as const;

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

const defaultBug = (bug: ClientBug) => {
  console.error(JSON.stringify({ event: "client_bug", code: bug.code, traceId: bug.traceId }));
};

/** 본문에 확인 값(06 confirm, 겹치지 않게)을 더한 새 본문. 본문은 JSON 객체여야 함 */
export function withConfirm<I>(input: I, kinds: readonly ConfirmationKind[]): I {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("확인 값은 JSON 객체 본문에만 담을 수 있음");
  }
  const before = (input as { confirm?: unknown }).confirm;
  const had = Array.isArray(before) ? before.filter(isConfirmationKind) : [];
  return { ...input, confirm: [...new Set([...had, ...kinds])] };
}

export class CommandRunner<I, O> {
  #send: Send<I, O>;
  readonly #clock: Clock;
  readonly #newKey: () => string;
  readonly #onClientBug: (bug: ClientBug) => void;
  readonly #listeners = new Set<() => void>();
  #state: CommandState<O> = IDLE;
  /** 지금 명령: 본문, 요청 키, 누른 때의 send(다시 보낼 때도 같은 send라 같은 키면 같은 요청) */
  #current: { readonly input: I; readonly key: string; readonly send: Send<I, O> } | null = null;
  #timer: unknown = null;
  #generation = 0;
  #inProgressSince: number | null = null;

  constructor(send: Send<I, O>, options: CommandOptions = {}) {
    this.#send = send;
    this.#clock = options.clock ?? realClock;
    this.#newKey = options.newKey ?? (() => newRequestKey());
    this.#onClientBug = options.onClientBug ?? defaultBug;
  }

  getState = (): CommandState<O> => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** 지금 보낸 요청의 키(시험·견본 화면용) */
  get currentKey(): string | null {
    return this.#current?.key ?? null;
  }

  /**
   * 다음 submit부터 쓸 send(화면이 다시 그려져 send가 붙잡은 값이 바뀌었을 때, useCommand가 부름).
   * 이미 누른 명령의 다시 보내기·확인은 누른 때의 send를 그대로 씀.
   */
  setSend = (send: Send<I, O>): void => {
    this.#send = send;
  };

  /** 새 명령. 보내는 중이거나 한도로 막힌 동안에는 무시하고 false */
  submit = (input: I): boolean => {
    if (this.#state.kind === "submitting" || this.#blocked()) return false;
    this.#current = { input, key: this.#newKey(), send: this.#send };
    this.#start();
    return true;
  };

  /** 실패한 같은 요청을 다시 보냄. 다시 보낼 수 없는 실패면 false */
  retry = (): boolean => {
    const s = this.#state;
    if (s.kind !== "failed" || this.#current === null || s.failure.retry === "none" || this.#blocked()) return false;
    if (s.failure.retry === "new") this.#current = { ...this.#current, key: this.#newKey() };
    this.#start();
    return true;
  };

  /** 확인 창에서 확인: 같은 본문에 확인 값을 담아 새 요청 키로 보냄 */
  confirm = (): boolean => {
    const s = this.#state;
    if (s.kind !== "confirm" || this.#current === null) return false;
    this.#current = {
      input: withConfirm(
        this.#current.input,
        s.items.map((i) => i.kind),
      ),
      key: this.#newKey(),
      send: this.#current.send,
    };
    this.#start();
    return true;
  };

  /** 확인 창에서 '돌아가기': 아무것도 바꾸지 않음 */
  cancelConfirm = (): void => {
    if (this.#state.kind === "confirm") {
      this.#current = null;
      this.#set(IDLE);
    }
  };

  /** 입력을 바꾸면 옛 본문을 버리되429의 남은 대기 시각은 보존한다. */
  reset = (): void => {
    const waiting = this.#state.kind === "failed" && this.#blocked() ? this.#state : null;
    const until = waiting?.blockedUntil ?? null;
    this.#generation++;
    this.#stopTimer();
    this.#current = null;
    this.#inProgressSince = null;
    if (waiting && until !== null) {
      const failure: Failure = { ...waiting.failure, retry: "none" };
      this.#set({ kind: "failed", failure, blockedUntil: until });
      this.#later(until - this.#clock.now(), () => {
        const state = this.#state;
        if (state.kind === "failed" && state.failure === failure) this.#set({ ...state, blockedUntil: null });
      });
    } else this.#set(IDLE);
  };

  /**
   * 화면이 사라질 때(useCommand의 effect 정리): 기다리는 타이머를 멈추고 아직 오지 않은 응답도 버린다.
   * 사라진 화면이 뒤늦게 온 429 rate_limited·409 request_in_progress로 스스로 다시 보내지 않게 하려는 것.
   * 다시 쓸 수 있다(StrictMode의 두 번 붙임, 숨겼다 다시 보임): 보내는 중이었으면 결과를 모르는 연결 실패로 두어
   * '다시 시도'가 같은 요청 키로 보내고(G2), 한도로 막혀 있었으면 풀어 둔다(막힘을 풀 타이머가 없으므로).
   */
  stopTimers = (): void => {
    this.#generation++;
    this.#stopTimer();
    this.#inProgressSince = null;
    const s = this.#state;
    if (s.kind === "submitting") {
      this.#set({ kind: "failed", failure: classify(0, null, null), blockedUntil: null });
    } else if (s.kind === "failed" && s.blockedUntil !== null) {
      this.#set({ ...s, blockedUntil: null });
    }
  };

  #blocked(): boolean {
    const s = this.#state;
    return s.kind === "failed" && s.blockedUntil !== null && this.#clock.now() < s.blockedUntil;
  }

  #set(state: CommandState<O>): void {
    this.#state = state;
    for (const l of [...this.#listeners]) l();
  }

  #stopTimer(): void {
    if (this.#timer !== null) {
      this.#clock.clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  #later(ms: number, fn: () => void): void {
    this.#stopTimer();
    this.#timer = this.#clock.setTimeout(() => {
      this.#timer = null;
      fn();
    }, ms);
  }

  #start(): void {
    this.#stopTimer();
    this.#inProgressSince = null;
    void this.#run();
  }

  async #run(): Promise<void> {
    const current = this.#current;
    if (current === null) return;
    const generation = ++this.#generation;
    if (this.#state.kind !== "submitting") this.#set(SUBMITTING);
    let result: ApiResult<O>;
    try {
      result = await current.send(current.input, current.key);
    } catch {
      result = { ok: false, status: 0, problem: null, retryAfterSeconds: null };
    }
    if (generation !== this.#generation) return;
    if (result.ok) {
      this.#inProgressSince = null;
      this.#set({ kind: "done", data: result.data, replayed: result.replayed });
      return;
    }
    const failure = classify(result.status, result.problem, result.retryAfterSeconds);
    const now = this.#clock.now();
    if (failure.outcome === "in_progress") {
      this.#inProgressSince ??= now;
      if (now - this.#inProgressSince < IN_PROGRESS_LIMIT_MS) {
        this.#later(IN_PROGRESS_DELAY_MS, () => void this.#run());
        return;
      }
      this.#inProgressSince = null;
      this.#set({
        kind: "failed",
        failure: {
          ...failure,
          outcome: "server",
          state: "error",
          retry: "same",
          message: ERROR_CODES.internal.message,
        },
        blockedUntil: null,
      });
      return;
    }
    this.#inProgressSince = null;
    if (failure.outcome === "confirm" && failure.confirm.length > 0) {
      this.#set({ kind: "confirm", items: failure.confirm });
      return;
    }
    if (failure.outcome === "confirm") {
      // 확인할 것이 없는 409 confirmation_required는 계약 밖: 서버 실패로 알림
      this.#set({
        kind: "failed",
        failure: {
          ...failure,
          outcome: "server",
          state: "error",
          retry: "none",
          message: ERROR_CODES.internal.message,
        },
        blockedUntil: null,
      });
      return;
    }
    if (failure.code === "idempotency_key_reused" || failure.code === "method_not_allowed") {
      this.#onClientBug({ code: failure.code, traceId: failure.traceId });
    }
    if (failure.outcome === "wait") {
      const until = now + (failure.retryAfterSeconds ?? 1) * 1000;
      this.#set({ kind: "failed", failure, blockedUntil: until });
      this.#later(until - now, () => {
        const s = this.#state;
        if (s.kind !== "failed" || s.failure !== failure) return;
        // 06: rate_limited는 Retry-After 뒤에 같은 요청을 다시 부름, too_many_attempts는 그동안 막기만 함
        if (failure.retry === "same") void this.#run();
        else this.#set({ kind: "failed", failure, blockedUntil: null });
      });
      return;
    }
    this.#set({ kind: "failed", failure, blockedUntil: null });
  }
}
