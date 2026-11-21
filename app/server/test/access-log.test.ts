import { readFileSync } from "node:fs";
import type { Context } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ACCESS_LOG_APIS,
  type AccessContext,
  type AccessEntry,
  AccessLogError,
  accessRow,
  clientIp,
} from "../src/access-log";
import { APP_ROUTES, createApp, type HonoEnv } from "../src/app";
import { JOBS } from "../src/jobs";
import { maskValue, openMaskedValue } from "../src/masked-values";
import { ApiError, fieldError } from "../src/problem";
import { REPLAYED_HEADER, REQUEST_KEY_HEADER } from "../src/request-key";
import { accessRoute, type RouteDecl, type ScopeResolvers, shopRoute } from "../src/routes";
import { createShopScope, type ShopDb, shopRequestDb } from "../src/shop-scope";
import {
  accessLogCount,
  accessRegistryGaps,
  CLIENT_IP_HEADER,
  contractAccessApis,
  contractOperations,
  expectFailClosed,
  expectOneAccessRow,
  failingAccessInsert,
  TEST_IPV4,
  TEST_IPV6,
} from "./support/access-log";
import { collectLogs, describeDb, newRequestKey, newUuid, testDb, testEnv } from "./support/db";
import { randomDigits, singleKeyCrypto } from "./support/field-keys";
import { createShopPair, type ShopFixture } from "./support/shops";
import { serverSources } from "./support/source-scan";

// 접속기록 남기기(TASK-024; 04 SPEC-074 수락 기준 #1~#3, 05 앱 규칙 A24·E21·TBL-053, 06 README 5절 '접속기록', REQ-196).
// 06의 접속기록 API(사장님 API-040~066, 운영자 API-074~077)는 아직 하나도 없어(뒤 TASK가 만듦), 이 파일 안에서만 붙이는
// 시험용 경로(/test/access/…, APP_ROUTES에 없고 운영 빌드에 없음)로 도구와 경로 선언이 일하는지 본다.

const OWNER_HEADER = "x-test-owner";
const OPERATOR_HEADER = "x-test-operator";
/** 시험 자료(support/shops.ts)의 주문자 이름·연락처: 성공 응답에만 있고 접속기록·로그·오류 응답에는 없어야 함. */
const FIXTURE_PII = ["시험손님", "010-0000-0000"];

const { fc } = singleKeyCrypto();

/** 이 트랜잭션의 now()(마이크로초 글). 접속기록의 accessed_at(기본 now())과 같으면 같은 트랜잭션이다. */
const NOW_US = "(extract(epoch FROM now()) * 1000000)::bigint::text";

async function friendCheck(tx: ShopDb, customerIdRaw: string | undefined) {
  const customerId = await tx.owned("customers", customerIdRaw, { lock: true });
  const row = await tx.found<{ at: string; now_us: string }>(
    `UPDATE customers c SET friend_checked_at = clock_timestamp() WHERE c.shop_id = $1 AND c.id = $2
     RETURNING c.friend_checked_at::text AS at, ${NOW_US} AS now_us`,
    [customerId],
  );
  return { customerId, ...row };
}

/** 운영자 원래 값 열기(06 API-077 꼴): 대화 속 번호 하나. 원래 값을 두지 않는 번호(카드번호)는 409 original_not_kept. */
async function openOriginal(tx: ShopDb, targetId: unknown, reason: string) {
  const target = await tx.found<{
    id: string;
    consultation_id: string;
    placeholder: string;
    customer_id: string;
    kept: boolean;
    now_us: string;
  }>(
    `SELECT m.id, m.consultation_id, m.placeholder, c.customer_id, m.original_enc IS NOT NULL AS kept, ${NOW_US} AS now_us
       FROM masked_values m JOIN consultations c ON c.shop_id = m.shop_id AND c.id = m.consultation_id
      WHERE m.shop_id = $1 AND m.id = $2`,
    [typeof targetId === "string" ? targetId.toLowerCase() : null],
  );
  if (!target.kept) throw new ApiError("original_not_kept");
  const opened = await openMaskedValue(tx, fc, target.consultation_id, target.placeholder);
  const access: AccessEntry = {
    action: "open_original",
    subjects: [target.customer_id],
    target: { kind: "masked_value", id: target.id },
    reason,
  };
  return {
    body: { targetKind: "masked_value", targetId: target.id, value: opened.original, at: target.now_us },
    access,
  };
}

function reasonOf(body: unknown): string {
  const reason = (body as { reason?: unknown } | null)?.reason;
  if (typeof reason !== "string") throw fieldError("/reason", "required");
  const n = [...reason].length;
  if (n < 5) throw fieldError("/reason", "too_short");
  if (n > 200) throw fieldError("/reason", "too_long");
  return reason;
}

/** 시험용 경로(06의 꼴을 흉내 냄). APP_ROUTES에 넣지 않는다. */
const ACCESS_ROUTES: readonly RouteDecl[] = [
  // SPEC-074 #1: 사장님 주문 상세(06 API-045 꼴). 주문자 이름·연락처를 돌려주고 그 손님 ID를 접속기록에 읽음으로.
  accessRoute("GET", "/test/access/owner/orders/:orderId", "owner", "API-045", (r) =>
    r.read(async (tx) => {
      const orderId = await tx.owned("orders", r.req.param("orderId"));
      const o = await tx.found<{ customer_id: string; customer_name: string; customer_phone: string; now_us: string }>(
        `SELECT o.customer_id, d.customer_name, d.customer_phone, ${NOW_US} AS now_us
           FROM orders o JOIN order_details d ON d.shop_id = o.shop_id AND d.order_id = o.id
          WHERE o.shop_id = $1 AND o.id = $2 ORDER BY d.version DESC LIMIT 1`,
        [orderId],
      );
      return {
        body: { orderId, customerName: o.customer_name, customerPhone: o.customer_phone, at: o.now_us },
        subjects: [o.customer_id],
      };
    }),
  ),
  // 목록 꼴(06 API-044): 고른 날의 주문이 없어도(빈 목록) 요청마다 한 행.
  accessRoute("GET", "/test/access/owner/orders", "owner", "API-044", (r) =>
    r.read(async (tx) => {
      const day = r.req.query("day") ?? "";
      const rows = await tx.run<{ id: string; customer_id: string }>(
        "SELECT o.id, o.customer_id FROM orders o WHERE o.shop_id = $1 AND o.pickup_day::text = $2 ORDER BY o.id",
        [day],
      );
      return {
        body: { items: rows.rows.map((o) => ({ orderId: o.id })) },
        subjects: rows.rows.map((o) => o.customer_id),
      };
    }),
  ),
  // 쓰기 명령(06 API-046 꼴): 손님 기록 하나를 바꾸고 바꿈으로. 다시 온 요청은 다시 읽어 돌려주므로 읽음으로.
  accessRoute("POST", "/test/access/owner/customers/:customerId/friend-check", "owner", "API-046", async (r) => {
    const body = (await r.body()) as { refuse?: boolean } | null;
    return r.command({
      pathIds: [r.pathId("customerId")],
      body,
      execute: async (tx) => {
        const done = await friendCheck(tx, r.req.param("customerId"));
        if (body?.refuse === true) throw new ApiError("invalid_state");
        return {
          result: {
            status: 200,
            code: "checked",
            ref: { customerId: done.customerId },
            body: { customerId: done.customerId, checkedAt: done.at, at: done.now_us },
          },
          access: { action: "change", subjects: [done.customerId] },
        };
      },
      render: async (db, stored) => {
        const customerId = String(stored.ref.customerId);
        const row = await db.found<{ at: string; now_us: string }>(
          `SELECT c.friend_checked_at::text AS at, ${NOW_US} AS now_us FROM customers c WHERE c.shop_id = $1 AND c.id = $2`,
          [customerId],
        );
        return {
          body: { customerId, checkedAt: row.at, at: row.now_us },
          access: { action: "read", subjects: [customerId] },
        };
      },
    });
  }),
  // 잘못 쓴 처리기들(코드의 잘못이 500으로 닫히는지): 사장님이 여는 행, 다시 온 요청을 바꿈으로, 두 번 읽기, 남기지 않고 200.
  accessRoute("POST", "/test/access/owner/customers/:customerId/peek", "owner", "API-047", async (r) =>
    r.command({
      pathIds: [r.pathId("customerId")],
      body: null,
      execute: async (tx) => {
        const done = await friendCheck(tx, r.req.param("customerId"));
        return {
          result: { status: 200, code: "opened", ref: { customerId: done.customerId }, body: { at: done.at } },
          access: {
            action: "open_original",
            subjects: [done.customerId],
            target: { kind: "order_contact", id: done.customerId },
            reason: "사장님이 열어 봄",
          },
        };
      },
      render: async () => ({ body: {}, access: { action: "read", subjects: [] } }),
    }),
  ),
  accessRoute("POST", "/test/access/owner/customers/:customerId/replay-change", "owner", "API-048", async (r) =>
    r.command({
      pathIds: [r.pathId("customerId")],
      body: null,
      execute: async (tx) => {
        const done = await friendCheck(tx, r.req.param("customerId"));
        return {
          result: { status: 200, code: "checked", ref: { customerId: done.customerId }, body: {} },
          access: { action: "change", subjects: [done.customerId] },
        };
      },
      render: async (_db, stored) => ({
        body: {},
        access: { action: "change", subjects: [String(stored.ref.customerId)] },
      }),
    }),
  ),
  accessRoute("GET", "/test/access/owner/orders/:orderId/twice", "owner", "API-049", async (r) => {
    const once = (tx: ShopDb) =>
      tx.owned("orders", r.req.param("orderId")).then((orderId) => ({ body: { orderId }, subjects: [] }));
    await r.read(once);
    return r.read(once);
  }),
  accessRoute("GET", "/test/access/owner/silent", "owner", "API-040", async () =>
    Response.json({ ok: true }, { status: 200 }),
  ),
  // 운영자 원래 값 열기(06 API-077 꼴, 요청 키). 다시 온 요청은 다시 열고 한 행 더(06 README 625행).
  accessRoute("POST", "/test/access/operator/shops/:shopId/originals", "operator", "API-077", async (r) => {
    const body = (await r.body()) as { targetId?: unknown } | null;
    const reason = reasonOf(body);
    return r.command({
      pathIds: [r.pathId("shopId")],
      body,
      execute: async (tx) => {
        const out = await openOriginal(tx, body?.targetId, reason);
        return {
          result: { status: 200, code: "opened", ref: { targetId: out.body.targetId }, body: out.body },
          access: out.access,
        };
      },
      render: (db, stored) => openOriginal(db, stored.ref.targetId, reason),
    });
  }),
  // SPEC-074 #3: 가격표(손님 개인정보가 없는 가게 설정)는 접속기록 경로가 아님(06 API-017 꼴의 새 버전, API-016 꼴의 읽기).
  shopRoute("POST", "/test/access/owner/price-list/versions", "owner", async (r) =>
    r.command({
      command: "TEST-ACCESS-PRICE-LIST",
      pathIds: [],
      body: null,
      execute: async (tx) => {
        const current = await tx.found<{ version: number }>(
          "UPDATE price_lists p SET superseded_at = now() WHERE p.shop_id = $1 AND p.superseded_at IS NULL RETURNING p.version",
        );
        const next = await tx.found<{ id: string; version: number }>(
          "INSERT INTO price_lists (shop_id, version) VALUES ($1, $2) RETURNING id, version",
          [current.version + 1],
        );
        return { status: 201, code: "created", ref: { priceListId: next.id }, body: { version: next.version } };
      },
      render: async (_db, stored) => ({ priceListId: stored.ref.priceListId }),
    }),
  ),
  shopRoute("GET", "/test/access/owner/price-list", "owner", async (r) => {
    const p = await r.db.found<{ version: number }>(
      "SELECT p.version FROM price_lists p WHERE p.shop_id = $1 AND p.superseded_at IS NULL",
    );
    return r.json({ version: p.version });
  }),
];

/** 시험용 해석기: 헤더의 사장님 ID로 가게를, 운영자 ID와 경로의 가게 ID로 운영자 범위를(진짜는 TASK-020·021). */
function testScopes(shops: readonly ShopFixture[], operatorId: () => string): Partial<ScopeResolvers> {
  return {
    owner: async (c: Context<HonoEnv>) => {
      const f = shops.find((s) => s.ownerId === c.req.header(OWNER_HEADER));
      if (f === undefined) throw new ApiError("unauthenticated");
      return createShopScope(f.shopId, { kind: "owner", ownerId: f.ownerId });
    },
    operator: async (c: Context<HonoEnv>) => {
      if (c.req.header(OPERATOR_HEADER) !== operatorId()) throw new ApiError("unauthenticated");
      const f = shops.find((s) => s.shopId === c.req.param("shopId"));
      if (f === undefined) throw new ApiError("not_found");
      return createShopScope(f.shopId, { kind: "operator", operatorId: operatorId() });
    },
  };
}

const ctx = (over: Partial<AccessContext> = {}): AccessContext => ({
  actor: { kind: "owner", id: "0b3f8f9e-6f0c-4a52-9a43-1f2d1b7c0a11" },
  api: "API-045",
  path: "/api/owner/orders/7c2f3e0a-1b2c-4d5e-8f90-a1b2c3d4e5f6",
  clientIp: TEST_IPV4,
  ...over,
});
const OPERATOR = { kind: "operator", id: "5d8e2c1a-3b4f-4e6a-9c7d-0e1f2a3b4c5d" } as const;
const SUBJECT = "c0ffee00-1234-4abc-8def-0123456789ab";

function failure(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof AccessLogError) return e.failure;
    throw e;
  }
  return "none";
}

describe("06과 같은 접속기록 API 목록(SPEC-074)", () => {
  const operations = contractOperations();

  it("06 components.x-corthex.jobs의 SPEC-074 범위(API-040~066, API-074~077)와 ACCESS_LOG_APIS가 같음", () => {
    const fromContract = contractAccessApis();
    expect(fromContract.length).toBe(31);
    expect([...ACCESS_LOG_APIS.keys()].sort()).toEqual([...fromContract].sort());
  });

  it("06 README 5절 '접속기록'도 같은 범위를 적음", () => {
    const readme = readFileSync(new URL("../../../docs/06-api/README.md", import.meta.url), "utf8");
    const line = readme.split("\n").find((l) => l.startsWith("- **접속기록**(SPEC-074"));
    expect(line).toBeDefined();
    expect(line).toContain("API-040~066");
    expect(line).toContain("API-074~077");
  });

  it("목록의 API는 모두 06에 있고 부르는 쪽(사장님·운영자 세션)이 06과 같음, SPEC-074를 적은 06 API는 모두 목록에 있음", () => {
    for (const [id, via] of ACCESS_LOG_APIS) {
      const op = operations.find((o) => o.id === id);
      expect(op, id).toBeDefined();
      expect(op?.schemes, id).toEqual([via === "owner" ? "ownerSession" : "operatorSession"]);
    }
    const tagged = operations.filter((o) => o.spec.includes("SPEC-074")).map((o) => o.id);
    expect(tagged.length).toBeGreaterThan(0);
    for (const id of tagged) expect(ACCESS_LOG_APIS.has(id), id).toBe(true);
  });

  it("앱의 선언이 06과 맞음(06의 접속기록 API는 accessRoute로, API 번호는 06의 방법·경로와 같음)", () => {
    expect(accessRegistryGaps(APP_ROUTES)).toEqual([]);
  });

  it("선언 검사가 어긋남을 찾음: 접속기록 API를 일반 가게 범위 경로로, 다른 API 번호로, 06에 없는 경로로", () => {
    const plain = shopRoute("GET", "/owner/orders/:orderId", "owner", async (r) => r.json({}));
    const wrongId = accessRoute("GET", "/owner/orders/:orderId", "owner", "API-044", async (r) =>
      r.read(async () => ({ body: {}, subjects: [] })),
    );
    const notIn06 = accessRoute("GET", "/owner/nowhere", "owner", "API-045", async (r) =>
      r.read(async () => ({ body: {}, subjects: [] })),
    );
    const ok = accessRoute("GET", "/owner/orders/:orderId", "owner", "API-045", async (r) =>
      r.read(async () => ({ body: {}, subjects: [] })),
    );
    expect(accessRegistryGaps([plain])).toEqual([
      'GET /owner/orders/:orderId: 06 API-045 leaves an access log, declare it with accessRoute(…, "API-045", …)',
    ]);
    expect(accessRegistryGaps([wrongId])).toEqual([
      'GET /owner/orders/:orderId: 06 API-045 leaves an access log, declare it with accessRoute(…, "API-045", …)',
    ]);
    expect(accessRegistryGaps([notIn06])).toEqual(["GET /owner/nowhere: accessRoute API-045 is not a 06 operation"]);
    expect(accessRegistryGaps([ok])).toEqual([]);
  });

  it("accessRoute는 목록 밖 API·사장님·운영자가 아닌 출처·06과 다른 출처를 받지 않음", () => {
    const h = async () => new Response(null, { status: 204 });
    expect(() => accessRoute("GET", "/owner/x", "owner", "API-016", h)).toThrow(TypeError);
    expect(() => accessRoute("GET", "/owner/x", "owner", "api-045", h)).toThrow(TypeError);
    expect(() => accessRoute("GET", "/x", "customer" as "owner", "API-045", h)).toThrow(TypeError);
    expect(() => accessRoute("GET", "/x", "public" as "owner", "API-045", h)).toThrow(TypeError);
    expect(() => accessRoute("POST", "/x", "owner", "API-077", h)).toThrow(TypeError);
    expect(() => accessRoute("GET", "/x", "operator", "API-045", h)).toThrow(TypeError);
    expect(accessRoute("GET", "/x", "operator", "API-076", h)).toMatchObject({ kind: "shop", access: "API-076" });
  });

  it("jobs.ts의 SPEC-074 항목은 요청 안의 일로 이 TASK의 도구를 가리킴", () => {
    const job = JOBS.find((j) => j.spec === "SPEC-074");
    expect(job).toMatchObject({ name: "access_log", task: "TASK-024", runs: { every: "request" }, sources: [] });
    expect(job?.note).toContain("accessRoute");
  });
});

describe("어디서: CF-Connecting-IP만 믿음", () => {
  const h = (entries: Record<string, string>) => new Headers(entries);

  it("Cloudflare가 넣는 CF-Connecting-IP의 IPv4·IPv6를 받음", () => {
    expect(clientIp(h({ "CF-Connecting-IP": TEST_IPV4 }))).toBe(TEST_IPV4);
    expect(clientIp(h({ [CLIENT_IP_HEADER]: TEST_IPV6 }))).toBe(TEST_IPV6);
    for (const ok of [
      "::1",
      "2001:db8:0:0:0:0:2:1",
      "::ffff:198.51.100.7",
      "fe80::1:2:3:4",
      "0.0.0.0",
      "255.255.255.255",
    ]) {
      expect(clientIp(h({ [CLIENT_IP_HEADER]: ok })), ok).toBe(ok);
    }
  });

  it("X-Forwarded-For·X-Real-IP·True-Client-IP는 보지 않음: CF-Connecting-IP가 없으면 닫힘", () => {
    expect(failure(() => clientIp(h({})))).toBe("client_ip_missing");
    expect(failure(() => clientIp(h({ [CLIENT_IP_HEADER]: "" })))).toBe("client_ip_missing");
    expect(failure(() => clientIp(h({ "X-Forwarded-For": TEST_IPV4 })))).toBe("client_ip_missing");
    expect(failure(() => clientIp(h({ "X-Real-IP": TEST_IPV4, "True-Client-IP": TEST_IPV4 })))).toBe(
      "client_ip_missing",
    );
    expect(clientIp(h({ [CLIENT_IP_HEADER]: TEST_IPV4, "X-Forwarded-For": "198.51.100.9" }))).toBe(TEST_IPV4);
  });

  it("IP 꼴이 아니면 닫힘(여러 값, 포트, 범위 밖 숫자, 05 CHECK 밖 글자, 46자 넘음)", () => {
    for (const bad of [
      "203.0.113.24, 198.51.100.9",
      "203.0.113.24:443",
      "[2001:db8::24]",
      "256.1.1.1",
      "1.2.3",
      "01.2.3.4",
      "1.2.3.4.5",
      "2001:db8::24::1",
      "1:2:3:4:5:6:7:8:9",
      "1.2.3.4::",
      ":1:2:3:4:5:6:7",
      "fe80::1%eth0",
      "localhost",
      "010-1234-5678",
      `${"1:".repeat(22)}1`,
    ]) {
      expect(
        failure(() => clientIp(h({ [CLIENT_IP_HEADER]: bad }))),
        bad,
      ).toBe("client_ip_invalid");
    }
  });
});

describe("무엇을: 05 CHECK를 넣기 전에 도구가 봄", () => {
  it("읽음·바꿈: 손님 ID만(소문자·겹침 없앰), 빈 목록도 한 행, 대상·사유 없음", () => {
    const row = accessRow(ctx(), { action: "read", subjects: [SUBJECT.toUpperCase(), SUBJECT] });
    expect(row).toEqual({
      actorKind: "owner",
      ownerId: ctx().actor.id,
      operatorId: null,
      action: "read",
      apiId: "API-045",
      requestPath: ctx().path,
      subjectIds: [SUBJECT],
      targetKind: null,
      targetId: null,
      reason: null,
      clientIp: TEST_IPV4,
    });
    expect(accessRow(ctx(), { action: "change", subjects: [] }).subjectIds).toEqual([]);
    expect(accessRow(ctx({ actor: OPERATOR, api: "API-076" }), { action: "read", subjects: [] })).toMatchObject({
      actorKind: "operator",
      ownerId: null,
      operatorId: OPERATOR.id,
    });
  });

  it("열기는 운영자만, 사유 5~200자(글자 수는 PostgreSQL char_length처럼), 대상 ID는 uuid", () => {
    const open = (over: Partial<{ reason: string; id: string }> = {}): AccessEntry => ({
      action: "open_original",
      subjects: [SUBJECT],
      target: { kind: "masked_value", id: over.id ?? SUBJECT },
      reason: over.reason ?? "손님 연락이 필요함",
    });
    const op = ctx({ actor: OPERATOR, api: "API-077" });
    expect(accessRow(op, open())).toMatchObject({
      targetKind: "masked_value",
      targetId: SUBJECT,
      reason: "손님 연락이 필요함",
    });
    expect(failure(() => accessRow(ctx({ api: "API-077" }), open()))).toBe("open_by_owner");
    expect(failure(() => accessRow(op, open({ reason: "네글자임" })))).toBe("reason_invalid");
    expect(failure(() => accessRow(op, open({ reason: "     " })))).toBe("reason_invalid");
    expect(failure(() => accessRow(op, open({ reason: "가".repeat(201) })))).toBe("reason_invalid");
    expect(accessRow(op, open({ reason: "가".repeat(200) })).reason).toHaveLength(200);
    expect(accessRow(op, open({ reason: "🎂".repeat(200) })).reason).toBe("🎂".repeat(200));
    expect(failure(() => accessRow(op, open({ reason: "🎂".repeat(201) })))).toBe("reason_invalid");
    expect(failure(() => accessRow(op, open({ id: "not-a-uuid" })))).toBe("target_invalid");
  });

  it("보관 기록은 보관 기록 열기로만, 보관 기록 열기는 보관 기록만(05 access_logs_target_chk)", () => {
    const op = ctx({ actor: OPERATOR, api: "API-077" });
    const kept = { action: "open_kept", subjects: [], reason: "분쟁 기록 확인 요청" } as const;
    expect(accessRow(op, { ...kept, target: { kind: "kept_record", id: SUBJECT } })).toMatchObject({
      action: "open_kept",
      targetKind: "kept_record",
    });
    expect(
      failure(() =>
        accessRow(op, { ...kept, target: { kind: "masked_value", id: SUBJECT } } as unknown as AccessEntry),
      ),
    ).toBe("target_invalid");
    expect(
      failure(() =>
        accessRow(op, {
          action: "open_original",
          subjects: [],
          reason: "분쟁 기록 확인 요청",
          target: { kind: "kept_record", id: SUBJECT },
        } as unknown as AccessEntry),
      ),
    ).toBe("target_invalid");
  });

  it("읽음·바꿈에 대상·사유를 붙이거나, 모르는 행동, uuid가 아닌 손님 ID, 손님 ID 목록이 아님은 닫힘", () => {
    const withTarget = { action: "read", subjects: [], reason: "열지 않음인데 사유" } as unknown as AccessEntry;
    expect(failure(() => accessRow(ctx(), withTarget))).toBe("entry_invalid");
    expect(failure(() => accessRow(ctx(), { action: "delete", subjects: [] } as unknown as AccessEntry))).toBe(
      "entry_invalid",
    );
    expect(failure(() => accessRow(ctx(), { action: "read", subjects: ["손님 이름"] }))).toBe("subject_invalid");
    expect(failure(() => accessRow(ctx(), { action: "read", subjects: "x" } as unknown as AccessEntry))).toBe(
      "subject_invalid",
    );
  });

  it("경로는 쿼리 없이 1~300자, API 번호는 목록 안, 누가는 uuid(05 컬럼 CHECK)", () => {
    const read: AccessEntry = { action: "read", subjects: [] };
    expect(failure(() => accessRow(ctx({ path: "/api/owner/orders?phone=010" }), read))).toBe("path_invalid");
    expect(failure(() => accessRow(ctx({ path: "/api/owner/orders#x" }), read))).toBe("path_invalid");
    expect(failure(() => accessRow(ctx({ path: "" }), read))).toBe("path_invalid");
    expect(failure(() => accessRow(ctx({ path: `/${"a".repeat(300)}` }), read))).toBe("path_invalid");
    expect(accessRow(ctx({ path: `/${"a".repeat(299)}` }), read).requestPath).toHaveLength(300);
    expect(failure(() => accessRow(ctx({ api: "API-016" }), read))).toBe("api_invalid");
    expect(failure(() => accessRow(ctx({ actor: { kind: "owner", id: "owner-1" } }), read))).toBe("actor_invalid");
    expect(failure(() => accessRow(ctx({ clientIp: "1.2.3" }), read))).toBe("client_ip_invalid");
  });
});

describe("정적 검사: 접속기록을 넣는 곳과 시험용 경로", () => {
  const sources = serverSources(new URL("../src/", import.meta.url));

  it("접속기록을 넣는 SQL은 access-log.ts에만, 넣는 도구는 routes.ts만 가져다 씀", () => {
    const inserts = sources.filter((s) => /INSERT\s+INTO\s+access_logs\b/i.test(s.text)).map((s) => s.name);
    expect(inserts).toEqual(["access-log.ts"]);
    const users = sources
      .filter((s) => /import[^;]*\bAccessRecorder\b[^;]*from\s+["']\.\/access-log["']/.test(s.text))
      .map((s) => s.name);
    expect(users).toEqual(["routes.ts"]);
    const other = sources.filter((s) => /\b(access_logs)\b/.test(s.text)).map((s) => s.name);
    // TASK-158의 보관 기한 지우기는 전용 모듈에서만 한다. 삽입과 기록 도구의 사용자는 위에서 따로 제한한다.
    expect(other.sort()).toEqual(["access-log.ts", "purge-access-logs.ts", "purge-sources.ts", "sql-scope.ts"]);
  });

  it("시험용 경로는 운영 빌드에 없음: APP_ROUTES에 /test/ 경로가 없고 서버 코드가 시험 파일을 가져오지 않음", () => {
    expect(APP_ROUTES.filter((r) => r.path.startsWith("/test/"))).toEqual([]);
    for (const s of sources) expect(s.text, s.name).not.toMatch(/from\s+["'](?:\.\.\/)+test\//);
    expect(sources.some((s) => s.text.includes("/test/access/"))).toBe(false);
  });
});

describeDb("접속기록을 남기는 경로(SPEC-074, A24)", () => {
  const db = testDb();
  const logs = collectLogs();
  let a: ShopFixture;
  let b: ShopFixture;
  let operatorId = "";
  let phoneId = "";
  let phoneDigits = "";
  let cardId = "";
  let app: ReturnType<typeof createApp>;
  let failing: ReturnType<typeof createApp>;

  const owner = (f: ShopFixture, extra: Record<string, string> = {}) => ({
    [OWNER_HEADER]: f.ownerId,
    [CLIENT_IP_HEADER]: TEST_IPV4,
    ...extra,
  });
  const operator = (extra: Record<string, string> = {}) => ({
    [OPERATOR_HEADER]: operatorId,
    [CLIENT_IP_HEADER]: TEST_IPV6,
    "content-type": "application/json",
    ...extra,
  });
  const call = async (target: ReturnType<typeof createApp>, url: string, init: RequestInit = {}): Promise<Response> =>
    target.request(`/api${url}`, init, testEnv());
  const friendCheckedAt = async (f: ShopFixture) =>
    (
      await db.query<{ at: string | null }>("SELECT friend_checked_at::text AS at FROM customers WHERE id = $1", [
        f.customerId,
      ])
    ).rows[0]?.at ?? null;

  beforeAll(async () => {
    ({ a, b } = await createShopPair(db));
    operatorId = newUuid();
    await db.query("INSERT INTO operators (id, email, display_name) VALUES ($1, $2, '시험 운영자')", [
      operatorId,
      `op-${operatorId.slice(0, 8)}@example.com`,
    ]);
    const scope = createShopScope(a.shopId, { kind: "operator", operatorId });
    phoneDigits = `010${randomDigits(8)}`;
    await shopRequestDb(scope, db).transaction(async (tx) => {
      await maskValue(tx, fc, a.consultationId, "phone", phoneDigits);
      await maskValue(tx, fc, a.consultationId, "card", `4${randomDigits(15)}`);
    });
    const ids = await db.query<{ id: string; kind: string }>(
      "SELECT id, kind FROM masked_values WHERE consultation_id = $1",
      [a.consultationId],
    );
    phoneId = ids.rows.find((r) => r.kind === "phone")?.id ?? "";
    cardId = ids.rows.find((r) => r.kind === "card")?.id ?? "";
    const scopes = testScopes([a, b], () => operatorId);
    app = createApp({ routes: ACCESS_ROUTES, scopes, logSink: logs.sink });
    failing = createApp({ routes: ACCESS_ROUTES, scopes, logSink: logs.sink, connect: failingAccessInsert() });
  });

  afterAll(async () => {
    await db.close();
  });

  it("SPEC-074 #1: 사장님이 주문 상세를 열면 그 사장님·시각·IP·그 손님·API 번호의 읽음 1행(경로에 쿼리 없음, 응답과 같은 트랜잭션)", async () => {
    const { text, row } = await expectOneAccessRow(
      db,
      a.shopId,
      () => call(app, `/test/access/owner/orders/${a.orderId}?phone=010-0000-0000&memo=x`, { headers: owner(a) }),
      {
        shop_id: a.shopId,
        actor_kind: "owner",
        owner_id: a.ownerId,
        operator_id: null,
        action: "read",
        api_id: "API-045",
        request_path: `/api/test/access/owner/orders/${a.orderId}`,
        subject_ids: [a.customerId],
        target_kind: null,
        target_id: null,
        reason: null,
        client_ip: TEST_IPV4,
      },
    );
    const body = JSON.parse(text) as { customerName: string; at: string };
    expect(body.customerName).toBe("시험손님");
    expect(row.accessed_us).toBe(body.at);
    for (const v of FIXTURE_PII) expect(row.row_text).not.toContain(v);
  });

  it("목록이 비어도 요청마다 한 행(손님 ID 빈 목록), IPv6 접속지", async () => {
    await expectOneAccessRow(
      db,
      a.shopId,
      () =>
        call(app, "/test/access/owner/orders?day=2000-01-01", {
          headers: owner(a, { [CLIENT_IP_HEADER]: TEST_IPV6 }),
        }),
      {
        action: "read",
        api_id: "API-044",
        subject_ids: [],
        client_ip: TEST_IPV6,
        request_path: "/api/test/access/owner/orders",
      },
    );
  });

  it("SPEC-074 #2: 1년 전 행을 앱의 연결로 고치기·지우기·비우기 하면 데이터베이스가 막아(23001) 바뀐 행이 0건, 2년 지난 행은 지울 수 있음", async () => {
    const yearOld = newUuid();
    const results = await db
      .transaction(async (tx) => {
        await tx.query(
          `INSERT INTO access_logs (id, shop_id, actor_kind, owner_id, action, api_id, request_path, subject_ids, client_ip, accessed_at)
           VALUES ($1, $2, 'owner', $3, 'read', 'API-045', $4, $5::jsonb, $6, now() - interval '1 year')`,
          [yearOld, a.shopId, a.ownerId, `/api/owner/orders/${a.orderId}`, JSON.stringify([a.customerId]), TEST_IPV4],
        );
        const snapshot = async () =>
          (await tx.query<{ t: string }>("SELECT t::text AS t FROM access_logs t WHERE id = $1", [yearOld])).rows[0]?.t;
        const before = await snapshot();
        const attempts: Record<string, string | undefined> = {};
        for (const [name, sql] of [
          ["update", "UPDATE access_logs SET client_ip = '192.0.2.1' WHERE id = $1"],
          ["delete", "DELETE FROM access_logs WHERE id = $1"],
          ["truncate", "TRUNCATE access_logs"],
        ] as const) {
          await tx.query("SAVEPOINT attempt");
          try {
            await tx.query(sql, name === "truncate" ? [] : [yearOld]);
            attempts[name] = "allowed";
          } catch (e) {
            attempts[name] = (e as { code?: string }).code;
          }
          await tx.query("ROLLBACK TO SAVEPOINT attempt");
          expect(await snapshot(), name).toBe(before);
        }
        const twoYears = newUuid();
        await tx.query(
          `INSERT INTO access_logs (id, shop_id, actor_kind, owner_id, action, api_id, request_path, client_ip, accessed_at)
           VALUES ($1, $2, 'owner', $3, 'read', 'API-045', '/api/owner/orders', $4, now() - interval '2 years 1 day')`,
          [twoYears, a.shopId, a.ownerId, TEST_IPV4],
        );
        const purged = await tx.query("DELETE FROM access_logs WHERE id = $1", [twoYears]);
        throw Object.assign(new Error("rollback"), { attempts, purged: purged.rowCount });
      })
      .catch((e: { attempts?: Record<string, string>; purged?: number }) => e);
    expect(results.attempts).toEqual({ update: "23001", delete: "23001", truncate: "23001" });
    expect(results.purged).toBe(1);
    expect((await db.query("SELECT 1 FROM access_logs WHERE id = $1", [yearOld])).rowCount).toBe(0);
  });

  it("SPEC-074 #3: 가격표를 바꾸거나 읽는 요청은 접속기록 0행", async () => {
    const before = await accessLogCount(db, a.shopId);
    const created = await call(app, "/test/access/owner/price-list/versions", {
      method: "POST",
      headers: owner(a, { [REQUEST_KEY_HEADER]: newRequestKey() }),
    });
    expect(created.status, await created.text()).toBe(201);
    const read = await call(app, "/test/access/owner/price-list", { headers: owner(a) });
    expect(read.status).toBe(200);
    expect(await accessLogCount(db, a.shopId)).toBe(before);
  });

  it("쓰기 명령: 바꿈 1행이 명령과 같은 트랜잭션, 같은 요청 키로 다시 오면 다시 읽어 돌려주고 읽음 1행 더", async () => {
    const key = newRequestKey();
    const send = () =>
      call(app, `/test/access/owner/customers/${a.customerId}/friend-check`, {
        method: "POST",
        headers: owner(a, { [REQUEST_KEY_HEADER]: key, "content-type": "application/json" }),
        body: "{}",
      });
    const first = await expectOneAccessRow(db, a.shopId, send, {
      action: "change",
      api_id: "API-046",
      subject_ids: [a.customerId],
      request_path: `/api/test/access/owner/customers/${a.customerId}/friend-check`,
    });
    expect(first.row.accessed_us).toBe((JSON.parse(first.text) as { at: string }).at);
    const again = await expectOneAccessRow(db, a.shopId, send, {
      action: "read",
      api_id: "API-046",
      subject_ids: [a.customerId],
    });
    expect(again.res.headers.get(REPLAYED_HEADER)).toBe("true");
    const replayed = JSON.parse(again.text) as { checkedAt: string; at: string };
    expect(replayed.checkedAt).toBe((JSON.parse(first.text) as { checkedAt: string }).checkedAt);
    expect(again.row.accessed_us).toBe(replayed.at);
  });

  it("오류 응답은 행을 남기지 않음: 다른 가게 ID(404), 남긴 오류의 다시 보냄(409)", async () => {
    const beforeA = await accessLogCount(db, a.shopId);
    const beforeB = await accessLogCount(db, b.shopId);
    const other = await call(app, `/test/access/owner/orders/${b.orderId}`, { headers: owner(a) });
    expect(other.status).toBe(404);
    const key = newRequestKey();
    const refuse = () =>
      call(app, `/test/access/owner/customers/${a.customerId}/friend-check`, {
        method: "POST",
        headers: owner(a, { [REQUEST_KEY_HEADER]: key, "content-type": "application/json" }),
        body: JSON.stringify({ refuse: true }),
      });
    const at = await friendCheckedAt(a);
    expect((await refuse()).status).toBe(409);
    const replay = await refuse();
    expect(replay.status).toBe(409);
    expect(replay.headers.get(REPLAYED_HEADER)).toBe("true");
    expect(await friendCheckedAt(a)).toBe(at);
    expect(await accessLogCount(db, a.shopId)).toBe(beforeA);
    expect(await accessLogCount(db, b.shopId)).toBe(beforeB);
  });

  it("A24: 넣기가 실패하면 읽기는 500 internal로 개인정보를 돌려주지 않고, 행이 없음", async () => {
    await expectFailClosed(
      db,
      a.shopId,
      () => call(failing, `/test/access/owner/orders/${a.orderId}`, { headers: owner(a) }),
      FIXTURE_PII,
    );
  });

  it("A24: 넣기가 실패하면 쓰기 명령의 바꾼 것도 되돌려지고 500, 같은 요청 키로 다시 보낼 수 있음", async () => {
    const at = await friendCheckedAt(a);
    const key = newRequestKey();
    const send = (target: ReturnType<typeof createApp>) =>
      call(target, `/test/access/owner/customers/${a.customerId}/friend-check`, {
        method: "POST",
        headers: owner(a, { [REQUEST_KEY_HEADER]: key, "content-type": "application/json" }),
        body: "{}",
      });
    await expectFailClosed(db, a.shopId, () => send(failing), FIXTURE_PII);
    expect(await friendCheckedAt(a)).toBe(at);
    await expectOneAccessRow(db, a.shopId, () => send(app), { action: "change" });
    expect(await friendCheckedAt(a)).not.toBe(at);
  });

  it("A24: 같은 요청 키의 다시 보냄도 넣기가 실패하면 500으로 본문을 돌려주지 않음", async () => {
    const key = newRequestKey();
    const send = (target: ReturnType<typeof createApp>) =>
      call(target, `/test/access/owner/customers/${a.customerId}/friend-check`, {
        method: "POST",
        headers: owner(a, { [REQUEST_KEY_HEADER]: key, "content-type": "application/json" }),
        body: "{}",
      });
    const first = await send(app);
    expect(first.status).toBe(200);
    const checkedAt = (JSON.parse(await first.text()) as { checkedAt: string }).checkedAt;
    await expectFailClosed(db, a.shopId, () => send(failing), [checkedAt]);
  });

  it("어디서: CF-Connecting-IP가 없거나(X-Forwarded-For만) IP 꼴이 아니면 500, 행 없음, 바꾼 것 없음", async () => {
    const before = await accessLogCount(db, a.shopId);
    const at = await friendCheckedAt(a);
    const noIp = { [OWNER_HEADER]: a.ownerId, "x-forwarded-for": TEST_IPV4 };
    const read = await call(app, `/test/access/owner/orders/${a.orderId}`, { headers: noIp });
    expect(read.status).toBe(500);
    const write = await call(app, `/test/access/owner/customers/${a.customerId}/friend-check`, {
      method: "POST",
      headers: { ...noIp, [REQUEST_KEY_HEADER]: newRequestKey(), "content-type": "application/json" },
      body: "{}",
    });
    expect(write.status).toBe(500);
    const forged = await call(app, `/test/access/owner/orders/${a.orderId}`, {
      headers: owner(a, { [CLIENT_IP_HEADER]: "010-0000-0000" }),
    });
    expect(forged.status).toBe(500);
    for (const res of [read, write, forged]) {
      const text = await res.text();
      for (const v of FIXTURE_PII) expect(text).not.toContain(v);
    }
    expect(await friendCheckedAt(a)).toBe(at);
    expect(await accessLogCount(db, a.shopId)).toBe(before);
  });

  it("운영자 원래 값 열기: 대상·사유와 함께 open_original 1행, 다시 오면 다시 열고 1행 더", async () => {
    const key = newRequestKey();
    const reason = "손님 연락처 확인 요청(문의 2026-11-16)";
    const send = () =>
      call(app, `/test/access/operator/shops/${a.shopId}/originals`, {
        method: "POST",
        headers: operator({ [REQUEST_KEY_HEADER]: key }),
        body: JSON.stringify({ targetId: phoneId, reason }),
      });
    const expected = {
      actor_kind: "operator",
      owner_id: null,
      operator_id: operatorId,
      action: "open_original",
      api_id: "API-077",
      request_path: `/api/test/access/operator/shops/${a.shopId}/originals`,
      subject_ids: [a.customerId],
      target_kind: "masked_value",
      target_id: phoneId,
      reason,
      client_ip: TEST_IPV6,
    } as const;
    const first = await expectOneAccessRow(db, a.shopId, send, expected);
    const opened = JSON.parse(first.text) as { value: string; at: string };
    expect(opened.value).toBe(phoneDigits);
    expect(first.row.accessed_us).toBe(opened.at);
    expect(first.row.row_text).not.toContain(phoneDigits);
    const again = await expectOneAccessRow(db, a.shopId, send, expected);
    expect(again.res.headers.get(REPLAYED_HEADER)).toBe("true");
    expect((JSON.parse(again.text) as { value: string }).value).toBe(phoneDigits);
  });

  it("운영자 열기: 원래 값을 두지 않는 번호는 409 original_not_kept이고 열기 행 없음(다시 와도), 사유가 짧으면 422", async () => {
    const before = await accessLogCount(db, a.shopId);
    const key = newRequestKey();
    const send = (body: unknown, k = key) =>
      call(app, `/test/access/operator/shops/${a.shopId}/originals`, {
        method: "POST",
        headers: operator({ [REQUEST_KEY_HEADER]: k }),
        body: JSON.stringify(body),
      });
    expect((await send({ targetId: cardId, reason: "카드 번호 확인 요청" })).status).toBe(409);
    const replay = await send({ targetId: cardId, reason: "카드 번호 확인 요청" });
    expect(replay.status).toBe(409);
    expect(replay.headers.get(REPLAYED_HEADER)).toBe("true");
    expect((await send({ targetId: phoneId, reason: "짧음" }, newRequestKey())).status).toBe(422);
    expect(await accessLogCount(db, a.shopId)).toBe(before);
  });

  it("코드의 잘못은 닫힘(500, 바꾼 것 되돌림): 사장님의 열기 행, 다시 온 요청을 바꿈으로, 두 번 남기기, 남기지 않은 성공", async () => {
    const at = await friendCheckedAt(a);
    const before = await accessLogCount(db, a.shopId);
    const peek = await call(app, `/test/access/owner/customers/${a.customerId}/peek`, {
      method: "POST",
      headers: owner(a, { [REQUEST_KEY_HEADER]: newRequestKey() }),
    });
    expect(peek.status).toBe(500);
    expect(await friendCheckedAt(a)).toBe(at);
    expect(await accessLogCount(db, a.shopId)).toBe(before);

    const key = newRequestKey();
    const change = () =>
      call(app, `/test/access/owner/customers/${a.customerId}/replay-change`, {
        method: "POST",
        headers: owner(a, { [REQUEST_KEY_HEADER]: key }),
      });
    expect((await change()).status).toBe(200);
    expect((await change()).status).toBe(500);
    expect(await accessLogCount(db, a.shopId)).toBe(before + 1);

    const twice = await call(app, `/test/access/owner/orders/${a.orderId}/twice`, { headers: owner(a) });
    expect(twice.status).toBe(500);
    expect(await accessLogCount(db, a.shopId)).toBe(before + 2);

    const silent = await call(app, "/test/access/owner/silent", { headers: owner(a) });
    expect(silent.status).toBe(500);
    expect(await silent.text()).not.toContain("ok");
    expect(await accessLogCount(db, a.shopId)).toBe(before + 2);
  });

  it("G6: 로그에는 추적 ID·API 번호·SQLSTATE·사유 코드만(손님 개인정보·IP·경로·사유 글 없음)", () => {
    const text = logs.lines.join("\n");
    expect(text).toContain('"event":"access_log_failed"');
    const failed = logs.lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((l) => l.event === "access_log_failed");
    expect(failed.length).toBeGreaterThan(0);
    for (const l of failed) {
      expect(Object.keys(l).sort()).toEqual(expect.arrayContaining(["api", "event", "level", "traceId"]));
      expect(String(l.api)).toMatch(/^API-[0-9]{3}$/);
    }
    expect(failed.some((l) => l.dbCode === "42P01")).toBe(true);
    expect(failed.some((l) => l.code === "client_ip_missing")).toBe(true);
    expect(failed.some((l) => l.code === "open_by_owner")).toBe(true);
    for (const secret of [...FIXTURE_PII, phoneDigits, TEST_IPV4, TEST_IPV6, "손님 연락처 확인", a.customerId]) {
      expect(text).not.toContain(secret);
    }
  });
});
