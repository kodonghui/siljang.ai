/** TASK-068. 날짜 판정은 자리를 만들지 않는다. 안내 전달 확정 뒤 마감 질문만 기록한다. */
import { calendarBookingDays } from "./calendar";
import { calendarDate } from "./calendar-input";
import { eventKeys, insertOnce } from "./event-keys";
import { ownerWaitDue } from "./owner-wait";
import { ApiError } from "./problem";
import { pathId, type ShopDb, type ShopRequestDb } from "./shop-scope";
import { toShopLocal } from "./time";

const CLOSED_TEXT = "그날은 마감됐어요.";
const NO_ALTERNATIVE = "가까운 날에 자리가 없어요. 사장님께 확인을 요청할 수 있어요.";
export interface PickupAvailability {
  readonly day: string;
  readonly status: "open" | "closed" | "day_off" | "outside_window";
  readonly alternatives: readonly string[];
  readonly message: string;
}

async function readAvailability(db: ShopDb, rawDay: string, now: Date): Promise<PickupAvailability> {
  const day = calendarDate(rawDay, "/pickupDay");
  const days = await calendarBookingDays(db, now);
  const desired = days.find((row) => row.day === day);
  if (!desired)
    return { day, status: "outside_window", alternatives: [], message: "오늘부터 60일 안의 날짜를 골라 주세요." };
  if (desired.status === "open")
    return { day, status: "open", alternatives: [], message: "그날 주문을 받을 수 있어요." };
  const distance = (candidate: string) => Math.abs(Date.parse(candidate) - Date.parse(day)) / 86400000;
  const alternatives = days
    .filter((row) => row.status === "open" && distance(row.day) <= 14)
    .sort((a, b) => distance(a.day) - distance(b.day) || a.day.localeCompare(b.day))
    .slice(0, 3)
    .map((row) => row.day);
  const message = desired.status === "day_off" ? "그날은 휴무예요." : CLOSED_TEXT;
  return {
    day,
    status: desired.status,
    alternatives,
    message: alternatives.length ? message : `${message} ${NO_ALTERNATIVE}`,
  };
}

export function assessPickupDay(db: ShopRequestDb, day: string, now: Date): Promise<PickupAvailability> {
  return db.transaction((tx) => readAvailability(tx, day, now));
}

/** 서버가 만든 마감 안내를 수신 메시지와 날짜에 묶는다. */
export function closedDayNoticeTrace(sourceMessageId: string, day: string): string {
  return `day-closed:${pathId(sourceMessageId)}:${calendarDate(day, "/pickupDay")}`;
}

interface ClosedPickupInput {
  readonly consultationId: string;
  readonly sourceMessageId: string;
  readonly day: string;
  readonly noticeMessageId: string;
  readonly insist: boolean;
  readonly now: Date;
}
type ClosedPickupResult = {
  readonly availability: PickupAvailability;
  readonly kind: "not_requested" | "waiting_for_notice" | "handed_off";
  readonly handoffId?: string;
};

export function requestClosedPickupDay(db: ShopRequestDb, input: ClosedPickupInput): Promise<ClosedPickupResult> {
  return db.transaction((tx) => recordClosedPickupDayInTransaction(tx, input));
}

/** 호출자는 안내 전달 표시와 같은 트랜잭션에서 부를 수 있다. 외부 발신은 하지 않는다. */
export async function recordClosedPickupDayInTransaction(
  tx: ShopDb,
  input: ClosedPickupInput,
): Promise<ClosedPickupResult> {
  const sourceId = pathId(input.sourceMessageId),
    consultationId = pathId(input.consultationId);
  const source = await tx.found<{ customer_id: string }>(
    `SELECT c.customer_id FROM messages m JOIN consultations c ON c.shop_id=$1 AND c.id=m.consultation_id
     WHERE m.shop_id=$1 AND m.id=$2 AND m.consultation_id=$3 AND m.direction='inbound'`,
    [sourceId, consultationId],
  );
  await tx.found("SELECT id FROM customers WHERE shop_id=$1 AND id=$2 FOR UPDATE", [source.customer_id]);
  const consultation = await tx.found<{ status: string }>(
    "SELECT status FROM consultations WHERE shop_id=$1 AND id=$2 AND customer_id=$3 FOR UPDATE",
    [consultationId, source.customer_id],
  );
  if (["ended", "deleted", "dropped"].includes(consultation.status)) throw new ApiError("not_found");
  const availability = await readAvailability(tx, input.day, input.now);
  if (availability.status !== "closed" || !input.insist) return { availability, kind: "not_requested" };
  const notice = await tx.found<{ delivery: string; sent_at: Date | null; body_masked: string }>(
    `SELECT delivery,sent_at,body_masked FROM messages WHERE shop_id=$1 AND id=$2 AND consultation_id=$3
     AND direction='outbound' AND author='system' AND kind='text' AND trace_id=$4`,
    [pathId(input.noticeMessageId), consultationId, closedDayNoticeTrace(sourceId, availability.day)],
  );
  if (!notice.body_masked.startsWith(CLOSED_TEXT)) throw new ApiError("not_found");
  if (
    notice.sent_at === null ||
    notice.sent_at > input.now ||
    !["skill_response", "callback", "delivered_later"].includes(notice.delivery)
  )
    return { availability, kind: "waiting_for_notice" };
  const previous = (
    await tx.run<{ id: string; reason: string; requested_day: string | null }>(
      `SELECT h.id,h.reason,h.requested_day::text FROM handoffs h WHERE h.shop_id=$1
     AND (h.source_message_id=$2 OR h.id IN (SELECT q.handoff_id FROM handoff_questions q WHERE q.shop_id=$1 AND q.message_id=$2))`,
      [sourceId],
    )
  ).rows[0];
  if (previous) {
    if (previous.reason !== "closed_day" || previous.requested_day !== availability.day)
      throw new ApiError("not_found");
    return { availability, kind: "handed_off", handoffId: previous.id };
  }
  const opened = (
    await tx.run<{ id: string }>(
      "SELECT id FROM handoffs WHERE shop_id=$1 AND consultation_id=$2 AND reason='closed_day' AND requested_day=$3::date AND status='open' FOR UPDATE",
      [consultationId, availability.day],
    )
  ).rows[0];
  let handoffId: string;
  if (opened) {
    handoffId = opened.id;
    await tx.run(
      "INSERT INTO handoff_questions (shop_id,handoff_id,message_id,reason,created_at) VALUES ($1,$2,$3,'closed_day',$4) ON CONFLICT (message_id) DO NOTHING",
      [handoffId, sourceId, input.now],
    );
    const task = await tx.found<{ id: string }>(
      "SELECT id FROM owner_tasks WHERE shop_id=$1 AND handoff_id=$2 AND closed_at IS NULL",
      [handoffId],
    );
    const shop = await tx.found<{ time_zone: string }>("SELECT time_zone FROM shops WHERE id=$1");
    await insertOnce(
      tx,
      "owner_alerts",
      `INSERT INTO owner_alerts (shop_id, event_key, owner_task_id, kind, next_attempt_at, created_at)
       VALUES ($1, $2, $3, 'handoff_appended', $4, $4) ON CONFLICT (shop_id, event_key) DO NOTHING RETURNING id`,
      [eventKeys.alert("handoff_appended", handoffId, toShopLocal(input.now, shop.time_zone).date), task.id, input.now],
    );
  } else {
    handoffId = (
      await tx.found<{ id: string }>(
        "INSERT INTO handoffs (shop_id,consultation_id,source_message_id,reason,requested_day,created_at) VALUES ($1,$2,$3,'closed_day',$4::date,$5) RETURNING id",
        [consultationId, sourceId, availability.day, input.now],
      )
    ).id;
    const task = await insertOnce(
      tx,
      "owner_tasks",
      `INSERT INTO owner_tasks (shop_id, event_key, handoff_id, kind, wait_status, wait_due_at, opened_at, detail)
       VALUES ($1, $2, $3, 'handoff', 'waiting', $4, $5, $6::jsonb) ON CONFLICT (shop_id, event_key) DO NOTHING RETURNING id`,
      [
        eventKeys.task("handoff", handoffId),
        handoffId,
        await ownerWaitDue(tx, input.now),
        input.now,
        JSON.stringify({ requestedDay: availability.day, reason: "closed_day" }),
      ],
    );
    await insertOnce(
      tx,
      "owner_alerts",
      `INSERT INTO owner_alerts (shop_id, event_key, owner_task_id, kind, next_attempt_at, created_at)
       VALUES ($1, $2, $3, 'new_task', $4, $4) ON CONFLICT (shop_id, event_key) DO NOTHING RETURNING id`,
      [eventKeys.alert("new_task", task.id), task.id, input.now],
    );
  }
  await tx.run("UPDATE consultations SET status='awaiting_owner' WHERE shop_id=$1 AND id=$2", [consultationId]);
  return { availability, kind: "handed_off", handoffId };
}
