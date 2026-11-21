import { afterAll, describe, expect, it, vi } from "vitest";
import { APP_ROUTES, createApp } from "../src/app";
import { KakaoUnavailableError, kakaoOwnerAuth, type OwnerAuth } from "../src/owner-auth";
import { OWNER_SESSION_SECONDS } from "../src/owner-oauth";
import { renewOwnerSession } from "../src/owner-session";
import { ownerRoute, shopRoute } from "../src/routes";
import { readSettings } from "../src/settings";
import { comparableProblem, expectProblem, expectSchema } from "./support/contract";
import { collectLogs, describeDb, newUuid, testDb, testEnv } from "./support/db";
import { MemoryLimiter } from "./support/rate-limit";
import { createShop } from "./support/shops";

const ORIGIN = "https://siljang.example";
const URI = `${ORIGIN}/owner/login/callback`;
const NOW = new Date("2026-11-21T00:00:00Z");
const CONFIG = {
  KAKAO_REST_API_KEY: "synthetic-client",
  KAKAO_CLIENT_SECRET: "synthetic-secret",
  KAKAO_OWNER_REDIRECT_URIS: `${URI},${URI}2`,
  KAKAO_ALERT_CHANNEL_ID: "_synthetic",
};
const cookieOf = (r: Response, name: string): string => {
  const header = r.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  if (header === undefined) throw new Error("쿠키 없음");
  return header.split(";")[0] as string;
};

describeDb("사장님 세션·가게 범위·로그아웃의 데이터베이스 계약(TASK-020)", () => {
  const db = testDb();
  afterAll(async () => {
    await db.close();
  });

  function harness(accountId = String(8_000_000_000 + Math.floor(Math.random() * 1_000_000_000))) {
    const settings = readSettings(CONFIG).ownerAuth;
    if (settings === null) throw new Error("설정 없음");
    const auth: OwnerAuth = {
      authorizeUrl: kakaoOwnerAuth(settings).authorizeUrl,
      signIn: vi.fn(async () => ({ accountId, friend: true as boolean | null })),
      channelFriend: vi.fn(async () => null as boolean | null),
    };
    const clock = { now: NOW };
    const limiter = new MemoryLimiter(1000);
    const logs = collectLogs();
    const probe = shopRoute("GET", "/owner/test-orders/:orderId", "owner", async (r) => {
      const id = await r.db.owned("orders", r.pathId("orderId"));
      return r.json({ id });
    });
    const app = createApp({
      logSink: logs.sink,
      routes: [
        ...APP_ROUTES,
        probe,
        ownerRoute("POST", "/owner/test-write", async (r) => r.json({ id: r.owner.ownerId })),
      ],
      services: { now: () => clock.now, ownerAuth: auth, limiters: { OWNER_LOGIN_RATE_LIMITER: limiter } },
    });
    const env = testEnv(CONFIG);
    const call = (method: string, path: string, cookie?: string, body?: unknown, origin = ORIGIN) =>
      app.request(
        `${ORIGIN}/api${path}`,
        {
          method,
          headers: {
            origin,
            ...(cookie === undefined ? {} : { cookie }),
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        env,
      );
    async function begin() {
      const response = await call("POST", "/owner/session/authorization", undefined, { redirectUri: URI });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { state: string };
      return { cookie: cookieOf(response, "siljang_login"), state: body.state };
    }
    async function login() {
      const start = await begin();
      return call("POST", "/owner/session", start.cookie, {
        kakaoCode: "synthetic-code",
        state: start.state,
        redirectUri: URI,
      });
    }
    return { auth, clock, logs, app, env, call, begin, login, accountId, limiter };
  }

  it("새 계정은 가게 등록으로, 내 정보는 실제 계정이고 쿠키 원문·토큰을 저장하지 않음", async () => {
    const h = harness();
    const response = await h.login();
    expect(response.status, h.logs.lines.join("\n")).toBe(200);
    const result = (await response.json()) as { owner: { ownerId: string }; shop: null; next: string };
    expectSchema("OwnerSessionResult", result);
    expect(result.next).toBe("register_shop");
    expect(result.shop).toBeNull();
    const sessionCookie = cookieOf(response, "siljang_owner");
    expect(
      response.headers.getSetCookie().some((c) => c.startsWith("siljang_login=;") && c.includes("Max-Age=0")),
    ).toBe(true);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const me = await h.call("GET", "/owner/me", sessionCookie);
    const body = await me.json();
    expectSchema("Me", body);
    expect(body).toEqual({ owner: result.owner, shop: null, banners: [] });
    const { rows } = await db.query<{ token_hash: string; duration: number }>(
      "SELECT token_hash, extract(epoch FROM expires_at-last_seen_at)::integer AS duration FROM owner_sessions WHERE owner_id=$1",
      [result.owner.ownerId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.token_hash).not.toBe(sessionCookie.split("=")[1]);
    expect(rows[0]?.duration).toBe(OWNER_SESSION_SECONDS);
    expect(h.logs.lines.join("\n")).not.toContain(sessionCookie.split("=")[1]);
    await expectProblem(await h.call("GET", "/operator/me", sessionCookie), "unauthenticated");
    await expectProblem(await h.call("GET", "/owner/test-orders/bad", sessionCookie), "shop_not_registered");
  });

  it("가게 있는 사장님의 경로와 보류 응답, 친구 안내를 계약대로 보임", async () => {
    const shop = await createShop(db, "사장님 로그인 시험 가게");
    const { rows } = await db.query<{ kakao_account_id: string }>("SELECT kakao_account_id FROM owners WHERE id=$1", [
      shop.ownerId,
    ]);
    const h = harness(rows[0]?.kakao_account_id);
    const response = await h.login();
    const body = (await response.json()) as { next: string };
    expectSchema("OwnerSessionResult", body);
    expect(body.next).toBe("open_tasks");
    const reviewer = await db.query<{ id: string }>(
      "INSERT INTO operators (email, display_name) VALUES ($1, '시험 운영자') RETURNING id",
      [`${newUuid()}@operator.example`],
    );
    await db.query(
      "UPDATE shops SET license_status='on_hold', license_hold_reason='시험 보류', license_reviewed_by=$2, license_reviewed_at=$3 WHERE id=$1",
      [shop.shopId, reviewer.rows[0]?.id, NOW],
    );
    vi.mocked(h.auth.signIn).mockResolvedValue({ accountId: h.accountId, friend: false });
    const held = await h.login();
    const heldBody = (await held.json()) as { next: string; owner: { alertChannelFriend: boolean } };
    expectSchema("OwnerSessionResult", heldBody);
    expect(heldBody.next).toBe("resubmit_license");
    expect(heldBody.owner.alertChannelFriend).toBe(false);
    const me = await h.call("GET", "/owner/me", cookieOf(held, "siljang_owner"));
    const profile = (await me.json()) as { banners: string[] };
    expectSchema("Me", profile);
    expect(profile.banners).toEqual(["add_alert_channel", "license_on_hold"]);
  });

  it("같은 계정의 동시 로그인에도 사장님 한 명만 생김", async () => {
    const h = harness();
    const responses = await Promise.all([h.login(), h.login(), h.login()]);
    const ids: string[] = [];
    for (const response of responses) {
      expect(response.status).toBe(200);
      const body = (await response.json()) as { owner: { ownerId: string } };
      ids.push(body.owner.ownerId);
    }
    expect(new Set(ids).size).toBe(1);
    const count = await db.query<{ n: number }>("SELECT count(*)::integer n FROM owners WHERE kakao_account_id=$1", [
      h.accountId,
    ]);
    expect(count.rows[0]?.n).toBe(1);
  });

  it("매 인증 요청에서 같은 쿠키와 서버 만료를 30일로 늘리며 기한 경계는 401", async () => {
    const h = harness();
    const response = await h.login();
    const cookie = cookieOf(response, "siljang_owner");
    h.clock.now = new Date(NOW.getTime() + 29 * 86400000);
    const renewed = await h.call("GET", "/owner/me", cookie);
    expect(renewed.status).toBe(200);
    expect(cookieOf(renewed, "siljang_owner")).toBe(cookie);
    expect(renewed.headers.get("set-cookie")).toContain(`Max-Age=${OWNER_SESSION_SECONDS}`);
    const body = (await renewed.json()) as { owner: { ownerId: string } };
    const state = await db.query<{ last_seen_at: Date; expires_at: Date }>(
      "SELECT last_seen_at, expires_at FROM owner_sessions WHERE owner_id=$1",
      [body.owner.ownerId],
    );
    expect(state.rows[0]?.last_seen_at).toEqual(h.clock.now);
    expect(state.rows[0]?.expires_at.getTime()).toBe(h.clock.now.getTime() + OWNER_SESSION_SECONDS * 1000);
    h.clock.now = new Date(h.clock.now.getTime() + OWNER_SESSION_SECONDS * 1000);
    await expectProblem(await h.call("GET", "/owner/me", cookie), "unauthenticated");
    expect(await renewOwnerSession(db, cookie.split("=")[1] as string, h.clock.now)).toBeNull();
  });

  it("동시 연장은 사용 시각을 되돌리지 않고 끝난 쿠키를 되살리지 않음", async () => {
    const h = harness();
    const login = await h.login();
    const cookie = cookieOf(login, "siljang_owner");
    const later = new Date(NOW.getTime() + 86400000);
    const token = cookie.split("=")[1] as string;
    const otherDb = testDb();
    try {
      await Promise.all([renewOwnerSession(db, token, later), renewOwnerSession(otherDb, token, NOW)]);
    } finally {
      await otherDb.close();
    }
    const me = await h.call("GET", "/owner/me", cookie);
    expect(me.status).toBe(200);
    const profile = (await me.json()) as { owner: { ownerId: string } };
    const state = await db.query<{ last_seen_at: Date }>("SELECT last_seen_at FROM owner_sessions WHERE owner_id=$1", [
      profile.owner.ownerId,
    ]);
    expect(state.rows[0]?.last_seen_at).toEqual(later);
    expect((await h.call("DELETE", "/owner/session", cookie)).status).toBe(204);
    expect(await renewOwnerSession(db, token, later)).toBeNull();
    await expectProblem(await h.call("GET", "/owner/me", cookie), "unauthenticated");
    expect((await h.call("DELETE", "/owner/session", cookie)).status).toBe(204);
  });

  it("다른 가게·없음·형식 오류는 같은 404이고 자기 주문만 읽음", async () => {
    const a = await createShop(db, "범위 A");
    const b = await createShop(db, "범위 B");
    const account = await db.query<{ kakao_account_id: string }>("SELECT kakao_account_id FROM owners WHERE id=$1", [
      a.ownerId,
    ]);
    const h = harness(account.rows[0]?.kakao_account_id);
    const cookie = cookieOf(await h.login(), "siljang_owner");
    const own = await h.call("GET", `/owner/test-orders/${a.orderId}`, cookie);
    expect(await own.json()).toEqual({ id: a.orderId });
    const problems: unknown[] = [];
    for (const id of [b.orderId, newUuid(), "malformed"])
      problems.push(
        comparableProblem(await expectProblem(await h.call("GET", `/owner/test-orders/${id}`, cookie), "not_found")),
      );
    expect(problems[0]).toEqual(problems[1]);
    expect(problems[1]).toEqual(problems[2]);
  });

  it.each(["state", "cookie", "uri", "expired", "origin"])(
    "불일치 %s는 카카오 호출·계정·세션을 만들지 않음",
    async (kind) => {
      const h = harness();
      const start = await h.begin();
      if (kind === "expired") h.clock.now = new Date(NOW.getTime() + 600000);
      const response = await h.call(
        "POST",
        "/owner/session",
        kind === "cookie" ? `siljang_login=${"A".repeat(43)}` : start.cookie,
        {
          kakaoCode: "synthetic-code",
          state: kind === "state" ? `${start.state}a` : start.state,
          redirectUri: kind === "uri" ? `${URI}2` : URI,
        },
        kind === "origin" ? "https://other.example" : ORIGIN,
      );
      await expectProblem(response, "kakao_login_failed");
      expect(h.auth.signIn).not.toHaveBeenCalled();
      const count = await db.query<{ n: number }>("SELECT count(*)::integer n FROM owners WHERE kakao_account_id=$1", [
        h.accountId,
      ]);
      expect(count.rows[0]?.n).toBe(0);
    },
  );

  it.each(["rejected", "unavailable", "internal"])("카카오 %s 응답 뒤 기록은 없음", async (kind) => {
    const h = harness();
    if (kind === "rejected") vi.mocked(h.auth.signIn).mockResolvedValue(null);
    else
      vi.mocked(h.auth.signIn).mockRejectedValue(
        kind === "unavailable" ? new KakaoUnavailableError() : new Error("synthetic secret"),
      );
    await expectProblem(
      await h.login(),
      kind === "rejected" ? "kakao_login_failed" : kind === "unavailable" ? "kakao_unavailable" : "internal",
    );
    const count = await db.query<{ n: number }>("SELECT count(*)::integer n FROM owners WHERE kakao_account_id=$1", [
      h.accountId,
    ]);
    expect(count.rows[0]?.n).toBe(0);
    expect(h.logs.lines.join("\n")).not.toContain("synthetic secret");
  });

  it("API-001의 429는 카카오를 부르지 않음", async () => {
    const h = harness();
    const start = await h.begin();
    for (const key of h.limiter.counts.keys()) h.limiter.counts.set(key, 1000);
    await expectProblem(
      await h.call("POST", "/owner/session", start.cookie, {
        kakaoCode: "synthetic-code",
        state: start.state,
        redirectUri: URI,
      }),
      "rate_limited",
    );
    expect(h.auth.signIn).not.toHaveBeenCalled();
  });

  it("채널 조회 실패는 기존 친구 여부를 유지하고 1분마다 한 번만 다시 확인함", async () => {
    const h = harness();
    vi.mocked(h.auth.signIn).mockResolvedValue({ accountId: h.accountId, friend: false });
    const cookie = cookieOf(await h.login(), "siljang_owner");
    h.clock.now = new Date(NOW.getTime() + 60000);
    await Promise.all([h.call("GET", "/owner/me", cookie), h.call("GET", "/owner/me", cookie)]);
    expect(h.auth.channelFriend).toHaveBeenCalledTimes(1);
    vi.mocked(h.auth.channelFriend).mockResolvedValue(true);
    h.clock.now = new Date(NOW.getTime() + 120000);
    const me = await h.call("GET", "/owner/me", cookie);
    const body = (await me.json()) as { banners: string[] };
    expect(body.banners).toEqual([]);
    vi.mocked(h.auth.signIn).mockResolvedValue({ accountId: h.accountId, friend: null });
    const relogin = await h.login();
    const profile = (await relogin.json()) as { owner: { alertChannelFriend: boolean } };
    expect(profile.owner.alertChannelFriend).toBe(true);
  });

  it("CSRF 쓰기·다른 사이트 로그아웃과 중복 쿠키를 막음", async () => {
    const h = harness();
    const cookie = cookieOf(await h.login(), "siljang_owner");
    await expectProblem(
      await h.call("POST", "/owner/test-write", cookie, {}, "https://other.example"),
      "unauthenticated",
    );
    expect((await h.call("DELETE", "/owner/session", cookie, undefined, "https://other.example")).status).toBe(204);
    expect((await h.call("GET", "/owner/me", cookie)).status).toBe(200);
    await expectProblem(await h.call("GET", "/owner/me", `${cookie}; ${cookie}`), "unauthenticated");
  });
});

describe("API-002·003 default 응답", () => {
  it.each([
    ["GET", "/owner/me"],
    ["DELETE", "/owner/session"],
  ])("데이터베이스 오류는 %s %s의 internal", async (method, path) => {
    const app = createApp({
      logSink: () => {},
      connect: () => ({
        query: async () => {
          throw new Error("synthetic private failure");
        },
        transaction: async () => {
          throw new Error("synthetic private failure");
        },
        close: async () => {},
      }),
    });
    await expectProblem(
      await app.request(
        `${ORIGIN}/api${path}`,
        { method, headers: { origin: ORIGIN, cookie: `siljang_owner=${"A".repeat(43)}` } },
        testEnv(),
      ),
      "internal",
    );
  });
});
