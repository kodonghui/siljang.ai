import { afterAll, beforeAll, expect, it } from "vitest";
import { HANDOFF_OWNER_TASK_JOIN, handoffSourceMatch } from "../src/handoff-source";
import { describeDb } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, type ShopFixture } from "./support/shops";

describeDb("실제 수신 글·확인 건 연결의 조회 계획(TASK-068)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
    shop = await createShop(isolated.db, "합성 연결 조회 가게");
  }, 30000);
  afterAll(async () => {
    await isolated?.close();
  });
  const queries = [
    () => ({
      label: "공통 수신 글 상관 조건",
      sql: `SELECT h.id FROM handoffs h WHERE h.shop_id=$1 AND ${handoffSourceMatch("$2")}`,
      values: [shop.shopId, shop.messageId],
    }),
    () => ({
      label: "기존 수신 글의 날짜 판정",
      sql: `SELECT h.id,t.detail FROM handoffs h ${HANDOFF_OWNER_TASK_JOIN} WHERE h.shop_id=$1 AND h.consultation_id=$3 AND ${handoffSourceMatch("$2")} ORDER BY h.created_at,h.id LIMIT 1`,
      values: [shop.shopId, shop.messageId, shop.consultationId],
    }),
    () => ({
      label: "열린 날짜 건의 재사용",
      sql: `SELECT h.id,t.detail FROM handoffs h ${HANDOFF_OWNER_TASK_JOIN} WHERE h.shop_id=$1 AND h.consultation_id=$2 AND h.reason='closed_day' AND h.requested_day=$3::date AND h.status='open'`,
      values: [shop.shopId, shop.consultationId, "2026-11-25"],
    }),
  ];
  for (const get of queries)
    it(`인덱스가 실제 연결 조건을 지원함: ${queries.indexOf(get)}`, async () => {
      const query = get();
      await isolated.db.transaction(async (tx) => {
        await tx.query("SET LOCAL enable_seqscan=off");
        const plan = await tx.query(`EXPLAIN (FORMAT JSON) ${query.sql}`, query.values);
        expect(JSON.stringify(plan.rows[0]), query.label).toContain('"Index Name":"owner_tasks_handoff_idx"');
      });
    });
});
