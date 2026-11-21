import { eventKeys, insertOnce } from "./event-keys";
import { deferredKakaoMessages, deferredKakaoTexts, markDeferredKakaoMessages } from "./kakao-deferred";
import { KAKAO_HANDOFF_TEXT } from "./kakao-reply";
import type { InboundReceipt } from "./kakao-skill-store";
import type { ShopDb, ShopRequestDb } from "./shop-scope";
import { addWithinReplyHours, toShopLocal } from "./time";

type FailureReason = "callback_timeout" | "ai_failure" | "ai_cost_limit" | "masking_failed";

/** 현재 답의 생성·사장님 할 일·이전 답의 전달 표시를 한 트랜잭션으로 기록한다. */
export async function replyWithKakaoHandoff(
  db: ShopRequestDb,
  receipt: Extract<InboundReceipt, { kind: "received" }>,
  now: Date,
  render: (previous: readonly string[]) => Response,
): Promise<Response> {
  return db.transaction((tx) => replyKakaoHandoffInTransaction(tx, receipt, now, render));
}

/** 호출자의 수신 트랜잭션을 그대로 사용해 후속 실패 때 수신도 되돌린다. */
export async function replyKakaoHandoffInTransaction(
  tx: ShopDb,
  receipt: Extract<InboundReceipt, { kind: "received" }>,
  now: Date,
  render: (previous: readonly string[]) => Response,
  reason: FailureReason = "ai_failure",
): Promise<Response> {
  await tx.found("SELECT id FROM customers WHERE shop_id = $1 AND id = $2 FOR UPDATE", [receipt.customerId]);
  const consultation = await tx.found<{ status: string }>(
    "SELECT status FROM consultations WHERE shop_id = $1 AND id = $2 AND customer_id = $3 FOR UPDATE",
    [receipt.consultationId, receipt.customerId],
  );
  if (["ended", "deleted", "dropped"].includes(consultation.status)) throw new Error("consultation closed");
  await tx.found(
    "SELECT id FROM messages WHERE shop_id = $1 AND id = $2 AND consultation_id = $3 AND direction = 'inbound' FOR UPDATE",
    [receipt.messageId, receipt.consultationId],
  );
  await recordKakaoHandoff(tx, receipt.consultationId, receipt.messageId, reason, now);
  const active = await tx.run(
    `SELECT m.id FROM messages m JOIN consultations c ON c.shop_id = $1 AND c.id = m.consultation_id
       WHERE m.shop_id = $1 AND c.customer_id = $2 AND m.kakao_callback_claim_until > $3 LIMIT 1`,
    [receipt.customerId, now],
  );
  const previous = active.rowCount === 0 ? await deferredKakaoMessages(tx, receipt.customerId) : [];
  const response = render(deferredKakaoTexts(previous));
  await markDeferredKakaoMessages(tx, receipt.customerId, previous, now);
  await tx.run(
    `INSERT INTO messages (shop_id, consultation_id, direction, author, kind, body_masked, delivery, sent_at, created_at)
       VALUES ($1, $2, 'outbound', 'system', 'text', $3, 'skill_response', $4, $4)`,
    [receipt.consultationId, KAKAO_HANDOFF_TEXT, now],
  );
  return response;
}

/** 호출자는 같은 트랜잭션에서 손님·상담 행을 잠근다. 외부 알림은 여기서 보내지 않는다. */
export async function recordKakaoHandoff(
  db: ShopDb,
  consultationId: string,
  messageId: string,
  reason: FailureReason,
  now: Date,
): Promise<void> {
  const previous = await db.run<{ id: string }>(
    `SELECT h.id FROM handoffs h WHERE h.shop_id = $1 AND h.consultation_id = $2
      AND (h.source_message_id = $3 OR h.id IN (
        SELECT q.handoff_id FROM handoff_questions q WHERE q.shop_id = $1 AND q.message_id = $3))`,
    [consultationId, messageId],
  );
  if (previous.rowCount > 0) return;

  const opened = await db.run<{ id: string }>(
    `SELECT id FROM handoffs WHERE shop_id = $1 AND consultation_id = $2 AND status = 'open'
      AND reason NOT IN ('closed_day', 'order_limit') AND (reason <> 'other_user' OR order_id IS NULL)`,
    [consultationId],
  );
  const existing = opened.rows[0];
  if (existing !== undefined) {
    await db.run(
      `INSERT INTO handoff_questions (shop_id, handoff_id, message_id, reason, created_at)
        VALUES ($1, $2, $3, $4, $5) ON CONFLICT (message_id) DO NOTHING`,
      [existing.id, messageId, reason, now],
    );
    // 새 질문 알림은 가게 날짜마다 한 번만 예약한다. 실제 발송 시각을 미리 쓰지 않는다.
    const shop = await db.found<{ time_zone: string }>("SELECT time_zone FROM shops WHERE id = $1");
    const day = toShopLocal(now, shop.time_zone).date;
    const task = await db.found<{ id: string }>(
      "SELECT id FROM owner_tasks WHERE shop_id = $1 AND handoff_id = $2 AND closed_at IS NULL",
      [existing.id],
    );
    await insertOnce(
      db,
      "owner_alerts",
      `INSERT INTO owner_alerts (shop_id, event_key, owner_task_id, kind, next_attempt_at, created_at)
        VALUES ($1, $2, $3, 'handoff_appended', $4, $4)
        ON CONFLICT (shop_id, event_key) DO NOTHING RETURNING id`,
      [eventKeys.alert("handoff_appended", existing.id, day), task.id, now],
    );
  } else {
    const config = await db.found<{
      time_zone: string;
      owner_wait_minutes: number;
      reply_start: string;
      reply_end: string;
    }>(
      `SELECT s.time_zone, s.owner_wait_minutes,
        to_char(b.reply_start, 'HH24:MI') AS reply_start, to_char(b.reply_end, 'HH24:MI') AS reply_end
       FROM shops s JOIN business_calendars b ON b.shop_id = $1 WHERE s.id = $1`,
    );
    const due = addWithinReplyHours(now, config.owner_wait_minutes, {
      timeZone: config.time_zone,
      start: config.reply_start,
      end: config.reply_end,
    });
    const handoff = await db.found<{ id: string }>(
      `INSERT INTO handoffs (shop_id, consultation_id, source_message_id, reason, created_at)
        VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [consultationId, messageId, reason, now],
    );
    const task = await insertOnce(
      db,
      "owner_tasks",
      `INSERT INTO owner_tasks (shop_id, event_key, handoff_id, kind, wait_status, wait_due_at, opened_at)
        VALUES ($1, $2, $3, 'handoff', 'waiting', $4, $5)
        ON CONFLICT (shop_id, event_key) DO NOTHING RETURNING id`,
      [eventKeys.task("handoff", handoff.id), handoff.id, due, now],
    );
    await insertOnce(
      db,
      "owner_alerts",
      `INSERT INTO owner_alerts (shop_id, event_key, owner_task_id, kind, next_attempt_at, created_at)
        VALUES ($1, $2, $3, 'new_task', $4, $4)
        ON CONFLICT (shop_id, event_key) DO NOTHING RETURNING id`,
      [eventKeys.alert("new_task", task.id), task.id, now],
    );
  }
  await db.run("UPDATE consultations SET status = 'awaiting_owner' WHERE shop_id = $1 AND id = $2", [consultationId]);
}
