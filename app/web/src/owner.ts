import { matchPath } from "react-router";
import { type ApiFailure, type ApiResult, request } from "./api";
import { classify, ERROR_CODES, type Failure } from "./problems";

export const OWNER_LOGIN = "/owner/login";
export const OWNER_CALLBACK = "/owner/login/callback";
export const OWNER_HOME = "/owner";
export const OWNER_REGISTER = "/owner/shop/new";
export const OWNER_LICENSE = "/owner/shop/license";
export const OWNER_AUTHORIZATION_API = "/owner/session/authorization";
export const OWNER_SESSION_API = "/owner/session";
export const OWNER_ME_API = "/owner/me";
export const OWNER_RETURN_KEY = "siljang.owner.returnTo";

/** 07의 사장님 웹 화면. 로그인·콜백과 카카오 알림은 돌아갈 주소에서 뺀다. */
export const OWNER_PATHS = [
  OWNER_HOME,
  OWNER_REGISTER,
  "/owner/handoffs/:handoffId",
  "/owner/consultations/:consultationId",
  "/owner/orders",
  "/owner/orders/:orderId",
  "/owner/orders/:orderId/custom-decision",
  "/owner/orders/:orderId/overdue-decision",
  "/owner/change-requests/:changeRequestId",
  "/owner/orders/:orderId/refund-decision",
  "/owner/refunds/:refundId",
  "/owner/issue-reports/:issueReportId",
  "/owner/payment-requests",
  "/owner/payment-requests/:paymentRequestId",
  "/owner/production",
  "/owner/pickups",
  "/owner/calendar",
  "/owner/calendar/settings",
  "/owner/shop",
  OWNER_LICENSE,
  "/owner/price-list",
  "/owner/price-list/versions",
  "/owner/operating-rules",
  "/owner/operating-rules/versions",
  "/owner/payment-destination",
  "/owner/kakao-channel",
  "/owner/ledger",
  "/owner/booking-link",
  "/owner/portfolio",
  "/owner/reviews",
] as const;

export function ownerReturnTo(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !value.startsWith("/owner") ||
    value.includes("\\") ||
    [...value].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)
  )
    return null;
  const origin = "https://example.org";
  try {
    const url = new URL(value, origin);
    if (
      url.origin !== origin ||
      !OWNER_PATHS.some((path) => matchPath({ path, caseSensitive: true, end: true }, url.pathname))
    )
      return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

export interface OwnerIdentity {
  readonly owner: { readonly ownerId: string; readonly alertChannelFriend: boolean; readonly createdAt: string };
  readonly shop: {
    readonly shopId: string;
    readonly name: string;
    readonly licenseStatus: "pending" | "on_hold" | "verified";
  } | null;
}
export interface OwnerSession extends OwnerIdentity {
  readonly next: "register_shop" | "resubmit_license" | "open_tasks";
}
export interface OwnerCallbackInput {
  readonly kakaoCode: string;
  readonly state: string;
  readonly redirectUri: string;
}
interface Authorization {
  readonly authorizationUrl: string;
  readonly state: string;
  readonly expiresAt: string;
}
const INVALID: ApiFailure = { ok: false, status: 502, problem: null, retryAfterSeconds: null };
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const STATE = /^[A-Za-z0-9._-]{16,512}$/;
const CODE = /^[A-Za-z0-9_-]{1,512}$/;
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function identity(value: unknown): value is OwnerIdentity {
  if (!object(value) || !object(value.owner)) return false;
  const owner = value.owner;
  if (
    typeof owner.ownerId !== "string" ||
    !UUID.test(owner.ownerId) ||
    typeof owner.alertChannelFriend !== "boolean" ||
    typeof owner.createdAt !== "string" ||
    !Number.isFinite(Date.parse(owner.createdAt))
  )
    return false;
  const shop = value.shop;
  return (
    shop === null ||
    (object(shop) &&
      typeof shop.shopId === "string" &&
      UUID.test(shop.shopId) &&
      typeof shop.name === "string" &&
      [...shop.name].length >= 1 &&
      [...shop.name].length <= 40 &&
      typeof shop.licenseStatus === "string" &&
      ["pending", "on_hold", "verified"].includes(shop.licenseStatus))
  );
}

export function ownerDestination(profile: OwnerIdentity, returnTo: unknown): string {
  if (profile.shop === null) return OWNER_REGISTER;
  if (profile.shop.licenseStatus === "on_hold") return OWNER_LICENSE;
  const safe = ownerReturnTo(returnTo);
  return safe === OWNER_REGISTER ? OWNER_HOME : (safe ?? OWNER_HOME);
}

/** 카카오가 돌려준 값만 API-001에 보낸다. 거부·누락·반복 파라미터는 전송하지 않는다. */
export function ownerCallbackInput(search: string, redirectUri: string): OwnerCallbackInput | null {
  if (search.length > 4096) return null;
  const params = new URLSearchParams(search);
  const code = params.getAll("code"),
    state = params.getAll("state");
  if (
    params.has("error") ||
    code.length !== 1 ||
    state.length !== 1 ||
    !CODE.test(code[0] ?? "") ||
    !STATE.test(state[0] ?? "")
  )
    return null;
  return { kakaoCode: code[0] as string, state: state[0] as string, redirectUri };
}

export async function startOwnerLogin(redirectUri: string, signal: AbortSignal): Promise<ApiResult<Authorization>> {
  const result = await request<unknown>(OWNER_AUTHORIZATION_API, {
    method: "POST",
    body: { redirectUri },
    cache: "no-store",
    signal,
  });
  if (!result.ok) return result;
  const data = result.data;
  if (
    !object(data) ||
    typeof data.authorizationUrl !== "string" ||
    data.authorizationUrl.length > 2048 ||
    typeof data.state !== "string" ||
    !STATE.test(data.state) ||
    typeof data.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(data.expiresAt))
  )
    return INVALID;
  try {
    const url = new URL(data.authorizationUrl);
    const params = url.searchParams;
    const names = ["client_id", "redirect_uri", "response_type", "state", "code_challenge", "code_challenge_method"];
    if (
      url.origin !== "https://kauth.kakao.com" ||
      url.pathname !== "/oauth/authorize" ||
      url.username ||
      url.password ||
      url.hash ||
      names.some((name) => params.getAll(name).length !== 1) ||
      !params.get("client_id") ||
      params.get("redirect_uri") !== redirectUri ||
      params.get("response_type") !== "code" ||
      params.get("state") !== data.state ||
      params.get("code_challenge_method") !== "S256" ||
      !/^[A-Za-z0-9_-]{43}$/.test(params.get("code_challenge") ?? "")
    )
      return INVALID;
    return { ...result, data: { authorizationUrl: url.href, state: data.state, expiresAt: data.expiresAt } };
  } catch {
    return INVALID;
  }
}

/** StrictMode의 효과 재실행도 같은 진행 중 교환을 공유한다. 코드·state는 완료 뒤 메모리에서 제거한다. */
const exchanges = new Map<string, Promise<ApiResult<OwnerSession>>>();
export function completeOwnerLogin(input: OwnerCallbackInput): Promise<ApiResult<OwnerSession>> {
  const key = JSON.stringify(input);
  const active = exchanges.get(key);
  if (active) return active;
  const pending = request<unknown>(OWNER_SESSION_API, { method: "POST", body: input, cache: "no-store" })
    .then((result): ApiResult<OwnerSession> => {
      if (!result.ok) return result;
      if (!identity(result.data) || !object(result.data)) return INVALID;
      const expected =
        result.data.shop === null
          ? "register_shop"
          : result.data.shop.licenseStatus === "on_hold"
            ? "resubmit_license"
            : "open_tasks";
      return result.data.next === expected
        ? { ...result, data: { owner: result.data.owner, shop: result.data.shop, next: expected } }
        : INVALID;
    })
    .finally(() => {
      exchanges.delete(key);
    });
  exchanges.set(key, pending);
  return pending;
}

export async function fetchOwner(signal: AbortSignal): Promise<ApiResult<OwnerIdentity>> {
  const result = await request<unknown>(OWNER_ME_API, { cache: "no-store", signal });
  return !result.ok
    ? result
    : identity(result.data)
      ? { ...result, data: { owner: result.data.owner, shop: result.data.shop } }
      : INVALID;
}
export function signOutOwner(signal: AbortSignal) {
  return request<null>(OWNER_SESSION_API, { method: "DELETE", cache: "no-store", signal });
}

export function ownerLoginFeedback(result: ApiFailure): Failure {
  if (result.status === 401 || result.status === 422)
    return {
      ...classify(401, null, null),
      ...ERROR_CODES.kakao_login_failed,
      code: "kakao_login_failed",
      fieldErrors: [],
    };
  if (result.status === 429)
    return {
      ...classify(429, null, null),
      ...ERROR_CODES.rate_limited,
      code: "rate_limited",
      retryAfterSeconds: result.retryAfterSeconds ?? 60,
    };
  const problem =
    result.status === 503 && result.problem?.code === "kakao_unavailable"
      ? result.problem
      : result.problem?.code === "internal"
        ? result.problem
        : null;
  return classify(result.status, problem, null);
}
