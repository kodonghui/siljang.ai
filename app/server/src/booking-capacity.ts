/** TASK-068. 날짜 판정은 자리를 만들지 않는다. 안내 전달 확정 뒤 마감 질문만 기록한다. */
import { calendarBookingDays } from "./calendar";
import { calendarDate } from "./calendar-input";
import { handoffSourceMatch } from "./handoff-source";
import { createHandoffTask } from "./handoff-task";
import { ApiError } from "./problem";
import { pathId, type ShopDb, type ShopRequestDb } from "./shop-scope";

const CLOSED_TEXT = "그날은 마감됐어요.";
const NO_ALTERNATIVE = "가까운 날에 자리가 없어요. 사장님께 확인을 요청할 수 있어요.";
const OTHER_DAY = "가까운 날에 자리가 없어요. 다른 날짜를 말씀해 주세요.";
export interface PickupAvailability {
  readonly day: string;
  readonly status: "open" | "closed" | "day_off" | "outside_window";
  readonly alternatives: readonly string[];
  readonly message: string;
}

function availabilityMessage(status: PickupAvailability["status"], alternatives: readonly string[]): string {
  const text = {
    open: "그날 주문을 받을 수 있어요.",
    closed: CLOSED_TEXT,
    day_off: "그날은 휴무예요.",
    outside_window: "오늘부터 60일 안의 날짜를 골라 주세요.",
  }[status];
  return status === "open" || alternatives.length
    ? text
    : `${text} ${status === "closed" ? NO_ALTERNATIVE : OTHER_DAY}`;
}

function storedAvailability(stored: PickupAvailability | null, day: string): PickupAvailability | null {
  if (stored?.day !== day || stored.status !== "closed" || !Array.isArray(stored.alternatives)) return null;
  const alternatives = stored.alternatives.slice(0, 3).map((value) => calendarDate(value, "/pickupDay"));
  return { day, status: "closed", alternatives, message: availabilityMessage("closed", alternatives) };
}

async function readAvailability(db: ShopDb, rawDay: string, now: Date): Promise<PickupAvailability> {
  const day = calendarDate(rawDay, "/pickupDay");
  const days = await calendarBookingDays(db, now);
  const desired = days.find((row) => row.day === day);
  if (desired?.status === "open")
    return { day, status: "open", alternatives: [], message: availabilityMessage("open", []) };
  const distance = (candidate: string) => Math.abs(Date.parse(candidate) - Date.parse(day)) / 86400000;
  const alternatives = days
    .filter((row) => row.status === "open" && distance(row.day) <= 14)
    .sort((a, b) => distance(a.day) - distance(b.day) || a.day.localeCompare(b.day))
    .slice(0, 3)
    .map((row) => row.day);
  const status = desired?.status ?? "outside_window";
  return {
    day,
    status,
    alternatives,
    message: availabilityMessage(status, alternatives),
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
  readonly kind: "not_requested" | "waiting_for_notice" | "handed_off" | "already_handed_off";
  readonly handoffId?: string;
};

export function requestClosedPickupDay(db: ShopRequestDb, input: ClosedPickupInput): Promise<ClosedPickupResult> {
  return db.transaction((tx) => recordClosedPickupDayInTransaction(tx, input));
}

async function previousRequest(
  tx: ShopDb,
  sourceId: string,
  consultationId: string,
  day: string,
  now: Date,
): Promise<ClosedPickupResult | null> {
  const row = (
    await tx.run<{ id: string; reason: string; requested_day: string | null; availability: PickupAvailability | null }>(
      `SELECT h.id,h.reason,h.requested_day::text,t.detail->'closedDayAvailability' AS availability
     FROM handoffs h LEFT JOIN owner_tasks t ON t.shop_id=$1 AND t.handoff_id=h.id
     WHERE h.shop_id=$1 AND h.consultation_id=$3 AND ${handoffSourceMatch("$2")}
     ORDER BY (h.reason='closed_day' AND h.requested_day=$4::date) DESC,h.created_at,h.id LIMIT 1`,
      [sourceId, consultationId, day],
    )
  ).rows[0];
  if (!row) return null;
  if (row.reason !== "closed_day" || row.requested_day !== day)
    return { kind: "already_handed_off", handoffId: row.id, availability: await readAvailability(tx, day, now) };
  const availability = storedAvailability(row.availability, day) ?? (await readAvailability(tx, day, now));
  return { kind: "handed_off", handoffId: row.id, availability };
}

/** 호출자는 안내 전달 표시와 같은 트랜잭션에서 부를 수 있다. 외부 발신은 하지 않는다. */
export async function recordClosedPickupDayInTransaction(
  tx: ShopDb,
  input: ClosedPickupInput,
): Promise<ClosedPickupResult> {
  const sourceId = pathId(input.sourceMessageId),
    consultationId = pathId(input.consultationId),
    day = calendarDate(input.day, "/pickupDay");
  const source = await tx.found<{ customer_id: string }>(
    `SELECT c.customer_id FROM messages m JOIN consultations c ON c.shop_id=$1 AND c.id=m.consultation_id
     WHERE m.shop_id=$1 AND m.id=$2 AND m.consultation_id=$3 AND m.direction='inbound'`,
    [sourceId, consultationId],
  );
  if (!input.insist) {
    const previous = await previousRequest(tx, sourceId, consultationId, day, input.now);
    return previous ?? { kind: "not_requested", availability: await readAvailability(tx, day, input.now) };
  }
  await tx.found("SELECT id FROM customers WHERE shop_id=$1 AND id=$2 FOR UPDATE", [source.customer_id]);
  const consultation = await tx.found<{ status: string }>(
    "SELECT status FROM consultations WHERE shop_id=$1 AND id=$2 AND customer_id=$3 FOR UPDATE",
    [consultationId, source.customer_id],
  );
  const previous = await previousRequest(tx, sourceId, consultationId, day, input.now);
  if (previous) return previous;
  if (["ended", "deleted", "dropped"].includes(consultation.status)) throw new ApiError("not_found");
  const availability = await readAvailability(tx, day, input.now);
  if (availability.status !== "closed") return { availability, kind: "not_requested" };
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
  const opened = (
    await tx.run<{ id: string; availability: PickupAvailability | null }>(
      `SELECT h.id,t.detail->'closedDayAvailability' AS availability FROM handoffs h
      LEFT JOIN owner_tasks t ON t.shop_id=$1 AND t.handoff_id=h.id
      WHERE h.shop_id=$1 AND h.consultation_id=$2 AND h.reason='closed_day' AND h.requested_day=$3::date AND h.status='open'`,
      [consultationId, availability.day],
    )
  ).rows[0];
  let handoffId: string;
  let resultAvailability = availability;
  if (opened) {
    handoffId = opened.id;
    resultAvailability = storedAvailability(opened.availability, day) ?? availability;
    // 마감 날짜 건에는 일반 추가 질문을 붙이지 않는다. 같은 열린 날짜 건을 쓴다(SPEC-014).
    await tx.run(
      `UPDATE owner_tasks SET detail=jsonb_set(coalesce(detail,'{}'::jsonb),'{closedDaySourceIds}',
       coalesce(detail->'closedDaySourceIds','[]'::jsonb)||jsonb_build_array($3::text))
       WHERE shop_id=$1 AND handoff_id=$2 AND NOT coalesce(detail->'closedDaySourceIds','[]'::jsonb) ? $3`,
      [handoffId, sourceId],
    );
  } else {
    handoffId = (
      await tx.found<{ id: string }>(
        "INSERT INTO handoffs (shop_id,consultation_id,source_message_id,reason,requested_day,created_at) VALUES ($1,$2,$3,'closed_day',$4::date,$5) RETURNING id",
        [consultationId, sourceId, availability.day, input.now],
      )
    ).id;
    await createHandoffTask(tx, handoffId, input.now, {
      requestedDay: availability.day,
      reason: "closed_day",
      closedDaySourceIds: [sourceId],
      closedDayAvailability: availability,
    });
  }
  await tx.run("UPDATE consultations SET status='awaiting_owner' WHERE shop_id=$1 AND id=$2", [consultationId]);
  return { kind: "handed_off", handoffId, availability: resultAvailability };
}
