import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { expectProblem, expectSchema } from "./support/contract";
import { testEnv } from "./support/db";

const ORIGIN = "https://siljang.example";
const REDIRECT = `${ORIGIN}/owner/login/callback`;
const NOW = new Date("2026-11-21T00:00:00Z");
const env = {
  ...testEnv({
    KAKAO_REST_API_KEY: "synthetic-client",
    KAKAO_CLIENT_SECRET: "synthetic-secret",
    KAKAO_OWNER_REDIRECT_URIS: REDIRECT,
    KAKAO_ALERT_CHANNEL_ID: "_synthetic",
  }),
  OWNER_LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
};

function app() {
  return createApp({ services: { now: () => NOW }, logSink: () => {} });
}

describe("사장님 로그인 계약(TASK-020, API-078·001·002·003)", () => {
  it("로그인 시작은 서버 state와 S256 인가 주소, 10분 시작 쿠키를 줌", async () => {
    const response = await app().request(
      `${ORIGIN}/api/owner/session/authorization`,
      {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ redirectUri: REDIRECT }),
      },
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { authorizationUrl: string; state: string };
    expectSchema("OwnerLoginStart", body);
    const url = new URL(body.authorizationUrl);
    expect(url.origin).toBe("https://kauth.kakao.com");
    expect(url.searchParams.get("state")).toBe(body.state);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.has("scope")).toBe(false);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("siljang_login=");
    for (const attr of ["HttpOnly", "Secure", "SameSite=Lax", "Max-Age=600"]) expect(cookie).toContain(attr);
    expect(JSON.stringify(body)).not.toContain(cookie.split(";")[0]?.split("=")[1]);
  });

  it("다른 브라우저에서 받은 state는 카카오에 묻기 전에 거절함", async () => {
    const response = await app().request(
      `${ORIGIN}/api/owner/session`,
      {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({
          kakaoCode: "synthetic-code",
          redirectUri: REDIRECT,
          state: "invalid_state_from_other_browser",
        }),
      },
      env,
    );
    await expectProblem(response, "kakao_login_failed");
  });

  it("세션이 없으면 내 정보는 401, 로그아웃은 항상 204", async () => {
    const api = app();
    await expectProblem(await api.request(`${ORIGIN}/api/owner/me`, {}, env), "unauthenticated");
    const response = await api.request(
      `${ORIGIN}/api/owner/session`,
      { method: "DELETE", headers: { origin: ORIGIN } },
      env,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
