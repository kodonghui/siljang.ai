import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Queryable, RequestDb } from "../src/db";
import {
  EVENT_KEY_TABLES,
  type EventKeyTable,
  EXISTING_KEY_SQL,
  eventKeys,
  insertOnce,
  LEDGER_EVENT_KINDS,
  PAYMENT_KINDS,
  REFUND_CAUSES,
  REMAKE_LEDGER_EVENTS,
} from "../src/event-keys";
import { createShopScope, type ShopDb, shopDb } from "../src/shop-scope";
import { describeDb, newUuid, testDb } from "./support/db";
import { createShop, type ShopFixture } from "./support/shops";

// 같은 일은 한 번만(05 A33, 04 G2, REQ-132·154). TASK-023의 '05 앱 규칙(A33)을 지키는지 보는 서버 시험'.

const readme = readFileSync(new URL("../../../docs/05-erd/README.md", import.meta.url), "utf8");
const schema = readFileSync(new URL("../../../db/schema.sql", import.meta.url), "utf8");

interface A33Row {
  readonly table: string;
  readonly column: string;
  readonly formats: readonly string[];
  readonly once: string;
}

/** 05 README의 'A33의 키 형식' 표(4절 A33 아래). */
function a33Rows(): A33Row[] {
  const start = readme.indexOf("A33의 키 형식입니다.");
  const end = readme.indexOf("\n## ", start);
  expect(start).toBeGreaterThan(0);
  const rows: A33Row[] = [];
  for (const line of readme.slice(start, end).split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    const col = /^`([a-z_]+)\.([a-z_]+)`$/.exec(cells[1] ?? "");
    if (col === null) continue;
    const quoted = [...(cells[2] ?? "").matchAll(/`([^`]+)`/g)].map((m) => m[1] as string);
    const base = quoted.find((q) => !q.startsWith(":")) as string;
    // ':{…}'로 시작하는 것은 첫 형식 뒤에 붙는 꼴(다시 알림의 가게 날짜, 들어온 금액 합).
    const formats = quoted.map((q) => (q.startsWith(":") ? `${base}${q}` : q));
    const once = /`([a-z_]+)`/.exec(cells[4] ?? "")?.[1] ?? "";
    rows.push({ table: col[1] as string, column: col[2] as string, formats, once });
  }
  return rows;
}

const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** 표의 형식을 정규식으로: {…ID…}는 소문자 uuid, 금액·합은 숫자, 날짜는 YYYY-MM-DD, 그 밖(종류·사유·일)은 영문 값. */
function formatRegex(format: string): RegExp {
  const parts = format.split(/(\{[^}]+\})/).map((p) => {
    if (!p.startsWith("{")) return p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (p.includes("ID")) return UUID_RE;
    if (p.includes("금액") || p.includes("합")) return "\\d+";
    if (p.includes("날짜")) return "\\d{4}-\\d{2}-\\d{2}";
    return "[a-z][a-z0-9_]*";
  });
  return new RegExp(`^${parts.join("")}$`);
}

/** CHECK (col IN ('a', 'b'))의 값. */
function checkValues(table: string, column: string): string[] {
  const body = new RegExp(`^CREATE TABLE ${table} \\(\\n([\\s\\S]*?)^\\);`, "m").exec(schema)?.[1] ?? "";
  const line = new RegExp(`^\\s+${column}\\s.*CHECK \\(${column} IN \\(([^)]*)\\)\\)`, "m").exec(body)?.[1] ?? "";
  return [...line.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);
}

const U = "7d0f3c1e-5b2a-4c4d-8e9f-0a1b2c3d4e5f";
const U2 = "0f1e2d3c-4b5a-4968-8776-655443322110";

/** 키 짓는 함수가 만드는 키(테이블마다 모든 꼴). */
const SAMPLES: { readonly [T in EventKeyTable]: readonly string[] } = {
  payment_requests: PAYMENT_KINDS.map((k) => eventKeys.pay(U, k)),
  refunds: REFUND_CAUSES.map((c) =>
    c === "paid_after_cancel" || c === "over_received" ? eventKeys.refund(U, c, 35000) : eventKeys.refund(U, c),
  ),
  slot_holds: [eventKeys.hold(U, U2), eventKeys.holdRemake(U)],
  owner_tasks: [eventKeys.task("payment_overdue", U), eventKeys.task("arrival_refund", U, 70000)],
  owner_alerts: [eventKeys.alert("new_task", U), eventKeys.alert("task_realert", U, "2026-11-16")],
  notifications: [eventKeys.notice(U, "order_confirmed")],
  ledger_writes: [
    ...LEDGER_EVENT_KINDS.map((k) => eventKeys.ledger(U, k)),
    ...REMAKE_LEDGER_EVENTS.map((w) => eventKeys.ledgerRemake(U, w)),
  ],
};

describe("A33 키 형식(05 README의 표와 견줌)", () => {
  const rows = a33Rows();

  it("표의 일곱 테이블·키 열·접두가 EVENT_KEY_TABLES와 같음", () => {
    expect(rows.map((r) => r.table).sort()).toEqual(Object.keys(EVENT_KEY_TABLES).sort());
    for (const r of rows) {
      const spec = EVENT_KEY_TABLES[r.table as EventKeyTable];
      expect(r.column, r.table).toBe(spec.column);
      for (const f of r.formats) expect(f.startsWith(`${spec.prefix}:`), f).toBe(true);
    }
  });

  it("키 짓는 함수의 키는 모두 표의 형식이고, 표의 형식은 모두 함수가 지음", () => {
    for (const r of rows) {
      const res = r.formats.map(formatRegex);
      const samples = SAMPLES[r.table as EventKeyTable];
      for (const key of samples)
        expect(
          res.some((re) => re.test(key)),
          `${r.table}: ${key}`,
        ).toBe(true);
      r.formats.forEach((f, i) => {
        expect(
          samples.some((key) => (res[i] as RegExp).test(key)),
          `${r.table}: ${f}`,
        ).toBe(true);
      });
    }
  });

  it("종류·사유 값이 05의 CHECK와 같음(재제작은 ledgerRemake로)", () => {
    expect([...PAYMENT_KINDS].sort()).toEqual(checkValues("payment_requests", "kind").sort());
    expect([...REFUND_CAUSES].sort()).toEqual(checkValues("refunds", "cause").sort());
    expect([...LEDGER_EVENT_KINDS, "remake"].sort()).toEqual(checkValues("ledger_writes", "event_kind").sort());
  });

  it("표의 '한 번만' 제약이 05에서 (shop_id, 키) UNIQUE", () => {
    for (const r of rows) {
      expect(schema, r.once).toContain(`CONSTRAINT ${r.once} UNIQUE (shop_id, ${r.column})`);
    }
  });

  it("대상 ID는 uuid를 소문자로, 틀린 값은 TypeError(값은 메시지에 없음)", () => {
    expect(eventKeys.pay(U.toUpperCase(), "first")).toBe(`pay:${U}:first`);
    expect(() => eventKeys.pay("order-1", "first")).toThrow(TypeError);
    expect(() => eventKeys.notice(U, "Order Confirmed")).toThrow(TypeError);
    expect(() => eventKeys.alert("task_realert", U, "2026-02-30")).toThrow(TypeError);
    expect(() => eventKeys.refund(U, "paid_after_cancel")).toThrow(TypeError);
    expect(() => eventKeys.refund(U, "customer_cancel", 1000)).toThrow(TypeError);
    expect(() => eventKeys.task("arrival_refund", U, -1)).toThrow(TypeError);
    try {
      eventKeys.pay("secret-looking-value", "first");
    } catch (err) {
      expect((err as Error).message).not.toContain("secret-looking-value");
    }
  });

  it("insertOnce는 꼴이 다르거나 키가 그 테이블의 것이 아니면 보내지 않음", async () => {
    const sent: string[] = [];
    const fake = {
      run: async (sql: string) => {
        sent.push(sql);
        return { rows: [], rowCount: 0 };
      },
    } as unknown as ShopDb;
    const sql =
      "INSERT INTO owner_alerts (shop_id, event_key, kind) VALUES ($1, $2, 'new_task') ON CONFLICT (shop_id, event_key) DO NOTHING RETURNING id";
    await expect(insertOnce(fake, "owner_alerts", sql, [eventKeys.notice(U, "order_confirmed")])).rejects.toThrow(
      TypeError,
    );
    await expect(insertOnce(fake, "notifications", sql, [eventKeys.alert("new_task", U)])).rejects.toThrow(TypeError);
    await expect(
      insertOnce(fake, "owner_alerts", sql.replace(" ON CONFLICT (shop_id, event_key) DO NOTHING", ""), [
        eventKeys.alert("new_task", U),
      ]),
    ).rejects.toThrow(TypeError);
    await expect(
      insertOnce(fake, "owner_alerts", sql.replace("(shop_id, event_key) DO", "(event_key) DO"), [
        eventKeys.alert("new_task", U),
      ]),
    ).rejects.toThrow(TypeError);
    expect(sent).toEqual([]);
  });
});

/** 시험의 가게 범위 연결(출처 job). */
function scoped(q: Queryable, shopId: string): ShopDb {
  return shopDb(createShopScope(shopId, { kind: "job", job: "event_key_test" }), q);
}

interface KeyCase {
  readonly table: EventKeyTable;
  readonly key: (f: ShopFixture) => string;
  readonly sql: string;
  /** 키 뒤의 값($3부터). 필요한 행은 여기서 먼저 만든다(날 연결). */
  readonly params: (db: RequestDb, f: ShopFixture) => Promise<unknown[]>;
}

const CASES: readonly KeyCase[] = [
  {
    table: "payment_requests",
    key: (f) => eventKeys.pay(f.paymentRequestId, "reissue"),
    sql: `INSERT INTO payment_requests (shop_id, event_key, order_id, kind, status, amount, payment_account_id, delivered_at,
                                   due_at, due_cap_at, expired_at)
          VALUES ($1, $2, $3, 'reissue', 'expired', 35000, $4, now(), now() + interval '12 hours', now() + interval '2 days', now())
          ON CONFLICT (shop_id, event_key) DO NOTHING RETURNING id`,
    params: async (_db, f) => [f.orderId, f.paymentAccountId],
  },
  {
    table: "refunds",
    key: (f) => eventKeys.refund(f.orderId, "customer_cancel"),
    sql: `INSERT INTO refunds (shop_id, event_key, order_id, cause, cancelled_order_id, decision, amount, calculated_amount, calc_basis)
          VALUES ($1, $2, $3, 'customer_cancel', $3, 'full', 35000, 35000, '{"case":"task-023"}')
          ON CONFLICT (shop_id, event_key) DO NOTHING RETURNING id`,
    params: async (_db, f) => [f.orderId],
  },
  {
    table: "slot_holds",
    key: (f) => eventKeys.hold(f.orderId, f.paymentRequestId),
    sql: `INSERT INTO slot_holds (shop_id, hold_key, day, order_id, status, payment_request_id)
          VALUES ($1, $2, $3, $4, 'held', $5) ON CONFLICT (shop_id, hold_key) DO NOTHING RETURNING id`,
    params: async (db, f) => {
      const r = await db.query<{ day: string }>("SELECT pickup_day AS day FROM orders WHERE id = $1", [f.orderId]);
      const day = r.rows[0]?.day as string;
      await db.query("INSERT INTO calendar_days (shop_id, day) VALUES ($1, $2) ON CONFLICT DO NOTHING", [
        f.shopId,
        day,
      ]);
      return [day, f.orderId, f.paymentRequestId];
    },
  },
  {
    table: "owner_tasks",
    key: (f) => eventKeys.task("payment_overdue", f.paymentRequestId),
    sql: `INSERT INTO owner_tasks (shop_id, event_key, kind, order_id) VALUES ($1, $2, 'payment_overdue', $3)
          ON CONFLICT (shop_id, event_key) DO NOTHING RETURNING id`,
    params: async (_db, f) => [f.orderId],
  },
  {
    table: "owner_alerts",
    key: (f) => eventKeys.alert("new_task", f.orderId),
    sql: `INSERT INTO owner_alerts (shop_id, event_key, kind) VALUES ($1, $2, 'new_task')
          ON CONFLICT (shop_id, event_key) DO NOTHING RETURNING id`,
    params: async () => [],
  },
  {
    table: "notifications",
    key: (f) => eventKeys.notice(f.orderId, "order_confirmed"),
    sql: `INSERT INTO notifications (shop_id, event_key, customer_id, consultation_id, order_id, kind, template_key, body)
          VALUES ($1, $2, $3, $4, $5, 'order_confirmed', 'order_confirmed', '시험 안내')
          ON CONFLICT (shop_id, event_key) DO NOTHING RETURNING id`,
    params: async (_db, f) => [f.customerId, f.consultationId, f.orderId],
  },
  {
    table: "ledger_writes",
    key: (f) => eventKeys.ledger(f.paymentRequestId, "confirmed"),
    sql: `INSERT INTO ledger_writes (shop_id, event_key, ledger_row_id, event_kind) VALUES ($1, $2, $3, 'confirmed')
          ON CONFLICT (shop_id, event_key) DO NOTHING RETURNING id`,
    params: async (db, f) => {
      const r = await db.query<{ id: string }>(
        "INSERT INTO ledger_rows (shop_id, order_id) VALUES ($1, $2) RETURNING id",
        [f.shopId, f.orderId],
      );
      return [r.rows[0]?.id];
    },
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describeDb("insertOnce: 같은 키는 가게마다 한 행(데이터베이스)", () => {
  let db: RequestDb;
  let other: RequestDb;

  beforeAll(() => {
    db = testDb();
    other = testDb();
  });

  afterAll(async () => {
    await db.close();
    await other.close();
  });

  it("CASES가 일곱 테이블을 모두 다룸", () => {
    expect(CASES.map((c) => c.table).sort()).toEqual(Object.keys(EVENT_KEY_TABLES).sort());
  });

  it("같은 키를 찾는 SQL이 테이블마다 돎", async () => {
    const f = await createShop(db, "키 찾기 시험");
    for (const table of Object.keys(EVENT_KEY_TABLES) as EventKeyTable[]) {
      const r = await scoped(db, f.shopId).run(EXISTING_KEY_SQL[table], [`missing:${newUuid()}`]);
      expect(r.rowCount, table).toBe(0);
    }
  });

  for (const c of CASES) {
    it(`${c.table}: 차례로 두 번 넣어도 한 행, 둘째는 처음 행의 ID`, async () => {
      const f = await createShop(db, `키 차례 ${c.table}`);
      const params = await c.params(db, f);
      const key = c.key(f);
      const first = await insertOnce(scoped(db, f.shopId), c.table, c.sql, [key, ...params]);
      const second = await insertOnce(scoped(db, f.shopId), c.table, c.sql, [key, ...params]);
      expect(first.created).toBe(true);
      expect(second).toEqual({ id: first.id, created: false });
      const rows = await scoped(db, f.shopId).run(EXISTING_KEY_SQL[c.table], [key]);
      expect(rows.rowCount).toBe(1);
    });

    it(`${c.table}: 동시에 두 번 넣으면 뒤는 앞이 끝날 때까지 기다려 같은 ID를 받음`, async () => {
      const f = await createShop(db, `키 동시 ${c.table}`);
      const params = await c.params(db, f);
      const key = c.key(f);
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let signal: () => void = () => {};
      const inserted = new Promise<void>((resolve) => {
        signal = resolve;
      });
      const p1 = db.transaction(async (tx) => {
        const once = await insertOnce(scoped(tx, f.shopId), c.table, c.sql, [key, ...params]);
        signal();
        await gate;
        return once;
      });
      await inserted;
      const p2 = other.transaction((tx) => insertOnce(scoped(tx, f.shopId), c.table, c.sql, [key, ...params]));
      const state = await Promise.race([p2.then(() => "done"), sleep(150).then(() => "waiting")]);
      expect(state).toBe("waiting");
      release();
      const [o1, o2] = await Promise.all([p1, p2]);
      expect(o1.created).toBe(true);
      expect(o2).toEqual({ id: o1.id, created: false });
      const rows = await scoped(db, f.shopId).run(EXISTING_KEY_SQL[c.table], [key]);
      expect(rows.rowCount).toBe(1);
    });
  }

  const alertSql =
    "INSERT INTO owner_alerts (shop_id, event_key, kind) VALUES ($1, $2, 'new_task') ON CONFLICT (shop_id, event_key) DO NOTHING RETURNING id";

  it("앞 트랜잭션이 되돌려지면 기다리던 뒤가 새로 넣음", async () => {
    const f = await createShop(db, "키 되돌림");
    const key = eventKeys.alert("new_task", newUuid());
    let signal: () => void = () => {};
    const inserted = new Promise<void>((resolve) => {
      signal = resolve;
    });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const p1 = db
      .transaction(async (tx) => {
        await insertOnce(scoped(tx, f.shopId), "owner_alerts", alertSql, [key]);
        signal();
        await gate;
        throw new Error("rollback for test");
      })
      .catch((err: Error) => err.message);
    await inserted;
    const p2 = other.transaction((tx) => insertOnce(scoped(tx, f.shopId), "owner_alerts", alertSql, [key]));
    release();
    expect(await p1).toBe("rollback for test");
    expect((await p2).created).toBe(true);
  });

  it("다른 가게의 같은 키는 다른 이벤트(가게마다 한 번)", async () => {
    const a = await createShop(db, "키 가게 A");
    const b = await createShop(db, "키 가게 B");
    const key = eventKeys.alert("new_task", newUuid());
    const inA = await insertOnce(scoped(db, a.shopId), "owner_alerts", alertSql, [key]);
    const inB = await insertOnce(scoped(db, b.shopId), "owner_alerts", alertSql, [key]);
    expect(inA.created && inB.created).toBe(true);
    expect(inA.id).not.toBe(inB.id);
  });
});
