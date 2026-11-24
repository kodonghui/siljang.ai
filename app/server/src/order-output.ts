/** TASK-066: 주문의 출력 목적별로 허용한 열만 읽는다. 장부 전송과 알림 발송은 호출자가 담당한다. */
import { eventKeys, insertOnce } from "./event-keys";
import { ownerWaitDue } from "./owner-wait";
import { ApiError } from "./problem";
import { pathId, type ShopDb, type ShopRequestDb } from "./shop-scope";

async function requireOwner(db: ShopDb): Promise<void> {
  const via = db.scope.via;
  if (via.kind !== "owner") throw new ApiError("not_found");
  await db.found("SELECT id FROM shops WHERE id=$1 AND owner_id=$2", [via.ownerId]);
}

type OrderSummary = {
  id: string;
  order_no: string;
  kind: string;
  status: string;
  amount: number;
  pickup_at: Date;
  requested_at: Date;
};

/** 요약과 알림에는 주문자 연락처·계좌·알레르기·자유 입력을 넣지 않는다. */
export async function createCustomOrderTask(db: ShopRequestDb, orderId: string, now: Date): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    await requireOwner(tx);
    const id = await tx.owned("orders", orderId, { lock: true });
    const order = await tx.found<OrderSummary>(
      `SELECT id,order_no,kind,status,amount,pickup_at,requested_at FROM orders
       WHERE shop_id=$1 AND id=$2 AND kind='custom' AND status='requested'`,
      [id],
    );
    const due = await ownerWaitDue(tx, now);
    const task = await insertOnce(
      tx,
      "owner_tasks",
      `INSERT INTO owner_tasks (shop_id, event_key, order_id, kind, wait_status, wait_due_at, opened_at, detail)
       VALUES ($1, $2, $3, 'custom_order', 'waiting', $4, $5, $6::jsonb)
       ON CONFLICT (shop_id, event_key) DO NOTHING RETURNING id`,
      [
        eventKeys.task("custom_order", id),
        id,
        due,
        now,
        JSON.stringify({
          orderNo: order.order_no,
          kind: order.kind,
          amount: order.amount,
          pickupAt: order.pickup_at,
        }),
      ],
    );
    await insertOnce(
      tx,
      "owner_alerts",
      `INSERT INTO owner_alerts (shop_id, event_key, owner_task_id, kind, next_attempt_at, created_at)
       VALUES ($1, $2, $3, 'new_task', $4, $4)
       ON CONFLICT (shop_id, event_key) DO NOTHING RETURNING id`,
      [eventKeys.alert("new_task", task.id), task.id, now],
    );
    return { id: task.id };
  });
}

export type OrderLedgerRow = {
  readonly orderNo: string;
  readonly status: string;
  readonly kind: string;
  readonly requestedAt: Date;
  readonly pickupAt: Date;
  readonly amount: number;
  readonly customerName: string | null;
  readonly customerPhone: string | null;
};

/** 장부에 허용된 주문자 정보만 읽으며 알레르기 열은 조회 자체에서 제외한다(SPEC-064). */
export async function writeOrderLedgerData(
  db: ShopRequestDb,
  orderId: string,
  write: (row: OrderLedgerRow) => Promise<void>,
): Promise<void> {
  await requireOwner(db);
  const row = await db.found<OrderSummary & { customer_name: string | null; customer_phone: string | null }>(
    `SELECT o.id,o.order_no,o.kind,o.status,o.amount,o.pickup_at,o.requested_at,d.customer_name,d.customer_phone
     FROM orders o JOIN order_details d ON d.shop_id=$1 AND d.order_id=o.id AND d.version=o.version
     WHERE o.shop_id=$1 AND o.id=$2`,
    [pathId(orderId)],
  );
  await write({
    orderNo: row.order_no,
    status: row.status,
    kind: row.kind,
    requestedAt: row.requested_at,
    pickupAt: row.pickup_at,
    amount: row.amount,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
  });
}

/** 알레르기는 사장님 주문 상세·제작 자료에서만 읽는다. 운영자·손님·일 실행기에는 주지 않는다. */
export async function ownerProductionOrder(db: ShopRequestDb, orderId: string) {
  await requireOwner(db);
  const row = await db.found<{
    order_no: string;
    customer_name: string | null;
    allergy_answer: string | null;
  }>(
    `SELECT o.order_no,d.customer_name,d.allergy_answer FROM orders o
     JOIN order_details d ON d.shop_id=$1 AND d.order_id=o.id AND d.version=o.version
     WHERE o.shop_id=$1 AND o.id=$2`,
    [pathId(orderId)],
  );
  return { orderNo: row.order_no, customerName: row.customer_name, allergyAnswer: row.allergy_answer };
}
