import type { ShopDb } from "./shop-scope";

/** SPEC-065 #2. 닫힌 상담 하나를 잠근 트랜잭션에서 내용과 삭제 대기를 함께 처리한다. */
export async function purgeConsultation(db: ShopDb, consultationId: string, now: Date): Promise<number> {
  if (Number.isNaN(now.getTime())) throw new RangeError("invalid purge cutoff");
  const eligible = await db.run(
    `SELECT c.id FROM consultations c WHERE c.shop_id = $1 AND c.id = $2
       AND ((c.status = 'dropped' AND c.dropped_at <= $3::timestamptz - interval '30 days')
         OR (c.status = 'ended' AND c.ended_at <= $3::timestamptz - interval '30 days'))
       AND NOT EXISTS (SELECT 1 FROM handoffs ho WHERE ho.shop_id = $1 AND ho.consultation_id = $2 AND ho.status = 'open')
       AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.shop_id = $1 AND o.personal_data_purged_at IS NULL
         AND (o.consultation_id = $2
           OR o.id IN (SELECT cc.order_id FROM confirm_cards cc WHERE cc.shop_id = $1 AND cc.consultation_id = $2)
           OR o.id IN (SELECT ide.order_id FROM issue_details ide WHERE ide.shop_id = $1 AND ide.consultation_id = $2)
           OR o.id IN (SELECT hr.order_id FROM handoffs hr WHERE hr.shop_id = $1 AND hr.consultation_id = $2)
           OR o.id IN (SELECT hd.day_used_order_id FROM handoffs hd WHERE hd.shop_id = $1 AND hd.consultation_id = $2)
           OR o.id IN (SELECT hl.limit_used_order_id FROM handoffs hl WHERE hl.shop_id = $1 AND hl.consultation_id = $2)
           OR o.id IN (SELECT hq.order_id FROM handoff_questions hq JOIN handoffs hj
                        ON hj.shop_id = $1 AND hj.id = hq.handoff_id WHERE hq.shop_id = $1 AND hj.consultation_id = $2)
           OR o.id IN (SELECT no.order_id FROM notifications no WHERE no.shop_id = $1 AND no.consultation_id = $2)))
     FOR UPDATE SKIP LOCKED`,
    [consultationId, now],
  );
  if (eligible.rowCount === 0) return 0;

  await db.run(
    `UPDATE owner_alerts SET owner_task_id = NULL WHERE shop_id = $1 AND owner_task_id IN (
       SELECT t.id FROM owner_tasks t JOIN handoffs h ON h.shop_id = $1 AND h.id = t.handoff_id
       WHERE t.shop_id = $1 AND h.consultation_id = $2)`,
    [consultationId],
  );
  await db.run(
    `DELETE FROM owner_tasks WHERE shop_id = $1 AND handoff_id IN (
       SELECT h.id FROM handoffs h WHERE h.shop_id = $1 AND h.consultation_id = $2)`,
    [consultationId],
  );
  await db.run(
    `DELETE FROM handoff_questions WHERE shop_id = $1 AND handoff_id IN (
       SELECT h.id FROM handoffs h WHERE h.shop_id = $1 AND h.consultation_id = $2)`,
    [consultationId],
  );
  await db.run(
    `UPDATE issue_reports SET handoff_id = NULL WHERE shop_id = $1 AND handoff_id IN (
       SELECT h.id FROM handoffs h WHERE h.shop_id = $1 AND h.consultation_id = $2)`,
    [consultationId],
  );
  await db.run("DELETE FROM handoffs WHERE shop_id = $1 AND consultation_id = $2", [consultationId]);
  await db.run(
    `DELETE FROM confirm_cards WHERE shop_id = $1 AND draft_id IN (
       SELECT d.id FROM order_drafts d WHERE d.shop_id = $1 AND d.consultation_id = $2
         AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.shop_id = $1 AND o.draft_id = d.id))`,
    [consultationId],
  );
  await db.run(
    `DELETE FROM quotes WHERE shop_id = $1 AND draft_id IN (
       SELECT d.id FROM order_drafts d WHERE d.shop_id = $1 AND d.consultation_id = $2
         AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.shop_id = $1 AND o.draft_id = d.id))`,
    [consultationId],
  );
  await db.run(
    `WITH gone AS (DELETE FROM reference_photos WHERE shop_id = $1 AND draft_id IN (
       SELECT d.id FROM order_drafts d WHERE d.shop_id = $1 AND d.consultation_id = $2) RETURNING storage_key)
     INSERT INTO file_deletions (shop_id, storage_key, source, queued_at)
     SELECT $1, storage_key, 'reference_photo', $3 FROM gone ON CONFLICT (storage_key) DO NOTHING`,
    [consultationId, now],
  );
  await db.run(
    `WITH gone AS (DELETE FROM issue_photos WHERE shop_id = $1 AND issue_details_id IN (
       SELECT i.id FROM issue_details i WHERE i.shop_id = $1 AND i.consultation_id = $2 AND i.status <> 'reported')
       RETURNING storage_key)
     INSERT INTO file_deletions (shop_id, storage_key, source, queued_at)
     SELECT $1, storage_key, 'issue_photo', $3 FROM gone ON CONFLICT (storage_key) DO NOTHING`,
    [consultationId, now],
  );
  await db.run("DELETE FROM issue_details WHERE shop_id = $1 AND consultation_id = $2 AND status <> 'reported'", [
    consultationId,
  ]);
  await db.run(
    `UPDATE issue_photos SET message_id = NULL WHERE shop_id = $1 AND message_id IN (
       SELECT m.id FROM messages m WHERE m.shop_id = $1 AND m.consultation_id = $2)`,
    [consultationId],
  );
  await db.run(
    `DELETE FROM order_draft_extras WHERE shop_id = $1 AND draft_id IN (
       SELECT d.id FROM order_drafts d WHERE d.shop_id = $1 AND d.consultation_id = $2
         AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.shop_id = $1 AND o.draft_id = d.id))`,
    [consultationId],
  );
  await db.run(
    `DELETE FROM order_drafts d WHERE d.shop_id = $1 AND d.consultation_id = $2
       AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.shop_id = $1 AND o.draft_id = d.id)`,
    [consultationId],
  );
  await db.run("DELETE FROM masked_values WHERE shop_id = $1 AND consultation_id = $2", [consultationId]);
  await db.run("DELETE FROM notifications WHERE shop_id = $1 AND consultation_id = $2", [consultationId]);
  await db.run("DELETE FROM ai_tool_calls WHERE shop_id = $1 AND consultation_id = $2", [consultationId]);
  await db.run("DELETE FROM messages WHERE shop_id = $1 AND consultation_id = $2", [consultationId]);
  const result = await db.run(
    `UPDATE consultations SET status = 'deleted', deleted_at = $3, turn_trace_id = NULL, turn_started_at = NULL
     WHERE shop_id = $1 AND id = $2`,
    [consultationId, now],
  );
  return result.rowCount;
}
