/**
 * 요청 빈도 한도(06 DEC-16)의 어댑터(TASK-022). 업무 코드는 RateLimiter만 쓰고 Workers 바인딩은 이 모듈과 app.ts만 안다
 * (tech-stack.md 4-3의 1).
 * - Workers: Rate Limiting 바인딩(wrangler.jsonc의 ratelimits). Cloudflare 문서('Rate Limiting', 2026-11-12 고침,
 *   2026-11-16 확인)대로 한도는 대략이다. Cloudflare 위치마다 따로 세고, 같은 위치에서도 수가 퍼지기 전에 잠깐 넘을 수 있다.
 *   기간은 10초나 60초만 된다. 그래서 '15분에 5번' 같은 한도(운영자 로그인, TASK-021)는 이 바인딩으로 하지 않는다.
 * - 시험: test/support/rate-limit.ts의 메모리 한도.
 */

export interface RateLimiter {
  /** key의 이번 기간 호출 하나를 세고, 한도 안이면 true. */
  limit(key: string): Promise<boolean>;
}

/** 한도 하나: wrangler.jsonc의 바인딩 이름과 값(시험이 wrangler.jsonc와 같은지 본다). */
export interface RateLimitRule {
  readonly binding:
    | "UPLOAD_RATE_LIMITER"
    | "OWNER_LOGIN_RATE_LIMITER"
    | "PUBLIC_PRIVACY_RATE_LIMITER"
    | "PUBLIC_BOOKING_RATE_LIMITER"
    | "FILE_RATE_LIMITER";
  readonly limit: number;
  readonly periodSeconds: 10 | 60;
}

/** 사진 올리기(API-007): 사장님마다 1분에 30번(06 DEC-16, 설계 재검토 RD-18). 키는 upload:<사장님 ID>. */
export const UPLOAD_RATE: RateLimitRule = { binding: "UPLOAD_RATE_LIMITER", limit: 30, periodSeconds: 60 };
export const OWNER_LOGIN_RATE: RateLimitRule = { binding: "OWNER_LOGIN_RATE_LIMITER", limit: 10, periodSeconds: 60 };

export const PUBLIC_PRIVACY_RATE: RateLimitRule = {
  binding: "PUBLIC_PRIVACY_RATE_LIMITER",
  limit: 60,
  periodSeconds: 60,
};

/**
 * Workers Rate Limiting 바인딩의 꼴(worker-runtime.d.ts의 RateLimit에서 쓰는 메서드만). 시험의 타입 검사는 Workers 형식을
 * 보지 않아 여기 적는다.
 */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Workers Rate Limiting 바인딩을 RateLimiter로. */
export function bindingLimiter(binding: RateLimitBinding): RateLimiter {
  return {
    limit: async (key) => (await binding.limit({ key })).success,
  };
}

export const PUBLIC_BOOKING_RATE: RateLimitRule = {
  binding: "PUBLIC_BOOKING_RATE_LIMITER",
  limit: 60,
  periodSeconds: 60,
};

/** 도안50장+포트폴리오100장을 한IP에서 한 분에 네 번 읽을 수 있는 상한. */
export const FILE_RATE: RateLimitRule = { binding: "FILE_RATE_LIMITER", limit: 600, periodSeconds: 60 };
