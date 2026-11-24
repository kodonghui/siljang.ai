/** TASK-082: 자리 수를 다시 센 날짜 잠금 안에서 같은 주문·결제 안내의 자리를 한 번만 잡습니다. */
import { lockCalendarDay, lockedCalendarSlotStatus } from "./calendar";
import { eventKeys } from "./event-keys";
import { fieldError } from "./problem";
import { pathId, type ShopDb, type ShopRequestDb } from "./shop-scope";

export interface HoldOrderSlotInput {
  readonly orderId: string;
  readonly paymentRequestId: string;
  readonly now: Date;
  readonly ownerConfirmed?: boolean;
  readonly expectedOrderRevision?: number;
}
export interface SlotResult {
  readonly kind: "held" | "existing" | "day_full" | "confirmation_required" | "stale" | "not_applicable";
  readonly holdId?: string;
  readonly status?: string;
  readonly day?: string;
  readonly reason?: "closed" | "day_off";
}
interface Order {
  id: string;
  kind: string;
  status: string;
  accepted_at: Date | null;
  pickup_day: string;
  pickup_at: Date;
  lock_version: number;
}
interface Payment {
  version: number;
  id: string;
  kind: string;
  status: string;
  due_at: Date;
  due_cap_at: Date;
  claimed_at: Date | null;
}
export function holdOrderSlot(db: ShopRequestDb, input: HoldOrderSlotInput): Promise<SlotResult> {
  return db.transaction((tx) => holdOrderSlotInTransaction(tx, input));
}
export async function holdOrderSlotInTransaction(db: ShopDb, input: HoldOrderSlotInput): Promise<SlotResult> {
  const order = await lockedSlotOrder(db, input);
  if (order === null) return { kind: "stale" };
  const orderId = order.id,
    paymentId = pathId(input.paymentRequestId),
    via = db.scope.via;
  const payment = await lockedPayment(db, orderId, paymentId);
  const key = eventKeys.hold(orderId, paymentId);
  const existing = (
    await db.run<{ id: string; status: string; day: string }>(
      "SELECT id,status,day::text FROM slot_holds WHERE shop_id=$1 AND hold_key=$2",
      [key],
    )
  ).rows[0];
  if (existing) return { kind: "existing", holdId: existing.id, status: existing.status, day: existing.day };
  if (
    payment.kind === "difference" ||
    !["awaiting_payment", "payment_overdue"].includes(order.status) ||
    order.pickup_at <= input.now ||
    (order.kind === "custom" && order.accepted_at === null)
  )
    return { kind: "not_applicable" };
  const valid =
    payment.status === "mismatch" ||
    (payment.status === "open" && payment.due_at > input.now) ||
    (payment.status === "claimed" &&
      payment.claimed_at !== null &&
      payment.claimed_at < payment.due_at &&
      payment.due_cap_at > input.now);
  if (!valid) return { kind: "not_applicable" };
  const availability = await lockedCalendarSlotStatus(db, order.pickup_day, input.now);
  let overbooked = false;
  if (availability.status !== "open") {
    const ownerMayChoose = via.kind === "owner" && (order.kind === "custom" || payment.kind === "reissue");
    if (!ownerMayChoose) return { kind: "day_full", day: availability.day };
    if (input.ownerConfirmed !== true)
      return { kind: "confirmation_required", day: availability.day, reason: availability.status };
    overbooked = true;
  }
  await lockCalendarDay(db, order.pickup_day);
  const saved = await db.found<{ id: string }>(
    "INSERT INTO slot_holds(shop_id,day,order_id,payment_request_id,hold_key,status,overbooked,created_at) VALUES($1,$2,$3,$4,$5,'held',$6,$7) RETURNING id",
    [order.pickup_day, orderId, paymentId, key, overbooked, input.now],
  );
  return { kind: "held", holdId: saved.id, status: "held", day: order.pickup_day };
}

async function lockedSlotOrder(db: ShopDb, input: HoldOrderSlotInput): Promise<Order | null> {
  if (!Number.isFinite(input.now.getTime())) throw new RangeError("invalid slot time");
  const id = pathId(input.orderId),
    via = db.scope.via;
  if (via.kind === "owner") {
    await db.found("SELECT id FROM shops WHERE id=$1 AND owner_id=$2", [via.ownerId]);
    if (input.expectedOrderRevision === undefined) throw fieldError("/baseRevision", "required");
  }
  if (
    input.expectedOrderRevision !== undefined &&
    (!Number.isSafeInteger(input.expectedOrderRevision) || input.expectedOrderRevision < 1)
  )
    throw fieldError("/baseRevision", "bad_format");
  const order = await db.found<Order>(
    "SELECT id,kind,status,accepted_at,pickup_day::text,pickup_at,lock_version FROM orders WHERE shop_id=$1 AND id=$2 AND personal_data_purged_at IS NULL FOR UPDATE",
    [id],
  );
  return input.expectedOrderRevision !== undefined && order.lock_version !== input.expectedOrderRevision ? null : order;
}
async function lockedPayment(db: ShopDb, orderId: string, paymentId: string): Promise<Payment> {
  return db.found<Payment>(
    "SELECT id,kind,status,due_at,due_cap_at,claimed_at,version FROM payment_requests WHERE shop_id=$1 AND id=$2 AND order_id=$3 FOR UPDATE",
    [paymentId, orderId],
  );
}
export interface SlotExpiryResult {
  readonly kind: "expired" | "protected" | "unchanged" | "stale";
  readonly holdId?: string;
}
export function expireOrderSlot(db: ShopRequestDb, input: HoldOrderSlotInput): Promise<SlotExpiryResult> {
  return db.transaction((tx) => expireOrderSlotInTransaction(tx, input));
}
/** 결제·주문·자리의 기한 상태만 바꿉니다. 안내·장부는 담당 실행기가 이 트랜잭션 안에서 함께 남깁니다. */
export async function expireOrderSlotInTransaction(db: ShopDb, input: HoldOrderSlotInput): Promise<SlotExpiryResult> {
  const order = await lockedSlotOrder(db, input);
  if (order === null) return { kind: "stale" };
  const payment = await lockedPayment(db, order.id, pathId(input.paymentRequestId));
  if (payment.status === "paid" || payment.status === "mismatch") return { kind: "protected" };
  if (
    !["open", "claimed"].includes(payment.status) ||
    payment.kind === "difference" ||
    !["awaiting_payment", "payment_overdue"].includes(order.status)
  )
    return { kind: "unchanged" };
  const deadline =
    payment.status === "claimed" && payment.claimed_at !== null && payment.claimed_at < payment.due_at
      ? payment.due_cap_at
      : payment.due_at;
  if (input.now < deadline) return { kind: "protected" };
  const held = (
    await db.run<{ id: string; day: string }>(
      "SELECT id,day::text FROM slot_holds WHERE shop_id=$1 AND order_id=$2 AND payment_request_id=$3 AND status='held'",
      [order.id, payment.id],
    )
  ).rows[0];
  if (!held) return { kind: "protected" };
  await lockCalendarDay(db, held.day);
  const slot = await db.run(
    "UPDATE slot_holds SET status='released',released_at=$3,release_reason='payment_overdue' WHERE shop_id=$1 AND id=$2 AND status='held'",
    [held.id, input.now],
  );
  if (slot.rowCount !== 1) throw new Error("slot changed after order lock");
  const pay = await db.run(
    "UPDATE payment_requests SET status='expired',expired_at=$3,version=version+1 WHERE shop_id=$1 AND id=$2 AND version=$4 AND status IN('open','claimed')",
    [payment.id, input.now, payment.version],
  );
  if (pay.rowCount !== 1) throw new Error("payment changed after order lock");
  const updated = await db.run(
    "UPDATE orders SET status='payment_overdue',lock_version=lock_version+1 WHERE shop_id=$1 AND id=$2 AND lock_version=$3 AND status IN('awaiting_payment','payment_overdue')",
    [order.id, order.lock_version],
  );
  if (updated.rowCount !== 1) throw new Error("order changed after slot lock");
  return { kind: "expired", holdId: held.id };
}
