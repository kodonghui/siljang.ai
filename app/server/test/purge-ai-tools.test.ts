import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { purgeExpiredAiToolCalls } from "../src/purge-ai-tools";
import { createShopScope, shopDb } from "../src/shop-scope";
import { describeDb, newUuid, testDb } from "./support/db";
import { createShop, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-21T00:00:00Z");
const DAY = 86_400_000;
type PurgeFixture = Pick<ShopFixture, "shopId" | "consultationId">;

describeDb("30일 지난 AI 도구 인자 지우기(TASK-158, SPEC-065 #9)", () => {
  const db = testDb();
  let a: PurgeFixture;
  let b: PurgeFixture;
  beforeAll(async () => {
    const baseA = await createShop(db, "보관 기간 A");
    const customerId = newUuid();
    a = { shopId: baseA.shopId, consultationId: newUuid() };
    await db.query("INSERT INTO customers (id, shop_id, kakao_channel_id, kakao_user_key) VALUES ($1, $2, $3, $4)", [
      customerId,
      a.shopId,
      baseA.channelId,
      `synthetic-open-${newUuid()}`,
    ]);
    await db.query("INSERT INTO consultations (id, shop_id, customer_id, opened_at) VALUES ($1, $2, $3, $4)", [
      a.consultationId,
      a.shopId,
      customerId,
      new Date(NOW.getTime() - 32 * DAY),
    ]);
    b = await createShop(db, "보관 기간 B");
  });
  afterEach(async () => {
    await db.query("DELETE FROM ai_tool_calls WHERE shop_id = ANY($1::uuid[])", [[a.shopId, b.shopId]]);
    await db.query("DELETE FROM ai_calls WHERE shop_id = ANY($1::uuid[])", [[a.shopId, b.shopId]]);
  });
  afterAll(() => db.close());

  const scoped = (f: PurgeFixture, connection = db) =>
    shopDb(createShopScope(f.shopId, { kind: "job", job: "purge" }), connection);

  async function seed(f: PurgeFixture, ageDays: number) {
    const callId = newUuid();
    const toolId = newUuid();
    const calledAt = new Date(NOW.getTime() - ageDays * DAY);
    await db.query(
      `INSERT INTO ai_calls
       (id, shop_id, consultation_id, trace_id, provider, model, prompt_version, sent_at,
        input_tokens, output_tokens, cost_krw, result, created_at)
       VALUES ($1, $2, $3, $4, 'synthetic', 'synthetic-model', 'test-1', $5, 7, 5, 1.25, 'success', $5)`,
      [callId, f.shopId, f.consultationId, newUuid(), calledAt],
    );
    await db.query(
      `INSERT INTO ai_tool_calls (id, shop_id, ai_call_id, consultation_id, tool_name, args_masked, result, called_at)
       VALUES ($1, $2, $3, $4, 'read_clause', '{"clause":"synthetic"}', 'ok', $5)`,
      [toolId, f.shopId, callId, f.consultationId, calledAt],
    );
    return toolId;
  }
  async function tools(f: PurgeFixture) {
    return (
      await db.query<{ id: string }>("SELECT id FROM ai_tool_calls WHERE shop_id = $1 ORDER BY id", [f.shopId])
    ).rows.map((r) => r.id);
  }
  const costs = (f: PurgeFixture) =>
    db.query("SELECT id, input_tokens, output_tokens, cost_krw, sent_at FROM ai_calls WHERE shop_id = $1 ORDER BY id", [
      f.shopId,
    ]);

  it("열린 상담도 30일 경계의 도구 인자만 지우고 29일 인자와 토큰·비용을 보존", async () => {
    await seed(a, 31);
    await seed(a, 30);
    const recent = await seed(a, 29);
    const before = await costs(a);
    expect(await purgeExpiredAiToolCalls(scoped(a), NOW)).toBe(2);
    expect(await tools(a)).toEqual([recent]);
    expect((await costs(a)).rows).toEqual(before.rows);
    expect((await db.query("SELECT status FROM consultations WHERE id = $1", [a.consultationId])).rows).toEqual([
      { status: "open" },
    ]);
  });
  it("가게 A 지우기는 B의 같은 나이 인자를 지우지 않음", async () => {
    await seed(a, 31);
    const other = await seed(b, 31);
    expect(await purgeExpiredAiToolCalls(scoped(a), NOW)).toBe(1);
    expect(await tools(a)).toEqual([]);
    expect(await tools(b)).toEqual([other]);
  });
  it("잠긴 행을 건너뛰고 잠금을 푼 뒤 한 번만 지움", async () => {
    const id = await seed(a, 31);
    const locker = testDb();
    try {
      await locker.transaction(async (tx) => {
        await tx.query("SELECT id FROM ai_tool_calls WHERE shop_id = $1 AND id = $2 FOR UPDATE", [a.shopId, id]);
        expect(await purgeExpiredAiToolCalls(scoped(a), NOW)).toBe(0);
        expect(await tools(a)).toEqual([id]);
      });
      expect(await purgeExpiredAiToolCalls(scoped(a), NOW)).toBe(1);
      expect(await purgeExpiredAiToolCalls(scoped(a), NOW)).toBe(0);
    } finally {
      await locker.close();
    }
  });
  it("동시 실행은 정한 배치 크기로 서로 다른 인자를 지우고 비용 행은 보존", async () => {
    await seed(a, 32);
    await seed(a, 31);
    const before = await costs(a);
    const other = testDb();
    try {
      expect(
        await Promise.all([
          purgeExpiredAiToolCalls(scoped(a), NOW, 1),
          purgeExpiredAiToolCalls(scoped(a, other), NOW, 1),
        ]),
      ).toEqual([1, 1]);
      expect(await tools(a)).toEqual([]);
      expect((await costs(a)).rows).toEqual(before.rows);
    } finally {
      await other.close();
    }
  });
});
