/** DB 잠금 확인과 연결 중단 신호를 모든 구글 요청에 묶는다. */
export function guardedLedgerFetch(
  guard: { readonly signal: AbortSignal; readonly revalidate: () => Promise<boolean> },
  deadline: AbortSignal,
  send: typeof fetch = fetch,
): typeof fetch {
  return async (request, init) => {
    deadline.throwIfAborted();
    guard.signal.throwIfAborted();
    if (!(await guard.revalidate())) throw new Error("ledger guard expired");
    guard.signal.throwIfAborted();
    const signals = [deadline, guard.signal];
    if (init?.signal) signals.push(init.signal);
    return send(request, { ...init, signal: AbortSignal.any(signals) });
  };
}
