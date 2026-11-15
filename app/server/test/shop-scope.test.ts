import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Queryable, sqlStateOf } from "../src/db";
import { ApiError } from "../src/problem";
import type { ShopRequest } from "../src/routes";
import {
  actorOf,
  createShopScope,
  ForgedScopeError,
  isShopScope,
  pathId,
  type ShopDb,
  type ShopRequestDb,
  type ShopScope,
  shopDb,
  shopRequestDb,
  UnscopedQueryError,
} from "../src/shop-scope";
import { SHOP_TABLES } from "../src/sql-scope";
import { describeDb, newUuid, testDb } from "./support/db";
import { createShopPair, type ShopFixture } from "./support/shops";

// 가게 범위 접근 층(TASK-019; 04 SPEC-068·G1, 05 A9·E1, 06 DEC-02).

/** 보낸 SQL을 적기만 하는 연결(데이터베이스에 닿았는지 보려고). */
function recorder(): Queryable & { readonly sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    query: async (sql: string) => {
      sent.push(sql);
      return { rows: [], rowCount: 0 };
    },
  };
}

async function apiCode(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return { code: e.code, ...e.extras };
    throw e;
  }
  return "no error";
}

describe("가게 범위(ShopScope)", () => {
  const shopId = newUuid();

  it("createShopScope로 만든 것만 진짜이고, 바꿀 수 없음", () => {
    const scope = createShopScope(shopId.toUpperCase(), { kind: "owner", ownerId: newUuid() });
    expect(isShopScope(scope)).toBe(true);
    expect(scope.shopId).toBe(shopId);
    expect(Object.isFrozen(scope)).toBe(true);
    expect(isShopScope({ shopId, via: { kind: "owner", ownerId: newUuid() } })).toBe(false);
    expect(() => createShopScope("not-a-uuid", { kind: "public" })).toThrow(TypeError);
  });

  it("흉내 낸 가게 범위로는 연결을 만들지 않음", () => {
    const forged = { shopId, via: { kind: "owner", ownerId: newUuid() } } as unknown as ShopScope;
    expect(() => shopDb(forged, recorder())).toThrow(ForgedScopeError);
  });

  it("요청 키의 누른 사람은 사장님·운영자 범위에서만(손님·예약 링크는 명령에 요청 키를 쓰지 않음)", () => {
    const ownerId = newUuid();
    expect(actorOf(createShopScope(shopId, { kind: "owner", ownerId }))).toEqual({ kind: "owner", id: ownerId });
    const operatorId = newUuid();
    expect(actorOf(createShopScope(shopId, { kind: "operator", operatorId }))).toEqual({
      kind: "operator",
      id: operatorId,
    });
    expect(() => actorOf(createShopScope(shopId, { kind: "customer", channelId: newUuid() }))).toThrow(TypeError);
    expect(() => actorOf(createShopScope(shopId, { kind: "public" }))).toThrow(TypeError);
  });

  it("가게 조건이 없는 SQL은 데이터베이스에 보내지 않음", async () => {
    const q = recorder();
    const db = shopDb(createShopScope(shopId, { kind: "public" }), q);
    await expect(db.run("SELECT o.id FROM orders o WHERE o.id = $2", [newUuid()])).rejects.toThrow(UnscopedQueryError);
    await expect(db.run("SELECT s.name FROM shops s")).rejects.toThrow(UnscopedQueryError);
    expect(q.sent).toEqual([]);
    await db.run("SELECT s.name FROM shops s WHERE s.id = $1");
    expect(q.sent).toHaveLength(1);
  });

  it("경로의 형식이 틀린 ID는 데이터베이스에 묻지 않고 404(06 DEC-02, 100자 넘는 것 포함)", async () => {
    const q = recorder();
    const db = shopDb(createShopScope(shopId, { kind: "public" }), q);
    for (const raw of [undefined, "", "not-a-uuid", "a".repeat(101), `${newUuid()}x`, `{${newUuid()}}`]) {
      expect(await apiCode(db.owned("orders", raw))).toEqual({ code: "not_found" });
    }
    expect(q.sent).toEqual([]);
    expect(() => pathId("1' OR '1'='1")).toThrow(ApiError);
  });

  it("id 없는 가게 테이블과 가게 테이블이 아닌 이름은 받지 않음", async () => {
    const db = shopDb(createShopScope(shopId, { kind: "public" }), recorder());
    await expect(db.owned("calendar_days" as never, newUuid())).rejects.toThrow(TypeError);
    await expect(db.references("request_keys" as never, [{ field: "/x", id: newUuid() }])).rejects.toThrow(TypeError);
  });

  it("처리기가 받는 가게 범위 연결은 날 연결(Queryable)이 아님(타입)", () => {
    const check = (db: ShopRequestDb, tx: ShopDb, r: ShopRequest) => {
      // @ts-expect-error 가게 범위 연결은 Queryable로 넘길 수 없다
      const raw: Queryable = db;
      // @ts-expect-error 트랜잭션 안의 연결도 날 query가 없다
      tx.query("SELECT 1");
      // @ts-expect-error 처리기의 요청에는 Hono 맥락(날 연결을 꺼낼 get)이 없다
      r.get("db");
      return raw;
    };
    expect(typeof check).toBe("function");
  });
});

describeDb("가게 범위 연결(ShopDb)과 데이터베이스", () => {
  const db = testDb();
  let a: ShopFixture;
  let b: ShopFixture;
  let scopeA: ShopScope;

  beforeAll(async () => {
    ({ a, b } = await createShopPair(db));
    scopeA = createShopScope(a.shopId, { kind: "owner", ownerId: a.ownerId });
  });

  afterAll(async () => {
    await db.close();
  });

  it("05와 데이터베이스의 shop_id 열을 가진 테이블이 SHOP_TABLES와 같음", async () => {
    const r = await db.query<{ table_name: string }>(
      `SELECT c.table_name FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = 'public' AND c.column_name = 'shop_id' AND t.table_type = 'BASE TABLE'
       ORDER BY 1`,
    );
    expect(r.rows.map((row) => row.table_name)).toEqual([...SHOP_TABLES].sort());
  });

  it("$1은 가게 ID로 채워지고, 다른 가게 행은 없는 행과 같이 0행", async () => {
    const s = shopDb(scopeA, db);
    const own = await s.run<{ id: string }>("SELECT o.id FROM orders o WHERE o.shop_id = $1 AND o.id = $2", [
      a.orderId,
    ]);
    expect(own.rows).toEqual([{ id: a.orderId }]);
    const other = await s.run("SELECT o.id FROM orders o WHERE o.shop_id = $1 AND o.id = $2", [b.orderId]);
    const missing = await s.run("SELECT o.id FROM orders o WHERE o.shop_id = $1 AND o.id = $2", [newUuid()]);
    expect(other.rowCount).toBe(0);
    expect(missing.rowCount).toBe(0);
    const shop = await s.found<{ name: string }>("SELECT s.name FROM shops s WHERE s.id = $1");
    expect(shop.name).toBe("가게A");
  });

  it("owned: 자기 가게 ID는 돌려주고, 다른 가게 ID·없는 ID·대문자로 쓴 다른 가게 ID는 같은 404", async () => {
    const s = shopDb(scopeA, db);
    expect(await s.owned("orders", a.orderId.toUpperCase())).toBe(a.orderId);
    for (const id of [b.orderId, newUuid(), b.orderId.toUpperCase()]) {
      expect(await apiCode(s.owned("orders", id))).toEqual({ code: "not_found" });
    }
    expect(await apiCode(s.owned("consultations", b.consultationId))).toEqual({ code: "not_found" });
    expect(await apiCode(s.owned("payment_requests", b.paymentRequestId))).toEqual({ code: "not_found" });
  });

  it("references: 다른 가게 ID와 없는 ID는 같은 422 reference_not_found, 형식이 틀린 값은 bad_format", async () => {
    const s = shopDb(scopeA, db);
    await expect(
      s.references("designs", [{ field: "/designs/0/sourceDesignId", id: a.designId }]),
    ).resolves.toBeUndefined();
    const other = await apiCode(s.references("designs", [{ field: "/designs/0/sourceDesignId", id: b.designId }]));
    const missing = await apiCode(s.references("designs", [{ field: "/designs/0/sourceDesignId", id: newUuid() }]));
    expect(other).toEqual({
      code: "validation_failed",
      errors: [{ field: "/designs/0/sourceDesignId", code: "reference_not_found" }],
    });
    expect(missing).toEqual(other);
    expect(
      await apiCode(
        s.references("designs", [
          { field: "/designs/0/sourceDesignId", id: a.designId },
          { field: "/designs/1/sourceDesignId", id: b.designId },
          { field: "/designs/2/sourceDesignId", id: 12 },
        ]),
      ),
    ).toEqual({
      code: "validation_failed",
      errors: [
        { field: "/designs/1/sourceDesignId", code: "reference_not_found" },
        { field: "/designs/2/sourceDesignId", code: "bad_format" },
      ],
    });
  });

  it("트랜잭션 안에서도 가게 범위 연결만 받음", async () => {
    const s = shopRequestDb(scopeA, db);
    const n = await s.transaction(async (tx) => {
      const r = await tx.run<{ n: number }>("SELECT count(*)::int AS n FROM orders o WHERE o.shop_id = $1");
      await expect(tx.run("SELECT count(*) FROM orders")).rejects.toThrow(UnscopedQueryError);
      return r.rows[0]?.n;
    });
    expect(n).toBe(1);
  });

  it("05 A9: 데이터베이스는 다른 가게 행 읽기를 막지 않음(날 연결로는 B의 주문이 읽힘). 그래서 앱이 막음", async () => {
    const raw = await db.query("SELECT o.id FROM orders o WHERE o.id = $1", [b.orderId]);
    expect(raw.rowCount).toBe(1);
    await expect(shopDb(scopeA, db).run("SELECT o.id FROM orders o WHERE o.id = $2", [b.orderId])).rejects.toThrow(
      UnscopedQueryError,
    );
  });

  it("05 E1: 데이터베이스는 가게가 섞인 행을 막음(A의 메시지가 B의 상담을 가리키면 23503)", async () => {
    const s = shopDb(scopeA, db);
    const err = await s
      .run(
        `INSERT INTO messages (shop_id, id, consultation_id, direction, author, kind, kakao_message_id, body_masked, trace_id)
         VALUES ($1, $2, $3, 'inbound', 'customer', 'text', $4, '섞인 행', 'trace-e1')`,
        [newUuid(), b.consultationId, `km-${newUuid()}`],
      )
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(sqlStateOf(err)).toBe("23503");
  });
});
