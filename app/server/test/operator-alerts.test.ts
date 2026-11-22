import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { Queryable, RequestDb } from "../src/db";
import { reviewCursor } from "../src/license-review-input";
import { operatorAlertDirectory } from "../src/operator-alert-directory";
import { createOperatorScope, type OperatorScope } from "../src/operator-scope";
import { OWNER_COOKIE } from "../src/owner-oauth";
import { createOwnerSession } from "../src/owner-session";
import { createShopScope, ForgedScopeError } from "../src/shop-scope";
import { expectProblem, expectSchema } from "./support/contract";
import { describeDb, testEnv } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { seedOperatorSession } from "./support/operator";
import { createShop } from "./support/shops";

const ORIGIN = "https://siljang.example",
  NOW = new Date("2026-11-22T06:00:00Z");
let db: RequestDb, isolated: Awaited<ReturnType<typeof isolatedTestDb>> | undefined;
interface AlertList {
  items: {
    alertId: string;
    kind: string;
    shop: { shopId: string; name: string } | null;
    count: number;
    createdAt: string;
  }[];
  nextCursor: string | null;
}
function application(connect?: () => RequestDb) {
  return createApp({
    connect:
      connect ??
      (() => {
        if (!isolated) throw new Error("시험 DB 없음");
        return isolated.connect();
      }),
    services: { now: () => NOW },
    logSink: () => {},
  });
}
async function alert(at: string = NOW.toISOString(), id: string = crypto.randomUUID()) {
  await db.query("INSERT INTO ops_events(id,kind,count,created_at) VALUES ($1,'ai_failure_burst',5,$2)", [id, at]);
  return id;
}
async function list(cookie: string, query = "", app = application()): Promise<AlertList> {
  const response = await app.request(`${ORIGIN}/api/operator/alerts${query}`, { headers: { cookie } }, testEnv());
  expect(response.status, await response.clone().text()).toBe(200);
  const body = (await response.json()) as AlertList;
  expectSchema("OperatorAlertList", body);
  return body;
}
describeDb("TASK-035 운영자 알림", () => {
  beforeAll(async () => {
    isolated = await isolatedTestDb();
    db = isolated.db;
  }, 30_000);
  afterAll(async () => isolated?.close());
  beforeEach(async () => {
    await db.query("DELETE FROM ops_events");
  });
  it("운영자에게 세 종류/가게 요약/건수만 최신순으로 돌려주고 내용은 읽지 않음", async () => {
    const f = await createShop(db, "알림 합성 가게"),
      op = await seedOperatorSession(db, NOW),
      ids = Array.from({ length: 4 }, () => crypto.randomUUID());
    for (const [i, kind] of [
      "channel_already_linked",
      "privacy_transfer_missing",
      "ai_failure_burst",
      "purge_run",
    ].entries())
      await db.query("INSERT INTO ops_events(id,shop_id,kind,count,detail,created_at) VALUES ($1,$2,$3,$4,$5,$6)", [
        ids[i],
        i === 1 ? null : f.shopId,
        kind,
        i + 1,
        { content: "합성 비공개 내용" },
        new Date(NOW.getTime() + i * 1000),
      ]);
    const database = isolated;
    if (!database) throw new Error("시험 DB 없음");
    const app = createApp({ connect: () => database.connect(), services: { now: () => NOW }, logSink: () => {} });
    const response = await app.request(`${ORIGIN}/api/operator/alerts`, { headers: { cookie: op.cookie } }, testEnv());
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      items: { alertId: string; kind: string; shop: unknown; count: number }[];
      nextCursor: string | null;
    };
    expectSchema("OperatorAlertList", body);
    expect(body.items.map((x) => x.alertId)).toEqual([ids[2], ids[1], ids[0]]);
    expect(body.items[1]?.shop).toBe(null);
    expect(body.items[0]).toMatchObject({
      kind: "ai_failure_burst",
      count: 3,
      shop: { shopId: f.shopId, name: "알림 합성 가게" },
    });
    expect(JSON.stringify(body)).not.toContain("합성 비공개 내용");
    expect(JSON.stringify(body)).not.toContain("detail");
  });
  it("빈 목록은200/빈 배열/커서 없음", async () => {
    const op = await seedOperatorSession(db, NOW);
    expect(await list(op.cookie)).toEqual({ items: [], nextCursor: null });
  });
  it("기본20개와 최대100개를 읽고 같은 시각은ID 오름차순", async () => {
    const op = await seedOperatorSession(db, NOW),
      ids: string[] = [];
    for (let i = 0; i < 21; i++) ids.push(await alert());
    ids.sort();
    const first = await list(op.cookie);
    expect(first.items.map((x) => x.alertId)).toEqual(ids.slice(0, 20));
    expect(first.nextCursor).not.toBeNull();
    expect((await list(op.cookie, `?cursor=${first.nextCursor}`)).items.map((x) => x.alertId)).toEqual(ids.slice(20));
    const all = await list(op.cookie, "?limit=100");
    expect(all.items).toHaveLength(21);
    expect(all.nextCursor).toBeNull();
  });
  it("마이크로초와 같은 시각의ID로 여러 페이지를 누락/중복 없이 읽음", async () => {
    const op = await seedOperatorSession(db, NOW),
      ids = [
        "00000000-0000-4000-8000-000000000035",
        "ffffffff-ffff-4fff-8fff-ffffffff0035",
        "11111111-1111-4111-8111-111111110035",
        "22222222-2222-4222-8222-222222220035",
      ];
    await alert("2026-11-22T06:00:00.000001Z", ids[0]);
    await alert("2026-11-22T06:00:00.000001Z", ids[1]);
    await alert("2026-11-22T06:00:00.000002Z", ids[2]);
    await alert("2026-11-22T05:59:59.999999Z", ids[3]);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 4; i++) {
      const page = await list(op.cookie, `?limit=1${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...page.items.map((x) => x.alertId));
      cursor = page.nextCursor;
      if (i < 3) expect(cursor).not.toBeNull();
    }
    expect(cursor).toBeNull();
    expect(seen).toEqual([ids[2], ids[0], ids[1], ids[3]]);
  });
  it.each([
    ["?limit=0", "query:limit", "out_of_range"],
    ["?limit=101", "query:limit", "out_of_range"],
    ["?limit=1.5", "query:limit", "bad_format"],
    ["?limit=1e2", "query:limit", "bad_format"],
    ["?cursor=", "query:cursor", "bad_format"],
    ["?cursor=broken", "query:cursor", "bad_format"],
    [
      `?cursor=${reviewCursor("pending", "2026-11-22T06:00:00.000000Z", "00000000-0000-4000-8000-000000000035")}`,
      "query:cursor",
      "bad_format",
    ],
    [
      `?cursor=${reviewCursor("alerts", "2026-02-30T06:00:00.000000Z", "00000000-0000-4000-8000-000000000035")}`,
      "query:cursor",
      "bad_format",
    ],
  ])("목록%s는422/필드 오류이며 알림을 읽거나 쓰지 않음", async (query, field, code) => {
    const op = await seedOperatorSession(db, NOW);
    let eventQueries = 0;
    const app = application(() => {
      if (!isolated) throw new Error("시험 DB 없음");
      const base = isolated.connect();
      return {
        ...base,
        query(sql, params) {
          if (/\bops_events\b/.test(sql)) eventQueries++;
          return base.query(sql, params);
        },
        transaction: (fn) => base.transaction(fn),
        abort: () => base.abort(),
        close: () => base.close(),
      };
    });
    const response = await app.request(
      `${ORIGIN}/api/operator/alerts${query}`,
      { headers: { cookie: op.cookie } },
      testEnv(),
    );
    expect(await expectProblem(response, "validation_failed")).toMatchObject({ errors: [{ field, code }] });
    expect(eventQueries).toBe(0);
  });
  it.each(["expired", "ended", "future", "disabled", "no_mfa"])("%s 운영자 세션은401/알림 조회0", async (state) => {
    const op = await seedOperatorSession(db, NOW);
    if (state === "expired")
      await db.query("UPDATE operator_sessions SET created_at=$2,expires_at=$3 WHERE operator_id=$1", [
        op.operatorId,
        new Date(NOW.getTime() - 12 * 3_600_000),
        NOW,
      ]);
    if (state === "ended")
      await db.query("UPDATE operator_sessions SET ended_at=$2 WHERE operator_id=$1", [op.operatorId, NOW]);
    if (state === "future")
      await db.query("UPDATE operator_sessions SET created_at=$2,expires_at=$3 WHERE operator_id=$1", [
        op.operatorId,
        new Date(NOW.getTime() + 1000),
        new Date(NOW.getTime() + 12 * 3_600_000 + 1000),
      ]);
    if (state === "disabled") await db.query("UPDATE operators SET disabled_at=$2 WHERE id=$1", [op.operatorId, NOW]);
    if (state === "no_mfa")
      await db.query("UPDATE operators SET mfa_enrolled_at=NULL,mfa_factor_id=NULL WHERE id=$1", [op.operatorId]);
    let events = 0;
    const app = application(() => {
      if (!isolated) throw new Error("시험 DB 없음");
      const base = isolated.connect();
      return {
        query(sql, params) {
          if (/\bops_events\b/.test(sql)) events++;
          return base.query(sql, params);
        },
        transaction: (fn) => base.transaction(fn),
        abort: () => base.abort(),
        close: () => base.close(),
      };
    });
    await expectProblem(
      await app.request(`${ORIGIN}/api/operator/alerts`, { headers: { cookie: op.cookie } }, testEnv()),
      "unauthenticated",
    );
    expect(events).toBe(0);
  });
  it("실제 사장님 세션만으로는 운영자 알림을 읽지 못함", async () => {
    const owner = await createOwnerSession(
      db,
      { accountId: BigInt(`0x${crypto.randomUUID().replaceAll("-", "").slice(0, 14)}`).toString(), friend: false },
      NOW,
      false,
    );
    await expectProblem(
      await application().request(
        `${ORIGIN}/api/operator/alerts`,
        { headers: { cookie: `${OWNER_COOKIE}=${owner.token}` } },
        testEnv(),
      ),
      "unauthenticated",
    );
  });
  it("가게 시각은 해당 시간대, 전역 알림은 서울이며 모든 값을 계약에 맞춤", async () => {
    const f = await createShop(db, "시간대 합성 가게"),
      op = await seedOperatorSession(db, NOW);
    await db.query("UPDATE shops SET time_zone='America/New_York' WHERE id=$1", [f.shopId]);
    const shopId = await alert(),
      globalId = await alert();
    await db.query("UPDATE ops_events SET shop_id=$2,count=0 WHERE id=$1", [shopId, f.shopId]);
    const body = await list(op.cookie);
    expect(body.items.find((x) => x.alertId === shopId)).toMatchObject({
      count: 0,
      createdAt: "2026-11-22T01:00:00-05:00",
    });
    expect(body.items.find((x) => x.alertId === globalId)?.createdAt).toBe("2026-11-22T15:00:00+09:00");
  });
  it("계약의 최대 건수를 넘긴 기록은 응답에 내보내지 않고500", async () => {
    const op = await seedOperatorSession(db, NOW),
      id = await alert();
    await db.query("UPDATE ops_events SET count=1000001 WHERE id=$1", [id]);
    const response = await application().request(
      `${ORIGIN}/api/operator/alerts`,
      { headers: { cookie: op.cookie } },
      testEnv(),
    );
    const body = await expectProblem(response, "internal");
    expect(JSON.stringify(body)).not.toContain("1000001");
  });
  it("상세 열과 쓰기 권한이 없는 최소 로컬 역할도200, 필수 열을 빼면500", async () => {
    const f = await createShop(db, "권한 합성 가게"),
      op = await seedOperatorSession(db, NOW),
      id = await alert(),
      role = `alerts_test_${crypto.randomUUID().replaceAll("-", "")}`;
    await db.query("UPDATE ops_events SET shop_id=$2 WHERE id=$1", [id, f.shopId]);
    await db.query(`CREATE ROLE "${role}" NOLOGIN NOINHERIT`);
    const roleDb = (): RequestDb => {
      if (!isolated) throw new Error("시험 DB 없음");
      const base = isolated.connect();
      const transaction = <T>(fn: (tx: Queryable) => Promise<T>) =>
        base.transaction(async (tx) => {
          await tx.query(`SET LOCAL ROLE "${role}"`);
          return fn(tx);
        });
      return {
        query: (sql, params) => transaction((tx) => tx.query(sql, params)),
        transaction,
        abort: () => base.abort(),
        close: () => base.close(),
      };
    };
    try {
      await db.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
      await db.query(`GRANT SELECT (id,shop_id,kind,count,created_at) ON ops_events TO "${role}"`);
      await db.query(`GRANT SELECT (id,name,time_zone) ON shops TO "${role}"`);
      await db.query(`GRANT SELECT (id,display_name,disabled_at,mfa_enrolled_at) ON operators TO "${role}"`);
      await db.query(
        `GRANT SELECT (id,operator_id,token_hash,created_at,expires_at,ended_at) ON operator_sessions TO "${role}"`,
      );
      const app = application(roleDb);
      expect((await list(op.cookie, "", app)).items.map((x) => x.alertId)).toEqual([id]);
      const limited = roleDb();
      try {
        await expect(limited.query("SELECT detail FROM ops_events")).rejects.toMatchObject({ code: "42501" });
        await expect(limited.query("UPDATE ops_events SET count=0 WHERE id=$1", [id])).rejects.toMatchObject({
          code: "42501",
        });
        await expect(limited.query("INSERT INTO ops_events(kind) VALUES ('ai_failure_burst')")).rejects.toMatchObject({
          code: "42501",
        });
      } finally {
        await limited.close();
      }
      await db.query(`REVOKE SELECT (count) ON ops_events FROM "${role}"`);
      const failed = await app.request(`${ORIGIN}/api/operator/alerts`, { headers: { cookie: op.cookie } }, testEnv());
      await expectProblem(failed, "internal");
      await db.query(`GRANT SELECT (count) ON ops_events TO "${role}"`);
      expect((await list(op.cookie, "", app)).items).toHaveLength(1);
    } finally {
      await db.query(`DROP OWNED BY "${role}"`);
      await db.query(`DROP ROLE "${role}"`);
    }
  });
});
it("가짜 운영자/사장님·가게 범위로는 전역 알림 능력을 만들지 못함", () => {
  let calls = 0;
  const query = async (): Promise<never> => {
      calls++;
      throw new Error("조회 금지");
    },
    db = { query };
  for (const scope of [
    { operatorId: crypto.randomUUID(), displayName: "합성 운영자" },
    createShopScope(crypto.randomUUID(), { kind: "owner", ownerId: crypto.randomUUID() }),
    createShopScope(crypto.randomUUID(), { kind: "operator", operatorId: crypto.randomUUID() }),
    { ...createOperatorScope(crypto.randomUUID(), "합성 운영자") },
  ])
    expect(() => operatorAlertDirectory(db, scope as unknown as OperatorScope)).toThrow(ForgedScopeError);
  expect(calls).toBe(0);
});
it("운영자 알림 무인증은401/데이터베이스0", async () => {
  let calls = 0;
  const fail = async (): Promise<never> => {
    calls++;
    throw new Error("데이터베이스 호출 금지");
  };
  const app = createApp({
    connect: () => ({ query: fail, transaction: fail, abort: async () => {}, close: async () => {} }),
    logSink: () => {},
  });
  await expectProblem(await app.request(`${ORIGIN}/api/operator/alerts`, {}, testEnv()), "unauthenticated");
  expect(calls).toBe(0);
});
