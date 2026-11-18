import { matchPath } from "react-router";
import { type ApiFailure, type ApiResult, request } from "./api";
import { classify, ERROR_CODES, type Failure } from "./problems";

export const OPERATOR_LOGIN = "/operator/login";
export const OPERATOR_HOME = "/operator/shops";
export const OPERATOR_SESSION_API = "/operator/session";
export const OPERATOR_ME_API = "/operator/me";

const OPERATOR_SCREENS = [
  { path: OPERATOR_HOME, screen: "SCR-047", title: "영업 신고 확인 목록", top: true },
  { path: "/operator/alerts", screen: "SCR-049", title: "운영자 알림", top: true },
  { path: "/operator/shops/:shopId", screen: "SCR-048", title: "영업 신고 확인", top: false },
  { path: "/operator/shops/:shopId/records", screen: "SCR-050", title: "가게 기록 보기", top: false },
  {
    path: "/operator/shops/:shopId/consultations/:consultationId",
    screen: "SCR-050",
    title: "가게 기록 보기",
    top: false,
  },
  { path: "/operator/shops/:shopId/orders/:orderId", screen: "SCR-050", title: "가게 기록 보기", top: false },
] as const;

export function operatorScreen(pathname: string) {
  return OPERATOR_SCREENS.find(({ path }) => matchPath({ path, caseSensitive: true, end: true }, pathname));
}

/** W9의 돌아갈 주소는 07 사이트맵의 운영자 화면으로 제한한다. */
export function operatorReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/operator/") || value.includes("\\")) return null;
  const origin = "https://example.org";
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || !operatorScreen(url.pathname)) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

export interface OperatorCredentials {
  readonly email: string;
  readonly password: string;
  readonly otp: string;
}

export interface OperatorIdentity {
  readonly operatorId: string;
  readonly displayName: string;
}

async function verifiedOperator(result: Promise<ApiResult<unknown>>): Promise<ApiResult<OperatorIdentity>> {
  const resolved = await result;
  if (!resolved.ok) return resolved;
  const data = resolved.data;
  if (
    typeof data === "object" &&
    data !== null &&
    "operatorId" in data &&
    typeof data.operatorId === "string" &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(data.operatorId) &&
    "displayName" in data &&
    typeof data.displayName === "string" &&
    [...data.displayName].length >= 1 &&
    [...data.displayName].length <= 40
  ) {
    return { ...resolved, data: { operatorId: data.operatorId, displayName: data.displayName } };
  }
  return { ok: false, status: 502, problem: null, retryAfterSeconds: null };
}

export function signIn(body: OperatorCredentials, signal: AbortSignal) {
  return verifiedOperator(request(OPERATOR_SESSION_API, { method: "POST", body, cache: "no-store", signal }));
}

export function fetchOperator(signal: AbortSignal) {
  return verifiedOperator(request(OPERATOR_ME_API, { cache: "no-store", signal }));
}

export function signOut(signal: AbortSignal) {
  return request<null>(OPERATOR_SESSION_API, { method: "DELETE", cache: "no-store", signal });
}

export function loginFeedback(result: ApiFailure): Failure {
  if (result.status === 401) {
    return {
      ...classify(401, null, null),
      outcome: "login",
      code: "operator_login_failed",
      message: ERROR_CODES.operator_login_failed.message,
    };
  }
  if (result.status === 429) {
    return {
      ...classify(429, null, null),
      outcome: "wait",
      code: "too_many_attempts",
      state: "rate-limited",
      message: ERROR_CODES.too_many_attempts.message,
      retryAfterSeconds: result.retryAfterSeconds ?? 15 * 60,
    };
  }
  const code = result.problem?.code;
  return classify(
    result.status,
    code === "validation_failed" || code === "auth_unavailable" || code === "internal" ? result.problem : null,
    null,
  );
}

export function loginFieldsAfterFailure(fields: OperatorCredentials, status: number): OperatorCredentials {
  if (status === 401) return { email: "", password: "", otp: "" };
  if (status === 422) return { ...fields, password: "" };
  if (status === 429) return fields;
  return { email: fields.email, password: "", otp: "" };
}
