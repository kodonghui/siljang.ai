import { afterAll, beforeEach, expect, it } from "vitest";
import { maskValue } from "../src/masked-values";
import { purgeConsultation } from "../src/purge-consultation";
import { purgeOrder } from "../src/purge-order";
import { createShopScope, type ShopDb, shopRequestDb } from "../src/shop-scope";
import { describeDb, newUuid, testDb } from "./support/db";
import { singleKeyCrypto } from "./support/field-keys";
import { createShop, type ShopFixture, snapshotShop } from "./support/shops";

const NOW = new Date("2026-11-21T00:00:00Z");
const DAY = 86_400_000;
const { fc } = singleKeyCrypto();

describeDb("닫힌 상담의 내용 지우기(TASK-158, SPEC-065 #2·#6)", () => {
  const db = testDb();
  let f: ShopFixture;
  let handoffId: string;
  let taskId: string;
  let orphanId: string;
  let fileKey: string;
  let firstAlert: string;
  let secondAlert: string;
  const scoped = (fixture = f, connection = db) =>
    shopRequestDb(createShopScope(fixture.shopId, { kind: "job", job: "purge" }), connection);
  const run = (fixture = f, id = f.consultationId, connection = db) =>
    scoped(fixture, connection).transaction((tx) => purgeConsultation(tx, id, NOW));
  const archiveOrder = () => scoped().transaction((tx) => purgeOrder(tx, f.orderId, NOW));
  beforeEach(async () => {
    f = await createShop(db, "상담 지우기 시험");
    handoffId = newUuid();
    taskId = newUuid();
    orphanId = newUuid();
    firstAlert = newUuid();
    secondAlert = newUuid();
    fileKey = `shops/${f.shopId}/reference/${newUuid()}.webp`;
    const ended = new Date(NOW.getTime() - 31 * DAY);
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE payment_requests SET status = 'closed', closed_at = $2, close_reason = 'order_cancelled' WHERE order_id = $1",
        [f.orderId, ended],
      );
      await tx.query(
        "UPDATE orders SET status = 'cancelled', cancelled_at = $2, cancel_kind = 'no_payment', finished_at = $2 WHERE id = $1",
        [f.orderId, ended],
      );
      await tx.query("UPDATE consultations SET status = 'ended', ended_at = $2 WHERE id = $1", [
        f.consultationId,
        ended,
      ]);
      await tx.query(
        "INSERT INTO order_drafts (id, shop_id, consultation_id, customer_name, customer_phone) VALUES ($1, $2, $3, '합성임시손님', '010-0000-0000')",
        [orphanId, f.shopId, f.consultationId],
      );
      await tx.query(
        "INSERT INTO reference_photos (shop_id, draft_id, message_id, storage_key, content_type, byte_size) VALUES ($1, $2, $3, $4, 'image/webp', 10)",
        [f.shopId, orphanId, f.messageId, fileKey],
      );
      await tx.query(
        "INSERT INTO handoffs (id, shop_id, consultation_id, source_message_id, order_id, reason, status, closed_at) VALUES ($1, $2, $3, $4, $5, 'cannot_answer', 'closed_no_answer', $6)",
        [handoffId, f.shopId, f.consultationId, f.messageId, f.orderId, ended],
      );
      await tx.query(
        "INSERT INTO handoff_questions (shop_id, handoff_id, message_id, reason) VALUES ($1, $2, $3, 'cannot_answer')",
        [f.shopId, handoffId, f.messageId],
      );
      await tx.query(
        "INSERT INTO owner_tasks (id, shop_id, kind, event_key, handoff_id, wait_status, wait_due_at, closed_at, detail) VALUES ($1, $2, 'handoff', $3, $4, 'closed_no_answer', $5, $5, '{\"text\":\"synthetic\"}')",
        [taskId, f.shopId, `synthetic:${newUuid()}`, handoffId, ended],
      );
      await tx.query(
        "INSERT INTO owner_alerts (id, shop_id, owner_task_id, kind, event_key, status, fail_code) VALUES ($1, $2, $3, 'new_task', $4, 'not_friend', 'not_friend')",
        [firstAlert, f.shopId, taskId, `synthetic:${newUuid()}`],
      );
      await tx.query(
        "INSERT INTO owner_alerts (id, shop_id, owner_task_id, kind, event_key, status, batched_into_id) VALUES ($1, $2, $3, 'new_task', $4, 'batched', $5)",
        [secondAlert, f.shopId, taskId, `synthetic:${newUuid()}`, firstAlert],
      );
      await tx.query(
        "INSERT INTO notifications (shop_id, customer_id, consultation_id, kind, event_key, template_key, body, status) VALUES ($1, $2, $3, 'owner_reply', $4, 'synthetic', '합성 안내', 'deferred')",
        [f.shopId, f.customerId, f.consultationId, `synthetic:${newUuid()}`],
      );
      const callId = newUuid();
      await tx.query(
        "INSERT INTO ai_calls (id, shop_id, consultation_id, trace_id, provider, model, prompt_version, sent_at, cost_krw, result) VALUES ($1, $2, $3, $4, 'synthetic', 'synthetic-model', 'test-1', $5, 1.25, 'timeout')",
        [callId, f.shopId, f.consultationId, newUuid(), NOW],
      );
      await tx.query(
        "INSERT INTO ai_tool_calls (shop_id, ai_call_id, consultation_id, tool_name, args_masked, result) VALUES ($1, $2, $3, 'read_clause', '{}', 'ok')",
        [f.shopId, callId, f.consultationId],
      );
    });
    await scoped().transaction((tx) => maskValue(tx, fc, f.consultationId, "phone", "01000000000"));
  });
  afterAll(() => db.close());

  it("닫힌 지 31일이고 주문이 보관된 상담은 내용과 원래 값·할 일을 지우고 알림·비용은 유지", async () => {
    await archiveOrder();
    const costs = (await db.query("SELECT id, cost_krw FROM ai_calls WHERE shop_id = $1", [f.shopId])).rows;
    expect(await run()).toBe(1);
    for (const table of ["messages", "masked_values", "handoffs", "notifications", "ai_tool_calls"]) {
      expect((await db.query(`SELECT id FROM ${table} WHERE consultation_id = $1`, [f.consultationId])).rows).toEqual(
        [],
      );
    }
    expect((await db.query("SELECT id FROM handoff_questions WHERE handoff_id = $1", [handoffId])).rows).toEqual([]);
    expect((await db.query("SELECT id FROM owner_tasks WHERE id = $1", [taskId])).rows).toEqual([]);
    expect((await db.query("SELECT id FROM order_drafts WHERE id = $1", [orphanId])).rows).toEqual([]);
    expect((await db.query("SELECT id FROM order_drafts WHERE id = $1", [f.draftId])).rows).toHaveLength(1);
    expect((await db.query("SELECT storage_key FROM file_deletions WHERE shop_id = $1", [f.shopId])).rows).toEqual([
      { storage_key: fileKey },
    ]);
    expect(
      (
        await db.query(
          "SELECT owner_task_id, status, batched_into_id FROM owner_alerts WHERE shop_id = $1 ORDER BY status",
          [f.shopId],
        )
      ).rows,
    ).toEqual([
      { owner_task_id: null, status: "batched", batched_into_id: firstAlert },
      { owner_task_id: null, status: "not_friend", batched_into_id: null },
    ]);
    expect((await db.query("SELECT id, cost_krw FROM ai_calls WHERE shop_id = $1", [f.shopId])).rows).toEqual(costs);
    expect(
      (await db.query("SELECT status, deleted_at FROM consultations WHERE id = $1", [f.consultationId])).rows,
    ).toEqual([{ status: "deleted", deleted_at: NOW }]);
    const after = await snapshotShop(db, f);
    expect(await run()).toBe(0);
    expect(await snapshotShop(db, f)).toEqual(after);
  });
  it("문의 끊김으로 닫힌 상담도 31일이면 지움", async () => {
    await archiveOrder();
    await db.query("UPDATE consultations SET status = 'dropped', ended_at = NULL, dropped_at = $2 WHERE id = $1", [
      f.consultationId,
      new Date(NOW.getTime() - 31 * DAY),
    ]);
    expect(await run()).toBe(1);
  });
  it("닫힌 지 29일이면 내용이 남음", async () => {
    await archiveOrder();
    await db.query("UPDATE consultations SET ended_at = $2 WHERE id = $1", [
      f.consultationId,
      new Date(NOW.getTime() - 29 * DAY),
    ]);
    const before = await snapshotShop(db, f);
    expect(await run()).toBe(0);
    expect(await snapshotShop(db, f)).toEqual(before);
  });
  it("열린 에스컬레이션이 있으면 지우지 않음", async () => {
    await archiveOrder();
    await db.query("UPDATE handoffs SET status = 'open', closed_at = NULL WHERE id = $1", [handoffId]);
    const before = await snapshotShop(db, f);
    expect(await run()).toBe(0);
    expect(await snapshotShop(db, f)).toEqual(before);
  });
  it("다룬 주문이 아직 보관되지 않았으면 지우지 않음", async () => {
    const before = await snapshotShop(db, f);
    expect(await run()).toBe(0);
    expect(await snapshotShop(db, f)).toEqual(before);
  });
  it("다른 가게 범위의 상담 ID는 아무것도 바꾸지 않음", async () => {
    await archiveOrder();
    const other = await createShop(db, "상담 범위 B");
    const before = await snapshotShop(db, f);
    expect(await run(other)).toBe(0);
    expect(await snapshotShop(db, f)).toEqual(before);
  });
  it("중간 오류는 알림 연결·원래 값·사진 삭제 대기까지 되돌림", async () => {
    await archiveOrder();
    const before = await snapshotShop(db, f);
    await expect(
      scoped().transaction((tx) => {
        const failingRun: ShopDb["run"] = <R>(sql: string, params?: readonly unknown[]) =>
          tx.run<R>(sql.replace(/DELETE FROM messages/, "DELETE FROM purge_missing_messages"), params);
        return purgeConsultation(
          {
            scope: tx.scope,
            run: failingRun,
            found: tx.found.bind(tx),
            owned: tx.owned.bind(tx),
            references: tx.references.bind(tx),
          },
          f.consultationId,
          NOW,
        );
      }),
    ).rejects.toThrow();
    expect(await snapshotShop(db, f)).toEqual(before);
  });
  it("동시 실행 둘은 한 번만 처리", async () => {
    await archiveOrder();
    const other = testDb();
    try {
      expect((await Promise.all([run(), run(f, f.consultationId, other)])).sort()).toEqual([0, 1]);
    } finally {
      await other.close();
    }
  });
});
