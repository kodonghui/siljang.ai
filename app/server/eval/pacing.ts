/** 평가 전용 요청 간격. 긴 Retry-After는 기다리는 대신 그 시각을 보존해 다음 실행에서 잇는다. */
export function retryAfterTime(value: string | null, nowMs: number): number | null {
  if (value === null) return null;
  const text = value.trim();
  let at: number;
  if (/^[0-9]+$/.test(text)) at = nowMs + Number(text) * 1000;
  else if (/[A-Za-z]/.test(text) && text.endsWith("GMT")) at = Date.parse(text);
  else return null;
  if (!Number.isSafeInteger(at) || !Number.isFinite(new Date(at).getTime())) return null;
  return Math.max(nowMs, at);
}

export interface EvalPacer {
  /** null이면 호출 가능. 대기 상한보다 길면 호출하지 않고 재개 시각을 반환한다. */
  beforeCall(): Promise<{ readonly retryAt: string } | null>;
  /** 본문은 읽지 않는다. 모델 클라이언트가 원래 응답을 그대로 처리한다. */
  observe(response: Response): void;
  notBefore(): string | null;
}

export function createEvalPacer(options: {
  readonly intervalMs: number;
  readonly maxWaitMs: number;
  readonly now: () => Date;
  readonly sleep: (ms: number) => Promise<void>;
  readonly notBefore?: string | null;
}): EvalPacer {
  const { intervalMs, maxWaitMs, now, sleep } = options;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 0 || !Number.isSafeInteger(maxWaitMs) || maxWaitMs < intervalMs)
    throw new RangeError("invalid eval pacing");
  let next = options.notBefore == null ? 0 : Date.parse(options.notBefore);
  if (!Number.isSafeInteger(next)) throw new RangeError("invalid eval cooldown");
  return {
    async beforeCall() {
      for (;;) {
        const delay = next - now().getTime();
        if (delay <= 0) break;
        if (delay > maxWaitMs) return { retryAt: new Date(next).toISOString() };
        await sleep(delay);
      }
      next = now().getTime() + intervalMs;
      return null;
    },
    observe(response) {
      if (response.status !== 429 && response.status !== 503) return;
      const at = retryAfterTime(response.headers.get("retry-after"), now().getTime());
      if (at !== null) next = Math.max(next, at);
    },
    notBefore: () => (next > now().getTime() ? new Date(next).toISOString() : null),
  };
}
