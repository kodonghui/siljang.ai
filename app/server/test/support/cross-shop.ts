import type { Hono } from "hono";
import { expect } from "vitest";
import type { HonoEnv } from "../../src/app";
import type { Queryable } from "../../src/db";
import { deriveKakaoSkillKey } from "../../src/kakao-skill-auth";
import { REQUEST_KEY_HEADER } from "../../src/request-key";
import { type Method, type RouteDecl, routeKey } from "../../src/routes";
import { Secret } from "../../src/settings";
import { comparableProblem, expectProblem } from "./contract";
import { newRequestKey, newUuid, TEST_HASH_KEY, testDb, testEnv } from "./db";
import { malformedIds, missingIds, type RecordIds, recordIds, type ShopFixture, snapshotShop } from "./shops";

/**
 * 교차 가게 시험 묶음(TASK-019; 04 SPEC-068 수락 기준 1·2, G1; 06 DEC-02).
 *
 * 가게 범위 경로(routes.ts의 shopRoute)는 하나도 빠짐없이 CROSS_SHOP_CASES에 등록한다. 시험(test/cross-shop.test.ts)이
 * 앱의 선언(app.ts의 APP_ROUTES)과 이 목록을 견주어, 등록되지 않은 가게 범위 경로가 있으면 실패한다(새 API가 빠지면 CI 실패).
 * 등록한 사례는 모두 앱의 선언을 붙인 앱에서 실제로 부른다(시험용 경로의 사례와 함께).
 *
 * 등록한 경로마다 가게 A 사장님으로 다음을 부른다.
 * - 경로의 ID(kind 'path'): 가게 B의 ID, 어느 가게에도 없는 ID, B의 ID를 대문자로, 형식이 틀린 ID 둘('not-a-uuid', 101자)
 *   → 모두 같은 404 not_found(상태·헤더 이름·본문이 traceId·instance 말고 같음).
 * - 본문·쿼리의 ID(kind 'reference'): 가게 B의 ID, 없는 ID, B의 ID를 대문자로 → 모두 같은 422 validation_failed와
 *   같은 필드의 reference_not_found.
 * - 그 사이 두 가게의 기록(가게 테이블 54개와 가게 행)이 하나도 생기거나 바뀌거나 지워지지 않음(남는 기록 0).
 *   B 사장님의 요청 키도 늘지 않는다. A가 낸 명령의 요청 키는 06 DEC-04대로 404를 남길 수 있지만 B의 기록 ID를 담지 않는다.
 * - 응답 본문 어디에도(경로를 되돌려 주는 instance 말고) B의 기록 ID가 없음.
 * - 대조: A 자신의 ID로 부르면 ownStatus(경로가 실제로 일하는지).
 */
export interface CrossShopRequest {
  /** /api 뒤의 주소(쿼리 포함). */
  readonly url: string;
  readonly body?: unknown;
}

interface OwnerCrossShopCase {
  readonly method: Method;
  /** 선언의 경로(/api 뒤, :이름). 등록 열쇠다. */
  readonly path: string;
  readonly kind: "path" | "reference";
  /** own은 부르는 사장님 가게의 ID, target은 바꿔 넣을 ID(path면 경로에, reference면 본문·쿼리에). */
  request(own: RecordIds, target: RecordIds): CrossShopRequest;
  /** A 자신의 ID로 부르면 나올 상태. */
  readonly ownStatus: number;
}

interface SkillCrossShopCase {
  readonly method: "POST";
  readonly path: string;
  readonly kind: "channel";
}

interface OwnShopCase {
  readonly method: "GET";
  readonly path: "/owner/shop";
  readonly kind: "self";
}

interface CalendarShopCase {
  readonly method: "GET" | "PUT" | "PATCH";
  readonly path: "/owner/calendar" | "/owner/calendar/days" | "/owner/calendar/days/:day";
  readonly kind: "calendar";
}

export type CrossShopCase = OwnerCrossShopCase | SkillCrossShopCase | OwnShopCase | CalendarShopCase;

export const CROSS_SHOP_CASES: readonly CrossShopCase[] = [
  ...["message", "card", "review", "event"].map(
    (kind) =>
      ({
        method: "POST",
        path: `/kakao/skills/${kind}`,
        kind: "channel",
      }) as const,
  ),
  { method: "GET", path: "/owner/shop", kind: "self" },
  { method: "GET", path: "/owner/calendar", kind: "calendar" },
  { method: "PUT", path: "/owner/calendar", kind: "calendar" },
  { method: "GET", path: "/owner/calendar/days", kind: "calendar" },
  { method: "PATCH", path: "/owner/calendar/days/:day", kind: "calendar" },
];

/** 선언된 가게 범위 경로 가운데 등록되지 않은 것(missing)과, 등록됐지만 선언이 없는 것(stale). */
export function registryGaps(
  routes: readonly RouteDecl[],
  cases: readonly CrossShopCase[],
): { readonly missing: string[]; readonly stale: string[] } {
  const shop = new Set(routes.filter((r) => r.kind === "shop").map((r) => routeKey(r.method, r.path)));
  const registered = new Set(cases.map((c) => routeKey(c.method, c.path)));
  return {
    missing: [...shop].filter((k) => !registered.has(k)).sort(),
    stale: [...registered].filter((k) => !shop.has(k)).sort(),
  };
}

/** 라우터에 붙은 경로 가운데 선언(RouteDecl)에 없는 것(선언 없이 app.get 따위로 붙인 경로). */
export function undeclaredRoutes(app: Hono<HonoEnv>, routes: readonly RouteDecl[]): string[] {
  const declared = new Set(routes.map((r) => routeKey(r.method, `/api${r.path}`)));
  return app.routes
    .filter((r) => !(r.method === "ALL" && r.path.endsWith("*")))
    .map((r) => routeKey(r.method, r.path))
    .filter((k) => !declared.has(k));
}

export interface CrossShopEnv {
  readonly app: Hono<HonoEnv>;
  /** 부르는 사장님의 가게. */
  readonly a: ShopFixture;
  /** 다른 가게. */
  readonly b: ShopFixture;
  /** 그 가게 사장님으로 부르는 헤더(TASK-020 전에는 시험용 해석기의 헤더). */
  readonly as: (f: ShopFixture) => Record<string, string>;
}

interface Sent {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  readonly body: Record<string, unknown> | null;
  readonly requestKey: string | null;
}

async function send(env: CrossShopEnv, method: Method, req: CrossShopRequest): Promise<Sent> {
  const headers: Record<string, string> = { ...env.as(env.a) };
  const requestKey = method === "GET" ? null : newRequestKey();
  if (requestKey !== null) headers[REQUEST_KEY_HEADER] = requestKey;
  const init: RequestInit = { method, headers };
  if (req.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(req.body);
  }
  const res = await env.app.request(`/api${req.url}`, init, testEnv());
  const text = await res.text();
  const body = text === "" ? null : (JSON.parse(text) as Record<string, unknown>);
  return { status: res.status, headers: res.headers, text, body, requestKey };
}

/** 견줄 수 있는 모양: 상태, 헤더 이름(길이 빼고)과 content-type, traceId·instance를 뺀 본문. */
function comparable(r: Sent) {
  const { traceId: _t, instance: _i, ...rest } = r.body ?? {};
  return {
    status: r.status,
    contentType: r.headers.get("content-type"),
    headerNames: [...r.headers.keys()].filter((h) => h !== "content-length").sort(),
    body: rest,
  };
}

function upper(ids: RecordIds): RecordIds {
  return Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, v.toUpperCase()])) as unknown as RecordIds;
}

/**
 * 두 가게의 기록 모습. A 사장님의 요청 키 수는 뺀다: A가 낸 명령이 404로 끝나면 06 DEC-04대로 그 요청 키에 결과가 남는다
 * (같은 키로 다시 보내면 같은 404). 그 요청 키에 B의 기록 ID가 없는지는 따로 본다.
 */
async function snapshots(db: Queryable, env: CrossShopEnv): Promise<Record<string, string>[]> {
  const { request_keys: _ownKeys, ...a } = await snapshotShop(db, env.a);
  return [a, await snapshotShop(db, env.b)];
}

async function checkSkillChannel(env: CrossShopEnv, c: SkillCrossShopCase, db: Queryable): Promise<void> {
  const key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), env.a.channelId, 1);
  async function call(botId: string) {
    return env.app.request(
      `/api${c.path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
        body: JSON.stringify({
          bot: { id: botId },
          userRequest: { utterance: "합성 시험", user: { id: env.a.userKey, type: "botUserKey" } },
          action: { id: "test", params: {} },
        }),
      },
      testEnv(),
    );
  }

  const before = await snapshots(db, env);
  const other = await call(env.b.botId);
  const unknown = await call(newUuid().replaceAll("-", "").slice(0, 24));
  const otherBody = await expectProblem(other, "skill_key_invalid");
  const unknownBody = await expectProblem(unknown, "skill_key_invalid");
  expect(comparableProblem(otherBody)).toEqual(comparableProblem(unknownBody));
  expect(await snapshots(db, env)).toEqual(before);
  expect((await call(env.a.botId)).status).toBe(200);
}

/** 등록한 경로 하나를 위 규칙대로 부르고 본다. 어기면 expect가 던진다. */
export async function runCrossShopCase(env: CrossShopEnv, c: CrossShopCase): Promise<void> {
  const db = testDb();
  try {
    if (c.kind === "calendar") {
      const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
      for (const [shop, capacity] of [
        [env.a, 3],
        [env.b, 9],
      ] as const)
        await db.query(
          `INSERT INTO business_calendars (shop_id, daily_capacity, order_cutoff_days, order_cutoff_time)
          VALUES ($1, $2, 2, '18:00') ON CONFLICT (shop_id) DO UPDATE SET daily_capacity = EXCLUDED.daily_capacity`,
          [shop.shopId, capacity],
        );
      const before = await snapshots(db, env);
      const read = await send(env, "GET", { url: `/owner/calendar?shopId=${env.b.shopId}&ownerId=${env.b.ownerId}` });
      expect(read.status).toBe(200);
      expect(read.body?.dailyCapacity).toBe(3);
      if (!read.body) throw new Error("시험 설정 없음");
      const { updatedAt: _at, revision, ...settings } = read.body;
      const url = c.path.includes("/days") ? c.path.replace(":day", day) : c.path;
      if (c.method === "GET") {
        const response = await send(env, "GET", { url: `${url}?from=${day}&to=${day}&shopId=${env.b.shopId}` });
        expect(response.status).toBe(200);
        if (c.path.endsWith("/days")) expect(response.body).toMatchObject({ items: [{ capacity: 3 }] });
        else expect(response.body?.dailyCapacity).toBe(3);
        expect(await snapshots(db, env)).toEqual(before);
      } else {
        const body =
          c.method === "PUT"
            ? { ...settings, baseRevision: revision, dailyCapacity: 4 }
            : { baseRevision: null, manuallyClosed: true };
        for (const target of [env.b.shopId, newUuid(), "not-a-uuid"]) {
          const response = await send(env, c.method, { url, body: { ...body, shopId: target } });
          expect(response.status).toBe(422);
          expect(response.body).toMatchObject({ errors: [{ field: "/shopId", code: "unknown_field" }] });
          expect(JSON.stringify(response.body)).not.toContain(env.b.shopId);
        }
        expect(await snapshots(db, env)).toEqual(before);
        const response = await send(env, c.method, { url, body });
        expect(response.status, response.text).toBe(200);
        const after = await snapshots(db, env);
        expect(after[1]).toEqual(before[1]);
        if (c.method === "PUT") expect(response.body).toMatchObject({ calendar: { dailyCapacity: 4 } });
        else expect(response.body).toMatchObject({ day: { capacity: 3, manuallyClosed: true } });
      }
      return;
    }
    if (c.kind === "channel") {
      await checkSkillChannel(env, c, db);
      return;
    }
    if (c.kind === "self") {
      const before = await snapshots(db, env);
      for (const target of [env.b.shopId, newUuid(), "not-a-uuid"]) {
        const response = await env.app.request(
          `/api/owner/shop?shopId=${target}&ownerId=${env.b.ownerId}`,
          {
            headers: env.as(env.a),
          },
          testEnv({ FILE_URL_KEY: TEST_HASH_KEY }),
        );
        const body = (await response.json()) as Record<string, unknown>;
        expect(response.status, JSON.stringify(body)).toBe(200);
        expect(body.shopId).toBe(env.a.shopId);
        expect(JSON.stringify(body)).not.toContain(env.b.shopId);
        expect(JSON.stringify(body)).not.toContain(env.b.ownerId);
      }
      expect(await snapshots(db, env)).toEqual(before);
      return;
    }
    const own = recordIds(env.a);
    const other = recordIds(env.b);
    const variants: [string, RecordIds][] = [
      ["다른 가게 ID", other],
      ["없는 ID", missingIds()],
      ["다른 가게 ID(대문자)", upper(other)],
    ];
    if (c.kind === "path") {
      variants.push(["형식이 틀린 ID", malformedIds("not-a-uuid")], ["101자 ID", malformedIds("a".repeat(101))]);
    }
    const before = await snapshots(db, env);
    const results: [string, Sent][] = [];
    for (const [name, ids] of variants) results.push([name, await send(env, c.method, c.request(own, ids))]);
    const after = await snapshots(db, env);
    const label = routeKey(c.method, c.path);

    // 남는 기록 0: 두 가게의 기록이 그대로(B 사장님의 요청 키 포함). A 사장님의 요청 키는 아래에서 따로 본다
    expect(after, `${label}: 가게 기록이 바뀜`).toEqual(before);

    const expected =
      c.kind === "path" ? { status: 404, code: "not_found" } : { status: 422, code: "validation_failed" };
    const [first] = results;
    for (const [name, r] of results) {
      expect(r.status, `${label} ${name}`).toBe(expected.status);
      expect(r.body?.code, `${label} ${name}`).toBe(expected.code);
      expect(comparable(r), `${label} ${name}: 없는 ID와 다른 응답`).toEqual(comparable((first as [string, Sent])[1]));
      if (c.kind === "reference") {
        const errors = (r.body?.errors ?? []) as { code: string }[];
        expect(errors.length, `${label} ${name}`).toBeGreaterThan(0);
        for (const e of errors) expect(e.code, `${label} ${name}`).toBe("reference_not_found");
      }
      // B의 기록이 있는지 알릴 내용 없음: instance(보낸 경로를 되돌려 줌) 말고 본문에 B의 ID가 없다
      const { instance: _i, ...rest } = r.body ?? {};
      const shown = JSON.stringify(rest).toLowerCase();
      for (const id of Object.values(other)) expect(shown, `${label} ${name}`).not.toContain(id);
    }

    // A의 명령이 남긴 요청 키(06 DEC-04: 404는 남김)에는 B의 기록 ID가 없다
    const keys = results.flatMap(([, r]) => (r.requestKey === null ? [] : [r.requestKey]));
    if (keys.length > 0) {
      const stored = await db.query<{ ref: string }>(
        "SELECT response_ref::text AS ref FROM request_keys WHERE actor_kind = 'owner' AND actor_id = $1 AND request_key = ANY($2)",
        [env.a.ownerId, keys],
      );
      for (const row of stored.rows) {
        for (const id of Object.values(other)) expect(row.ref.toLowerCase(), label).not.toContain(id);
      }
    }

    // 대조: A 자신의 ID로는 일한다
    const mine = await send(env, c.method, c.request(own, own));
    expect(mine.status, `${label}: 자기 가게 ID로 부름 ${mine.text}`).toBe(c.ownStatus);
  } finally {
    await db.close();
  }
}
