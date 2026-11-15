/**
 * 오류 응답(06 계약의 Problem: RFC 9457에 code·traceId를 더함, application/problem+json).
 * 뼈대(TASK-015)는 없는 경로(not_found)와 예상하지 못한 오류(internal)만 낸다.
 * 오류 코드 목록·필드 오류·요청 키는 TASK-018이 계약(api/openapi.yaml의 components.x-corthex.errors)에서 만든다.
 */

/** components.x-corthex.errors의 message(06 README 6절)를 그대로 옮김. */
export const PROBLEM_TITLES = {
  not_found: "찾을 수 없어요",
  internal: "문제가 생겼어요. 다시 시도해 주세요",
} as const;

export type ProblemCode = keyof typeof PROBLEM_TITLES;

const STATUS: Record<ProblemCode, number> = {
  not_found: 404,
  internal: 500,
};

export interface Problem {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: ProblemCode;
  readonly traceId: string;
  readonly instance?: string;
}

export function problemBody(code: ProblemCode, traceId: string, instance?: string): Problem {
  const body: Problem = {
    type: `/problems/${code}`,
    title: PROBLEM_TITLES[code],
    status: STATUS[code],
    code,
    traceId,
    ...(instance !== undefined && instance.length > 0 ? { instance: instance.slice(0, 2048) } : {}),
  };
  return body;
}

export function problemResponse(code: ProblemCode, traceId: string, instance?: string): Response {
  const body = problemBody(code, traceId, instance);
  return new Response(JSON.stringify(body), {
    status: body.status,
    headers: {
      "content-type": "application/problem+json",
      "cache-control": "no-store",
    },
  });
}
