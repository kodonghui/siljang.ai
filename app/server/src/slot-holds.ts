/** TASK-082: 자리 수를 다시 센 날짜 잠금 안에서 같은 주문·결제 안내의 자리를 한 번만 잡습니다. */
import { lockCalendarDay, lockedCalendarSlotStatus } from "./calendar";
import { shiftDate } from "./calendar-input";
import { eventKeys } from "./event-keys";
import { fieldError } from "./problem";
import { pathId, type ShopDb, type ShopRequestDb } from "./shop-scope";
import { toShopLocal } from "./time";

export interface OrderSlotInput {
  readonly orderId: string;
  readonly now: Date;
  readonly expectedOrderRevision?: number;
}
export interface HoldOrderSlotInput extends OrderSlotInput {
  readonly paymentRequestId: string;
  readonly ownerConfirmed?: boolean;
  readonly expectedChangeRevision?: number;
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
  version: number;
  consultation_id: string;
  remake_of_order_id: string | null;
}
interface Payment {
  version: number;
  id: string;
  kind: string;
  status: string;
  due_at: Date;
  due_cap_at: Date;
  claimed_at: Date | null;
  change_request_id: string | null;
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
  const key = eventKeys.hold(orderId, payment.change_request_id ?? paymentId);
  const existing = (
    await db.run<{ id: string; status: string; day: string }>(
      "SELECT id,status,day::text FROM slot_holds WHERE shop_id=$1 AND hold_key=$2",
      [key],
    )
  ).rows[0];
  if (existing) return { kind: "existing", holdId: existing.id, status: existing.status, day: existing.day };
  const difference = payment.kind === "difference";
  const change = difference ? await differenceChange(db, order, payment, input.expectedChangeRevision) : null;
  let targetDay = order.pickup_day;
  let oldDay: string | undefined;
  if (difference) {
    if (!change || change.new_pickup_at === null) return { kind: "not_applicable" };
    targetDay = await pickupDay(db, change.new_pickup_at, input.now);
    if (targetDay === order.pickup_day) return { kind: "not_applicable" };
    const old = (
      await db.run<{ day: string }>(
        "SELECT day::text FROM slot_holds WHERE shop_id=$1 AND order_id=$2 AND status='fixed'",
        [order.id],
      )
    ).rows[0];
    if (!old || old.day !== order.pickup_day) return { kind: "not_applicable" };
    oldDay = old.day;
  } else if (
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
  const approval =
    !difference && order.kind === "standard" && payment.kind === "first"
      ? (
          await db.run<{ id: string }>(
            "SELECT id FROM handoffs WHERE shop_id=$1 AND consultation_id=$2 AND requested_day=$3 AND reason='closed_day' AND status='answered' AND day_decision='accepted' AND day_accept_expires_at>$4 AND day_used_order_id IS NULL ORDER BY answered_at DESC,id LIMIT 1 FOR UPDATE",
            [order.consultation_id, targetDay, input.now],
          )
        ).rows[0]
      : undefined;
  if (oldDay !== undefined) await lockSlotDays(db, [oldDay, targetDay]);
  const availability = await lockedCalendarSlotStatus(db, targetDay, input.now);
  let overbooked = false;
  if (availability.status !== "open") {
    const ownerMayChoose =
      via.kind === "owner" && (difference || order.kind === "custom" || payment.kind === "reissue");
    if (!ownerMayChoose && !approval) return { kind: "day_full", day: availability.day };
    if (!approval && input.ownerConfirmed !== true)
      return { kind: "confirmation_required", day: availability.day, reason: availability.status };
    overbooked = true;
  }
  await lockCalendarDay(db, targetDay);
  const saved = await db.found<{ id: string }>(
    "INSERT INTO slot_holds(shop_id,day,order_id,payment_request_id,hold_key,status,overbooked,created_at) VALUES($1,$2,$3,$4,$5,'held',$6,$7) RETURNING id",
    [targetDay, orderId, paymentId, key, overbooked, input.now],
  );
  if (overbooked && approval) {
    const consumed = await db.run(
      "UPDATE handoffs SET day_used_order_id=$3 WHERE shop_id=$1 AND id=$2 AND day_used_order_id IS NULL",
      [approval.id, orderId],
    );
    if (consumed.rowCount !== 1) throw new Error("day approval changed after lock");
  }
  return { kind: "held", holdId: saved.id, status: "held", day: targetDay };
}

async function lockedSlotOrder(db: ShopDb, input: OrderSlotInput): Promise<Order | null> {
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
    "SELECT id,kind,status,accepted_at,pickup_day::text,pickup_at,lock_version,version,consultation_id,remake_of_order_id FROM orders WHERE shop_id=$1 AND id=$2 AND personal_data_purged_at IS NULL FOR UPDATE",
    [id],
  );
  return input.expectedOrderRevision !== undefined && order.lock_version !== input.expectedOrderRevision ? null : order;
}
async function lockedPayment(db: ShopDb, orderId: string, paymentId: string): Promise<Payment> {
  return db.found<Payment>(
    "SELECT id,kind,status,due_at,due_cap_at,claimed_at,version,change_request_id FROM payment_requests WHERE shop_id=$1 AND id=$2 AND order_id=$3 FOR UPDATE",
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
  if (!["open", "claimed"].includes(payment.status)) return { kind: "unchanged" };
  const difference = payment.kind === "difference";
  const change = difference ? await differenceChange(db, order, payment, input.expectedChangeRevision) : null;
  if (difference ? change === null : !["awaiting_payment", "payment_overdue"].includes(order.status))
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
  if (!held && !difference) return { kind: "protected" };
  if (held) {
    await lockCalendarDay(db, held.day);
    const slot = await db.run(
      "UPDATE slot_holds SET status='released',released_at=$3,release_reason=$4 WHERE shop_id=$1 AND id=$2 AND status='held'",
      [held.id, input.now, difference ? "change_closed" : "payment_overdue"],
    );
    if (slot.rowCount !== 1) throw new Error("slot changed after order lock");
  }
  const pay = await db.run(
    "UPDATE payment_requests SET status='expired',expired_at=$3,version=version+1 WHERE shop_id=$1 AND id=$2 AND version=$4 AND status IN('open','claimed')",
    [payment.id, input.now, payment.version],
  );
  if (pay.rowCount !== 1) throw new Error("payment changed after order lock");
  if (change) {
    const updated = await db.run(
      "UPDATE change_requests SET status='closed_no_difference',closed_at=$3,lock_version=lock_version+1 WHERE shop_id=$1 AND id=$2 AND lock_version=$4 AND status='awaiting_difference'",
      [change.id, input.now, change.lock_version],
    );
    if (updated.rowCount !== 1) throw new Error("change changed after order lock");
  } else {
    const updated = await db.run(
      "UPDATE orders SET status='payment_overdue',lock_version=lock_version+1 WHERE shop_id=$1 AND id=$2 AND lock_version=$3 AND status IN('awaiting_payment','payment_overdue')",
      [order.id, order.lock_version],
    );
    if (updated.rowCount !== 1) throw new Error("order changed after slot lock");
  }
  return held ? { kind: "expired", holdId: held.id } : { kind: "expired" };
}

export interface SlotTransitionResult {
  readonly kind: "fixed" | "done" | "released" | "unchanged" | "not_applicable" | "stale";
  readonly holdId?: string;
}
export function fixPaidOrderSlot(db: ShopRequestDb, input: HoldOrderSlotInput): Promise<SlotTransitionResult> {
  return db.transaction((tx) => fixPaidOrderSlotInTransaction(tx, input));
}
/** 결제 확인 담당 실행기는 주문·결제·자리 변경을 같은 트랜잭션으로 묶습니다. */
export async function fixPaidOrderSlotInTransaction(
  db: ShopDb,
  input: HoldOrderSlotInput,
): Promise<SlotTransitionResult> {
  const order = await lockedSlotOrder(db, input);
  if (order === null) return { kind: "stale" };
  const payment = await lockedPayment(db, order.id, pathId(input.paymentRequestId));
  if (payment.kind === "difference" || payment.status !== "paid" || order.status !== "confirmed")
    return { kind: "not_applicable" };
  const slot = (
    await db.run<{ id: string; day: string; status: string }>(
      "SELECT id,day::text,status FROM slot_holds WHERE shop_id=$1 AND order_id=$2 AND payment_request_id=$3 AND hold_key=$4",
      [order.id, payment.id, eventKeys.hold(order.id, payment.id)],
    )
  ).rows[0];
  if (slot?.status !== "held") return { kind: "unchanged" };
  await lockCalendarDay(db, slot.day);
  const updated = await db.run(
    "UPDATE slot_holds SET status='fixed',fixed_at=$3 WHERE shop_id=$1 AND id=$2 AND status='held'",
    [slot.id, input.now],
  );
  if (updated.rowCount !== 1) throw new Error("slot changed after order lock");
  return { kind: "fixed", holdId: slot.id };
}
export function finishOrderSlot(db: ShopRequestDb, input: OrderSlotInput): Promise<SlotTransitionResult> {
  return db.transaction((tx) => finishOrderSlotInTransaction(tx, input));
}
/** 픽업 일시가 지난 확정 자리는 끝난 자리로 바꾸며 그날 개수에서 빼지 않습니다. */
export async function finishOrderSlotInTransaction(db: ShopDb, input: OrderSlotInput): Promise<SlotTransitionResult> {
  const order = await lockedSlotOrder(db, input);
  if (order === null) return { kind: "stale" };
  if (order.pickup_at > input.now || !["confirmed", "received", "no_pickup"].includes(order.status))
    return { kind: "not_applicable" };
  const slot = (
    await db.run<{ id: string; day: string }>(
      "SELECT id,day::text FROM slot_holds WHERE shop_id=$1 AND order_id=$2 AND status='fixed'",
      [order.id],
    )
  ).rows[0];
  if (!slot) return { kind: "unchanged" };
  await lockCalendarDay(db, slot.day);
  const updated = await db.run(
    "UPDATE slot_holds SET status='done',done_at=$3 WHERE shop_id=$1 AND id=$2 AND status='fixed'",
    [slot.id, input.now],
  );
  if (updated.rowCount !== 1) throw new Error("slot changed after order lock");
  return { kind: "done", holdId: slot.id };
}
export function releaseCancelledOrderSlots(db: ShopRequestDb, input: OrderSlotInput): Promise<SlotTransitionResult> {
  return db.transaction((tx) => releaseCancelledOrderSlotsInTransaction(tx, input));
}
/** 취소 담당 실행기가 주문 취소·환불·차액 안내 닫기를 함께 남긴 뒤 같은 트랜잭션에서 부릅니다. */
export async function releaseCancelledOrderSlotsInTransaction(
  db: ShopDb,
  input: OrderSlotInput,
): Promise<SlotTransitionResult> {
  const order = await lockedSlotOrder(db, input);
  if (order === null) return { kind: "stale" };
  if (order.status !== "cancelled") return { kind: "not_applicable" };
  const slots = (
    await db.run<{ id: string; day: string }>(
      "SELECT id,day::text FROM slot_holds WHERE shop_id=$1 AND order_id=$2 AND status IN('held','fixed') ORDER BY day,id",
      [order.id],
    )
  ).rows;
  if (slots.length === 0) return { kind: "unchanged" };
  for (const day of [...new Set(slots.map((x) => x.day))].sort()) await lockCalendarDay(db, day);
  const updated = await db.run(
    "UPDATE slot_holds SET status='released',released_at=$3,release_reason='order_cancelled' WHERE shop_id=$1 AND order_id=$2 AND status IN('held','fixed')",
    [order.id, input.now],
  );
  if (updated.rowCount !== slots.length) throw new Error("slot changed after order lock");
  return { kind: "released" };
}

export interface ChangeSlotInput extends OrderSlotInput {
  readonly changeRequestId: string;
  readonly expectedChangeRevision?: number;
  readonly ownerConfirmed?: boolean;
}
export interface ChangeSlotResult {
  readonly kind: "fixed" | "existing" | "day_full" | "confirmation_required" | "stale" | "not_applicable";
  readonly holdId?: string;
  readonly day?: string;
  readonly reason?: "closed" | "day_off";
}
interface Change {
  id: string;
  base_version: number;
  lock_version: number;
  new_pickup_at: Date | null;
  amount_delta: number | null;
  status: string;
}
async function lockedChange(db: ShopDb, orderId: string, changeId: string, expected?: number): Promise<Change | null> {
  if (db.scope.via.kind === "owner" && expected === undefined) throw fieldError("/baseRevision", "required");
  if (expected !== undefined && (!Number.isSafeInteger(expected) || expected < 1))
    throw fieldError("/baseRevision", "bad_format");
  const change = await db.found<Change>(
    "SELECT id,base_version,lock_version,new_pickup_at,amount_delta,status FROM change_requests WHERE shop_id=$1 AND id=$2 AND order_id=$3 FOR UPDATE",
    [pathId(changeId), orderId],
  );
  return expected !== undefined && change.lock_version !== expected ? null : change;
}
async function pickupDay(db: ShopDb, pickup: Date, now: Date): Promise<string> {
  const zone = (await db.found<{ time_zone: string }>("SELECT time_zone FROM shops WHERE id=$1")).time_zone;
  const day = toShopLocal(pickup, zone).date,
    today = toShopLocal(now, zone).date;
  if (pickup <= now || day < today || day > shiftDate(today, 59)) throw fieldError("/pickupDay", "out_of_range");
  return day;
}
async function lockSlotDays(db: ShopDb, days: readonly string[]): Promise<void> {
  for (const day of [...new Set(days)].sort()) await lockCalendarDay(db, day);
}
/** 호출자는 변경 반영·주문 내용·버전을 같은 트랜잭션에서 저장합니다. 이 함수만 따로 커밋하지 않습니다. */
export async function moveOrderSlotInTransaction(db: ShopDb, input: ChangeSlotInput): Promise<ChangeSlotResult> {
  const order = await lockedSlotOrder(db, input);
  if (order === null) return { kind: "stale" };
  const change = await lockedChange(db, order.id, input.changeRequestId, input.expectedChangeRevision);
  if (change === null || change.base_version !== order.version) return { kind: "stale" };
  if (
    order.status !== "confirmed" ||
    change.status !== "requested" ||
    change.amount_delta === null ||
    change.amount_delta > 0 ||
    change.new_pickup_at === null
  )
    return { kind: "not_applicable" };
  const key = eventKeys.hold(order.id, change.id);
  const existing = (
    await db.run<{ id: string; day: string }>("SELECT id,day::text FROM slot_holds WHERE shop_id=$1 AND hold_key=$2", [
      key,
    ])
  ).rows[0];
  if (existing) return { kind: "existing", holdId: existing.id, day: existing.day };
  const old = (
    await db.run<{ id: string; day: string }>(
      "SELECT id,day::text FROM slot_holds WHERE shop_id=$1 AND order_id=$2 AND status='fixed'",
      [order.id],
    )
  ).rows[0];
  if (!old || old.day !== order.pickup_day) return { kind: "not_applicable" };
  const day = await pickupDay(db, change.new_pickup_at, input.now);
  if (day === old.day) return { kind: "existing", holdId: old.id, day };
  await lockSlotDays(db, [old.day, day]);
  const availability = await lockedCalendarSlotStatus(db, day, input.now);
  const overbooked = availability.status !== "open";
  if (overbooked) {
    if (db.scope.via.kind !== "owner") return { kind: "day_full", day };
    if (input.ownerConfirmed !== true)
      return { kind: "confirmation_required", day, reason: availability.status as "closed" | "day_off" };
  }
  const released = await db.run(
    "UPDATE slot_holds SET status='released',released_at=$3,release_reason='date_changed' WHERE shop_id=$1 AND id=$2 AND status='fixed'",
    [old.id, input.now],
  );
  if (released.rowCount !== 1) throw new Error("slot changed after order lock");
  const saved = await db.found<{ id: string }>(
    "INSERT INTO slot_holds(shop_id,day,order_id,hold_key,status,overbooked,fixed_at,created_at) VALUES($1,$2,$3,$4,'fixed',$5,$6,$6) RETURNING id",
    [day, order.id, key, overbooked, input.now],
  );
  return { kind: "fixed", holdId: saved.id, day };
}

async function differenceChange(db: ShopDb, order: Order, payment: Payment, expected?: number): Promise<Change | null> {
  if (payment.change_request_id === null) return null;
  const change = await lockedChange(db, order.id, payment.change_request_id, expected);
  return change &&
    order.status === "confirmed" &&
    change.base_version === order.version &&
    change.status === "awaiting_difference" &&
    change.amount_delta !== null &&
    change.amount_delta > 0
    ? change
    : null;
}

/** 차액 결제를 확인한 담당 실행기는 이 자리 변경과 주문 내용·변경 반영을 같은 트랜잭션에서 저장합니다. */
export async function applyDifferenceSlotInTransaction(
  db: ShopDb,
  input: ChangeSlotInput & { readonly paymentRequestId: string },
): Promise<ChangeSlotResult> {
  const order = await lockedSlotOrder(db, input);
  if (order === null) return { kind: "stale" };
  const payment = await lockedPayment(db, order.id, pathId(input.paymentRequestId));
  if (
    payment.kind !== "difference" ||
    payment.status !== "paid" ||
    payment.change_request_id !== pathId(input.changeRequestId)
  )
    return { kind: "not_applicable" };
  const change = await differenceChange(db, order, payment, input.expectedChangeRevision);
  if (!change || change.new_pickup_at === null) return { kind: "not_applicable" };
  const day = await pickupDay(db, change.new_pickup_at, input.now);
  const old = (
    await db.run<{ id: string; day: string }>(
      "SELECT id,day::text FROM slot_holds WHERE shop_id=$1 AND order_id=$2 AND status='fixed'",
      [order.id],
    )
  ).rows[0];
  if (!old || old.day !== order.pickup_day) return { kind: "not_applicable" };
  if (day === old.day) return { kind: "existing", holdId: old.id, day };
  const held = (
    await db.run<{ id: string; day: string; status: string }>(
      "SELECT id,day::text,status FROM slot_holds WHERE shop_id=$1 AND order_id=$2 AND payment_request_id=$3 AND hold_key=$4",
      [order.id, payment.id, eventKeys.hold(order.id, change.id)],
    )
  ).rows[0];
  if (held?.status !== "held" || held.day !== day) return { kind: "not_applicable" };
  await lockSlotDays(db, [old.day, day]);
  const released = await db.run(
    "UPDATE slot_holds SET status='released',released_at=$3,release_reason='date_changed' WHERE shop_id=$1 AND id=$2 AND status='fixed'",
    [old.id, input.now],
  );
  if (released.rowCount !== 1) throw new Error("slot changed after order lock");
  const fixed = await db.run(
    "UPDATE slot_holds SET status='fixed',fixed_at=$3 WHERE shop_id=$1 AND id=$2 AND status='held'",
    [held.id, input.now],
  );
  if (fixed.rowCount !== 1) throw new Error("slot changed after order lock");
  return { kind: "fixed", holdId: held.id, day };
}

export interface RemakeSlotInput extends OrderSlotInput {
  readonly ownerConfirmed?: boolean;
}
export function reserveRemakeSlot(db: ShopRequestDb, input: RemakeSlotInput): Promise<ChangeSlotResult> {
  return db.transaction((tx) => reserveRemakeSlotInTransaction(tx, input));
}
/** 재제작 담당 실행기는 새 주문·첫 주문 내용과 이 확정 자리를 같은 트랜잭션에서 만듭니다. */
export async function reserveRemakeSlotInTransaction(db: ShopDb, input: RemakeSlotInput): Promise<ChangeSlotResult> {
  const order = await lockedSlotOrder(db, input);
  if (order === null) return { kind: "stale" };
  if (order.remake_of_order_id === null || order.status !== "confirmed" || order.pickup_at <= input.now)
    return { kind: "not_applicable" };
  const key = eventKeys.holdRemake(order.id);
  const existing = (
    await db.run<{ id: string; day: string; status: string }>(
      "SELECT id,day::text,status FROM slot_holds WHERE shop_id=$1 AND hold_key=$2",
      [key],
    )
  ).rows[0];
  if (existing) return { kind: "existing", holdId: existing.id, day: existing.day };
  const availability = await lockedCalendarSlotStatus(db, order.pickup_day, input.now);
  const overbooked = availability.status !== "open";
  if (overbooked) {
    if (db.scope.via.kind !== "owner") return { kind: "day_full", day: availability.day };
    if (input.ownerConfirmed !== true)
      return {
        kind: "confirmation_required",
        day: availability.day,
        reason: availability.status as "closed" | "day_off",
      };
  }
  await lockCalendarDay(db, order.pickup_day);
  const saved = await db.found<{ id: string }>(
    "INSERT INTO slot_holds(shop_id,day,order_id,hold_key,status,overbooked,fixed_at,created_at) VALUES($1,$2,$3,$4,'fixed',$5,$6,$6) RETURNING id",
    [order.pickup_day, order.id, key, overbooked, input.now],
  );
  return { kind: "fixed", holdId: saved.id, day: order.pickup_day };
}

export function releaseClosedChangeSlot(
  db: ShopRequestDb,
  input: ChangeSlotInput & { readonly paymentRequestId: string },
): Promise<SlotTransitionResult> {
  return db.transaction((tx) => releaseClosedChangeSlotInTransaction(tx, input));
}
/** 변경 닫기 담당 실행기는 변경·차액 안내를 먼저 닫고 같은 트랜잭션에서 새날 자리만 풉니다. */
export async function releaseClosedChangeSlotInTransaction(
  db: ShopDb,
  input: ChangeSlotInput & { readonly paymentRequestId: string },
): Promise<SlotTransitionResult> {
  const order = await lockedSlotOrder(db, input);
  if (order === null) return { kind: "stale" };
  const payment = await lockedPayment(db, order.id, pathId(input.paymentRequestId));
  if (
    payment.kind !== "difference" ||
    payment.change_request_id !== pathId(input.changeRequestId) ||
    !["expired", "closed"].includes(payment.status)
  )
    return { kind: "not_applicable" };
  const change = await lockedChange(db, order.id, input.changeRequestId, input.expectedChangeRevision);
  if (change === null) return { kind: "stale" };
  if (!["closed_no_difference", "closed_by_cancel", "closed_no_answer", "rejected"].includes(change.status))
    return { kind: "not_applicable" };
  const held = (
    await db.run<{ id: string; day: string }>(
      "SELECT id,day::text FROM slot_holds WHERE shop_id=$1 AND order_id=$2 AND payment_request_id=$3 AND hold_key=$4 AND status='held'",
      [order.id, payment.id, eventKeys.hold(order.id, change.id)],
    )
  ).rows[0];
  if (!held) return { kind: "unchanged" };
  await lockCalendarDay(db, held.day);
  const updated = await db.run(
    "UPDATE slot_holds SET status='released',released_at=$3,release_reason='change_closed' WHERE shop_id=$1 AND id=$2 AND status='held'",
    [held.id, input.now],
  );
  if (updated.rowCount !== 1) throw new Error("slot changed after order lock");
  return { kind: "released", holdId: held.id };
}
