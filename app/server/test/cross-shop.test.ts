import { readFileSync } from "node:fs";
import type { Context } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { APP_ROUTES, createApp, type HonoEnv } from "../src/app";
import { resolveKakaoSkillScope } from "../src/kakao-skill-auth";
import { ApiError, ERRORS } from "../src/problem";
import { REQUEST_KEY_HEADER } from "../src/request-key";
import { openRoute, type RouteDecl, routeKey, type ScopeResolvers, shopRoute } from "../src/routes";
import { createShopScope, type ScopeKind } from "../src/shop-scope";
import {
  CROSS_SHOP_CASES,
  type CrossShopCase,
  type CrossShopEnv,
  registryGaps,
  runCrossShopCase,
  undeclaredRoutes,
} from "./support/cross-shop";
import { describeDb, newRequestKey, newUuid, testDb, testEnv } from "./support/db";
import { singleKeyCrypto } from "./support/field-keys";
import { createShopPair, type ShopFixture, snapshotShop } from "./support/shops";

// 교차 가게 시험 묶음(TASK-019; 04 SPEC-068 수락 기준 1·2, G1; 05 A9; 06 DEC-02).
// 실제 가게 범위 API는 아직 없어(TASK-020부터) 이 파일 안에서만 쓰는 시험용 경로(/test/…)로 묶음과 층이 일하는지 본다.

const OWNER_HEADER = "x-test-owner";
const BOT_HEADER = "x-test-bot";

/** 시험용 경로. 06의 화면·명령을 흉내 낸다(주문·상담·결제 안내의 화면과 명령, 가격표 새 버전의 원본 도안, 쿼리의 ID). */
const TEST_ROUTES: readonly RouteDecl[] = [
  shopRoute("GET", "/test/orders/:orderId", "owner", async (r) => {
    const order = await r.db.found<{ id: string; status: string }>(
      "SELECT o.id, o.status FROM orders o WHERE o.shop_id = $1 AND o.id = $2",
      [r.pathId("orderId")],
    );
    return r.json(order);
  }),
  shopRoute("POST", "/test/orders/:orderId/note", "owner", async (r) => {
    const orderId = r.pathId("orderId");
    return r.command({
      command: "TEST-ORDER-NOTE",
      pathIds: [orderId],
      body: null,
      execute: async (tx) => {
        await tx.owned("orders", orderId, { lock: true });
        await tx.run("UPDATE orders o SET version = o.version WHERE o.shop_id = $1 AND o.id = $2", [orderId]);
        return { status: 200, code: "noted", ref: { orderId }, body: { orderId } };
      },
      render: async (_db, stored) => ({ orderId: stored.ref.orderId }),
    });
  }),
  shopRoute("GET", "/test/consultations/:consultationId/messages", "owner", async (r) => {
    const consultationId = await r.db.owned("consultations", r.req.param("consultationId"));
    const messages = await r.db.run<{ id: string; body_masked: string | null }>(
      "SELECT m.id, m.body_masked FROM messages m WHERE m.shop_id = $1 AND m.consultation_id = $2 ORDER BY m.id",
      [consultationId],
    );
    return r.json({ items: messages.rows });
  }),
  shopRoute("POST", "/test/consultations/:consultationId/close", "owner", async (r) => {
    const consultationId = r.pathId("consultationId");
    return r.command({
      command: "TEST-CONSULTATION-CLOSE",
      pathIds: [consultationId],
      body: null,
      execute: async (tx) => {
        await tx.owned("consultations", consultationId, { lock: true });
        await tx.run("UPDATE consultations c SET status = c.status WHERE c.shop_id = $1 AND c.id = $2", [
          consultationId,
        ]);
        return { status: 200, code: "closed", ref: { consultationId }, body: { consultationId } };
      },
      render: async (_db, stored) => ({ consultationId: stored.ref.consultationId }),
    });
  }),
  shopRoute("GET", "/test/payment-requests/:paymentRequestId", "owner", async (r) => {
    const row = await r.db.found<{ id: string; amount: number }>(
      "SELECT p.id, p.amount FROM payment_requests p WHERE p.shop_id = $1 AND p.id = $2",
      [r.pathId("paymentRequestId")],
    );
    return r.json(row);
  }),
  shopRoute("POST", "/test/payment-requests/:paymentRequestId/reconciliation", "owner", async (r) => {
    const paymentRequestId = r.pathId("paymentRequestId");
    return r.command({
      command: "TEST-RECONCILE",
      pathIds: [paymentRequestId],
      body: null,
      execute: async (tx) => {
        await tx.owned("payment_requests", paymentRequestId, { lock: true });
        await tx.run("UPDATE payment_requests p SET version = p.version WHERE p.shop_id = $1 AND p.id = $2", [
          paymentRequestId,
        ]);
        return { status: 200, code: "reconciled", ref: { paymentRequestId }, body: { paymentRequestId } };
      },
      render: async (_db, stored) => ({ paymentRequestId: stored.ref.paymentRequestId }),
    });
  }),
  // SPEC-068 수락 기준 2(06 API-017의 designs[].sourceDesignId): 원본 도안을 다른 가게 것으로 넣으면 없는 ID와 같은 422
  shopRoute("POST", "/test/price-list/versions", "owner", async (r) => {
    const body = (await r.body()) as { designs?: { sourceDesignId?: unknown }[] } | null;
    const designs = Array.isArray(body?.designs) ? body.designs : [];
    return r.command({
      command: "TEST-PRICE-LIST-VERSION",
      pathIds: [],
      body,
      execute: async (tx) => {
        await tx.references(
          "designs",
          designs.map((d, i) => ({ field: `/designs/${i}/sourceDesignId`, id: d?.sourceDesignId })),
        );
        const current = await tx.found<{ version: number }>(
          "UPDATE price_lists p SET superseded_at = now() WHERE p.shop_id = $1 AND p.superseded_at IS NULL RETURNING p.version",
        );
        const next = await tx.found<{ id: string; version: number }>(
          "INSERT INTO price_lists (shop_id, version) VALUES ($1, $2) RETURNING id, version",
          [current.version + 1],
        );
        const copied = await tx.run(
          `INSERT INTO designs (shop_id, price_list_id, name, image_key)
           SELECT $1, $2, d.name, d.image_key FROM designs d WHERE d.shop_id = $1 AND d.id = ANY($3::uuid[])`,
          [next.id, designs.map((d) => String(d?.sourceDesignId).toLowerCase())],
        );
        return {
          status: 201,
          code: "created",
          ref: { priceListId: next.id },
          body: { version: next.version, copied: copied.rowCount },
        };
      },
      render: async (_db, stored) => ({ priceListId: stored.ref.priceListId }),
    });
  }),
  // 쿼리의 ID(06 API-049의 paymentRequestId 쿼리)
  shopRoute("GET", "/test/orders/:orderId/refund-preview", "owner", async (r) => {
    const orderId = await r.db.owned("orders", r.req.param("orderId"));
    const paymentRequestId = r.req.query("paymentRequestId");
    await r.db.references("payment_requests", [{ field: "query:paymentRequestId", id: paymentRequestId }]);
    return r.json({ orderId, paymentRequestId });
  }),
];

/**
 * 05 A9: 손님 쪽은 카카오 채널로 찾은 가게 ID로 거른다(해석기는 TASK-028, 여기는 시험용). 묶음의 부르는 쪽은 아직 사장님뿐이라
 * 이 경로는 묶음에 넣지 않고 아래 시험이 따로 앱을 만들어 본다. 카카오 스킬은 처리한 모든 경우에 200이고 다른 가게의 것은
 * 없는 것과 같은 답이므로(06 API-070, REQ-252), 손님 경로를 묶음에 넣을 때(TASK-028) 부르는 쪽과 기대를 더한다.
 */
const CUSTOMER_ROUTE = shopRoute("POST", "/test/kakao/customer", "customer", async (r) => {
  const body = (await r.body()) as { userKey?: unknown } | null;
  const row = await r.db.found<{ id: string }>(
    "SELECT c.id FROM customers c WHERE c.shop_id = $1 AND c.kakao_user_key = $2",
    [typeof body?.userKey === "string" ? body.userKey : ""],
  );
  return r.json({ customerId: row.id });
});

/** 시험용 경로의 등록. */
const TEST_CASES: readonly CrossShopCase[] = [
  {
    method: "GET",
    path: "/test/orders/:orderId",
    kind: "path",
    ownStatus: 200,
    request: (_o, t) => ({ url: `/test/orders/${t.orderId}` }),
  },
  {
    method: "POST",
    path: "/test/orders/:orderId/note",
    kind: "path",
    ownStatus: 200,
    request: (_o, t) => ({ url: `/test/orders/${t.orderId}/note` }),
  },
  {
    method: "GET",
    path: "/test/consultations/:consultationId/messages",
    kind: "path",
    ownStatus: 200,
    request: (_o, t) => ({ url: `/test/consultations/${t.consultationId}/messages` }),
  },
  {
    method: "POST",
    path: "/test/consultations/:consultationId/close",
    kind: "path",
    ownStatus: 200,
    request: (_o, t) => ({ url: `/test/consultations/${t.consultationId}/close` }),
  },
  {
    method: "GET",
    path: "/test/payment-requests/:paymentRequestId",
    kind: "path",
    ownStatus: 200,
    request: (_o, t) => ({ url: `/test/payment-requests/${t.paymentRequestId}` }),
  },
  {
    method: "POST",
    path: "/test/payment-requests/:paymentRequestId/reconciliation",
    kind: "path",
    ownStatus: 200,
    request: (_o, t) => ({ url: `/test/payment-requests/${t.paymentRequestId}/reconciliation` }),
  },
  {
    method: "POST",
    path: "/test/price-list/versions",
    kind: "reference",
    ownStatus: 201,
    request: (_o, t) => ({ url: "/test/price-list/versions", body: { designs: [{ sourceDesignId: t.designId }] } }),
  },
  {
    method: "GET",
    path: "/test/orders/:orderId/refund-preview",
    kind: "path",
    ownStatus: 200,
    request: (o, t) => ({ url: `/test/orders/${t.orderId}/refund-preview?paymentRequestId=${o.paymentRequestId}` }),
  },
  {
    method: "GET",
    path: "/test/orders/:orderId/refund-preview",
    kind: "reference",
    ownStatus: 200,
    request: (o, t) => ({ url: `/test/orders/${o.orderId}/refund-preview?paymentRequestId=${t.paymentRequestId}` }),
  },
];

/**
 * 묶음이 붙이는 경로와 부르는 사례: 앱의 선언(APP_ROUTES)·등록 목록(CROSS_SHOP_CASES)과 시험용 경로·등록.
 * 등록한 사례는 모두 부른다(앱의 등록 목록도 등록만 보고 끝나지 않음).
 */
const SUITE_ROUTES: readonly RouteDecl[] = [...APP_ROUTES, ...TEST_ROUTES];
const SUITE_CASES: readonly CrossShopCase[] = [...CROSS_SHOP_CASES, ...TEST_CASES];

/** 사례의 경로가 받는 가게 범위 출처(가게 범위 경로가 아니면 null). */
function viaOf(c: CrossShopCase): ScopeKind | null {
  const decl = SUITE_ROUTES.find((r) => r.method === c.method && r.path === c.path);
  return decl?.kind === "shop" ? decl.via : null;
}

/** 시험용 해석기: 헤더의 사장님 ID·봇 ID로 가게를 찾는다(진짜는 TASK-020 세션, TASK-028 스킬 키). */
function testScopes(shops: readonly ShopFixture[]): Partial<ScopeResolvers> {
  return {
    owner: async (c: Context<HonoEnv>) => {
      const f = shops.find((s) => s.ownerId === c.req.header(OWNER_HEADER));
      if (f === undefined) throw new ApiError("unauthenticated");
      return createShopScope(f.shopId, { kind: "owner", ownerId: f.ownerId });
    },
    customer: async (c: Context<HonoEnv>) => {
      const requestedBot = c.req.header(BOT_HEADER);
      if (requestedBot === undefined) return resolveKakaoSkillScope(c);
      const f = shops.find((s) => s.botId === requestedBot);
      if (f === undefined) throw new ApiError("skill_key_invalid");
      return createShopScope(f.shopId, { kind: "customer", channelId: f.channelId });
    },
  };
}

describeDb("교차 가게 시험 묶음(SPEC-068, G1, 06 DEC-02)", () => {
  let env: CrossShopEnv;
  const db = testDb();

  beforeAll(async () => {
    const { a, b } = await createShopPair(db);
    const { fc } = singleKeyCrypto();
    const app = createApp({ routes: SUITE_ROUTES, scopes: testScopes([a, b]), services: { fieldCrypto: fc } });
    env = { app, a, b, fieldCrypto: fc, as: (f) => ({ [OWNER_HEADER]: f.ownerId }) };
  });

  afterAll(async () => {
    await db.close();
  });

  for (const c of SUITE_CASES) {
    it(`${routeKey(c.method, c.path)} (${c.kind === "channel" ? "연결 키" : c.kind === "path" ? "경로의 ID" : "본문·쿼리의 ID"})`, async () => {
      expect(viaOf(c)).toBe(c.kind === "channel" ? "customer" : c.kind === "operator_review" ? "operator" : "owner");
      await runCrossShopCase(env, c);
    });
  }

  it("SPEC-068 수락 기준 1: 주문·상담·결제 안내 ID로 화면과 명령을 하나씩 부른 시험이 묶음에 있음", () => {
    const covered = TEST_CASES.filter((c) => c.kind === "path").map((c) => `${c.method} ${c.path.split("/")[2]}`);
    for (const resource of ["orders", "consultations", "payment-requests"]) {
      expect(covered).toContain(`GET ${resource}`);
      expect(covered).toContain(`POST ${resource}`);
    }
  });

  it("SPEC-068 수락 기준 2: 가격표 새 버전에 가게 B의 도안 ID를 원본으로 넣으면 없는 ID와 같은 입력 오류이고 B의 도안은 0건 복사됨", async () => {
    const send = (sourceDesignId: string) =>
      env.app.request(
        "/api/test/price-list/versions",
        {
          method: "POST",
          headers: {
            [OWNER_HEADER]: env.a.ownerId,
            [REQUEST_KEY_HEADER]: newRequestKey(),
            "content-type": "application/json",
          },
          body: JSON.stringify({ designs: [{ sourceDesignId }] }),
        },
        testEnv(),
      );
    const designs = async (f: ShopFixture) =>
      (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM designs WHERE shop_id = $1", [f.shopId])).rows[0]
        ?.n;
    const beforeA = await designs(env.a);
    const beforeB = await designs(env.b);
    const other = await send(env.b.designId);
    const missing = await send(newUuid());
    const otherBody = (await other.json()) as Record<string, unknown>;
    const missingBody = (await missing.json()) as Record<string, unknown>;
    expect(other.status).toBe(422);
    expect(otherBody.errors).toEqual([{ field: "/designs/0/sourceDesignId", code: "reference_not_found" }]);
    expect({ ...otherBody, traceId: "" }).toEqual({ ...missingBody, traceId: "" });
    expect(await designs(env.a)).toBe(beforeA);
    expect(await designs(env.b)).toBe(beforeB);
    // 대조: 자기 도안은 복사된다
    const own = await send(env.a.designId);
    expect(own.status).toBe(201);
    expect(await designs(env.a)).toBe((beforeA ?? 0) + 1);
    expect(await designs(env.b)).toBe(beforeB);
  });

  it("05 A9: 손님 쪽은 채널로 찾은 가게 ID로만 읽음(가게 B 손님의 사용자 키는 없는 키와 같은 404)", async () => {
    const app = createApp({ routes: [...APP_ROUTES, CUSTOMER_ROUTE], scopes: testScopes([env.a, env.b]) });
    const call = (bot: string, userKey: string) =>
      app.request(
        "/api/test/kakao/customer",
        {
          method: "POST",
          headers: { [BOT_HEADER]: bot, "content-type": "application/json" },
          body: JSON.stringify({ userKey }),
        },
        testEnv(),
      );
    const before = await snapshotShop(db, env.b);
    const other = await call(env.a.botId, env.b.userKey);
    const missing = await call(env.a.botId, `user-${newUuid()}`);
    expect(other.status).toBe(404);
    const strip = async (r: Response) => {
      const { traceId: _t, ...rest } = (await r.json()) as Record<string, unknown>;
      return rest;
    };
    expect(await strip(other)).toEqual(await strip(missing));
    expect(await snapshotShop(db, env.b)).toEqual(before);
    const own = await call(env.a.botId, env.a.userKey);
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual({ customerId: env.a.customerId });
    const mine = await call(env.b.botId, env.b.userKey);
    expect(await mine.json()).toEqual({ customerId: env.b.customerId });
  });

  it("묶음이 새는 경로를 잡음: 날 연결로 가게 조건 없이 읽는 경로(가게 범위가 아니라고 선언)", async () => {
    const leaky = openRoute("GET", "/test/leaky/orders/:orderId", "시험: 가게 조건을 빠뜨린 경로", async (c) => {
      const r = await c
        .get("db")
        .query<{ id: string }>("SELECT o.id FROM orders o WHERE o.id = $1", [c.req.param("orderId")]);
      if (r.rows[0] === undefined) throw new ApiError("not_found");
      return c.json(r.rows[0]);
    });
    const app = createApp({ routes: [...APP_ROUTES, leaky], scopes: testScopes([env.a, env.b]) });
    const leakyCase: CrossShopCase = {
      method: "GET",
      path: "/test/leaky/orders/:orderId",
      kind: "path",
      ownStatus: 200,
      request: (_o, t) => ({ url: `/test/leaky/orders/${t.orderId}` }),
    };
    await expect(runCrossShopCase({ ...env, app }, leakyCase)).rejects.toThrow();
    // 가게 범위가 아니라고 선언해 묶음을 피해도, 그 SQL은 정적 시험(shop-scope-static)이 잡는다(서버 코드라면).
  });

  it("묶음이 새는 경로를 잡음: 가게 범위 연결에 가게 조건 없는 SQL을 보내면 보내지 않고 500", async () => {
    const unscoped = shopRoute("GET", "/test/unscoped/orders/:orderId", "owner", async (r) => {
      const row = await r.db.found("SELECT o.id FROM orders o WHERE o.id = $2", [r.pathId("orderId")]);
      return r.json(row);
    });
    const app = createApp({ routes: [...APP_ROUTES, unscoped], scopes: testScopes([env.a, env.b]) });
    const res = await app.request(
      `/api/test/unscoped/orders/${env.b.orderId}`,
      { headers: { [OWNER_HEADER]: env.a.ownerId } },
      testEnv(),
    );
    expect(res.status).toBe(500);
    expect(((await res.json()) as { code: string }).code).toBe("internal");
    await expect(
      runCrossShopCase(
        { ...env, app },
        {
          method: "GET",
          path: "/test/unscoped/orders/:orderId",
          kind: "path",
          ownStatus: 200,
          request: (_o, t) => ({ url: `/test/unscoped/orders/${t.orderId}` }),
        },
      ),
    ).rejects.toThrow();
  });

  it("G1: 가게 범위 경로는 해석기가 없으면 닫혀 있음(사장님 401, 손님 401, 예약 링크 404)", async () => {
    const make = (via: ScopeKind) =>
      shopRoute("GET", `/test/closed/${via}`, via, async (r) => r.json({ shopId: r.scope.shopId }));
    const app = createApp({ routes: (["owner", "operator", "customer", "public"] as const).map(make) });
    const status = async (via: string) => (await app.request(`/api/test/closed/${via}`, {}, testEnv())).status;
    expect(await status("owner")).toBe(401);
    expect(await status("operator")).toBe(401);
    expect(await status("customer")).toBe(401);
    expect(await status("public")).toBe(404);
  });

  it("G1: 다른 출처의 가게 범위나 흉내 낸 가게 범위는 받지 않음(500)", async () => {
    const route = shopRoute("GET", "/test/scope", "owner", async (r) => r.json({ shopId: r.scope.shopId }));
    const wrongKind = createApp({
      routes: [route],
      scopes: { owner: async () => createShopScope(env.a.shopId, { kind: "customer", channelId: env.a.channelId }) },
    });
    expect((await wrongKind.request("/api/test/scope", {}, testEnv())).status).toBe(500);
    const forged = createApp({
      routes: [route],
      scopes: {
        owner: async () => ({ shopId: env.a.shopId, via: { kind: "owner", ownerId: env.a.ownerId } }) as never,
      },
    });
    expect((await forged.request("/api/test/scope", {}, testEnv())).status).toBe(500);
  });
});

describe("교차 가게 시험 묶음의 등록(새 가게 범위 API가 빠지면 실패)", () => {
  it("앱의 가게 범위 경로가 모두 등록됨", () => {
    const gaps = registryGaps(APP_ROUTES, CROSS_SHOP_CASES);
    expect(gaps.missing).toEqual([]);
    expect(gaps.stale).toEqual([]);
  });

  it("라우터의 경로가 모두 선언으로 붙음(선언 없이 붙인 경로 없음)", () => {
    expect(undeclaredRoutes(createApp(), APP_ROUTES)).toEqual([]);
  });

  it("시험용 경로도 모두 등록됨", () => {
    const gaps = registryGaps([...APP_ROUTES, ...TEST_ROUTES], [...CROSS_SHOP_CASES, ...TEST_CASES]);
    expect(gaps).toEqual({ missing: [], stale: [] });
  });

  // Codex 검토(PR #61): 앱의 등록 목록은 등록만 보고 부르지 않았음(묶음은 시험용 사례만 불렀음)
  it("앱의 등록 목록도 묶음이 부름(등록만 하고 부르지 않는 사례 없음), 묶음의 앱은 앱의 선언을 모두 붙임", () => {
    for (const c of [...CROSS_SHOP_CASES, ...TEST_CASES]) expect(SUITE_CASES).toContain(c);
    for (const r of APP_ROUTES) expect(SUITE_ROUTES).toContain(r);
    expect(registryGaps(SUITE_ROUTES, SUITE_CASES)).toEqual({ missing: [], stale: [] });
  });

  it("등록하지 않은 가게 범위 경로를 잡음", () => {
    const added = shopRoute("GET", "/owner/new-things/:thingId", "owner", async (r) => r.json({}));
    expect(registryGaps([...APP_ROUTES, added], CROSS_SHOP_CASES).missing).toEqual(["GET /owner/new-things/:thingId"]);
  });

  it("선언이 없어진 등록을 잡음", () => {
    expect(registryGaps(APP_ROUTES, TEST_CASES).stale.length).toBeGreaterThan(0);
  });

  it("선언 없이 라우터에 붙인 경로를 잡음", () => {
    const app = createApp();
    app.get("/owner/sneaky/:id", (c) => c.json({}));
    expect(undeclaredRoutes(app, APP_ROUTES)).toEqual(["GET /api/owner/sneaky/:id"]);
  });

  it("같은 경로를 두 번 선언하면 앱을 만들지 않음", () => {
    expect(() => createApp({ routes: [...APP_ROUTES, ...APP_ROUTES] })).toThrow(TypeError);
  });
});

// 06 계약에서 어느 API가 가게 범위 경로여야 하는지(새 API를 선언할 때 출처를 틀리게 고르면 실패)
type Operation = { operationId: string; security?: Record<string, unknown>[]; "x-corthex"?: { id?: string } };
const contract = parse(readFileSync(new URL("../../../api/openapi.yaml", import.meta.url), "utf8")) as {
  paths: Record<string, Record<string, Operation>>;
};
/** 사장님 세션은 있지만 가게가 정해지기 전이거나 가게 기록이 아닌 API: 로그인·로그아웃·내 정보·사진 올리기·가게 등록. */
const OWNER_LEVEL = new Set(["API-001", "API-002", "API-003", "API-007", "API-008", "API-078"]);

function requiredScope(path: string, op: Operation): ScopeKind | null {
  const schemes = new Set((op.security ?? []).flatMap((s) => Object.keys(s)));
  const id = op["x-corthex"]?.id ?? "";
  if (path.startsWith("/public/shops/{slug}")) return "public";
  if (schemes.has("kakaoSkillKey")) return "customer";
  if (schemes.has("operatorSession") && path.includes("{shopId}")) return "operator";
  if (schemes.has("ownerSession") && !OWNER_LEVEL.has(id)) return "owner";
  return null;
}

describe("06 계약과 가게 범위 경로", () => {
  const operations = Object.entries(contract.paths).flatMap(([path, ops]) =>
    Object.entries(ops)
      .filter(([m]) => ["get", "post", "put", "patch", "delete"].includes(m))
      .map(([m, op]) => ({ method: m.toUpperCase(), path, op })),
  );

  it("사장님 쪽 API 가운데 가게 범위 밖으로 둔 것은 정한 여섯뿐이고 모두 계약에 있음", () => {
    const ids = new Set(operations.map((o) => o.op["x-corthex"]?.id));
    for (const id of OWNER_LEVEL) expect(ids.has(id)).toBe(true);
    const counts: Record<string, number> = {};
    for (const o of operations) {
      const k = requiredScope(o.path, o.op) ?? "none";
      counts[k] = (counts[k] ?? 0) + 1;
    }
    // 가게 범위여야 하는 계약 API 수(구현하며 교차 가게 시험 묶음에 들어갈 것): 사장님·손님·운영자·예약 링크
    expect(counts.owner).toBeGreaterThan(50);
    expect(counts.customer).toBe(4);
    expect(counts.operator).toBe(6);
    expect(counts.public).toBe(2);
  });

  it("구현한 계약 API는 계약이 정한 출처의 가게 범위 경로로 선언됨", () => {
    for (const decl of APP_ROUTES) {
      const hit = operations.find(
        (o) => o.method === decl.method && o.path.replace(/\{([A-Za-z]+)\}/g, ":$1") === decl.path,
      );
      if (hit === undefined) continue;
      const need = requiredScope(hit.path, hit.op);
      if (need === null) continue;
      expect(decl.kind, routeKey(decl.method, decl.path)).toBe("shop");
      if (decl.kind === "shop") expect(decl.via, routeKey(decl.method, decl.path)).toBe(need);
    }
  });

  it("구현한 사장님 범위 계약 API(가게가 정해지기 전에도 여는 것)는 사장님 범위 경로로 선언됨(TASK-022부터)", () => {
    const declared: string[] = [];
    for (const decl of APP_ROUTES) {
      const hit = operations.find(
        (o) => o.method === decl.method && o.path.replace(/\{([A-Za-z]+)\}/g, ":$1") === decl.path,
      );
      const id = hit?.op["x-corthex"]?.id ?? "";
      if (hit === undefined || !OWNER_LEVEL.has(id)) continue;
      const schemes = (hit.op.security ?? []).flatMap((s) => Object.keys(s));
      if (!schemes.includes("ownerSession")) continue;
      if (id === "API-003") {
        // 로그아웃은 세션이 없어도 204이므로 세션 표만 다루는 공개 처리기로 선언한다.
        expect(decl.kind).toBe("open");
        expect(hit.op.security).toContainEqual({});
        continue;
      }
      expect(decl.kind, routeKey(decl.method, decl.path)).toBe("owner");
      declared.push(id);
    }
    expect(declared).toContain("API-007");
  });

  it("G1·06 DEC-02: 403 코드가 없음(다른 가게 ID는 404, 남의 기록 ID는 422)", () => {
    expect(Object.values(ERRORS).map((e): number => e.status)).not.toContain(403);
  });
});
