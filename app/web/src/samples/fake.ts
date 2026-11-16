// 견본 화면의 가짜 서버(개발 서버에서만). 보낸 요청 키와 본문을 window.__sampleRequests에 남겨
// scripts/page-check.mjs가 '새 명령은 새 키, 다시 시도는 같은 키, 확인하면 새 키와 confirm 값'을 브라우저에서 확인한다.
import type { ApiResult } from "../api";
import type { Send } from "../command";
import { classify, ERROR_CODES, type ErrorCode, type Failure, parseProblem } from "../problems";

export interface SampleRequest {
  readonly key: string;
  readonly body: unknown;
}

declare global {
  interface Window {
    __sampleRequests?: SampleRequest[];
  }
}

/** 견본에 쓰는 추적 ID(06 traceId 꼴, 지어낸 값) */
export const SAMPLE_TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

/** 06 Problem 꼴의 실패 응답 */
export function problemResult(code: ErrorCode, extra: Record<string, unknown> = {}): ApiResult<never> {
  const { status, message } = ERROR_CODES[code];
  const body = { type: `/problems/${code}`, title: message, status, code, traceId: SAMPLE_TRACE, ...extra };
  return { ok: false, status, problem: parseProblem(body, status), retryAfterSeconds: null };
}

/** 그 응답을 화면이 받았을 때의 실패(G7) */
export function sampleFailure(code: ErrorCode, extra: Record<string, unknown> = {}): Failure {
  const r = problemResult(code, extra);
  if (r.ok) throw new Error("unreachable");
  return classify(r.status, r.problem, r.retryAfterSeconds);
}

/**
 * 이 send의 n번째 부름(0부터)에 script가 정한 결과를 delayMs 뒤에 돌려주는 send.
 * 보낸 키와 본문은 페이지 하나에 하나인 window.__sampleRequests에 쌓는다(그릴 때마다 send를 새로 만들어도 이어짐).
 */
export function fakeSend<I, O>(script: (input: I, call: number) => ApiResult<O>, delayMs = 400): Send<I, O> {
  let calls = 0;
  return (input, key) => {
    const call = calls++;
    if (typeof window !== "undefined") {
      window.__sampleRequests ??= [];
      window.__sampleRequests.push({ key, body: input });
    }
    return new Promise((resolve) => setTimeout(() => resolve(script(input, call)), delayMs));
  };
}
