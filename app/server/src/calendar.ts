/** 영업 캘린더(API-026~029). 가게·날짜의 잠금은 이후 자리 확보 명령과 함께 쓴다(G3). */
import { requireJson } from "./body";
import {
  CALENDAR_SETTING_KEYS,
  type CalendarSettingsInput,
  calendarBookingDate,
  calendarDate,
  isoWeekday,
  parseCalendarDay,
  parseCalendarSettings,
  shiftDate,
} from "./calendar-input";
import { rescheduleCalendarNotices } from "./calendar-notices";
import { toHex } from "./encoding";
import { ApiError, type CalendarConflict, type ConfirmationKind, fieldError } from "./problem";
import type { ShopRequest } from "./routes";
import type { ShopDb } from "./shop-scope";
import { shopLocalToUtc, toShopIso, toShopLocal } from "./time";

interface CalendarRow {
  closed_weekdays: number[];
  daily_capacity: number;
  order_cutoff_days: number;
  order_cutoff_time: string;
  reply_start: string;
  reply_end: string;
  day_before_notice_time: string;
  review_request_time: string;
  updated_at: Date;
  revision: string;
}
interface DayRow {
  day: string;
  closed: boolean;
  capacity: number | null;
  manually_closed_at: Date | null;
  revision: string;
}
interface HoldRow {
  id: string;
  day: string;
  status: string;
  overbooked: boolean;
  order_id: string;
  order_no: string;
  order_status: string;
  pickup_at: Date;
}

async function digest(value: unknown): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)))));
}

function candidate(input: CalendarSettingsInput, previous: CalendarRow | undefined, now: Date): CalendarRow {
  return {
    closed_weekdays: input.closedWeekdays,
    daily_capacity: input.dailyCapacity,
    order_cutoff_days: input.orderCutoffDays,
    order_cutoff_time: input.orderCutoffTime,
    reply_start: input.replyStart,
    reply_end: input.replyEnd,
    day_before_notice_time: input.dayBeforeNoticeTime,
    review_request_time: input.reviewRequestTime,
    updated_at: now,
    revision: previous?.revision ?? "new",
  };
}

function conflict(day: string, capacity: number, holds: HoldRow[], zone: string): CalendarConflict {
  const orders = [
    ...new Map(
      holds.map((h) => [
        h.order_id,
        { orderId: h.order_id, orderNo: h.order_no, status: h.order_status, pickupAt: toShopIso(h.pickup_at, zone) },
      ]),
    ).values(),
  ];
  return { day, capacity, held: holds.length, orders: orders.slice(0, 100) };
}

/** 409에는 변경 전의 주문만 보낸다. 확인하지 않은 저장은 트랜잭션 전체가 되돌아간다. */
function requireConfirmation(
  confirm: string[],
  items: { kind: ConfirmationKind; count: number; day?: string }[],
  conflicts: CalendarConflict[],
) {
  const missing = items.filter((item) => !confirm.includes(item.kind));
  if (missing.length)
    throw new ApiError("confirmation_required", {
      confirm: missing.map((item) =>
        item.count <= 10000 ? item : { kind: item.kind, ...(item.day ? { day: item.day } : {}) },
      ),
      conflicts: conflicts.slice(0, 400),
    });
}

type CalendarInventory = Awaited<ReturnType<typeof readDays>>;

function settingConflicts(
  previous: CalendarRow | undefined,
  next: CalendarRow,
  data: CalendarInventory,
  zone: string,
  confirm?: string[],
): CalendarConflict[] {
  const byDay = new Map<string, HoldRow[]>();
  for (const hold of data.holds) {
    const group = byDay.get(hold.day) ?? [];
    group.push(hold);
    byDay.set(hold.day, group);
  }
  const days = new Map(data.days.map((row) => [row.day, row]));
  const conflicts: CalendarConflict[] = [];
  let closedCount = 0;
  let capacityCount = 0;
  for (const [day, holds] of byDay) {
    const active = holds.filter((h) => h.status !== "done");
    const row = days.get(day);
    const capacity = row?.capacity ?? next.daily_capacity;
    const oldCapacity = row?.capacity ?? previous?.daily_capacity;
    const closed = row?.closed || next.closed_weekdays.includes(isoWeekday(day));
    const oldClosed = row?.closed || previous?.closed_weekdays.includes(isoWeekday(day));
    if (closed && !oldClosed) closedCount += active.length;
    if (capacity < holds.length && (oldCapacity === undefined || capacity < oldCapacity)) capacityCount += holds.length;
    if (capacity < holds.length || (closed && active.length)) conflicts.push(conflict(day, capacity, holds, zone));
  }
  if (confirm)
    requireConfirmation(
      confirm,
      [
        ...(closedCount ? [{ kind: "closed_day_with_orders" as const, count: closedCount }] : []),
        ...(capacityCount ? [{ kind: "capacity_below_held" as const, count: capacityCount }] : []),
      ],
      conflicts,
    );
  return conflicts.slice(0, 400);
}

/** 설정 변경은 배타 잠금, 날짜·자리 변경은 공유 잠금부터 얻는다. 없는 날짜도 설정 변경과 엇갈리지 않는다. */
async function lockSettings(db: ShopDb, exclusive: boolean): Promise<void> {
  if (exclusive) await db.run("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 41027))");
  else await db.run("SELECT pg_advisory_xact_lock_shared(hashtextextended($1::text, 41027))");
}

async function lockDay(db: ShopDb, day: string): Promise<void> {
  await lockSettings(db, false);
  await db.run("SELECT pg_advisory_xact_lock(hashtextextended($1::text || ':' || $2::text, 41029))", [day]);
  await db.run("SELECT d.day FROM calendar_days d WHERE d.shop_id = $1 AND d.day = $2::date FOR UPDATE", [day]);
}

/** 여러 날의 자리 이동은 날짜순으로 한 번씩 잠근다. 거절 전에는 새 날짜 행을 만들지 않는다. */
export function lockCalendarDate(db: ShopDb, day: string): Promise<void> {
  return lockDay(db, day);
}

/** 날짜 잠금을 잡은 호출자가 자리 저장 직전에만 날짜 행을 준비한다. */
export function ensureLockedCalendarDay(db: ShopDb, day: string): Promise<void> {
  return ensureDay(db, day);
}

/** 자리 확보·해제도 이 순서로 날짜 행을 잠근 뒤 수량을 다시 센다(G3). 트랜잭션 안에서만 부른다. */
export async function lockCalendarDay(db: ShopDb, day: string): Promise<void> {
  await lockDay(db, day);
  await ensureDay(db, day);
  await db.run("SELECT d.day FROM calendar_days d WHERE d.shop_id = $1 AND d.day = $2::date FOR UPDATE", [day]);
}

async function ensureDay(db: ShopDb, day: string): Promise<void> {
  await db.run("INSERT INTO calendar_days (shop_id, day) VALUES ($1, $2::date) ON CONFLICT (shop_id, day) DO NOTHING", [
    day,
  ]);
}

async function calendarRow(db: ShopDb, required = true): Promise<CalendarRow | undefined> {
  const row = (
    await db.run<CalendarRow>("SELECT c.*, c.xmin::text AS revision FROM business_calendars c WHERE c.shop_id = $1")
  ).rows[0];
  if (!row && required) throw new ApiError("not_set");
  return row;
}

async function timeZone(db: ShopDb): Promise<string> {
  return (await db.found<{ time_zone: string }>("SELECT s.time_zone FROM shops s WHERE s.id = $1")).time_zone;
}

async function renderSettings(db: ShopDb, row: CalendarRow, zone: string, inventory: CalendarInventory) {
  const revision = await digest([
    db.scope.shopId,
    row.revision,
    inventory.days.map((d) => [d.day, d.revision]),
    inventory.holds.map((h) => [h.day, h.id, h.status === "done", h.overbooked]),
  ]);
  return {
    closedWeekdays: row.closed_weekdays,
    dailyCapacity: row.daily_capacity,
    orderCutoffDays: row.order_cutoff_days,
    orderCutoffTime: row.order_cutoff_time.slice(0, 5),
    replyStart: row.reply_start.slice(0, 5),
    replyEnd: row.reply_end.slice(0, 5),
    dayBeforeNoticeTime: row.day_before_notice_time.slice(0, 5),
    reviewRequestTime: row.review_request_time.slice(0, 5),
    updatedAt: toShopIso(row.updated_at, zone),
    revision,
  };
}

async function readDays(db: ShopDb, from: string, to: string) {
  const days = (
    await db.run<DayRow>(
      "SELECT d.day::text, d.closed, d.capacity, d.manually_closed_at, d.xmin::text AS revision FROM calendar_days d WHERE d.shop_id = $1 AND d.day BETWEEN $2::date AND $3::date ORDER BY d.day",
      [from, to],
    )
  ).rows;
  const holds = (
    await db.run<HoldRow>(
      "SELECT h.id, h.day::text, h.status, h.overbooked, h.order_id, o.order_no, o.status AS order_status, o.pickup_at FROM slot_holds h JOIN orders o ON o.shop_id = $1 AND o.id = h.order_id WHERE h.shop_id = $1 AND h.day BETWEEN $2::date AND $3::date AND h.status IN ('held', 'fixed', 'done') ORDER BY h.day, h.id",
      [from, to],
    )
  ).rows;
  return { days, holds };
}

function dayValues(calendar: CalendarRow, day: string, row: DayRow | undefined, holds: HoldRow[]) {
  const capacity = row?.capacity ?? calendar.daily_capacity;
  return {
    day,
    weekdayClosed: calendar.closed_weekdays.includes(isoWeekday(day)),
    closed: row?.closed ?? false,
    capacityOverride: row?.capacity ?? null,
    capacity,
    held: holds.length,
    remaining: Math.max(0, capacity - holds.length),
    full: holds.length >= capacity,
    manuallyClosed: row?.manually_closed_at != null,
    overbooked: holds.some((h) => h.overbooked),
  };
}

async function renderDay(db: ShopDb, calendar: CalendarRow, day: string, row: DayRow | undefined, holds: HoldRow[]) {
  const revision = await digest([
    db.scope.shopId,
    calendar.revision,
    day,
    row?.revision ?? null,
    holds.map((h) => [h.id, h.status === "done", h.overbooked]),
  ]);
  return {
    ...dayValues(calendar, day, row, holds),
    revision,
  };
}

export interface CalendarBookingDay {
  readonly day: string;
  readonly status: "open" | "closed" | "day_off";
}

function bookingStatus(
  calendar: CalendarRow,
  value: ReturnType<typeof dayValues>,
  now: Date,
  zone: string,
): CalendarBookingDay {
  if (value.weekdayClosed || value.closed) return { day: value.day, status: "day_off" };
  const cutoff = shopLocalToUtc(shiftDate(value.day, -calendar.order_cutoff_days), calendar.order_cutoff_time, zone);
  const closed = value.full || value.manuallyClosed || value.overbooked || now.getTime() >= cutoff.getTime();
  return { day: value.day, status: closed ? "closed" : "open" };
}

/** 예약 링크의60일 날짜 상태(API-038). 수량·내부 식별자는 반환하지 않는다(G6). 트랜잭션 안에서 부른다. */
export async function calendarBookingDays(db: ShopDb, now: Date): Promise<CalendarBookingDay[]> {
  await lockSettings(db, false);
  const calendar = (await calendarRow(db)) as CalendarRow;
  const zone = await timeZone(db);
  const from = toShopLocal(now, zone).date;
  const data = await readDays(db, from, shiftDate(from, 59));
  return Array.from({ length: 60 }, (_, offset) => {
    const day = shiftDate(from, offset);
    return bookingStatus(
      calendar,
      dayValues(
        calendar,
        day,
        data.days.find((d) => d.day === day),
        data.holds.filter((h) => h.day === day),
      ),
      now,
      zone,
    );
  });
}

/**
 * 기간/형식은 잠금 전에 확인하고, 판정만으로 날짜 행을 만들지 않는다. 요청의 필드 위치는 호출자가 넘긴다.
 * TASK-082는 필요한 날을 날짜순으로 잠그고 calendarSlotStatusAfterLock으로 읽은 뒤, 저장 직전에 ensureLockedCalendarDay를 부른다.
 * 뒤의 조건/저장이 실패하면 트랜잭션을 롤백한다. 추가 수락은 별도로 확인받는다.
 */
export async function lockedCalendarSlotStatus(
  db: ShopDb,
  rawDay: string,
  now: Date,
  field = "/pickupDay",
): Promise<CalendarBookingDay> {
  const zone = await timeZone(db);
  const day = calendarBookingDate(rawDay, toShopLocal(now, zone).date, field);
  await lockDay(db, day);
  return readSlotStatus(db, day, now, zone);
}

/** 날짜 잠금을 이미 잡은 자리 처리 전용이다. 잠금을 다시 잡지 않고 최신 개수를 읽는다. */
export async function calendarSlotStatusAfterLock(
  db: ShopDb,
  rawDay: string,
  now: Date,
  field = "/pickupDay",
): Promise<CalendarBookingDay> {
  const zone = await timeZone(db);
  const day = calendarBookingDate(rawDay, toShopLocal(now, zone).date, field);
  return readSlotStatus(db, day, now, zone);
}

async function readSlotStatus(db: ShopDb, day: string, now: Date, zone: string): Promise<CalendarBookingDay> {
  const calendar = (await calendarRow(db)) as CalendarRow;
  const data = await readDays(db, day, day);
  return bookingStatus(calendar, dayValues(calendar, day, data.days[0], data.holds), now, zone);
}

async function oneDay(db: ShopDb, calendar: CalendarRow, day: string) {
  const data = await readDays(db, day, day);
  return renderDay(db, calendar, day, data.days[0], data.holds);
}

export async function getCalendarSettings(r: ShopRequest): Promise<Response> {
  return r.json(
    await r.db.transaction(async (db) => {
      await lockSettings(db, false);
      const row = await calendarRow(db);
      const zone = await timeZone(db);
      return renderSettings(
        db,
        row as CalendarRow,
        zone,
        await readDays(db, toShopLocal(r.services.now(), zone).date, "9999-12-31"),
      );
    }),
  );
}

export async function getCalendarDays(r: ShopRequest): Promise<Response> {
  const from = calendarDate(r.req.query("from"), "query:from");
  const to = calendarDate(r.req.query("to"), "query:to");
  if (to < from || Date.parse(to) - Date.parse(from) > 61 * 86_400_000) throw fieldError("query:to", "out_of_range");
  return r.json(
    await r.db.transaction(async (db) => {
      await lockSettings(db, false);
      const calendar = (await calendarRow(db)) as CalendarRow;
      const data = await readDays(db, from, to);
      const items = [];
      for (let day = from; day <= to; day = shiftDate(day, 1))
        items.push(
          await renderDay(
            db,
            calendar,
            day,
            data.days.find((d) => d.day === day),
            data.holds.filter((h) => h.day === day),
          ),
        );
      return { items };
    }),
  );
}

export async function setCalendarSettings(r: ShopRequest): Promise<Response> {
  requireJson(r.req.raw);
  const raw = await r.body();
  const input = parseCalendarSettings(raw);
  return r.command({
    command: "API-027",
    pathIds: [],
    body: raw,
    async execute(db) {
      await lockSettings(db, true);
      const zone = await timeZone(db);
      const today = toShopLocal(r.services.now(), zone).date;
      await db.run(
        "SELECT d.day FROM calendar_days d WHERE d.shop_id = $1 AND d.day >= $2::date ORDER BY d.day FOR UPDATE",
        [today],
      );
      const previous = await calendarRow(db, false);
      const inventory = await readDays(db, today, "9999-12-31");
      const old = previous ? await renderSettings(db, previous, zone, inventory) : undefined;
      if (input.baseRevision !== (old?.revision ?? null)) throw new ApiError("version_conflict");
      const next = candidate(input, previous, r.services.now());
      const conflicts = settingConflicts(previous, next, inventory, zone, input.confirm);
      if (old && CALENDAR_SETTING_KEYS.every((key) => JSON.stringify(old[key]) === JSON.stringify(input[key])))
        return {
          status: 200,
          code: "unchanged",
          ref: {},
          body: { outcome: "unchanged", calendar: old, conflicts },
        };
      await db.run(
        `INSERT INTO business_calendars (shop_id, closed_weekdays, daily_capacity, order_cutoff_days, order_cutoff_time, reply_start, reply_end, day_before_notice_time, review_request_time, updated_at)
        VALUES ($1, $2::smallint[], $3, $4, $5::time, $6::time, $7::time, $8::time, $9::time, $10)
        ON CONFLICT (shop_id) DO UPDATE SET closed_weekdays = EXCLUDED.closed_weekdays, daily_capacity = EXCLUDED.daily_capacity, order_cutoff_days = EXCLUDED.order_cutoff_days, order_cutoff_time = EXCLUDED.order_cutoff_time, reply_start = EXCLUDED.reply_start, reply_end = EXCLUDED.reply_end, day_before_notice_time = EXCLUDED.day_before_notice_time, review_request_time = EXCLUDED.review_request_time, updated_at = EXCLUDED.updated_at`,
        [
          input.closedWeekdays,
          input.dailyCapacity,
          input.orderCutoffDays,
          input.orderCutoffTime,
          input.replyStart,
          input.replyEnd,
          input.dayBeforeNoticeTime,
          input.reviewRequestTime,
          r.services.now(),
        ],
      );
      await rescheduleCalendarNotices(
        db,
        zone,
        previous
          ? { dayBefore: previous.day_before_notice_time.slice(0, 5), review: previous.review_request_time.slice(0, 5) }
          : undefined,
        { dayBefore: input.dayBeforeNoticeTime, review: input.reviewRequestTime },
      );
      const outcome = previous ? "updated" : "created";
      return {
        status: 200,
        code: outcome,
        ref: {},
        body: {
          outcome,
          calendar: await renderSettings(db, (await calendarRow(db)) as CalendarRow, zone, inventory),
          conflicts,
        },
      };
    },
    async render(db, stored) {
      await lockSettings(db, false);
      const calendar = (await calendarRow(db)) as CalendarRow;
      const zone = await timeZone(db);
      const inventory = await readDays(db, toShopLocal(r.services.now(), zone).date, "9999-12-31");
      return {
        outcome: stored.code,
        calendar: await renderSettings(db, calendar, zone, inventory),
        conflicts: settingConflicts(calendar, calendar, inventory, zone),
      };
    },
  });
}

export async function updateCalendarDay(r: ShopRequest): Promise<Response> {
  requireJson(r.req.raw);
  const day = calendarDate(r.req.param("day"), "path:day");
  const raw = await r.body();
  const input = parseCalendarDay(raw);
  return r.command({
    command: "API-029",
    pathIds: [day],
    body: raw,
    async execute(db) {
      await lockDay(db, day);
      const calendar = (await calendarRow(db)) as CalendarRow;
      if (day < toShopLocal(r.services.now(), await timeZone(db)).date) throw fieldError("path:day", "in_past");
      const data = await readDays(db, day, day);
      const row = data.days[0];
      const current = await renderDay(db, calendar, day, row, data.holds);
      if (input.baseRevision !== current.revision) throw new ApiError("version_conflict");
      const next = {
        closed: input.closed ?? current.closed,
        capacity: input.capacityOverride === undefined ? current.capacityOverride : input.capacityOverride,
        manual: input.manuallyClosed ?? current.manuallyClosed,
      };
      if (
        next.closed === current.closed &&
        next.capacity === current.capacityOverride &&
        next.manual === current.manuallyClosed
      )
        return { status: 200, code: "unchanged", ref: { day }, body: { outcome: "unchanged", day: current } };
      const active = data.holds.filter((h) => h.status !== "done");
      const capacity = next.capacity ?? calendar.daily_capacity;
      requireConfirmation(
        input.confirm,
        [
          ...(next.closed && !current.closed && !current.weekdayClosed && active.length
            ? [{ kind: "closed_day_with_orders" as const, count: active.length, day }]
            : []),
          ...(capacity < current.capacity && capacity < current.held
            ? [{ kind: "capacity_below_held" as const, count: current.held, day }]
            : []),
        ],
        data.holds.length ? [conflict(day, capacity, data.holds, await timeZone(db))] : [],
      );
      await ensureDay(db, day);
      await db.run(
        "UPDATE calendar_days SET closed = $3, capacity = $4, manually_closed_at = CASE WHEN $5::boolean THEN COALESCE(manually_closed_at, $6::timestamptz) ELSE NULL END, updated_at = $6 WHERE shop_id = $1 AND day = $2::date",
        [day, next.closed, next.capacity, next.manual, r.services.now()],
      );
      return {
        status: 200,
        code: "done",
        ref: { day },
        body: { outcome: "done", day: await oneDay(db, calendar, day) },
      };
    },
    async render(db, stored) {
      const calendar = (await calendarRow(db)) as CalendarRow;
      return { outcome: stored.code, day: await oneDay(db, calendar, String(stored.ref.day)) };
    },
  });
}
