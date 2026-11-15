// 카카오 로그인 PKCE 시험(K-11, OPEN-11). 문서(2026-11-15 다시 확인):
// - OIDC 설정(https://kauth.kakao.com/.well-known/openid-configuration)은 code_challenge_methods_supported ["S256"]을 알림
// - '인가 코드 요청'·'토큰 요청'의 매개변수 표에는 code_challenge·code_verifier가 없음
// 그래서 ① 맞는 code_verifier ② 틀린 code_verifier ③ PKCE 없이 셋을 해 보고, ②가 거절되는지로 PKCE를 검사하는지 본다.
// 토큰은 받자마자 버리고 기록에는 상태 코드·오류 코드·토큰이 있었는지(참거짓)만 남긴다.

export type LoginMode = "pkce" | "pkce_wrong" | "plain";

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

export function verdict(results: Partial<Record<LoginMode, boolean>>): string {
  const { pkce, pkce_wrong: wrong } = results;
  if (pkce === undefined || wrong === undefined) return "①과 ②를 모두 해야 판단할 수 있어요.";
  if (pkce && !wrong) return "①은 되고 ②는 거절: 카카오가 code_verifier를 검사함(PKCE를 씀).";
  if (pkce && wrong) return "①·② 모두 됨: 카카오가 PKCE 값을 보지 않음(PKCE 없이 state만으로 시작).";
  return "①이 안 됨: 오류 코드를 보고 TASK-011에서 판단.";
}

export function resultPage(title: string, lines: string[]): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body style="font-family:system-ui,sans-serif;margin:16px;line-height:1.6"><h1 style="font-size:20px">${esc(title)}</h1>${lines.map((l) => `<p>${esc(l)}</p>`).join("")}</body></html>`;
}
