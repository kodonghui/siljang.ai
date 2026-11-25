import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RequestDb } from "../src/db";
import { DUE_SOURCE_NAMES, DUE_SOURCES, FIND_SHAPE, LAST_DAILY_RUN, LAST_RUN_SHAPE } from "../src/due-sources";
import { nextDeliveryCheckAt } from "../src/retry";
import { createShopScope, shopDb } from "../src/shop-scope";
import { describeDb, newUuid } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop } from "./support/shops";

// 기다리는 일을 찾는 곳(TASK-023). 찾기가 05의 부분 인덱스와 같은 조건이고 그 인덱스를 쓰는지, 잡기가 찾기와 같은 조건인지,
// 발송 결과 조회의 1·5·30분 셈이 retry.ts와 같은지 본다.

const schema = readFileSync(new URL("../../../db/schema.sql", import.meta.url), "utf8");

interface PartialIndex {
  readonly table: string;
  readonly column: string;
  readonly predicate: string;
}

function partialIndexes(): Map<string, PartialIndex> {
  const out = new Map<string, PartialIndex>();
  for (const m of schema.matchAll(/^CREATE INDEX ([a-z_]+) ON ([a-z_]+) \(([a-z_]+)\) WHERE (.+?);/gm)) {
    out.set(m[1] as string, { table: m[2] as string, column: m[3] as string, predicate: m[4] as string });
  }
  return out;
}

describe("찾는 곳과 05 인덱스", () => {
  const indexes = partialIndexes();

  it("곳 이름 목록과 SQL에 now()가 없음(기준 시각은 실행기가 넘김)", () => {
    expect(DUE_SOURCE_NAMES).toEqual(Object.keys(DUE_SOURCES));
    for (const name of DUE_SOURCE_NAMES) {
      const s = DUE_SOURCES[name];
      expect(`${s.find} ${s.claim}`, name).not.toMatch(/now\(\)|current_timestamp|clock_timestamp/i);
    }
    expect(LAST_RUN_SHAPE.test(LAST_DAILY_RUN)).toBe(true);
  });

  for (const name of DUE_SOURCE_NAMES) {
    const s = DUE_SOURCES[name];

    it(`${name}: 찾기는 정한 꼴이고 05 부분 인덱스(${s.index})의 조건으로 시작함`, () => {
      const m = FIND_SHAPE.exec(s.find);
      expect(m).not.toBeNull();
      const [, due, table, where] = m as RegExpExecArray;
      expect(due).toBe(s.dueColumn);
      expect(table).toBe(s.table);
      const idx = indexes.get(s.index);
      expect(idx?.table).toBe(s.table);
      expect(idx?.column).toBe(s.dueColumn);
      const own = (where as string).replaceAll(/\bt\./g, "");
      const predicate = idx?.predicate as string;
      expect(own === predicate || own.startsWith(`${predicate} AND `), own).toBe(true);
    });

    it(`${name}: 잡기는 찾기와 같은 조건에 가게·행 ID와 FOR UPDATE SKIP LOCKED`, () => {
      const where = (FIND_SHAPE.exec(s.find) as RegExpExecArray)[3] as string;
      expect(s.claim).toBe(
        `SELECT t.id FROM ${s.table} t WHERE t.shop_id = $1 AND t.id = $2 AND ${where.replaceAll("$1", "$3")} AND t.${s.dueColumn} <= $3 FOR UPDATE SKIP LOCKED`,
      );
    });
  }
});

describeDb("찾는 곳(데이터베이스)", () => {
  let db: RequestDb;
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>;

  beforeAll(async () => {
    isolated = await isolatedTestDb();
    db = isolated.db;
  }, 30000);

  afterAll(async () => {
    await isolated?.close();
  });

  it("찾기마다 실행 계획이 그 05 인덱스를 씀(테이블 전체를 읽지 않음)", async () => {
    await db.transaction(async (tx) => {
      await tx.query("SET LOCAL enable_seqscan = off");
      for (const name of DUE_SOURCE_NAMES) {
        const s = DUE_SOURCES[name];
        const r = await tx.query(`EXPLAIN (FORMAT JSON) ${s.find}`, [new Date(), 10]);
        expect(JSON.stringify(r.rows[0]), name).toContain(`"Index Name":"${s.index}"`);
      }
    });
  });

  it("잡기가 가게 범위 연결로 돎(없는 행은 0행)", async () => {
    const f = await createShop(db, "찾는 곳 시험");
    const sdb = shopDb(createShopScope(f.shopId, { kind: "job", job: "due_source_test" }), db);
    for (const name of DUE_SOURCE_NAMES) {
      const r = await sdb.run(DUE_SOURCES[name].claim, [newUuid(), new Date()]);
      expect(r.rowCount, name).toBe(0);
    }
    const last = await db.query<{ last_at: Date | null }>(LAST_DAILY_RUN, ["purge_run", new Date(0), new Date(60_000)]);
    expect(last.rows[0]?.last_at).toBeNull();
  });

  it("발송 결과 조회 때(1·5·30분)가 retry.ts의 nextDeliveryCheckAt과 같음", async () => {
    const f = await createShop(db, "발송 결과 조회 시험");
    const sdb = shopDb(createShopScope(f.shopId, { kind: "job", job: "due_source_test" }), db);
    const minute = 60_000;
    // 다른 시험의 실행기가 찾지 않게 먼 뒤의 시각에 둔다.
    const requested = new Date(Date.UTC(2090, 0, 1) + Math.floor(Math.random() * 500_000) * minute);
    const at = (m: number, s = 0) => new Date(requested.getTime() + m * minute + s * 1000);
    const checks: (Date | null)[] = [null, at(1, 10), at(5, 10), at(30, 10)];
    const nows = [at(0, 30), at(1), at(2), at(5), at(6), at(29, 59), at(30), at(31), at(90)];
    const ids: string[] = [];
    let compared = 0;
    for (const checked of checks) {
      for (const now of nows) {
        if (checked !== null && checked.getTime() > now.getTime()) continue;
        const r = await db.query<{ id: string }>(
          `INSERT INTO owner_alerts (shop_id, event_key, kind, status, kakao_task_id, requested_at, delivery_checked_at)
           VALUES ($1, $2, 'new_task', 'confirming', 'task-test', $3, $4) RETURNING id`,
          [f.shopId, `alert:new_task:${newUuid()}`, requested, checked],
        );
        const id = r.rows[0]?.id as string;
        ids.push(id);
        const due = await sdb.run(DUE_SOURCES.owner_alert_check.claim, [id, now]);
        const expected = nextDeliveryCheckAt(requested, checked).getTime() <= now.getTime();
        expect(due.rowCount === 1, `checked ${checked?.toISOString()} now ${now.toISOString()}`).toBe(expected);
        compared += 1;
      }
    }
    expect(compared).toBe(23);
    // 손님 안내도 같은 셈(같은 꼴의 SQL이 돎).
    const n = await db.query<{ id: string }>(
      `INSERT INTO notifications (shop_id, event_key, customer_id, consultation_id, kind, template_key, body, status,
                                  kakao_task_id, requested_at)
       VALUES ($1, $2, $3, $4, 'order_confirmed', 'order_confirmed', '시험 안내', 'confirming', 'task-test', $5) RETURNING id`,
      [f.shopId, `notice:${newUuid()}:order_confirmed`, f.customerId, f.consultationId, requested],
    );
    const nid = n.rows[0]?.id as string;
    expect((await sdb.run(DUE_SOURCES.notification_check.claim, [nid, at(0, 59)])).rowCount).toBe(0);
    expect((await sdb.run(DUE_SOURCES.notification_check.claim, [nid, at(1)])).rowCount).toBe(1);
    // 끝난 행으로 둔다(다른 시험의 찾기에 걸리지 않게).
    await sdb.run(
      "UPDATE owner_alerts t SET status = 'failed', fail_code = 'unknown' WHERE t.shop_id = $1 AND t.id = ANY($2::uuid[])",
      [ids],
    );
    await sdb.run("UPDATE notifications t SET status = 'deferred' WHERE t.shop_id = $1 AND t.id = $2", [nid]);
  });
});
