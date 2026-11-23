import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import {
  completeOwnerLogin,
  fetchOwner,
  OWNER_AUTHORIZATION_API,
  OWNER_CALLBACK,
  OWNER_HOME,
  OWNER_LICENSE,
  OWNER_ME_API,
  OWNER_PATHS,
  OWNER_REGISTER,
  OWNER_SESSION_API,
  ownerCallbackInput,
  ownerDestination,
  ownerLoginFeedback,
  ownerReturnTo,
  signOutOwner,
  startOwnerLogin,
} from "./owner";

const api = parse(readFileSync(new URL("../../../api/openapi.yaml", import.meta.url), "utf8"));
const examples = api.paths[OWNER_SESSION_API].post.responses[200].content["application/json"].examples;
const returning = examples.returning_owner.value;
const redirectUri = `https://siljang.example${OWNER_CALLBACK}`;
const state = "example-signed-state-123";
const input = { kakaoCode: "example-code", state, redirectUri };
function authorization() {
  const url = new URL("https://kauth.kakao.com/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: "example-client",
    redirect_uri: redirectUri,
    response_type: "code",
    state,
    code_challenge: "a".repeat(43),
    code_challenge_method: "S256",
  }).toString();
  return { authorizationUrl: url.href, state, expiresAt: "2026-11-21T16:10:00+09:00" };
}
afterEach(() => vi.unstubAllGlobals());

describe("TASK-030 사장님 로그인 계약과 경로", () => {
  it("API-078·001·002·003의 경로와 입력을 사용한다", () => {
    expect(api.paths[OWNER_AUTHORIZATION_API].post["x-corthex"].id).toBe("API-078");
    expect(api.paths[OWNER_SESSION_API].post["x-corthex"].id).toBe("API-001");
    expect(api.paths[OWNER_SESSION_API].delete["x-corthex"].id).toBe("API-003");
    expect(api.paths[OWNER_ME_API].get["x-corthex"].id).toBe("API-002");
  });
  it("07의 사장님 업무 경로를 빠짐없이 제한 목록으로 사용한다", () => {
    const site = parse(readFileSync(new URL("../../../docs/07-sitemap/sitemap.yaml", import.meta.url), "utf8"));
    const paths: string[] = [];
    function walk(value: unknown) {
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      if (typeof value !== "object" || value === null) return;
      const object = value as Record<string, unknown>;
      for (const path of [object.path, ...(Array.isArray(object.also_paths) ? object.also_paths : [])])
        if (
          typeof path === "string" &&
          path.startsWith("/owner") &&
          !["/owner/login", OWNER_CALLBACK, "/owner/ledger/callback"].includes(path)
        )
          paths.push(path);
      Object.values(object).forEach(walk);
    }
    walk(site);
    expect([...OWNER_PATHS].sort()).toEqual(paths.sort());
  });
  it.each([
    "//example.org/owner",
    "https://example.org/owner",
    "/owner/login",
    "/owner/login/callback",
    "/owner/ledger/callback",
    "/owner/unknown",
    "/owner/../../operator/shops",
    "/owner\\orders",
    "/owner\n",
    `/owner?x=${"a".repeat(2048)}`,
  ])("돌아갈 수 없는 주소 %s", (value) => expect(ownerReturnTo(value)).toBeNull());
  it("07 경로의 쿼리·해시는 그대로 돌아간다", () => {
    const path = "/owner/orders/example-order?tab=history#event";
    expect(ownerReturnTo(path)).toBe(path);
    expect(ownerDestination(returning, path)).toBe(path);
    expect(ownerDestination(returning, "https://example.org")).toBe(OWNER_HOME);
  });
  it.each(["price-list", "operating-rules"])("%s 보조 상세 경로도 로그인 뒤 복구한다", (name) => {
    const path = `/owner/${name}/versions/3`;
    expect(ownerReturnTo(path)).toBe(path);
    expect(ownerDestination(returning, path)).toBe(path);
  });
  it("가게 없음과 신고 보류는 돌아갈 주소보다 우선한다", () => {
    expect(ownerDestination(examples.new_owner.value, "/owner/orders")).toBe(OWNER_REGISTER);
    expect(ownerDestination(examples.license_on_hold.value, "/owner/orders")).toBe(OWNER_LICENSE);
    expect(ownerDestination(returning, OWNER_REGISTER)).toBe(OWNER_HOME);
  });
  it("신고 보류여도 SCR-034 설정으로 돌아가며 다른 업무는 재제출로 보냄", () => {
    expect(ownerDestination(examples.license_on_hold.value, "/owner/shop?tab=settings")).toBe(
      "/owner/shop?tab=settings",
    );
    expect(ownerDestination(examples.license_on_hold.value, "/owner/orders")).toBe(OWNER_LICENSE);
  });
  it.each(["/owner/shop/license?source=hold", "/owner/payment-destination?tab=account"])(
    "신고 보류를 고치는 경로 %s는 막지 않고 돌아감",
    (path) => expect(ownerDestination(examples.license_on_hold.value, path)).toBe(path),
  );
  it.each([
    "",
    "?error=access_denied",
    "?code=example-code",
    `?state=${state}`,
    `?code=one&code=two&state=${state}`,
    "?code=example-code&state=a&state=b",
    `?code=bad%20code&state=${state}`,
  ])("거부·잘못된 콜백은 보내지 않는다 %s", (search) => expect(ownerCallbackInput(search, redirectUri)).toBeNull());
  it("코드와 state를 API-001 입력으로만 전달한다", () =>
    expect(ownerCallbackInput(`?code=example-code&state=${state}`, redirectUri)).toEqual(input));
});

describe("TASK-030 API 응답 검증", () => {
  it("로그인 시작은 S256 카카오 인가 주소를 검증한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(authorization())));
    vi.stubGlobal("fetch", fetchMock);
    expect((await startOwnerLogin(redirectUri, new AbortController().signal)).ok).toBe(true);
    expect(fetchMock.mock.calls[0]).toMatchObject([
      "/api/owner/session/authorization",
      { method: "POST", credentials: "same-origin", cache: "no-store", body: JSON.stringify({ redirectUri }) },
    ]);
  });
  it.each([
    "https://example.org/oauth/authorize",
    "https://kauth.kakao.com.example.org/oauth/authorize",
    "http://kauth.kakao.com/oauth/authorize",
    "https://kauth.kakao.com/other",
    "https://user@kauth.kakao.com/oauth/authorize",
  ])("인가 출처·경로를 바꾸면 이동하지 않는다 %s", async (target) => {
    const valid = authorization(),
      url = new URL(target);
    url.search = new URL(valid.authorizationUrl).search;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...valid, authorizationUrl: url.href }))),
    );
    expect((await startOwnerLogin(redirectUri, new AbortController().signal)).ok).toBe(false);
  });
  it.each(["state", "redirect_uri", "code_challenge_method", "code_challenge"])(
    "인가 주소의 %s가 다르면 이동하지 않는다",
    async (key) => {
      const valid = authorization(),
        url = new URL(valid.authorizationUrl);
      url.searchParams.set(key, "wrong");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...valid, authorizationUrl: url.href }))),
      );
      expect((await startOwnerLogin(redirectUri, new AbortController().signal)).ok).toBe(false);
    },
  );
  it.each(Object.keys(examples))("API-001의 %s 계약 예시를 수용한다", async (name) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(examples[name].value))));
    const result = await completeOwnerLogin(input);
    expect(result.ok && result.data).toEqual(examples[name].value);
  });
  it("같은 진행 중 콜백은 한 번만 교환하고 다음 요청은 새로 시작한다", async () => {
    let resolve!: (response: Response) => void;
    const response = new Promise<Response>((done) => {
      resolve = done;
    });
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(response)
      .mockResolvedValueOnce(new Response(JSON.stringify(returning)));
    vi.stubGlobal("fetch", fetchMock);
    const first = completeOwnerLogin(input),
      second = completeOwnerLogin(input);
    expect(first).toBe(second);
    resolve(new Response(JSON.stringify(returning)));
    expect((await first).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await completeOwnerLogin(input);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each([
    null,
    {},
    { ...returning, next: "register_shop" },
    { ...returning, shop: { ...returning.shop, licenseStatus: "invalid" } },
  ])("잘못된 세션 200은 업무 화면을 열지 않는다", async (data) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(data))));
    expect((await completeOwnerLogin(input)).ok).toBe(false);
  });
  it("내 정보와 로그아웃도 같은 출처에서 캐시 없이 요청한다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(returning)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    expect((await fetchOwner(signal)).ok).toBe(true);
    expect((await signOutOwner(signal)).ok).toBe(true);
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method, init.credentials, init.cache])).toEqual([
      ["/api/owner/me", "GET", "same-origin", "no-store"],
      ["/api/owner/session", "DELETE", "same-origin", "no-store"],
    ]);
  });
  it.each([401, 422])("%s는 카카오 로그인 다시 하기 문구", (status) =>
    expect(ownerLoginFeedback({ ok: false, status, problem: null, retryAfterSeconds: null }).message).toBe(
      "카카오 로그인을 다시 해 주세요",
    ),
  );
  it("429는 Retry-After를 기다리고 누락이면 60초", () => {
    expect(ownerLoginFeedback({ ok: false, status: 429, problem: null, retryAfterSeconds: 37 })).toMatchObject({
      message: "잠시 뒤 다시 시도해 주세요",
      retryAfterSeconds: 37,
    });
    expect(
      ownerLoginFeedback({ ok: false, status: 429, problem: null, retryAfterSeconds: null }).retryAfterSeconds,
    ).toBe(60);
  });
});
