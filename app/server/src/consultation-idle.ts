import type { DueItem, JobContext, TransactionHandler } from "./job-runner";
import type { ShopDb } from "./shop-scope";

/** TASK-076: 실행기가 잡은 상담을 현재 가게 설정과 실제 열린 건으로 다시 판단한다. */
export async function closeIdleConsultation(db: ShopDb, consultationId: string, now: Date): Promise<void> {
  if (Number.isNaN(now.getTime())) throw new RangeError("invalid consultation cutoff");
  const current = await db.run<{ status: string }>(
    `SELECT c.status FROM consultations c JOIN shops s ON s.id=c.shop_id
     WHERE c.shop_id=$1 AND c.id=$2 AND c.status IN ('open','awaiting_owner','ordered')
       AND c.last_customer_message_at <= $3::timestamptz - s.idle_close_hours * interval '1 hour'
     FOR UPDATE OF c`,
    [consultationId, now],
  );
  if (current.rowCount === 0) return;
  const waiting = await db.run(
    "SELECT id FROM handoffs WHERE shop_id=$1 AND consultation_id=$2 AND status='open' LIMIT 1",
    [consultationId],
  );
  if (waiting.rowCount !== 0) return;
  const orders = await db.run(
    `SELECT o.id FROM orders o WHERE o.shop_id=$1 AND (o.consultation_id=$2
      OR o.id IN (SELECT c.order_id FROM confirm_cards c WHERE c.shop_id=$1 AND c.consultation_id=$2)
      OR o.id IN (SELECT i.order_id FROM issue_details i WHERE i.shop_id=$1 AND i.consultation_id=$2)
      OR o.id IN (SELECT hr.order_id FROM handoffs hr WHERE hr.shop_id=$1 AND hr.consultation_id=$2)
      OR o.id IN (SELECT hd.day_used_order_id FROM handoffs hd WHERE hd.shop_id=$1 AND hd.consultation_id=$2)
      OR o.id IN (SELECT hl.limit_used_order_id FROM handoffs hl WHERE hl.shop_id=$1 AND hl.consultation_id=$2)
      OR o.id IN (SELECT q.order_id FROM handoff_questions q JOIN handoffs hj ON hj.shop_id=q.shop_id AND hj.id=q.handoff_id WHERE q.shop_id=$1 AND hj.consultation_id=$2)
      OR o.id IN (SELECT n.order_id FROM notifications n WHERE n.shop_id=$1 AND n.consultation_id=$2))`,
    [consultationId],
  );
  // 주문의 끝남 판정은 다음 실패 시험에서 채운다. 여기서는 주문이 있으면 닫지 않는다.
  if (orders.rowCount !== 0) {
    await db.run("UPDATE consultations SET status='ordered' WHERE shop_id=$1 AND id=$2 AND status<>'ordered'", [
      consultationId,
    ]);
    return;
  }
  await db.run("UPDATE consultations SET status='dropped',dropped_at=$3,ended_at=NULL WHERE shop_id=$1 AND id=$2", [
    consultationId,
    now,
  ]);
}

export const consultationIdleHandler: TransactionHandler = {
  mode: "transaction",
  run: (db: ShopDb, item: DueItem, ctx: JobContext) => closeIdleConsultation(db, item.id, ctx.now),
};
