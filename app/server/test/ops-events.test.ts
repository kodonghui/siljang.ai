import { afterAll, describe, expect, it } from "vitest";
import { pgConnector } from "../src/db";
import { OPS_EVENT_KINDS, recordOpsEvent } from "../src/ops-events";
import { describeDb, newProbe, testDb } from "./support/db";

describe("운영 기록 값 검사(데이터베이스 전)", () => {
  const nodb = pgConnector(null);
  const bad: [string, Parameters<typeof recordOpsEvent>[1]][] = [
    ["모르는 종류", { kind: "other" as never }],
    ["음수 건수", { kind: "purge_run", count: -1 }],
    ["정수 아닌 건수", { kind: "purge_run", count: 1.5 }],
    ["글 값", { kind: "purge_run", detail: { name: "홍길동" as unknown as number } }],
    ["이름 꼴이 아님", { kind: "purge_run", detail: { "Bad Name": 1 } }],
    ["무한", { kind: "purge_run", detail: { n: Number.POSITIVE_INFINITY } }],
  ];
  for (const [what, ev] of bad) {
    it(`${what}는 TypeError(값은 메시지에 없음)`, async () => {
      const err = await recordOpsEvent(nodb, ev).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TypeError);
      expect(String((err as Error).message)).not.toContain("홍길동");
    });
  }
});

describeDb("운영 기록 쓰기(데이터베이스)", () => {
  const db = testDb();
  afterAll(() => db.close());

  it("종류 목록이 데이터베이스의 CHECK(ops_events.kind)와 같다", async () => {
    const r = await db.query<{ def: string }>(
      `SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
       WHERE c.conrelid = 'ops_events'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%kind%'`,
    );
    const kinds = [...(r.rows[0]?.def ?? "").matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
    expect(kinds.sort()).toEqual([...OPS_EVENT_KINDS].sort());
  });

  it("한 행을 넣고 ID를 돌려준다. detail은 숫자만, 가게 없음은 null", async () => {
    const probe = newProbe();
    const id = await recordOpsEvent(db, { kind: "message_rate_limited", count: 3, detail: { probe, per_minute: 60 } });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const r = await db.query<Record<string, unknown>>(
      "SELECT shop_id, kind, count, detail FROM ops_events WHERE id = $1",
      [id],
    );
    expect(r.rows[0]).toEqual({
      shop_id: null,
      kind: "message_rate_limited",
      count: 3,
      detail: { probe, per_minute: 60 },
    });
  });
});
