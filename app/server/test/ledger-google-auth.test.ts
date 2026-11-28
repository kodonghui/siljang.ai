import { describe, expect, it, vi } from "vitest";
import {
  type GoogleLedgerOAuthSettings,
  GoogleLedgerUnavailableError,
  googleLedgerOAuth,
  LEDGER_GOOGLE_SCOPE,
} from "../src/ledger-google-auth";
import { Secret } from "../src/settings";

const redirect = "https://siljang.example/owner/ledger/callback";
const now = new Date("2026-11-26T10:00:00.000Z");
function settings(): GoogleLedgerOAuthSettings {
  return {
    clientId: new Secret(`${crypto.randomUUID()}.apps.googleusercontent.com`),
    clientSecret: new Secret(crypto.randomUUID() + crypto.randomUUID()),
    redirectUris: [redirect],
  };
}
function credential() {
  return {
    access_token: crypto.randomUUID() + crypto.randomUUID(),
    refresh_token: crypto.randomUUID() + crypto.randomUUID(),
    token_type: "Bearer",
    expires_in: 3600,
    scope: LEDGER_GOOGLE_SCOPE,
  };
}
function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

describe("구글 장부 인가 코드 교환: 고정 주소/최소 범위/토큰 비노출", () => {
  it("Sheets 권한 하나·offline/consent·PKCE를 요청하고 클라이언트 비밀은 주소에 넣지 않는다", () => {
    const config = settings(),
      auth = googleLedgerOAuth(config),
      state = "1".repeat(57),
      challenge = "c".repeat(43);
    const url = new URL(auth.authorizeUrl(redirect, state, challenge));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: config.clientId.reveal(),
      redirect_uri: redirect,
      response_type: "code",
      scope: LEDGER_GOOGLE_SCOPE,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "false",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/spreadsheets");
    expect(url.href).not.toContain(config.clientSecret.reveal());
  });
  it.each([`${redirect}?x=1`, `${redirect}2`, "https://other.example/owner/ledger/callback"])(
    "설정 밖의 돌아올 주소 %s는 외부 호출 전에 거절한다",
    async (altered) => {
      const send = vi.fn(),
        auth = googleLedgerOAuth(settings(), { fetch: send });
      expect(() => auth.authorizeUrl(altered, "s".repeat(32), "c".repeat(43))).toThrow();
      await expect(auth.exchange("fixture/code", altered, "v".repeat(43))).rejects.toThrow();
      expect(send).not.toHaveBeenCalled();
    },
  );
  it("인가 코드/PKCE는 고정 토큰 주소의 본문에만 보내고 비밀 래퍼로 돌려준다", async () => {
    const config = settings(),
      tokens = credential();
    const send = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(url).toBe("https://oauth2.googleapis.com/token");
      expect(init?.method).toBe("POST");
      expect(init?.redirect).toBe("manual");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(new Headers(init?.headers).get("content-type")).toBe("application/x-www-form-urlencoded");
      expect(Object.fromEntries(new URLSearchParams(init?.body as string))).toEqual({
        grant_type: "authorization_code",
        client_id: config.clientId.reveal(),
        client_secret: config.clientSecret.reveal(),
        redirect_uri: redirect,
        code: "fixture/code",
        code_verifier: "v".repeat(43),
      });
      return reply(tokens);
    });
    const result = await googleLedgerOAuth(config, { fetch: send, now: () => now }).exchange(
      "fixture/code",
      redirect,
      "v".repeat(43),
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(result?.accessToken).toBeInstanceOf(Secret);
    expect(result?.refreshToken).toBeInstanceOf(Secret);
    expect(result?.accessToken.reveal()).toBe(tokens.access_token);
    expect(result?.refreshToken.reveal()).toBe(tokens.refresh_token);
    expect(result?.expiresAt.toISOString()).toBe("2026-11-26T11:00:00.000Z");
    expect(JSON.stringify(result)).not.toContain(tokens.access_token);
    expect(JSON.stringify(result)).not.toContain(tokens.refresh_token);
  });
  it.each([400, 401, 403])("권한 거절 HTTP%s는 연결할 자격 증명이 없다", async (status) => {
    const send = vi.fn(async () => reply({ error: "fixture", error_description: crypto.randomUUID() }, status));
    expect(
      await googleLedgerOAuth(settings(), { fetch: send }).exchange("fixture/code", redirect, "v".repeat(43)),
    ).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each([302, 307, 429, 500, 503])(
    "HTTP%s는 값을 다른 주소로 보내거나 오류 본문을 노출하지 않는다",
    async (status) => {
      const secret = crypto.randomUUID(),
        send = vi.fn(
          async () => new Response(secret, { status, headers: { Location: "https://other.example/collect" } }),
        );
      const promise = googleLedgerOAuth(settings(), { fetch: send }).exchange("fixture/code", redirect, "v".repeat(43));
      await expect(promise).rejects.toBeInstanceOf(GoogleLedgerUnavailableError);
      await expect(promise).rejects.not.toThrow(secret);
      expect(send).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    null,
    [],
    {},
    { access_token: 1 },
    { token_type: "Basic" },
    { expires_in: 0 },
    { expires_in: 1.5 },
    { expires_in: 86401 },
    { access_token: "x".repeat(8193) },
    { access_token: "not a token" },
  ])("잘못된 성공 응답 %j는 서비스 오류로 닫는다", async (altered) => {
    const data = altered === null || Array.isArray(altered) ? altered : { ...credential(), ...altered };
    // 빈 객체는 별도의 누락 응답으로 검사한다.
    const raw = altered !== null && !Array.isArray(altered) && Object.keys(altered).length === 0 ? {} : data;
    await expect(
      googleLedgerOAuth(settings(), { fetch: async () => reply(raw) }).exchange(
        "fixture/code",
        redirect,
        "v".repeat(43),
      ),
    ).rejects.toBeInstanceOf(GoogleLedgerUnavailableError);
  });
  it.each([
    { refresh_token: undefined },
    { refresh_token: "" },
    { scope: "https://www.googleapis.com/auth/drive.metadata.readonly" },
  ])("재시작 후 쓸 refresh token/필수 범위가 없으면 연결하지 않는다 %j", async (altered) => {
    const tokens = { ...credential(), ...altered };
    expect(
      await googleLedgerOAuth(settings(), { fetch: async () => reply(tokens) }).exchange(
        "fixture/code",
        redirect,
        "v".repeat(43),
      ),
    ).toBeNull();
  });
  it("잘못된 JSON·큰 본문·읽기 실패는 일정한 오류만 반환한다", async () => {
    for (const response of [
      new Response("{"),
      new Response("x".repeat(65537)),
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error(crypto.randomUUID()));
          },
        }),
      ),
    ]) {
      await expect(
        googleLedgerOAuth(settings(), { fetch: async () => response }).exchange(
          "fixture/code",
          redirect,
          "v".repeat(43),
        ),
      ).rejects.toBeInstanceOf(GoogleLedgerUnavailableError);
    }
  });
  it("통신 실패/시간 초과의 원문 오류는 내보내지 않는다", async () => {
    const leaked = crypto.randomUUID();
    await expect(
      googleLedgerOAuth(settings(), {
        fetch: async () => {
          throw new Error(leaked);
        },
      }).exchange("fixture/code", redirect, "v".repeat(43)),
    ).rejects.toThrow("Google ledger is unavailable");
    const send: typeof fetch = async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error(leaked)), { once: true });
      });
    await expect(
      googleLedgerOAuth(settings(), { fetch: send, timeoutMs: 10 }).exchange("fixture/code", redirect, "v".repeat(43)),
    ).rejects.toBeInstanceOf(GoogleLedgerUnavailableError);
  });
});
