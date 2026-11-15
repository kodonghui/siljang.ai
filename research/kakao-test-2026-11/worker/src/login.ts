// 카카오 로그인 PKCE 시험(K-11, OPEN-11). 문서(2026-11-15 다시 확인):
// - OIDC 설정(https://kauth.kakao.com/.well-known/openid-configuration)은 code_challenge_methods_supported ["S256"]을 알림
// - '인가 코드 요청'·'토큰 요청'의 매개변수 표에는 code_challenge·code_verifier가 없음
// 그래서 ① 맞는 code_verifier ② 틀린 code_verifier ③ PKCE 없이 셋을 해 보고, ②가 거절되는지로 PKCE를 검사하는지 본다.
// 토큰은 받자마자 버리고 기록에는 상태 코드·오류 코드·토큰이 있었는지(참거짓)만 남긴다.

import { hmacHex } from "./mask.ts";
import { safeEqual } from "./record.ts";

export type LoginMode = "pkce" | "pkce_wrong" | "plain";

/** 로그인 시험 표의 유효 시간. 표는 키가 맞는 스킬 요청(K-11 카드)에서만 만들어 버튼 주소에 붙임.
 *  표 없이 /login/start를 열면 KV에 쓰지도, REST API 키가 든 인가 주소로 보내지도 않음 */
export const TICKET_TTL_SEC = 1800;

export async function makeTicket(hashKey: string, nowMs: number): Promise<string> {
  const exp = Math.floor(nowMs / 1000) + TICKET_TTL_SEC;
  return `${exp}-${(await hmacHex(hashKey, `login-ticket:${exp}`)).slice(0, 32)}`;
}

export async function ticketValid(hashKey: string, ticket: string | null, nowMs: number): Promise<boolean> {
  const m = /^(\d{10})-([0-9a-f]{32})$/.exec(ticket ?? "");
  if (!m || Number(m[1]) * 1000 < nowMs) return false;
  return safeEqual(m[2], (await hmacHex(hashKey, `login-ticket:${m[1]}`)).slice(0, 32));
}

/** state = 무작위 22자 + HMAC 앞 24자. 서버가 만든 state만 KV에서 찾고 기록함(아무 state로 기록을 쓰지 못하게) */
export async function makeState(hashKey: string): Promise<string> {
  const r = randomB64url(16);
  return `${r}${(await hmacHex(hashKey, `login-state:${r}`)).slice(0, 24)}`;
}

export async function stateValid(hashKey: string, state: string): Promise<boolean> {
  const m = /^([A-Za-z0-9_-]{22})([0-9a-f]{24})$/.exec(state);
  if (!m) return false;
  return safeEqual(m[2], (await hmacHex(hashKey, `login-state:${m[1]}`)).slice(0, 24));
}

export const AUTHORIZE_URL = "https://kauth.kakao.com/oauth/authorize";
export const TOKEN_URL = "https://kauth.kakao.com/oauth/token";

export function isMode(v: string | null): v is LoginMode {
  return v === "pkce" || v === "pkce_wrong" || v === "plain";
}

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomB64url(n: number): string {
  return b64url(crypto.getRandomValues(new Uint8Array(n)));
}

/** RFC 7636의 S256: BASE64URL(SHA256(ASCII(code_verifier))) */
export async function s256(verifier: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(d));
}

export function authorizeUrl(o: { clientId: string; redirectUri: string; state: string; challenge?: string }): string {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", o.clientId);
  u.searchParams.set("redirect_uri", o.redirectUri);
  u.searchParams.set("state", o.state);
  if (o.challenge) {
    u.searchParams.set("code_challenge", o.challenge);
    u.searchParams.set("code_challenge_method", "S256");
  }
  return u.toString();
}

export function tokenForm(o: { clientId: string; redirectUri: string; code: string; clientSecret?: string; verifier?: string }): URLSearchParams {
  const f = new URLSearchParams();
  f.set("grant_type", "authorization_code");
  f.set("client_id", o.clientId);
  f.set("redirect_uri", o.redirectUri);
  f.set("code", o.code);
  if (o.clientSecret) f.set("client_secret", o.clientSecret);
  if (o.verifier) f.set("code_verifier", o.verifier);
  return f;
}

export type TokenSummary = {
  httpStatus: number;
  ok: boolean;
  error: string | null;
  errorCode: string | null;
  errorDescription: string | null;
  hasAccessToken: boolean;
  hasIdToken: boolean;
  tokenType: string | null;
};

/** 토큰 응답에서 기록할 것만. 토큰 값은 담지 않음 */
export function summarizeToken(httpStatus: number, body: unknown): TokenSummary {
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : null);
  return {
    httpStatus,
    ok: httpStatus === 200 && typeof o.access_token === "string",
    error: s("error"),
    errorCode: s("error_code"),
    errorDescription: s("error_description"),
    hasAccessToken: typeof o.access_token === "string",
    hasIdToken: typeof o.id_token === "string",
    tokenType: s("token_type"),
  };
}

/** 토큰 요청 한 번의 결과. rejected는 RFC 7636 4.6이 code_verifier가 맞지 않을 때 돌려주라고 한 invalid_grant(4xx)만.
 *  서버 오류(5xx), invalid_client·invalid_request 같은 다른 오류, 보내기 실패는 PKCE와 관계를 알 수 없어 inconclusive */
export type Outcome = "ok" | "rejected" | "inconclusive";

export const OUTCOME_LABEL: Record<Outcome, string> = { ok: "됨", rejected: "거절(invalid_grant)", inconclusive: "알 수 없는 오류" };

export function outcomeOf(t: TokenSummary | null): Outcome {
  if (!t) return "inconclusive";
  if (t.ok) return "ok";
  if (t.httpStatus >= 400 && t.httpStatus < 500 && t.error === "invalid_grant") return "rejected";
  return "inconclusive";
}

export function isOutcome(v: string | null): v is Outcome {
  return v === "ok" || v === "rejected" || v === "inconclusive";
}

export function verdict(results: Partial<Record<LoginMode, Outcome>>): string {
  const { pkce, pkce_wrong: wrong } = results;
  if (pkce === undefined || wrong === undefined) return "①과 ②를 모두 해야 판단할 수 있어요.";
  if (pkce !== "ok") return "①이 안 됨: 오류 코드를 보고 설정(리다이렉트 URI, 카카오 로그인 켜기, Client Secret)을 확인한 뒤 다시 해요.";
  if (wrong === "ok") return "①·② 모두 됨: 카카오가 PKCE 값을 보지 않음(PKCE 없이 state만으로 시작).";
  if (wrong === "rejected")
    return "①은 되고 ②는 invalid_grant로 거절: 카카오가 code_verifier를 검사함(PKCE를 씀). 오류 설명이 verifier 이야기인지 기록에서 한 번 더 봐요.";
  return "②가 invalid_grant가 아닌 오류로 안 됨: PKCE 때문인지 알 수 없어 판단하지 않아요. ②를 다시 해요.";
}

export function resultPage(title: string, lines: string[]): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body style="font-family:system-ui,sans-serif;margin:16px;line-height:1.6"><h1 style="font-size:20px">${esc(title)}</h1>${lines.map((l) => `<p>${esc(l)}</p>`).join("")}</body></html>`;
}
