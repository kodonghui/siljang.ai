import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { KakaoUnavailableError, kakaoOwnerAuth } from "../src/owner-auth";
import { parseOwnerInput } from "../src/owner-login";
import { LOGIN_COOKIE, loginState, pkceVerifier, readCookie, verifyLoginState } from "../src/owner-oauth";
import { readSettings, Secret, SettingsError } from "../src/settings";
import { expectProblem } from "./support/contract";
import { TEST_HASH_KEY, testEnv } from "./support/db";
import { MemoryLimiter } from "./support/rate-limit";

const NOW = new Date("2026-11-21T00:00:00Z");
const URI = "https://siljang.example/owner/login/callback";
const KEY = new Secret(TEST_HASH_KEY);
const CONFIG = {
  KAKAO_REST_API_KEY: "synthetic-client",
  KAKAO_CLIENT_SECRET: "synthetic-secret",
  KAKAO_OWNER_REDIRECT_URIS: URI,
  KAKAO_ALERT_CHANNEL_ID: "_synthetic",
  KAKAO_ADMIN_KEY: "synthetic-admin",
};
function authSettings() {
  const settings = readSettings({ ...CONFIG, KAKAO_OWNER_LOGIN_SCOPES: "plusfriends" }).ownerAuth;
  if (settings === null) throw new Error("설정 없음");
  return settings;
}

describe("MVP 사장님 로그인 동의 항목(TASK-020, 2026-11-22 결정)", () => {
  it("기본 인가는 plusfriends를 요청하지 않고 채널 조회도 하지 않음", async () => {
    const settings = readSettings(CONFIG).ownerAuth;
    if (settings === null) throw new Error("설정 없음");
    const send = vi.fn(async () => Response.json({ access_token: "synthetic-access", id: 123456789 }));
    const auth = kakaoOwnerAuth(settings, { fetch: send });
    expect(new URL(auth.authorizeUrl(URI, "synthetic-state", "synthetic-challenge")).searchParams.has("scope")).toBe(
      false,
    );
    expect(await auth.signIn("synthetic-code", URI, "synthetic-verifier")).toEqual({
      accountId: "123456789",
      friend: null,
    });
    expect(await auth.channelFriend("123456789")).toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("MVP 로그인은 채널 ID와 Admin 키 없이 설정할 수 있음", () => {
    const settings = readSettings({
      KAKAO_REST_API_KEY: CONFIG.KAKAO_REST_API_KEY,
      KAKAO_CLIENT_SECRET: CONFIG.KAKAO_CLIENT_SECRET,
      KAKAO_OWNER_REDIRECT_URIS: URI,
    }).ownerAuth;
    expect(settings).not.toBeNull();
  });

  it("동의 항목을 명시하면 정확한 scope를 요청하고 채널 친구 조회를 다시 켬", async () => {
    const settings = readSettings({ ...CONFIG, KAKAO_OWNER_LOGIN_SCOPES: "profile_nickname, plusfriends" }).ownerAuth;
    if (settings === null) throw new Error("설정 없음");
    const send = vi.fn(async () =>
      Response.json({ channels: [{ channel_public_id: "_synthetic", relation: "ADDED" }] }),
    );
    const auth = kakaoOwnerAuth(settings, { fetch: send });
    expect(new URL(auth.authorizeUrl(URI, "state", "challenge")).searchParams.get("scope")).toBe(
      "profile_nickname,plusfriends",
    );
    expect(await auth.channelFriend("123456789")).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each(["plus friends", "plusfriends,", "PLUSFRIENDS"])("잘못된 동의 항목은 시작에서 막음: %s", (scopes) => {
    expect(() => readSettings({ ...CONFIG, KAKAO_OWNER_LOGIN_SCOPES: scopes })).toThrow(SettingsError);
  });

  it("plusfriends를 켜면 채널 ID가 필요함", () => {
    expect(() =>
      readSettings({ ...CONFIG, KAKAO_ALERT_CHANNEL_ID: "", KAKAO_OWNER_LOGIN_SCOPES: "plusfriends" }),
    ).toThrow(SettingsError);
  });
});

describe("서명 state와 nonce·PKCE(TASK-020, DEC-10)", () => {
  it("서명은 nonce·만료·URI에 묶고 verifier는 외부에 보이지 않음", async () => {
    const state = await loginState(KEY, URI, NOW);
    expect(await verifyLoginState(KEY, state.state, state.nonce, URI, NOW)).toBe(
      await pkceVerifier(KEY, state.nonce, URI),
    );
    expect(state.state).not.toContain(state.nonce);
    for (const [key, nonce, uri, at] of [
      [new Secret("other-key"), state.nonce, URI, NOW],
      [KEY, null, URI, NOW],
      [KEY, "A".repeat(43), URI, NOW],
      [KEY, state.nonce, `${URI}?other`, NOW],
      [KEY, state.nonce, URI, state.expiresAt],
      [KEY, state.nonce, URI, new Date(NOW.getTime() - 1)],
    ] as const)
      expect(await verifyLoginState(key, state.state, nonce, uri, at)).toBeNull();
    const changed = state.state.replace(/.$/, state.state.endsWith("A") ? "B" : "A");
    expect(await verifyLoginState(KEY, changed, state.nonce, URI, NOW)).toBeNull();
    const next = await loginState(KEY, URI, NOW);
    expect(await verifyLoginState(KEY, state.state, next.nonce, URI, NOW)).toBeNull();
  });

  it.each([
    null,
    "",
    "siljang_login=short",
    `siljang_login=${"A".repeat(43)}; siljang_login=${"A".repeat(43)}`,
    `siljang_owner=${"A".repeat(43)}`,
  ])("불분명한 시작 쿠키는 닫힘: %s", (header) => {
    expect(readCookie(header, LOGIN_COOKIE)).toBeNull();
  });
  it("쿠키는 이름을 정확하게 보고 이웃 쿠키와 섞지 않음", () => {
    expect(readCookie(`x=1; siljang_login=${"A".repeat(43)}; other=2`, LOGIN_COOKIE)).toBe("A".repeat(43));
  });

  it.each([
    [],
    {},
    { redirectUri: "http://example.com" },
    { redirectUri: URI, unknown: 1 },
    { redirectUri: URI, kakaoCode: "x", state: "has space and is invalid" },
    { redirectUri: URI, kakaoCode: "\0", state: "a".repeat(16) },
  ])("계약 밖 본문을 거절함", (body) => {
    expect(() => parseOwnerInput(body, true)).toThrow();
  });
  it("설정은 함께 넣고 비밀 값은 마스킹함", () => {
    expect(readSettings({}).ownerAuth).toBeNull();
    expect(() => readSettings({ KAKAO_REST_API_KEY: "x" })).toThrow(SettingsError);
    expect(() => readSettings({ ...CONFIG, KAKAO_OWNER_REDIRECT_URIS: "https://siljang.example/cb#x" })).toThrow(
      SettingsError,
    );
    expect(JSON.stringify(authSettings())).not.toContain("synthetic-secret");
  });
});

describe("카카오 토큰 교환·사용자·채널 어댑터(외부 호출 없음)", () => {
  function mock(responses: Response[]) {
    const send = vi.fn(async (_url: string, _init: RequestInit): Promise<Response> => {
      const response = responses.shift();
      if (response === undefined) throw new Error("예상하지 않은 호출");
      return response;
    });
    return { send, auth: kakaoOwnerAuth(authSettings(), { fetch: send }) };
  }
  const token = () => Response.json({ access_token: ["synthetic", "access", "token"].join("-") });
  const user = () => Response.json({ id: 123456789 });
  const channel = () => Response.json({ channels: [{ channel_public_id: "_synthetic", relation: "ADDED" }] });

  it("고정 주소만 부르고 verifier와 시크릿을 폼으로 보내며 토큰은 결과에서 버림", async () => {
    const { send, auth } = mock([token(), user(), channel()]);
    expect(await auth.signIn("synthetic-code", URI, "synthetic-verifier")).toEqual({
      accountId: "123456789",
      friend: true,
    });
    expect(send.mock.calls.map(([url]) => url)).toEqual([
      "https://kauth.kakao.com/oauth/token",
      "https://kapi.kakao.com/v2/user/me",
      "https://kapi.kakao.com/v2/api/talk/channels",
    ]);
    const form = new URLSearchParams(String(send.mock.calls[0]?.[1].body));
    expect(form.get("code_verifier")).toBe("synthetic-verifier");
    expect(form.get("client_secret")).toBe("synthetic-secret");
    expect(send.mock.calls.every(([, init]) => init.redirect === "manual" && init.signal !== undefined)).toBe(true);
  });
  it.each(
    [301, 302, 303, 307, 308].flatMap(
      (status) =>
        [
          [status, "token"],
          [status, "profile"],
        ] as const,
    ),
  )("%i %s 응답의 다른 주소로 자격 증명을 전달하지 않음", async (status, phase) => {
    const redirect = new Response(null, { status, headers: { Location: "https://other.example/token" } });
    const { send, auth } = mock(phase === "token" ? [redirect] : [token(), redirect]);
    await expect(auth.signIn("synthetic-code", URI, "synthetic-verifier")).rejects.toBeInstanceOf(
      KakaoUnavailableError,
    );
    expect(send).toHaveBeenCalledTimes(phase === "token" ? 1 : 2);
    expect(send.mock.calls.at(-1)?.[0]).toBe(
      phase === "token" ? "https://kauth.kakao.com/oauth/token" : "https://kapi.kakao.com/v2/user/me",
    );
    expect(send.mock.calls.every(([, init]) => init.redirect === "manual")).toBe(true);
  });
  it.each([400, 401, 403])("인가 코드 거절 %i은 로그인 실패", async (status) => {
    const { auth } = mock([new Response(null, { status })]);
    expect(await auth.signIn("code", URI, "verifier")).toBeNull();
  });
  it.each([429, 500, 503, 302])("서비스 상태 %i은 장애", async (status) => {
    const { auth } = mock([new Response(null, { status })]);
    await expect(auth.signIn("code", URI, "verifier")).rejects.toBeInstanceOf(KakaoUnavailableError);
  });
  it.each([{}, { access_token: "" }, { access_token: 123 }, { access_token: "x".repeat(8193) }])(
    "예상하지 못한 토큰 응답은 닫힘",
    async (body) => {
      const { auth } = mock([Response.json(body)]);
      await expect(auth.signIn("code", URI, "verifier")).rejects.toBeInstanceOf(KakaoUnavailableError);
    },
  );
  it("정밀도를 잃은 사용자 번호로 계정을 만들지 않음", async () => {
    const { auth } = mock([token(), Response.json({ id: Number.MAX_SAFE_INTEGER + 1 })]);
    await expect(auth.signIn("code", URI, "verifier")).rejects.toBeInstanceOf(KakaoUnavailableError);
  });
  it("관계 조회 실패는 로그인에 영향 없이 기존 친구 여부를 유지하게 함", async () => {
    const { auth } = mock([token(), user(), new Response(null, { status: 503 })]);
    expect(await auth.signIn("code", URI, "verifier")).toEqual({ accountId: "123456789", friend: null });
  });
  it("Admin 조회는 사용자 번호와 종류를 보내고 다른 채널의 관계를 섞지 않음", async () => {
    const { auth, send } = mock([channel()]);
    expect(await auth.channelFriend("123456789")).toBe(true);
    const [url, init] = send.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).searchParams.get("target_id")).toBe("123456789");
    expect(new URL(url).searchParams.get("target_id_type")).toBe("user_id");
    expect(init.headers).toEqual({ Authorization: "KakaoAK synthetic-admin" });
  });
});

describe("API-078의 422·429·default와 API-001의 입력 오류", () => {
  const limit = new MemoryLimiter(10);
  const app = createApp({
    logSink: () => {},
    services: { now: () => NOW, limiters: { OWNER_LOGIN_RATE_LIMITER: limit } },
  });
  const env = testEnv(CONFIG);
  function call(path: string, body: unknown, origin = "https://siljang.example", type = "application/json") {
    return app.request(
      `https://siljang.example/api${path}`,
      { method: "POST", headers: { origin, "content-type": type }, body: JSON.stringify(body) },
      env,
    );
  }
  it.each([
    [
      "/owner/session/authorization",
      { redirectUri: "https://other.example/callback" },
      "https://siljang.example",
      "application/json",
    ],
    ["/owner/session/authorization", { redirectUri: URI }, "https://other.example", "application/json"],
    ["/owner/session/authorization", { redirectUri: URI }, "https://siljang.example", "text/plain"],
    ["/owner/session", {}, "https://siljang.example", "application/json"],
  ])("입력 계약 밖의 요청은 422", async (path, body, origin, type) => {
    await expectProblem(await call(path as string, body, origin as string, type as string), "validation_failed");
  });
  it("같은 접속지는 1분 10번, 11번째는 Retry-After", async () => {
    limit.reset();
    for (let i = 0; i < 10; i++)
      expect((await call("/owner/session/authorization", { redirectUri: URI })).status).toBe(200);
    const response = await call("/owner/session/authorization", { redirectUri: URI });
    await expectProblem(response, "rate_limited");
    expect(response.headers.get("retry-after")).toBe("60");
    expect([...limit.counts.keys()][0]).not.toContain("local");
  });
  it("빠진 설정은 default의 internal로 닫힘", async () => {
    await expectProblem(
      await createApp({ logSink: () => {} }).request(
        "https://siljang.example/api/owner/session/authorization",
        {
          method: "POST",
          headers: { origin: "https://siljang.example", "content-type": "application/json" },
          body: JSON.stringify({ redirectUri: URI }),
        },
        testEnv(),
      ),
      "internal",
    );
  });
});
