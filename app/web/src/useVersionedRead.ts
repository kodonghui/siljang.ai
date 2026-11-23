import { useCallback, useEffect, useRef, useState } from "react";
import { type ApiFailure, type ApiResult, CONNECTION_FAILED } from "./api";
export type ReadMode = "initial" | "stale";
export interface VersionedReadResult<T> {
  readonly mode: ReadMode;
  readonly response: ApiResult<T>;
}
interface Options<T> {
  readonly sessionChecking?: boolean;
  readonly sessionFailed?: boolean;
  readonly allowNotSet?: boolean;
  readonly onLoaded?: (mode: ReadMode, data: T) => void;
  readonly onNotSet?: () => void;
  readonly onSessionExpired?: () => void;
  readonly onRegisterShop?: () => void;
}
/** 버전 편집 화면의 초기/충돌 조회와 취소된 응답 처리를 함께 관리한다. */
export function useVersionedRead<T>(load: (signal: AbortSignal) => Promise<ApiResult<T>>, options: Options<T>) {
  const current = useRef({ load, options });
  current.current = { load, options };
  const active = useRef<AbortController | null>(null),
    needed = useRef(true),
    mode = useRef<ReadMode>("initial");
  const [state, setState] = useState<{
    loading: boolean;
    failure: ApiFailure | null;
    result: VersionedReadResult<T> | null;
  }>({ loading: !options.sessionFailed, failure: null, result: null });
  const read = useCallback((nextMode: ReadMode = "initial"): boolean => {
    mode.current = nextMode;
    needed.current = true;
    if (current.current.options.sessionChecking || current.current.options.sessionFailed) return false;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setState((old) => ({ ...old, loading: true, failure: null }));
    const settle = (response: ApiResult<T>) => {
      if (controller.signal.aborted) return;
      needed.current = false;
      const empty =
        nextMode === "initial" &&
        current.current.options.allowNotSet &&
        !response.ok &&
        response.status === 404 &&
        response.problem?.code === "not_set";
      setState({
        loading: false,
        failure: response.ok || empty ? null : response,
        result: { mode: nextMode, response },
      });
      const callbacks = current.current.options;
      if (response.ok) callbacks.onLoaded?.(nextMode, response.data);
      else if (empty) callbacks.onNotSet?.();
      else if (response.status === 401) callbacks.onSessionExpired?.();
      else if (response.problem?.code === "shop_not_registered") callbacks.onRegisterShop?.();
    };
    void current.current.load(controller.signal).then(settle, () => settle(CONNECTION_FAILED));
    return true;
  }, []);
  useEffect(() => {
    if (options.sessionChecking || options.sessionFailed) {
      active.current?.abort();
      setState((old) => {
        const loading = !options.sessionFailed && needed.current && old.result === null;
        return old.loading === loading ? old : { ...old, loading };
      });
      return;
    }
    if (needed.current) read(mode.current);
    return () => active.current?.abort();
  }, [read, options.sessionChecking, options.sessionFailed]);
  const retry = useCallback(() => read(mode.current), [read]);
  const clearFailure = useCallback(
    () => setState((old) => (old.failure === null ? old : { ...old, failure: null })),
    [],
  );
  return { ...state, read, retry, clearFailure };
}
