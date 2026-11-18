/**
 * 운영자 인증 서비스 어댑터(TASK-021; 06 DEC-27, TASK-003): Supabase Auth의 이메일·비밀번호 로그인과 TOTP 2단계 인증.
 * 업무 코드는 OperatorAuth만 쓰고 Supabase 주소·키는 이 모듈과 settings.ts만 안다.
 *
 * - supabase-js를 쓰지 않고 fetch로 부른다. 부르는 곳이 7개(비밀번호 로그인, 사용자, TOTP 등록·지우기, challenge, verify,
 *   로그아웃)뿐이고, supabase-js는 세션을 저장소에 두고 토큰을 스스로 새로 받는 클라이언트라 서버가 한 요청 안에서
 *   한 번 쓰고 버리는 이 쓰임과 맞지 않는다. 길과 본문은 Supabase Auth의 OpenAPI(github.com/supabase/auth openapi.yaml,
 *   2026-11-18 확인)와 'Multi-Factor Authentication (TOTP)' 문서(2026-11-18 확인)를 따른다.
 * - 키는 publishable 키를 apikey 헤더로 보낸다(Supabase 문서 'Understanding API keys', 2026-11-18 확인). 사용자 토큰은
 *   Authorization: Bearer. secret 키는 쓰지 않는다(settings.ts가 막음).
 * - 실패를 둘로 가른다. 맞지 않음(4xx: 비밀번호·번호가 틀림, 사용자 없음 등)은 null이고, 답하지 않음(연결 실패, 시간 초과,
 *   5xx, 429, 예상하지 못한 답)은 AuthUnavailableError다. 오류에는 이유와 상태 코드만 싣고 본문·토큰·값은 싣지 않는다.
 * - Supabase가 준 토큰은 우리 세션에 쓰지 않는다(operator-login.ts). 확인이 끝나면 signOut으로 그 세션을 끝낸다.
 */
import type { OperatorAuthSettings } from "./settings";

/** 부를 때마다의 기본 시간 한도(밀리초). */
export const AUTH_TIMEOUT_MS = 5000;

/** 인증 서비스가 답하지 않음. 응답은 503 auth_unavailable(app.ts), 로그에는 이유·상태 코드만. */
export class AuthUnavailableError extends Error {
  override readonly name = "AuthUnavailableError";
  readonly reason: "network" | "timeout" | "status" | "shape";
  readonly status: number | null;

  constructor(reason: "network" | "timeout" | "status" | "shape", status: number | null = null) {
    super(`auth service ${reason}${status === null ? "" : ` ${status}`}`);
    this.reason = reason;
    this.status = status;
  }
}

export interface AuthFactor {
  readonly id: string;
  readonly type: string;
  readonly status: string;
}

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  /** 사용자의 인증 수단. 응답에 목록이 없으면 null(getUser로 다시 읽음). */
  readonly factors: readonly AuthFactor[] | null;
}

export interface AuthSession {
  readonly accessToken: string;
  readonly user: AuthUser;
}

export interface TotpEnrollment {
  readonly factorId: string;
  /** 인증 앱에 넣을 비밀 글자(base32). 등록 도구가 화면에 한 번 보이고 어디에도 남기지 않는다. */
  readonly secret: string;
  /** otpauth:// 주소(같은 비밀 글자를 담음). */
  readonly uri: string;
}

export interface OperatorAuth {
  /** 비밀번호 로그인(aal1). 맞지 않으면 null. */
  signInWithPassword(email: string, password: string): Promise<AuthSession | null>;
  /** 토큰의 사용자(인증 수단 목록 포함). 토큰이 맞지 않으면 null. */
  getUser(accessToken: string): Promise<AuthUser | null>;
  /** TOTP 확인(challenge → verify). 번호가 맞으면 aal2 토큰, 틀리면 null. */
  verifyTotp(accessToken: string, factorId: string, code: string): Promise<string | null>;
  /** TOTP 등록 시작(확인 전 상태). 막히면 null. */
  enrollTotp(accessToken: string, friendlyName: string): Promise<TotpEnrollment | null>;
  /** 인증 수단 지우기. 지웠으면 true. */
  unenroll(accessToken: string, factorId: string): Promise<boolean>;
  /** 이 토큰의 세션을 끝낸다(scope=local). 실패해도 던지지 않는다. */
  signOut(accessToken: string): Promise<void>;
}

export interface OperatorAuthOptions {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** JWT 본문의 aal(서명은 보지 않음: 토큰은 방금 TLS로 Supabase에서 받은 것이고 우리 세션에 쓰지 않는다). */
export function tokenAal(token: string): string | null {
  const part = token.split(".")[1];
  if (part === undefined) return null;
  try {
    const b64 = part.replaceAll("-", "+").replaceAll("_", "/");
    const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))));
    return isRecord(json) ? str(json.aal) : null;
  } catch {
    return null;
  }
}

function parseUser(v: unknown): AuthUser {
  if (!isRecord(v)) throw new AuthUnavailableError("shape");
  const id = str(v.id);
  const email = str(v.email);
  if (id === null || email === null) throw new AuthUnavailableError("shape");
  let factors: AuthFactor[] | null = null;
  if (Array.isArray(v.factors)) {
    factors = [];
    for (const f of v.factors) {
      if (!isRecord(f)) throw new AuthUnavailableError("shape");
      const fid = str(f.id);
      const type = str(f.factor_type);
      const status = str(f.status);
      if (fid === null || type === null || status === null) throw new AuthUnavailableError("shape");
      factors.push({ id: fid, type, status });
    }
  }
  return { id, email, factors };
}

function accessTokenOf(body: unknown): string {
  const token = isRecord(body) ? str(body.access_token) : null;
  if (token === null) throw new AuthUnavailableError("shape");
  return token;
}

/** Supabase Auth를 fetch로 부르는 OperatorAuth. */
export function supabaseAuth(settings: OperatorAuthSettings, options: OperatorAuthOptions = {}): OperatorAuth {
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? AUTH_TIMEOUT_MS;
  const base = `${settings.url}/auth/v1`;

  async function call(
    method: "GET" | "POST" | "DELETE",
    path: string,
    init: { readonly token?: string; readonly body?: unknown } = {},
  ): Promise<{ readonly status: number; readonly body: unknown }> {
    const headers: Record<string, string> = {
      apikey: settings.publishableKey.reveal(),
      accept: "application/json",
    };
    if (init.token !== undefined) headers.authorization = `Bearer ${init.token}`;
    if (init.body !== undefined) headers["content-type"] = "application/json";
    const signal = AbortSignal.timeout(timeoutMs);
    let res: Response;
    try {
      const request: RequestInit = { method, headers, redirect: "manual", signal };
      if (init.body !== undefined) request.body = JSON.stringify(init.body);
      res = await doFetch(`${base}${path}`, request);
    } catch {
      throw new AuthUnavailableError(signal.aborted ? "timeout" : "network");
    }
    if (res.status === 429 || res.status >= 500 || (res.status >= 300 && res.status < 400)) {
      await res.body?.cancel().catch(() => {});
      throw new AuthUnavailableError("status", res.status);
    }
    let text: string;
    try {
      text = await res.text();
    } catch {
      throw new AuthUnavailableError(signal.aborted ? "timeout" : "network");
    }
    let body: unknown = null;
    if (text !== "") {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    return { status: res.status, body };
  }

  const ok = (status: number) => status >= 200 && status < 300;

  return {
    async signInWithPassword(email, password) {
      const r = await call("POST", "/token?grant_type=password", { body: { email, password } });
      if (!ok(r.status)) return null;
      const accessToken = accessTokenOf(r.body);
      return { accessToken, user: parseUser(isRecord(r.body) ? r.body.user : null) };
    },

    async getUser(accessToken) {
      const r = await call("GET", "/user", { token: accessToken });
      if (!ok(r.status)) return null;
      return parseUser(r.body);
    },

    async verifyTotp(accessToken, factorId, code) {
      if (!UUID.test(factorId)) throw new AuthUnavailableError("shape");
      const path = `/factors/${factorId}`;
      const challenge = await call("POST", `${path}/challenge`, { token: accessToken, body: {} });
      if (!ok(challenge.status)) return null;
      const challengeId = isRecord(challenge.body) ? str(challenge.body.id) : null;
      if (challengeId === null || !UUID.test(challengeId)) throw new AuthUnavailableError("shape");
      const verified = await call("POST", `${path}/verify`, {
        token: accessToken,
        body: { challenge_id: challengeId, code },
      });
      if (!ok(verified.status)) return null;
      const token = accessTokenOf(verified.body);
      // 확인했다는 답인데 2단계가 아니면 받지 않는다(닫힘).
      return tokenAal(token) === "aal2" ? token : null;
    },

    async enrollTotp(accessToken, friendlyName) {
      const r = await call("POST", "/factors", {
        token: accessToken,
        body: { factor_type: "totp", friendly_name: friendlyName },
      });
      if (!ok(r.status)) return null;
      const b = r.body;
      const totp = isRecord(b) && isRecord(b.totp) ? b.totp : null;
      const factorId = isRecord(b) ? str(b.id) : null;
      const secret = totp === null ? null : str(totp.secret);
      const uri = totp === null ? null : str(totp.uri);
      if (factorId === null || !UUID.test(factorId) || secret === null || uri === null) {
        throw new AuthUnavailableError("shape");
      }
      return { factorId, secret, uri };
    },

    async unenroll(accessToken, factorId) {
      if (!UUID.test(factorId)) throw new AuthUnavailableError("shape");
      const r = await call("DELETE", `/factors/${factorId}`, { token: accessToken });
      return ok(r.status);
    },

    async signOut(accessToken) {
      try {
        await call("POST", "/logout?scope=local", { token: accessToken });
      } catch {
        // 끝내지 못해도 그 토큰은 우리가 어디에도 두지 않았고 Supabase가 정한 시간에 끝난다.
      }
    },
  };
}
