import type { ApiFailure } from "./api";

/** 계약에 맞지 않는 성공 응답은 입력 자료를 출력하지 않고 공통 실패로 처리한다. */
export const INVALID_API_RESPONSE: ApiFailure = { ok: false, status: 502, problem: null, retryAfterSeconds: null };
export const UUID_PATTERN = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export const isApiObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const MAX_API_VERSION = 2147483647;
export const isApiVersion = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= MAX_API_VERSION;
export const isApiTimestamp = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
export const isApiInteger = (value: unknown, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
