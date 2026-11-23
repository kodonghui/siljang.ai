// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ApiResult } from "./api";
import { parseProblem } from "./problems";
import { useVersionedRead } from "./useVersionedRead";

const ok = (value: string): ApiResult<{ value: string }> => ({
  ok: true,
  status: 200,
  data: { value },
  replayed: false,
});
const notSet: ApiResult<{ value: string }> = {
  ok: false,
  status: 404,
  problem: parseProblem({ code: "not_set" }, 404),
  retryAfterSeconds: null,
};
afterEach(cleanup);
it.each(["checking", "failed"] as const)("첫 세션 %s 동안 요청하지 않고 확인 뒤 한 번만 읽는다", async (kind) => {
  const load = vi.fn(async () => ok("initial"));
  const view = renderHook((props) => useVersionedRead(load, props), {
    initialProps: { sessionChecking: kind === "checking", sessionFailed: kind === "failed" },
  });
  await act(async () => {});
  expect(load).not.toHaveBeenCalled();
  if (kind === "failed") expect(view.result.current.loading).toBe(false);
  view.rerender({ sessionChecking: false, sessionFailed: false });
  await waitFor(() => expect(view.result.current.result?.response).toEqual(ok("initial")));
  view.rerender({ sessionChecking: true, sessionFailed: false });
  view.rerender({ sessionChecking: false, sessionFailed: false });
  expect(load).toHaveBeenCalledOnce();
});
it.each([true, false])("미설정 응답을 허용하는 양식만 빈 입력으로 구분한다: %s", async (allowNotSet) => {
  const view = renderHook(() => useVersionedRead(async () => notSet, { allowNotSet }));
  await waitFor(() => expect(view.result.current.result?.response).toEqual(notSet));
  expect(view.result.current.failure).toEqual(allowNotSet ? null : notSet);
});
it("재확인 때 진행 중 조회를 취소하고 늦은 실패를 버린 뒤 확인한 요청만 재개한다", async () => {
  let finish: ((value: ApiResult<{ value: string }>) => void) | undefined;
  const signals: AbortSignal[] = [];
  const load = vi.fn((signal: AbortSignal) => {
    signals.push(signal);
    return signals.length === 1
      ? new Promise<ApiResult<{ value: string }>>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(ok("current"));
  });
  const view = renderHook((props) => useVersionedRead(load, props), {
    initialProps: { sessionChecking: false, sessionFailed: false },
  });
  await waitFor(() => expect(load).toHaveBeenCalledOnce());
  view.rerender({ sessionChecking: true, sessionFailed: false });
  expect(signals[0]?.aborted).toBe(true);
  expect(view.result.current.loading).toBe(true);
  await act(async () => {
    finish?.(notSet);
  });
  expect(view.result.current.result).toBeNull();
  view.rerender({ sessionChecking: false, sessionFailed: false });
  await waitFor(() => expect(view.result.current.result?.response).toEqual(ok("current")));
  expect(load).toHaveBeenCalledTimes(2);
});
it("충돌 조회 실패를 지운 뒤 같은 모드로 재시도하고 기존 요청을 취소한다", async () => {
  let count = 0;
  const load = vi.fn(async () => (++count === 2 ? notSet : ok(String(count))));
  const view = renderHook(() => useVersionedRead(load, {}));
  await waitFor(() => expect(view.result.current.result?.response).toEqual(ok("1")));
  act(() => {
    view.result.current.read("stale");
  });
  await waitFor(() => expect(view.result.current.failure).toEqual(notSet));
  expect(view.result.current.result?.mode).toBe("stale");
  act(() => {
    view.result.current.clearFailure();
  });
  expect(view.result.current.failure).toBeNull();
  act(() => {
    view.result.current.retry();
  });
  await waitFor(() => expect(view.result.current.result?.response).toEqual(ok("3")));
  await waitFor(() => expect(view.result.current.result?.mode).toBe("stale"));
});
it("연결 예외도 원래 값을 포함하지 않는 공통 실패로 끝낸다", async () => {
  const view = renderHook(() =>
    useVersionedRead(async () => {
      throw new Error("synthetic-network-failure");
    }, {}),
  );
  await waitFor(() => expect(view.result.current.failure?.status).toBe(0));
  expect(view.result.current.loading).toBe(false);
  expect(view.result.current.failure?.problem).toBeNull();
});

it("세션 확인 중 요청한 stale 조회를 확인 뒤 한 번 이어서 읽는다", async () => {
  const load = vi.fn(async () => ok("latest"));
  const view = renderHook((props) => useVersionedRead(load, props), { initialProps: { sessionChecking: false } });
  await waitFor(() => expect(load).toHaveBeenCalledOnce());
  view.rerender({ sessionChecking: true });
  act(() => {
    expect(view.result.current.read("stale")).toBe(false);
  });
  view.rerender({ sessionChecking: false });
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(view.result.current.result?.mode).toBe("stale"));
});

it.each(["loaded", "empty", "expired", "noShop"] as const)(
  "조회 결과 %s 콜백을 렌더마다 되풀이하지 않고 한 번 전달한다",
  async (kind) => {
    const onLoaded = vi.fn(),
      onNotSet = vi.fn(),
      onSessionExpired = vi.fn(),
      onRegisterShop = vi.fn();
    const response =
      kind === "loaded"
        ? ok("value")
        : kind === "empty"
          ? notSet
          : {
              ok: false as const,
              status: kind === "expired" ? 401 : 404,
              problem: parseProblem(
                { code: kind === "expired" ? "unauthenticated" : "shop_not_registered" },
                kind === "expired" ? 401 : 404,
              ),
              retryAfterSeconds: null,
            };
    const view = renderHook(() =>
      useVersionedRead(async () => response, {
        allowNotSet: true,
        onLoaded,
        onNotSet,
        onSessionExpired,
        onRegisterShop,
      }),
    );
    const called =
      kind === "loaded"
        ? onLoaded
        : kind === "empty"
          ? onNotSet
          : kind === "expired"
            ? onSessionExpired
            : onRegisterShop;
    await waitFor(() => expect(called).toHaveBeenCalledOnce());
    view.rerender();
    await act(async () => {});
    expect(called).toHaveBeenCalledOnce();
    for (const callback of [onLoaded, onNotSet, onSessionExpired, onRegisterShop])
      if (callback !== called) expect(callback).not.toHaveBeenCalled();
    if (kind === "loaded") expect(onLoaded).toHaveBeenCalledWith("initial", { value: "value" });
  },
);
