import { useCallback, useLayoutEffect, useRef, useState } from "react";

export function focusReady(target: HTMLElement | null | undefined): boolean {
  if (!target?.isConnected || target.matches(":disabled")) return false;
  target.focus();
  return target.ownerDocument.activeElement === target;
}
/** 초점 요청은 같은 화면 반영에서 소비하고, 대상 두 번 실패 뒤 결과 영역으로 한 번만 보낸다. */
export function useFocusRequest<T>(
  resolve: (target: T) => HTMLElement | null | undefined,
  blocked: boolean,
  fallback: () => HTMLElement | null,
) {
  const current = useRef({ resolve, fallback });
  current.current = { resolve, fallback };
  const [request, setRequest] = useState<{ readonly target: T; readonly origin: Element | null } | null>(null);
  const queue = useCallback((target: T, origin: Element | null = document.activeElement) => {
    setRequest({ target, origin });
  }, []);
  const cancel = useCallback(() => setRequest(null), []);
  useLayoutEffect(() => {
    if (!request) return;
    setRequest(null);
    if (blocked) return;
    const active = document.activeElement;
    if (active && active !== document.body && active !== request.origin) return;
    const target = current.current.resolve(request.target);
    if (focusReady(target) || focusReady(target)) return;
    const backup = current.current.fallback();
    if (backup !== target) focusReady(backup);
  }, [request, blocked]);
  return { queue, cancel };
}
