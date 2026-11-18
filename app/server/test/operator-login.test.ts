import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { APP_ROUTES, createApp } from "../src/app";
import { AuthUnavailableError, supabaseAuth, tokenAal } from "../src/operator-auth";
import { FAILURE_FLOOR_MS, parseLoginInput } from "../src/operator-login";
import { createOperatorScope } from "../src/operator-scope";
import {
  clearedCookie,
  createSession,
  emailHash,
  LOGIN_FAILURE_WINDOW_SECONDS,
  OPERATOR_SESSION_SECONDS,
  readSessionCookie,
  sessionCookie,
  tokenHash,
} from "../src/operator-session";
import { createOwnerScope } from "../src/owner-scope";
import { ApiError } from "../src/problem";
import { type OperatorResolver, type OwnerResolver, operatorRoute, ownerRoute, type RouteDecl } from "../src/routes";
import { readSettings, Secret, SettingsError } from "../src/settings";
import { comparableProblem, expectProblem, expectSchema } from "./support/contract";
import { collectLogs, describeDb, newUuid, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { SupabaseMock, testPublishableKey } from "./support/supabase-mock";

// 운영자 로그인(TASK-021; 06 API-004·005·006, 04 SPEC-001, 06 DEC-11·16·26·27). 인증 서비스는 모의 Supabase(진짜 호출 0번).

const KEY = testPublishableKey();
const ORIGIN = "http://localhost";
const AUTH_URL = "https://project.supabase.example";
const T0 = new Date("2026-11-18T00:00:00.000Z");

interface CallOptions {
  readonly body?: unknown;
  readonly cookie?: string;
  readonly origin?: string | null;
  readonly contentType?: string;
}

interface HarnessOptions {
  readonly ownerAccount?: OwnerResolver;
  readonly operatorAccount?: OperatorResolver;
  readonly routes?: readonly RouteDecl[];
  readonly env?: Record<string, string>;
  /** 모의 인증 서비스를 넣지 않음(설정에서 읽음). */
  readonly noAuth?: boolean;
}

function harness(options: HarnessOptions = {}) {
  const mock = new SupabaseMock(KEY);
  const auth = supabaseAuth({ url: AUTH_URL, publishableKey: new Secret(KEY) }, { fetch: mock.fetch, timeoutMs: 50 });
  const clock = { now: T0 };
  const waits: number[] = [];
  const logs = collectLogs();
  const app = createApp({
    logSink: logs.sink,
    ...(options.ownerAccount !== undefined ? { ownerAccount: options.ownerAccount } : {}),
    ...(options.operatorAccount !== undefined ? { operatorAccount: options.operatorAccount } : {}),
    ...(options.routes !== undefined ? { routes: options.routes } : {}),
    services: {
      now: () => clock.now,
      ...(options.noAuth === true ? {} : { operatorAuth: auth }),
      wait: async (ms) => {
        waits.push(ms);
      },
    },
  });
  const env = testEnv(options.env);
  const call = async (method: string, path: string, o: CallOptions = {}): Promise<Response> => {
    const headers: Record<string, string> = {};
    const origin = o.origin === undefined ? ORIGIN : o.origin;
    if (origin !== null) headers.origin = origin;
    if (o.cookie !== undefined) headers.cookie = o.cookie;
    if (o.body !== undefined) headers["content-type"] = o.contentType ?? "application/json";
    const init: RequestInit = { method, headers };
    if (o.body !== undefined) init.body = typeof o.body === "string" ? o.body : JSON.stringify(o.body);
    return app.request(`/api${path}`, init, env);
  };
  const login = (body: unknown, o: Omit<CallOptions, "body"> = {}) => call("POST", "/operator/session", { ...o, body });
  const me = (cookie?: string) => call("GET", "/operator/me", cookie === undefined ? {} : { cookie });
  const logout = (o: Omit<CallOptions, "body"> = {}) => call("DELETE", "/operator/session", o);
  return { mock, auth, clock, waits, logs, app, env, call, login, me, logout };
}

type Harness = ReturnType<typeof harness>;

/** 세션 쿠키 값(Set-Cookie에서). */
function cookieOf(res: Response): string {
  const set = res.headers.get("set-cookie") ?? "";
  const m = /^siljang_operator=([^;]*);/.exec(set);
  if (m === null) throw new Error("no operator cookie");
  return `siljang_operator=${m[1]}`;
}

describe("세션 쿠키와 입력 검사(데이터베이스 없이)", () => {
  it("쿠키 속성: HttpOnly·Secure·SameSite=Lax·Path=/·Max-Age 43200, 로그아웃은 Max-Age=0(06 DEC-10·DEC-26)", () => {
    expect(OPERATOR_SESSION_SECONDS).toBe(12 * 60 * 60);
    expect(sessionCookie("A".repeat(43))).toBe(
      `siljang_operator=${"A".repeat(43)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`,
    );
    expect(clearedCookie()).toBe("siljang_operator=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  });

  it("Cookie 헤더에서 운영자 쿠키 하나만 읽음(없음·꼴이 틀림·둘 이상은 null)", () => {
    const v = "abcDEF0123456789_-abcDEF0123456789_-abcdefg";
    expect(v.length).toBe(43);
    expect(readSessionCookie(`a=1; siljang_operator=${v}; b=2`)).toBe(v);
    expect(readSessionCookie(undefined)).toBeNull();
    expect(readSessionCookie("siljang_owner=x")).toBeNull();
    expect(readSessionCookie("siljang_operator=short")).toBeNull();
    expect(readSessionCookie(`siljang_operator=${v}; siljang_operator=${v}`)).toBeNull();
  });

  it("06 OperatorSessionInput: 필드마다 사유 코드, 넣은 값은 싣지 않음", () => {
    const codes = (body: unknown) => {
      try {
        parseLoginInput(body);
        return [];
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        return (e as ApiError).extras.errors ?? [];
      }
    };
    const ok = { email: "op@ops.example", password: "x", otp: "123456" };
    expect(codes(ok)).toEqual([]);
    expect(codes([])).toEqual([{ field: "/", code: "bad_format" }]);
    expect(codes({})).toEqual([
      { field: "/email", code: "required" },
      { field: "/password", code: "required" },
      { field: "/otp", code: "required" },
    ]);
    expect(codes({ ...ok, otp: "12345a" })).toEqual([{ field: "/otp", code: "bad_format" }]);
    expect(codes({ ...ok, otp: 123456 })).toEqual([{ field: "/otp", code: "bad_format" }]);
    expect(codes({ ...ok, email: "no-at" })).toEqual([{ field: "/email", code: "bad_format" }]);
    expect(codes({ ...ok, email: "a@" })).toEqual([{ field: "/email", code: "too_short" }]);
    expect(codes({ ...ok, password: "" })).toEqual([{ field: "/password", code: "too_short" }]);
    expect(codes({ ...ok, password: "x".repeat(257) })).toEqual([{ field: "/password", code: "too_long" }]);
    expect(codes({ ...ok, password: "a\u0000b" })).toEqual([{ field: "/password", code: "bad_format" }]);
    expect(codes({ ...ok, extra: 1, "bad name!": 2 })).toEqual([
      { field: "/extra", code: "unknown_field" },
      { field: "/", code: "unknown_field" },
    ]);
  });
});

describe("Supabase Auth 어댑터(모의 서버)", () => {
  it("publishable 키를 apikey 헤더로 보내고, 맞지 않음(4xx)은 null", async () => {
    const h = harness();
    h.mock.addUser("a@ops.example", "pw-1");
    expect(await h.auth.signInWithPassword("a@ops.example", "wrong")).toBeNull();
    const s = await h.auth.signInWithPassword("A@ops.example", "pw-1");
    expect(s?.user.email).toBe("a@ops.example");
    expect(tokenAal(s?.accessToken ?? "")).toBe("aal1");
    expect(h.mock.calls.every((c) => c.apikeyOk)).toBe(true);
  });

  it("답하지 않음(던짐·5xx·429·넘겨주기·시간 초과·꼴이 틀림)은 AuthUnavailableError이고 키·본문을 싣지 않음", async () => {
    const reasons: string[] = [];
    for (const mode of ["throw", "500", "429", "redirect", "hang", "shape"] as const) {
      const h = harness();
      h.mock.addUser("a@ops.example", "pw-1");
      h.mock.down = mode;
      const err = await h.auth.signInWithPassword("a@ops.example", "pw-1").catch((e: unknown) => e);
      expect(err, mode).toBeInstanceOf(AuthUnavailableError);
      const e = err as AuthUnavailableError;
      reasons.push(`${e.reason}${e.status === null ? "" : `:${e.status}`}`);
      expect(e.message).not.toContain(KEY);
      expect(e.message).not.toContain("pw-1");
    }
    expect(reasons).toEqual(["network", "status:502", "status:429", "status:302", "timeout", "shape"]);
  });

  it("verify가 aal2가 아닌 토큰을 주면 받지 않음(null)", async () => {
    const h = harness();
    const user = h.mock.addUser("a@ops.example", "pw-1", "246802");
    h.mock.verifyGivesAal1 = true;
    const s = await h.auth.signInWithPassword("a@ops.example", "pw-1");
    expect(await h.auth.verifyTotp(s?.accessToken ?? "", user.factors[0]?.id ?? "", "246802")).toBeNull();
  });
});

describe("설정(SUPABASE_URL·SUPABASE_PUBLISHABLE_KEY)", () => {
  const base = { APP_ENV: "production" };
  it("둘 다 없으면 null, 하나만 있으면 멈춤", () => {
    expect(readSettings(base).operatorAuth).toBeNull();
    expect(() => readSettings({ ...base, SUPABASE_URL: AUTH_URL })).toThrow(SettingsError);
    expect(() => readSettings({ ...base, SUPABASE_PUBLISHABLE_KEY: KEY })).toThrow(SettingsError);
  });

  it("https 프로젝트 주소와 publishable 키만 받음(secret 키·경로·http는 막음), 값은 메시지에 없음", () => {
    const s = readSettings({ ...base, SUPABASE_URL: `${AUTH_URL}/`, SUPABASE_PUBLISHABLE_KEY: KEY });
    expect(s.operatorAuth?.url).toBe(AUTH_URL);
    expect(String(s.operatorAuth?.publishableKey)).not.toContain(KEY);
    const secretKey = ["sb", "secret", "testonly", "y".repeat(16)].join("_");
    const bad: Record<string, string>[] = [
      { SUPABASE_URL: AUTH_URL, SUPABASE_PUBLISHABLE_KEY: secretKey },
      { SUPABASE_URL: AUTH_URL, SUPABASE_PUBLISHABLE_KEY: "anon-key-old-format" },
      { SUPABASE_URL: "http://project.supabase.example", SUPABASE_PUBLISHABLE_KEY: KEY },
      { SUPABASE_URL: `${AUTH_URL}/auth/v1`, SUPABASE_PUBLISHABLE_KEY: KEY },
      { SUPABASE_URL: "http://localhost:54321", SUPABASE_PUBLISHABLE_KEY: KEY },
    ];
    for (const env of bad) {
      let message = "";
      try {
        readSettings({ ...base, ...env });
      } catch (e) {
        expect(e).toBeInstanceOf(SettingsError);
        message = (e as Error).message;
      }
      expect(message, JSON.stringify(Object.keys(env))).not.toBe("");
      expect(message).not.toContain(secretKey);
      expect(message).not.toContain(KEY);
    }
    // 로컬 Supabase(개발)만 http를 받음.
    const local = readSettings({
      APP_ENV: "development",
      SUPABASE_URL: "http://localhost:54321",
      SUPABASE_PUBLISHABLE_KEY: KEY,
    });
    expect(local.operatorAuth?.url).toBe("http://localhost:54321");
  });
});

// 06 계약에서 운영자 세션을 받는 API가 어느 경로 종류여야 하는지.
type Operation = { security?: Record<string, unknown>[]; "x-corthex"?: { id?: string } };
const contract = parse(readFileSync(new URL("../../../api/openapi.yaml", import.meta.url), "utf8")) as {
  paths: Record<string, Record<string, Operation>>;
};
const operations = Object.entries(contract.paths).flatMap(([path, ops]) =>
  Object.entries(ops)
    .filter(([m]) => ["get", "post", "put", "patch", "delete"].includes(m))
    .map(([m, op]) => ({ method: m.toUpperCase(), path: path.replace(/\{([A-Za-z]+)\}/g, ":$1"), op })),
);

describe("06 계약과 운영자 범위 경로(TASK-021)", () => {
  it("운영자 세션만 받는 API(가게 ID 없음)는 operatorRoute, 세션이 없어도 되는 것과 누구나는 openRoute로 선언됨", () => {
    const declared: string[] = [];
    for (const decl of APP_ROUTES) {
      const hit = operations.find((o) => o.method === decl.method && o.path === decl.path);
      if (hit === undefined) continue;
      const security = hit.op.security ?? [];
      const schemes = security.flatMap((s) => Object.keys(s));
      const optional = security.some((s) => Object.keys(s).length === 0);
      const where = `${decl.method} ${decl.path}`;
      if (schemes.includes("operatorSession") && !decl.path.includes(":shopId")) {
        expect(decl.kind, where).toBe(optional ? "open" : "operator");
        declared.push(hit.op["x-corthex"]?.id ?? "");
      }
      if (decl.kind === "operator") expect(schemes, where).toEqual(["operatorSession"]);
      if (hit.op["x-corthex"]?.id === "API-004") {
        expect(security).toEqual([]);
        expect(decl.kind).toBe("open");
        declared.push("API-004");
      }
    }
    expect(declared.sort()).toEqual(["API-004", "API-005", "API-006"]);
    // 운영자 범위 경로는 모두 06에 있음(계약 밖 운영자 경로 없음).
    for (const decl of APP_ROUTES.filter((r) => r.kind === "operator")) {
      expect(operations.some((o) => o.method === decl.method && o.path === decl.path)).toBe(true);
    }
  });

  it("06 API-004는 503 auth_unavailable을 가짐(DEC-27, OPEN-6을 닫음)", () => {
    const op = contract.paths["/operator/session"]?.post as unknown as { responses: Record<string, unknown> };
    expect(Object.keys(op.responses).sort()).toEqual(["200", "401", "422", "429", "503", "default"]);
  });
});

const db = testDb();
afterAll(async () => {
  await db.close();
});

interface Account {
  readonly email: string;
  readonly password: string;
  readonly otp: string;
  readonly id: string | null;
  /** 모의 Supabase 사용자 ID(운영자 행의 auth_user_id). */
  readonly userId: string;
  /** 등록 도구가 묶은 인증 수단 ID(운영자 행의 mfa_factor_id). Supabase에 TOTP가 없으면 아무 데도 없는 ID. */
  readonly factorId: string;
}

/** 모의 Supabase 사용자와 운영자 행 하나(등록 도구가 쓰는 것처럼 Supabase 사용자 ID와 인증 수단 ID를 묶음). */
async function addOperator(
  h: Harness,
  o: { mfa?: boolean; disabled?: boolean; code?: string | null; inTable?: boolean; name?: string } = {},
): Promise<Account> {
  const email = `op-${newUuid()}@ops.example`;
  const password = `pw-${newUuid()}`;
  const code = o.code === undefined ? "135790" : o.code;
  const user = h.mock.addUser(email, password, code);
  const factorId = user.factors[0]?.id ?? newUuid();
  let id: string | null = null;
  if (o.inTable !== false) {
    const mfa = o.mfa !== false;
    const r = await db.query<{ id: string }>(
      `INSERT INTO operators (email, display_name, auth_user_id, mfa_factor_id, mfa_enrolled_at, disabled_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        email,
        o.name ?? "운영자 시험",
        user.id,
        mfa ? factorId : null,
        mfa ? new Date("2026-11-01T00:00:00Z") : null,
        o.disabled ? T0 : null,
      ],
    );
    id = (r.rows[0] as { id: string }).id;
  }
  return { email, password, otp: code ?? "135790", id, userId: user.id, factorId };
}

/** 그 운영자의 끝나지 않은 세션 수. */
async function openSessions(operatorId: string | null): Promise<number> {
  const r = await db.query<{ n: string }>(
    "SELECT count(*) AS n FROM operator_sessions WHERE operator_id = $1 AND ended_at IS NULL",
    [operatorId],
  );
  return Number((r.rows[0] as { n: string }).n);
}

const creds = (a: Account) => ({ email: a.email, password: a.password, otp: a.otp });

async function failureRows(email: string): Promise<number> {
  const hash = await emailHash(new Secret(TEST_HASH_KEY), email);
  const r = await db.query<{ n: string }>("SELECT count(*) AS n FROM operator_login_failures WHERE email_hash = $1", [
    hash,
  ]);
  return Number((r.rows[0] as { n: string }).n);
}

describeDb("운영자 로그인 API-004·005·006(06 계약 시험)", () => {
  it("API-004 200: 06 Operator 본문과 세션 쿠키, API-005 200, API-006 204와 지운 쿠키", async () => {
    const h = harness();
    const a = await addOperator(h);
    const res = await h.login(creds(a));
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await res.json();
    expectSchema("Operator", body);
    expect(body).toEqual({ operatorId: a.id, displayName: "운영자 시험" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const set = res.headers.get("set-cookie") ?? "";
    expect(set).toMatch(/^siljang_operator=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200$/);
    const cookie = cookieOf(res);

    const me = await h.me(cookie);
    expect(me.status).toBe(200);
    const meBody = await me.json();
    expectSchema("Operator", meBody);
    expect(meBody).toEqual(body);

    const out = await h.logout({ cookie });
    expect(out.status).toBe(204);
    expect(out.headers.get("set-cookie")).toBe(clearedCookie());
    expect(await out.text()).toBe("");
    await expectProblem(await h.me(cookie), "unauthenticated");
    // 두 번 해도 204.
    expect((await h.logout({ cookie })).status).toBe(204);
    // Supabase 세션은 남기지 않음.
    expect(h.mock.liveTokens()).toBe(0);
    expect(h.waits).toEqual([]);
    // challenge·verify는 운영자 행에 묶은 인증 수단으로만.
    const factorCalls = h.mock.calls.filter((c) => c.path.startsWith("/factors/")).map((c) => c.path);
    expect(factorCalls).toEqual([`/factors/${a.factorId}/challenge`, `/factors/${a.factorId}/verify`]);
  });

  it("API-004 401·422·429·503과 API-005 401이 06 Problem", async () => {
    const h = harness();
    const a = await addOperator(h);
    await expectProblem(await h.login({ ...creds(a), otp: "000000" }), "operator_login_failed");
    const bad = await expectProblem(await h.login({ ...creds(a), otp: "12" }), "validation_failed");
    expect(bad.errors).toEqual([{ field: "/otp", code: "too_short" }]);
    for (let i = 0; i < 4; i += 1) await h.login({ ...creds(a), password: "wrong" });
    const limited = await h.login(creds(a));
    const p = await expectProblem(limited, "too_many_attempts");
    expect(limited.headers.get("retry-after")).toBe(String(p.retryAfterSeconds));
    const h2 = harness();
    const b = await addOperator(h2);
    h2.mock.down = "500";
    await expectProblem(await h2.login(creds(b)), "auth_unavailable");
    await expectProblem(await h.me(), "unauthenticated");
  });

  it("Content-Type이 JSON이 아니거나 JSON으로 읽을 수 없으면 422(06 DEC-01), 세지 않음", async () => {
    const h = harness();
    const a = await addOperator(h);
    const ct = await expectProblem(await h.login(creds(a), { contentType: "text/plain" }), "validation_failed");
    expect(ct.errors).toEqual([{ field: "header:Content-Type", code: "not_allowed" }]);
    const json = await expectProblem(await h.login("{not json"), "validation_failed");
    expect(json.errors).toEqual([{ field: "/", code: "bad_json" }]);
    expect((await h.login(creds(a), { contentType: "application/json; charset=utf-8" })).status).toBe(200);
    expect(h.mock.calls.filter((c) => c.path === "/token")).toHaveLength(1);
  });
});

describeDb("틀린 것을 알리지 않음(같은 응답)", () => {
  it("없는 이메일·틀린 비밀번호·틀린 번호·운영자 표에 없음·2단계 인증 안 켬·막힘·TOTP 없음·aal2 아님이 모두 같은 401", async () => {
    const h = harness();
    const ok = await addOperator(h);
    const cases: Array<[string, () => Promise<Record<string, unknown>>]> = [
      ["없는 이메일", async () => ({ ...creds(ok), email: `nobody-${newUuid()}@ops.example` })],
      ["틀린 비밀번호", async () => ({ ...creds(ok), password: "wrong-password" })],
      ["틀린 번호", async () => ({ ...creds(ok), otp: "000000" })],
      ["운영자 표에 없음", async () => creds(await addOperator(h, { inTable: false }))],
      ["2단계 인증을 켜지 않음(mfa_enrolled_at 빔)", async () => creds(await addOperator(h, { mfa: false }))],
      ["막힌 운영자(disabled_at)", async () => creds(await addOperator(h, { disabled: true }))],
      ["Supabase에 TOTP가 없음", async () => ({ ...creds(await addOperator(h, { code: null })), otp: "135790" })],
      [
        "확인된 TOTP가 둘(등록 도구가 만들지 않는 상태, 닫힘)",
        async () => {
          const acc = await addOperator(h);
          const user = h.mock.users.get(acc.email);
          const first = user?.factors[0];
          if (user === undefined || first === undefined) throw new Error("mock user");
          user.factors.push({ ...first, id: newUuid(), friendlyName: "second" });
          return creds(acc);
        },
      ],
      [
        "Supabase의 확인된 TOTP가 등록 도구가 묶은 인증 수단이 아님(대시보드에서 지운 뒤 비밀번호를 아는 사람이 직접 등록)",
        async () => {
          const acc = await addOperator(h);
          const first = h.mock.users.get(acc.email)?.factors[0];
          if (first === undefined) throw new Error("mock user");
          first.id = newUuid();
          return creds(acc);
        },
      ],
      [
        "비밀번호 로그인의 Supabase 사용자가 운영자 행에 묶인 사용자가 아님(같은 이메일로 다시 만든 사용자)",
        async () => {
          const acc = await addOperator(h);
          await db.query("UPDATE operators SET auth_user_id = $2 WHERE id = $1", [acc.id, newUuid()]);
          return creds(acc);
        },
      ],
    ];
    const seen: Record<string, unknown>[] = [];
    // 묶은 사용자·인증 수단이 아니면 Supabase에 challenge·verify를 부르지도 않음(verify의 실패나 세션 만들기의 다시 보기에 기대지 않음).
    const unbound = new Set([cases[cases.length - 2]?.[0], cases[cases.length - 1]?.[0]]);
    for (const [name, make] of cases) {
      const before = h.waits.length;
      const body0 = await make();
      const callsBefore = h.mock.calls.length;
      const res = await h.login(body0);
      if (unbound.has(name)) {
        expect(
          h.mock.calls.slice(callsBefore).filter((c) => c.path.startsWith("/factors/")),
          name,
        ).toEqual([]);
      }
      const body = await expectProblem(res, "operator_login_failed");
      expect(res.headers.get("set-cookie"), name).toBeNull();
      expect([...res.headers.keys()].sort(), name).toEqual(["cache-control", "content-type"]);
      seen.push(comparableProblem(body));
      // 실패 응답은 최소 시간까지 기다림(어디서 틀렸는지 응답 시간으로 드러나지 않게).
      expect(h.waits.length, name).toBe(before + 1);
      const waited = h.waits.at(-1) as number;
      expect(waited).toBeGreaterThan(0);
      expect(waited).toBeLessThanOrEqual(FAILURE_FLOOR_MS);
    }
    const h2 = harness();
    const aal1 = await addOperator(h2);
    h2.mock.verifyGivesAal1 = true;
    seen.push(comparableProblem(await expectProblem(await h2.login(creds(aal1)), "operator_login_failed")));
    for (const b of seen) expect(b).toEqual(seen[0]);
    // 비밀번호 로그인 답에 인증 수단 목록이 없으면 사용자를 다시 읽어 확인함.
    const h3 = harness();
    const plain = await addOperator(h3);
    h3.mock.omitFactorsOnSignIn = true;
    expect((await h3.login(creds(plain))).status).toBe(200);
    expect(h3.mock.calls.map((c) => `${c.method} ${c.path}`)).toContain("GET /user");
    expect(h.mock.liveTokens() + h2.mock.liveTokens() + h3.mock.liveTokens()).toBe(0);
  });

  it("Origin이 없거나 다른 사이트면 인증 서비스에 묻지 않고 같은 401, 세지 않음", async () => {
    const h = harness();
    const a = await addOperator(h);
    for (const origin of [null, "https://evil.example", "http://localhost:8787"]) {
      await expectProblem(await h.login(creds(a), { origin }), "operator_login_failed");
    }
    expect(h.mock.calls).toEqual([]);
    expect(await failureRows(a.email)).toBe(0);
  });
});

describeDb("실패 응답의 바닥 시간(401·429·503 모두 같음)", () => {
  it("401·429·503은 모두 시작한 때부터 2초까지 기다리고, 성공·422·Origin이 다른 401은 기다리지 않음", async () => {
    const h = harness();
    const a = await addOperator(h);
    const statusAndWait = async (body: unknown, o: Omit<CallOptions, "body"> = {}) => {
      const before = h.waits.length;
      const res = await h.login(body, o);
      const waited = h.waits.length - before;
      if (waited === 1) {
        const w = h.waits.at(-1) as number;
        expect(w > 0 && w <= FAILURE_FLOOR_MS).toBe(true);
      }
      return `${res.status}:${waited}`;
    };
    expect(await statusAndWait(creds(a))).toBe("200:0");
    expect(await statusAndWait({ ...creds(a), otp: "12" })).toBe("422:0");
    expect(await statusAndWait(creds(a), { origin: "https://evil.example" })).toBe("401:0");
    for (let i = 0; i < 5; i += 1) expect(await statusAndWait({ ...creds(a), otp: "000000" })).toBe("401:1");
    expect(await statusAndWait(creds(a))).toBe("429:1");
    const b = await addOperator(h);
    h.mock.down = "500";
    expect(await statusAndWait(creds(b))).toBe("503:1");
  });
});

describeDb("로그인 실패 15분에 5번(06 DEC-16)", () => {
  it("5번 실패하면 맞는 정보도 429와 Retry-After, 인증 서비스에 묻지 않음. 15분이 지나면 다시 되고 성공하면 지움", async () => {
    const h = harness();
    const a = await addOperator(h);
    for (let i = 0; i < 5; i += 1) {
      h.clock.now = new Date(T0.getTime() + i * 60_000);
      await expectProblem(await h.login({ ...creds(a), otp: "000000" }), "operator_login_failed");
    }
    expect(await failureRows(a.email)).toBe(5);
    const calls = h.mock.calls.length;
    h.clock.now = new Date(T0.getTime() + 5 * 60_000);
    const res = await h.login(creds(a));
    const p = await expectProblem(res, "too_many_attempts");
    // 가장 오래된 실패(T0)가 15분 창을 벗어날 때까지 600초.
    expect(p.retryAfterSeconds).toBe(LOGIN_FAILURE_WINDOW_SECONDS - 300);
    expect(res.headers.get("retry-after")).toBe("600");
    expect(h.mock.calls.length).toBe(calls);
    // 대소문자가 달라도 같은 이메일로 셈(앞뒤 공백은 06 형식이 받지 않음).
    await expectProblem(await h.login({ ...creds(a), email: a.email.toUpperCase() }), "too_many_attempts");
    h.clock.now = new Date(T0.getTime() + 899_000);
    const late = await expectProblem(await h.login(creds(a)), "too_many_attempts");
    expect(late.retryAfterSeconds).toBe(1);
    h.clock.now = new Date(T0.getTime() + 900_000);
    expect((await h.login(creds(a))).status).toBe(200);
    expect(await failureRows(a.email)).toBe(0);
  });

  it("동시에 보낸 시도도 15분에 5번까지만 인증 서비스에 닿음", async () => {
    const h = harness();
    const a = await addOperator(h);
    const results = await Promise.all(
      Array.from({ length: 9 }, () => h.login({ ...creds(a), password: "wrong" }).then((r) => r.status)),
    );
    expect(results.filter((s) => s === 401)).toHaveLength(5);
    expect(results.filter((s) => s === 429)).toHaveLength(4);
    expect(h.mock.calls.filter((c) => c.path === "/token")).toHaveLength(5);
  });

  it("다른 이메일의 실패는 따로 셈", async () => {
    const h = harness();
    const a = await addOperator(h);
    const b = await addOperator(h);
    for (let i = 0; i < 5; i += 1) await h.login({ ...creds(a), password: "wrong" });
    expect((await h.login(creds(b))).status).toBe(200);
  });
});

describeDb("운영자 세션 12시간 고정(06 DEC-26)", () => {
  it("로그인한 때부터 12시간: 11:59:59까지 열리고 12시간에 끝남, 쓴다고 늘지 않음", async () => {
    const h = harness();
    const a = await addOperator(h);
    const res = await h.login(creds(a));
    const cookie = cookieOf(res);
    const at = (ms: number) => {
      h.clock.now = new Date(T0.getTime() + ms);
    };
    at(6 * 3600_000);
    expect((await h.me(cookie)).status).toBe(200);
    at(12 * 3600_000 - 1000);
    expect((await h.me(cookie)).status).toBe(200);
    at(12 * 3600_000);
    await expectProblem(await h.me(cookie), "unauthenticated");
    const token = cookie.slice("siljang_operator=".length);
    const row = await db.query<{ created_at: Date; expires_at: Date; token_hash: string }>(
      "SELECT created_at, expires_at, token_hash FROM operator_sessions WHERE token_hash = $1",
      [await tokenHash(token)],
    );
    const s = row.rows[0] as { created_at: Date; expires_at: Date; token_hash: string };
    expect(s.created_at.toISOString()).toBe(T0.toISOString());
    expect(s.expires_at.getTime() - s.created_at.getTime()).toBe(OPERATOR_SESSION_SECONDS * 1000);
    expect(s.token_hash).not.toBe(token);
  });

  it("막으면 그 운영자의 열린 세션이 모두 끝나 풀어도 옛 쿠키는 401, 다른 운영자의 세션은 그대로(06 DEC-27)", async () => {
    const h = harness();
    const a = await addOperator(h);
    const b = await addOperator(h);
    const first = cookieOf(await h.login(creds(a)));
    const second = cookieOf(await h.login(creds(a)));
    const other = cookieOf(await h.login(creds(b)));
    expect(await openSessions(a.id)).toBe(2);
    await db.query("UPDATE operators SET disabled_at = $2 WHERE id = $1", [a.id, T0]);
    expect(await openSessions(a.id)).toBe(0);
    await expectProblem(await h.me(first), "unauthenticated");
    // 막기 전에 새어 나간 쿠키가 풀린 뒤 다시 살아나지 않음.
    await db.query("UPDATE operators SET disabled_at = NULL WHERE id = $1", [a.id]);
    await expectProblem(await h.me(first), "unauthenticated");
    await expectProblem(await h.me(second), "unauthenticated");
    expect((await h.me(other)).status).toBe(200);
    expect(await openSessions(b.id)).toBe(1);
    // 푼 뒤 새로 로그인하면 됨.
    expect((await h.login(creds(a))).status).toBe(200);
  });

  it("2단계 인증을 끄거나 다시 등록하거나 Supabase 사용자를 바꾸면 옛 쿠키는 401이고 되돌려도 살아나지 않음, 이름만 바꾸면 그대로", async () => {
    const h = harness();
    // 바꾸는 것마다 새 운영자 하나(되돌리는 문장은 같은 값을 다시 씀).
    const changes: Array<[string, (a: Account) => [string, unknown[]], (a: Account) => [string, unknown[]]]> = [
      [
        "2단계 인증 끔(인증 수단 ID와 켠 시각을 비움)",
        (a) => ["UPDATE operators SET mfa_factor_id = NULL, mfa_enrolled_at = NULL WHERE id = $1", [a.id]],
        (a) => ["UPDATE operators SET mfa_factor_id = $2, mfa_enrolled_at = $3 WHERE id = $1", [a.id, a.factorId, T0]],
      ],
      [
        "다시 등록(새 인증 수단 ID와 켠 시각)",
        (a) => ["UPDATE operators SET mfa_factor_id = $2, mfa_enrolled_at = $3 WHERE id = $1", [a.id, newUuid(), T0]],
        (a) => [
          "UPDATE operators SET mfa_factor_id = $2, mfa_enrolled_at = $3 WHERE id = $1",
          [a.id, a.factorId, new Date("2026-11-01T00:00:00Z")],
        ],
      ],
      [
        "Supabase 사용자 ID가 바뀜",
        (a) => ["UPDATE operators SET auth_user_id = $2 WHERE id = $1", [a.id, newUuid()]],
        (a) => ["UPDATE operators SET auth_user_id = $2 WHERE id = $1", [a.id, a.userId]],
      ],
    ];
    for (const [name, change, revert] of changes) {
      const a = await addOperator(h);
      const cookie = cookieOf(await h.login(creds(a)));
      await db.query(...change(a));
      await expectProblem(await h.me(cookie), "unauthenticated");
      expect(await openSessions(a.id), name).toBe(0);
      await db.query(...revert(a));
      await expectProblem(await h.me(cookie), "unauthenticated");
    }
    const a = await addOperator(h);
    const cookie = cookieOf(await h.login(creds(a)));
    await db.query("UPDATE operators SET display_name = '새 이름', email = email WHERE id = $1", [a.id]);
    const me = await h.me(cookie);
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ displayName: "새 이름" });
    // 같은 값을 다시 써도(등록 도구가 같은 인증 수단을 다시 확인한 때) 끝내지 않음.
    await db.query(
      "UPDATE operators SET mfa_factor_id = mfa_factor_id, mfa_enrolled_at = mfa_enrolled_at WHERE id = $1",
      [a.id],
    );
    expect((await h.me(cookie)).status).toBe(200);
  });

  it("로그인 확인과 세션 만들기 사이에 운영자 행이 바뀌면 세션을 만들지 않음", async () => {
    const h = harness();
    const a = await addOperator(h);
    const binding = { id: a.id as string, mfaFactorId: a.factorId, authUserId: a.userId };
    expect(await createSession(db, { ...binding, mfaFactorId: newUuid() }, T0)).toBeNull();
    expect(await createSession(db, { ...binding, authUserId: newUuid() }, T0)).toBeNull();
    await db.query("UPDATE operators SET disabled_at = $2 WHERE id = $1", [a.id, T0]);
    expect(await createSession(db, binding, T0)).toBeNull();
    await db.query("UPDATE operators SET disabled_at = NULL WHERE id = $1", [a.id]);
    expect(await createSession(db, binding, T0)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await openSessions(a.id)).toBe(1);
  });

  it("로그아웃은 Origin이 맞을 때만 세션을 끝냄(다른 사이트는 세션이 없는 것과 같음), 쿠키는 늘 지움", async () => {
    const h = harness();
    const a = await addOperator(h);
    const cookie = cookieOf(await h.login(creds(a)));
    const foreign = await h.logout({ cookie, origin: "https://evil.example" });
    expect(foreign.status).toBe(204);
    expect(foreign.headers.get("set-cookie")).toBe(clearedCookie());
    expect((await h.me(cookie)).status).toBe(200);
    expect((await h.logout()).status).toBe(204);
    expect((await h.logout({ cookie: "siljang_operator=garbage" })).status).toBe(204);
    expect((await h.logout({ cookie })).status).toBe(204);
    await expectProblem(await h.me(cookie), "unauthenticated");
  });

  it("읽기가 아닌 운영자 범위 요청은 Origin이 맞아야 함(06 DEC-10 M18)", async () => {
    let calls = 0;
    const ping = operatorRoute("POST", "/test/operator/ping", async (r) => {
      calls += 1;
      return r.json({ ok: true });
    });
    const h = harness({ routes: [...APP_ROUTES, ping] });
    const a = await addOperator(h);
    const cookie = cookieOf(await h.login(creds(a)));
    await expectProblem(await h.call("POST", "/test/operator/ping", { cookie, origin: null }), "unauthenticated");
    await expectProblem(
      await h.call("POST", "/test/operator/ping", { cookie, origin: "https://evil.example" }),
      "unauthenticated",
    );
    expect(calls).toBe(0);
    expect((await h.call("POST", "/test/operator/ping", { cookie })).status).toBe(200);
    expect(calls).toBe(1);
  });
});

describeDb("SPEC-001 수락 기준 5: 사장님 세션으로는 운영자 화면이 열리지 않음", () => {
  it("운영자 계정이 아닌 사장님의 카카오 로그인 세션은 운영자 API에서 401(운영자 기록 0건), 운영자로 로그인한 때에만 열림", async () => {
    const ownerId = newUuid();
    // 사장님 세션 해석기(진짜는 TASK-020): 쿠키 siljang_owner가 있으면 그 사장님.
    const ownerAccount: OwnerResolver = async (c) => {
      if (!/(^|;\s*)siljang_owner=[^;]+/.test(c.req.header("cookie") ?? "")) throw new ApiError("unauthenticated");
      return createOwnerScope(ownerId);
    };
    let screens = 0;
    const ownerPing = ownerRoute("GET", "/test/owner/ping", async (r) => r.json({ ownerId: r.owner.ownerId }));
    const operatorScreen = operatorRoute("GET", "/test/operator/screen", async (r) => {
      screens += 1;
      return r.json({ operatorId: r.operator.operatorId });
    });
    const h = harness({ ownerAccount, routes: [...APP_ROUTES, ownerPing, operatorScreen] });
    const ownerCookie = `siljang_owner=owner-session-${newUuid()}`;
    // 그 사장님 세션은 사장님 경로에서는 맞는 세션.
    const owned = await h.call("GET", "/test/owner/ping", { cookie: ownerCookie });
    expect(owned.status).toBe(200);
    expect(await owned.json()).toEqual({ ownerId });
    for (const path of ["/operator/me", "/test/operator/screen"]) {
      const res = await h.call("GET", path, { cookie: ownerCookie });
      const body = await expectProblem(res, "unauthenticated");
      expect(body).not.toHaveProperty("operatorId");
      expect(body).not.toHaveProperty("displayName");
    }
    // 사장님 쿠키 값을 운영자 쿠키 이름으로 보내도 열리지 않음.
    const forged = `siljang_operator=${"A".repeat(43)}`;
    await expectProblem(
      await h.call("GET", "/operator/me", { cookie: `${ownerCookie}; ${forged}` }),
      "unauthenticated",
    );
    expect(screens).toBe(0);
    // 운영자로 로그인한 때에만 열림.
    const a = await addOperator(h);
    const cookie = cookieOf(await h.login(creds(a)));
    expect((await h.call("GET", "/test/operator/screen", { cookie: `${ownerCookie}; ${cookie}` })).status).toBe(200);
    expect(screens).toBe(1);
  });

  it("이름 40자는 코드 포인트로 셈(데이터베이스 char_length·06 maxLength와 같음): 이모지 40개 이름도 모든 운영자 경로에서 200", async () => {
    const name = "🎂".repeat(40);
    expect(name.length).toBe(80);
    const screen = operatorRoute("GET", "/test/operator/name", async (r) => r.json({ name: r.operator.displayName }));
    const h = harness({ routes: [...APP_ROUTES, screen] });
    const a = await addOperator(h, { name });
    const res = await h.login(creds(a));
    expect(res.status).toBe(200);
    expectSchema("Operator", await res.json());
    const cookie = cookieOf(res);
    const me = await h.me(cookie);
    expect(me.status).toBe(200);
    expectSchema("Operator", await me.json());
    const named = await h.call("GET", "/test/operator/name", { cookie });
    expect(named.status).toBe(200);
    expect(await named.json()).toEqual({ name });
    expect(createOperatorScope(newUuid(), "🎂".repeat(21)).displayName).toBe("🎂".repeat(21));
    expect(() => createOperatorScope(newUuid(), "🎂".repeat(41))).toThrow(TypeError);
    expect(() => createOperatorScope(newUuid(), `${"가".repeat(40)}🎂`)).toThrow(TypeError);
  });

  it("흉내 낸 운영자 범위는 경로가 받지 않음(500, 운영자 화면 0번)", async () => {
    const h = harness({
      operatorAccount: async () =>
        ({ operatorId: newUuid(), displayName: "흉내" }) as unknown as ReturnType<typeof createOperatorScope>,
    });
    const res = await h.me();
    await expectProblem(res, "internal");
    expect(createOperatorScope(newUuid(), "운영자").displayName).toBe("운영자");
    expect(() => createOperatorScope("not-a-uuid", "운영자")).toThrow(TypeError);
    expect(() => createOperatorScope(newUuid(), "")).toThrow(TypeError);
  });
});

describeDb("인증 서비스가 답하지 않을 때(06 auth_unavailable)", () => {
  it("비밀번호 단계부터 답이 없으면 503이고 세지 않음(6번 해도 429가 아님)", async () => {
    for (const mode of ["throw", "500", "429", "hang", "redirect", "shape"] as const) {
      const h = harness();
      const a = await addOperator(h);
      h.mock.down = mode;
      for (let i = 0; i < 6; i += 1) {
        await expectProblem(await h.login(creds(a)), "auth_unavailable");
      }
      expect(await failureRows(a.email), mode).toBe(0);
      // 503도 401과 같은 바닥(2초)까지 기다림(앞의 기대값 waits=[]를 바꿈).
      expect(h.waits, mode).toHaveLength(6);
      for (const w of h.waits) expect(w > 0 && w <= FAILURE_FLOOR_MS, mode).toBe(true);
      h.mock.down = null;
      expect((await h.login(creds(a))).status, mode).toBe(200);
    }
  });

  it("비밀번호에 답한 뒤 2단계 인증에서 끊기면 503이고 실패로 셈(비밀번호가 맞았는지 무제한으로 알아내지 못하게)", async () => {
    const h = harness();
    const a = await addOperator(h);
    h.mock.down = "500";
    h.mock.downAt = "/factors";
    for (let i = 0; i < 5; i += 1) await expectProblem(await h.login(creds(a)), "auth_unavailable");
    expect(await failureRows(a.email)).toBe(5);
    await expectProblem(await h.login(creds(a)), "too_many_attempts");
  });

  it("verify가 challenge와 다른 IP라고 거절하면(mfa_ip_address_mismatch) 503이고 로그에 ip_mismatch, 비밀번호 단계 뒤라 셈", async () => {
    const h = harness();
    const a = await addOperator(h);
    h.mock.verifyIpMismatch = true;
    await expectProblem(await h.login(creds(a)), "auth_unavailable");
    expect(await failureRows(a.email)).toBe(1);
    expect(h.logs.lines.join("\n")).toContain('"names":["ip_mismatch","counted"]');
    expect(h.waits).toHaveLength(1);
    h.mock.verifyIpMismatch = false;
    expect((await h.login(creds(a))).status).toBe(200);
  });

  it("설정이 없으면 운영자 로그인만 500 internal이고 세지 않음, 로그에는 이름만", async () => {
    const h = harness({ noAuth: true });
    const a = await addOperator(h);
    await expectProblem(await h.login(creds(a)), "internal");
    expect(await failureRows(a.email)).toBe(0);
    expect(h.logs.lines.join("\n")).toContain("MissingSettingError");
    expect((await h.call("GET", "/healthz")).status).toBe(200);
  });
});

describeDb("비밀 값을 남기지 않음(REQ-135)", () => {
  it("비밀번호·번호·이메일·쿠키 값·Supabase 토큰이 로그·데이터베이스·응답 본문에 0건", async () => {
    const h = harness();
    const a = await addOperator(h);
    const bodies: string[] = [];
    const keep = async (res: Response) => {
      bodies.push(await res.clone().text());
      return res;
    };
    await keep(await h.login({ ...creds(a), password: "fake-wrong-password" }));
    await keep(await h.login({ ...creds(a), otp: "864209" }));
    const res = await keep(await h.login(creds(a)));
    const cookie = cookieOf(res);
    const token = cookie.slice("siljang_operator=".length);
    await keep(await h.me(cookie));
    h.mock.down = "500";
    await keep(await h.login(creds(a)));
    await keep(await h.logout({ cookie }));

    const sessions = await db.query("SELECT * FROM operator_sessions WHERE operator_id = $1", [a.id]);
    const failures = await db.query("SELECT * FROM operator_login_failures WHERE email_hash = $1", [
      await emailHash(new Secret(TEST_HASH_KEY), a.email),
    ]);
    const stored = JSON.stringify([sessions.rows, failures.rows]);
    const logs = h.logs.lines.join("\n");
    const secrets = [a.password, "fake-wrong-password", a.otp, "864209", a.email, token, KEY, "mock-refresh"];
    for (const s of secrets) {
      expect(logs, "logs").not.toContain(s);
      expect(stored, "database").not.toContain(s);
      for (const b of bodies) expect(b, "response").not.toContain(s);
    }
    // Supabase가 준 토큰(eyJ… 꼴)도 어디에도 없음.
    expect(logs + stored + bodies.join("")).not.toMatch(/eyJ[A-Za-z0-9_-]+\./);
    expect(sessions.rows).toHaveLength(1);
    expect(logs).toContain('"event":"operator_login"');
  });
});
