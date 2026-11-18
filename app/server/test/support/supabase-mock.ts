/**
 * 시험용 Supabase Auth(TASK-021). 진짜 프로젝트에 요청을 보내지 않고, operator-auth.ts가 부르는 일곱 곳만 메모리로 흉내 낸다:
 * 비밀번호 로그인(POST /token?grant_type=password), 사용자(GET /user), TOTP 등록(POST /factors), 지우기(DELETE /factors/:id),
 * challenge·verify(POST /factors/:id/challenge·verify), 로그아웃(POST /logout?scope=local).
 * - 길·본문은 Supabase Auth의 OpenAPI(github.com/supabase/auth openapi.yaml, 2026-11-18 확인)를 따른다.
 * - 토큰은 서명 없는 JWT 꼴(본문에 sub·aal·session_id). 받은 토큰은 이 모의 서버가 기억하는 것만 맞다.
 * - TOTP 번호: 인자마다 정한 번호 하나(code)만 맞다. 진짜 시각 계산은 하지 않는다.
 * - down으로 '답하지 않음'을 흉내 낸다(던짐·5xx·429·끝나지 않음·넘겨주기·꼴이 틀린 답). downAt으로 어느 길부터인지 고른다.
 * - 부른 기록(calls)에는 방법·길·apikey가 맞았는지만 남긴다(본문·토큰은 남기지 않음).
 */

export interface MockFactor {
  id: string;
  type: "totp";
  status: "verified" | "unverified";
  friendlyName: string;
  secret: string;
  code: string;
}

export interface MockUser {
  readonly id: string;
  readonly email: string;
  password: string;
  factors: MockFactor[];
}

export type DownMode = "throw" | "500" | "429" | "hang" | "redirect" | "shape";

export interface MockCall {
  readonly method: string;
  readonly path: string;
  readonly apikeyOk: boolean;
}

interface TokenInfo {
  readonly userId: string;
  readonly sessionId: string;
  readonly aal: "aal1" | "aal2";
}

function b64url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

/** 시험마다 새로 만든다. */
export class SupabaseMock {
  readonly users = new Map<string, MockUser>();
  readonly calls: MockCall[] = [];
  /** 끝낸 세션 ID(로그아웃). */
  readonly endedSessions: string[] = [];
  /** 답하지 않게 할 방식. null이면 정상. */
  down: DownMode | null = null;
  /** down을 적용할 길의 앞부분(예 "/factors"). null이면 모든 길. */
  downAt: string | null = null;
  /** verify가 aal2가 아닌 토큰을 주게 함(이상한 답을 닫는지 보는 시험). */
  verifyGivesAal1 = false;
  /** 비밀번호 로그인 답에 factors 목록을 빼게 함(getUser로 다시 읽는지 보는 시험). */
  omitFactorsOnSignIn = false;
  readonly #tokens = new Map<string, TokenInfo>();
  readonly #challenges = new Map<string, string>();
  readonly #apiKey: string;
  #seq = 0;

  constructor(apiKey: string) {
    this.#apiKey = apiKey;
  }

  /** 사용자 하나(확인된 TOTP 인자 하나와 그 번호). 인자를 원하지 않으면 code를 null로. */
  addUser(email: string, password: string, code: string | null = "135790"): MockUser {
    const user: MockUser = { id: crypto.randomUUID(), email: email.toLowerCase(), password, factors: [] };
    if (code !== null) {
      user.factors.push({
        id: crypto.randomUUID(),
        type: "totp",
        status: "verified",
        friendlyName: "phone",
        secret: "JBSWY3DPEHPK3PXP",
        code,
      });
    }
    this.users.set(user.email, user);
    return user;
  }

  /** 지금 살아 있는 토큰 수(로그아웃하지 않은 Supabase 세션). */
  liveTokens(): number {
    return this.#tokens.size;
  }

  #token(userId: string, aal: "aal1" | "aal2", sessionId: string = crypto.randomUUID()): string {
    this.#seq += 1;
    const head = b64url(JSON.stringify({ alg: "none", typ: "JWT" }));
    const body = b64url(JSON.stringify({ sub: userId, aal, session_id: sessionId, n: this.#seq }));
    const token = `${head}.${body}.mock`;
    this.#tokens.set(token, { userId, sessionId, aal });
    return token;
  }

  #userJson(user: MockUser, withFactors = true): Record<string, unknown> {
    return {
      id: user.id,
      aud: "authenticated",
      role: "authenticated",
      email: user.email,
      ...(withFactors
        ? {
            factors: user.factors.map((f) => ({
              id: f.id,
              friendly_name: f.friendlyName,
              factor_type: f.type,
              status: f.status,
            })),
          }
        : {}),
    };
  }

  #byToken(auth: string | null): { user: MockUser; info: TokenInfo; token: string } | null {
    if (auth === null || !auth.startsWith("Bearer ")) return null;
    const token = auth.slice("Bearer ".length);
    const info = this.#tokens.get(token);
    if (info === undefined) return null;
    const user = [...this.users.values()].find((u) => u.id === info.userId);
    return user === undefined ? null : { user, info, token };
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const path = url.pathname.replace(/^\/auth\/v1/, "");
    this.calls.push({ method, path, apikeyOk: headers.get("apikey") === this.#apiKey });

    if (this.down !== null && (this.downAt === null || path.startsWith(this.downAt))) {
      switch (this.down) {
        case "throw":
          throw new TypeError("fetch failed");
        case "500":
          return new Response("{}", { status: 502 });
        case "429":
          return new Response("{}", { status: 429 });
        case "redirect":
          return new Response(null, { status: 302, headers: { location: "https://elsewhere.example/" } });
        case "shape":
          return Response.json({ unexpected: true });
        case "hang":
          return new Promise<Response>((_, reject) => {
            const signal = init?.signal;
            signal?.addEventListener("abort", () => reject(signal.reason));
          });
      }
    }
    if (headers.get("apikey") !== this.#apiKey) return Response.json({ message: "Invalid API key" }, { status: 401 });
    const body =
      init?.body === undefined || init.body === null ? {} : (JSON.parse(String(init.body)) as Record<string, unknown>);
    const authz = headers.get("authorization");

    if (method === "POST" && path === "/token" && url.searchParams.get("grant_type") === "password") {
      const user = this.users.get(String(body.email ?? "").toLowerCase());
      if (user === undefined || user.password !== body.password) {
        return Response.json(
          { error: "invalid_grant", error_description: "Invalid login credentials" },
          { status: 400 },
        );
      }
      const access = this.#token(user.id, "aal1");
      return Response.json({
        access_token: access,
        token_type: "bearer",
        expires_in: 3600,
        refresh_token: "mock-refresh",
        user: this.#userJson(user, !this.omitFactorsOnSignIn),
      });
    }

    const who = this.#byToken(authz);
    if (who === null) return Response.json({ message: "invalid JWT" }, { status: 401 });

    if (method === "GET" && path === "/user") return Response.json(this.#userJson(who.user));

    if (method === "POST" && path === "/logout") {
      for (const [t, info] of this.#tokens) if (info.sessionId === who.info.sessionId) this.#tokens.delete(t);
      this.endedSessions.push(who.info.sessionId);
      return new Response(null, { status: 204 });
    }

    if (method === "POST" && path === "/factors") {
      if (body.factor_type !== "totp") return Response.json({ message: "bad factor" }, { status: 422 });
      const name = String(body.friendly_name ?? "");
      if (who.user.factors.some((f) => f.friendlyName === name)) {
        return Response.json({ error_code: "mfa_factor_name_conflict" }, { status: 422 });
      }
      const factor: MockFactor = {
        id: crypto.randomUUID(),
        type: "totp",
        status: "unverified",
        friendlyName: name,
        secret: "KRSXG5CTMVRXEZLU",
        code: "975310",
      };
      who.user.factors.push(factor);
      return Response.json({
        id: factor.id,
        type: "totp",
        friendly_name: name,
        totp: {
          qr_code: "data:image/svg+xml;utf-8,<svg/>",
          secret: factor.secret,
          uri: `otpauth://totp/mock:${encodeURIComponent(who.user.email)}?secret=${factor.secret}&issuer=mock`,
        },
      });
    }

    const factorPath = /^\/factors\/([0-9a-f-]{36})(\/challenge|\/verify)?$/.exec(path);
    if (factorPath !== null) {
      const factor = who.user.factors.find((f) => f.id === factorPath[1]);
      if (factor === undefined) return Response.json({ error_code: "mfa_factor_not_found" }, { status: 404 });
      const action = factorPath[2];
      if (method === "DELETE" && action === undefined) {
        if (factor.status === "verified" && who.info.aal !== "aal2") {
          return Response.json({ error_code: "insufficient_aal" }, { status: 403 });
        }
        who.user.factors = who.user.factors.filter((f) => f.id !== factor.id);
        return Response.json({ id: factor.id });
      }
      if (method === "POST" && action === "/challenge") {
        const id = crypto.randomUUID();
        this.#challenges.set(id, factor.id);
        return Response.json({ id, type: "totp", expires_at: Math.floor(Date.now() / 1000) + 300 });
      }
      if (method === "POST" && action === "/verify") {
        const challengeId = String(body.challenge_id ?? "");
        if (this.#challenges.get(challengeId) !== factor.id) {
          return Response.json({ error_code: "mfa_challenge_expired" }, { status: 422 });
        }
        this.#challenges.delete(challengeId);
        if (body.code !== factor.code) {
          return Response.json({ error_code: "mfa_verification_failed" }, { status: 422 });
        }
        factor.status = "verified";
        const access = this.#token(who.user.id, this.verifyGivesAal1 ? "aal1" : "aal2", who.info.sessionId);
        return Response.json({
          access_token: access,
          token_type: "bearer",
          expires_in: 3600,
          refresh_token: "mock-refresh",
          user: this.#userJson(who.user),
        });
      }
    }
    return Response.json({ message: "not found" }, { status: 404 });
  };
}

/** 시험용 publishable 키(저장소 글에 키 꼴이 남지 않게 실행 중에 만든다). */
export function testPublishableKey(): string {
  return ["sb", "publishable", "testonly", "x".repeat(16)].join("_");
}
