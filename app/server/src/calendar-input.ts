/** 영업 캘린더 입력(API-027·029). 검사 전의 값은 저장하거나 오류 응답에 싣지 않는다. */
import { ApiError, type FieldError, fieldError } from "./problem";
import { shopLocalToUtc } from "./time";

export interface CalendarSettingsInput {
  baseRevision: string | null;
  closedWeekdays: number[];
  dailyCapacity: number;
  orderCutoffDays: number;
  orderCutoffTime: string;
  replyStart: string;
  replyEnd: string;
  dayBeforeNoticeTime: string;
  reviewRequestTime: string;
  confirm: string[];
}

export interface CalendarDayInput {
  baseRevision: string | null;
  closed?: boolean;
  capacityOverride?: number | null;
  manuallyClosed?: boolean;
  confirm: string[];
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const REVISION = /^[A-Za-z0-9._:-]{1,64}$/;
const CONFIRM = ["closed_day_with_orders", "capacity_below_held"];
export const CALENDAR_SETTING_KEYS = [
  "closedWeekdays",
  "dailyCapacity",
  "orderCutoffDays",
  "orderCutoffTime",
  "replyStart",
  "replyEnd",
  "dayBeforeNoticeTime",
  "reviewRequestTime",
] as const;

function object(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw fieldError("/", "bad_format");
  return body as Record<string, unknown>;
}

function common(
  input: Record<string, unknown>,
  names: readonly string[],
  required: readonly string[],
  errors: FieldError[],
) {
  for (const name of Object.keys(input))
    if (!["baseRevision", "confirm", ...names].includes(name))
      errors.push({ field: /^[A-Za-z0-9_]{1,100}$/.test(name) ? `/${name}` : "/", code: "unknown_field" });
  for (const name of ["baseRevision", ...required])
    if (!Object.hasOwn(input, name)) errors.push({ field: `/${name}`, code: "required" });
  if (
    input.baseRevision !== undefined &&
    input.baseRevision !== null &&
    (typeof input.baseRevision !== "string" || !REVISION.test(input.baseRevision))
  )
    errors.push({ field: "/baseRevision", code: "bad_format" });
  if (input.confirm !== undefined) {
    if (!Array.isArray(input.confirm) || input.confirm.some((x) => typeof x !== "string" || !CONFIRM.includes(x)))
      errors.push({ field: "/confirm", code: "not_allowed" });
    else if (input.confirm.length > 2) errors.push({ field: "/confirm", code: "too_many" });
    else if (new Set(input.confirm).size !== input.confirm.length)
      errors.push({ field: "/confirm", code: "duplicate" });
  }
}

function integer(value: unknown, field: string, max: number, errors: FieldError[]) {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isInteger(value)) errors.push({ field, code: "bad_format" });
  else if (value < 0 || value > max) errors.push({ field, code: "out_of_range" });
}

function finish(errors: FieldError[]) {
  if (errors.length) throw new ApiError("validation_failed", { errors: errors.slice(0, 50) });
}

export function parseCalendarSettings(body: unknown): CalendarSettingsInput {
  const input = object(body);
  const errors: FieldError[] = [];
  common(input, CALENDAR_SETTING_KEYS, CALENDAR_SETTING_KEYS, errors);
  const days = input.closedWeekdays;
  if (days !== undefined) {
    if (!Array.isArray(days) || days.some((d) => !Number.isInteger(d) || d < 1 || d > 7))
      errors.push({ field: "/closedWeekdays", code: "out_of_range" });
    else if (days.length > 7) errors.push({ field: "/closedWeekdays", code: "too_many" });
    else if (new Set(days).size !== days.length) errors.push({ field: "/closedWeekdays", code: "duplicate" });
  }
  integer(input.dailyCapacity, "/dailyCapacity", 100, errors);
  integer(input.orderCutoffDays, "/orderCutoffDays", 30, errors);
  for (const name of ["orderCutoffTime", "replyStart", "replyEnd", "dayBeforeNoticeTime", "reviewRequestTime"]) {
    const value = input[name];
    if (value === undefined) continue;
    if (typeof value !== "string" || !TIME.test(value)) errors.push({ field: `/${name}`, code: "bad_format" });
    else if (["dayBeforeNoticeTime", "reviewRequestTime"].includes(name) && (value < "08:00" || value > "20:50"))
      errors.push({ field: `/${name}`, code: "outside_window" });
  }
  if (
    typeof input.replyStart === "string" &&
    typeof input.replyEnd === "string" &&
    TIME.test(input.replyStart) &&
    TIME.test(input.replyEnd) &&
    input.replyEnd <= input.replyStart
  )
    errors.push({ field: "/replyEnd", code: "not_after_start" });
  finish(errors);
  return {
    ...input,
    closedWeekdays: [...(days as number[])].sort((a, b) => a - b),
    confirm: input.confirm ?? [],
  } as CalendarSettingsInput;
}

export function parseCalendarDay(body: unknown): CalendarDayInput {
  const input = object(body);
  const errors: FieldError[] = [];
  common(input, ["closed", "capacityOverride", "manuallyClosed"], [], errors);
  if (!["closed", "capacityOverride", "manuallyClosed"].some((name) => Object.hasOwn(input, name)))
    errors.push({ field: "/", code: "required" });
  for (const name of ["closed", "manuallyClosed"])
    if (input[name] !== undefined && typeof input[name] !== "boolean")
      errors.push({ field: `/${name}`, code: "bad_format" });
  if (input.capacityOverride !== null) integer(input.capacityOverride, "/capacityOverride", 100, errors);
  finish(errors);
  return { ...input, confirm: input.confirm ?? [] } as CalendarDayInput;
}

export function calendarDate(value: unknown, field: string): string {
  if (value === undefined) throw fieldError(field, "required");
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw fieldError(field, "bad_format");
  try {
    shopLocalToUtc(value, "12:00", "UTC");
  } catch {
    throw fieldError(field, "bad_format");
  }
  return value;
}

export function shiftDate(day: string, by: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
}

/** 예약 가능 기간은 오늘부터59일 뒤까지이며 모든 자리 처리에서 같은 오류를 쓴다. */
export function calendarBookingDate(value: unknown, today: string, field = "/pickupDay"): string {
  const day = calendarDate(value, field);
  if (day < today || day > shiftDate(today, 59)) throw fieldError(field, "outside_window");
  return day;
}

export function isoWeekday(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay() || 7;
}
