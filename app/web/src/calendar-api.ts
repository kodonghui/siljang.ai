import { type ApiResult, request } from "./api";
import { INVALID_API_RESPONSE, isApiInteger as integer, isApiObject } from "./api-response";
import { isCalendarDate } from "./calendar-date";

export { isCalendarDate } from "./calendar-date";
export interface CalendarDay {
  readonly day: string;
  readonly weekdayClosed: boolean;
  readonly closed: boolean;
  readonly capacityOverride: number | null;
  readonly capacity: number;
  readonly held: number;
  readonly remaining: number;
  readonly full: boolean;
  readonly manuallyClosed: boolean;
  readonly overbooked: boolean;
  readonly revision: string;
}
export interface CalendarDays {
  readonly items: readonly CalendarDay[];
}
export interface CalendarDayResult {
  readonly outcome: "done" | "unchanged";
  readonly day: CalendarDay;
}
function valid(value: unknown): value is CalendarDay {
  return (
    isApiObject(value) &&
    isCalendarDate(value.day) &&
    ["weekdayClosed", "closed", "full", "manuallyClosed", "overbooked"].every(
      (key) => typeof value[key] === "boolean",
    ) &&
    (value.capacityOverride === null || integer(value.capacityOverride, 100)) &&
    integer(value.capacity, 100) &&
    integer(value.held, 10000) &&
    integer(value.remaining, 100) &&
    typeof value.revision === "string" &&
    /^[A-Za-z0-9._-]{1,64}$/.test(value.revision)
  );
}
function copy(value: CalendarDay): CalendarDay {
  return {
    day: value.day,
    weekdayClosed: value.weekdayClosed,
    closed: value.closed,
    capacityOverride: value.capacityOverride,
    capacity: value.capacity,
    held: value.held,
    remaining: value.remaining,
    full: value.full,
    manuallyClosed: value.manuallyClosed,
    overbooked: value.overbooked,
    revision: value.revision,
  };
}
export async function fetchCalendarDays(
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<ApiResult<CalendarDays>> {
  const query = new URLSearchParams({ from, to });
  const result = await request<unknown>(`/owner/calendar/days?${query}`, {
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  if (!result.ok) return result;
  const value = result.data;
  const count =
    isCalendarDate(from) && isCalendarDate(to)
      ? (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1
      : 0;
  if (
    count < 1 ||
    count > 62 ||
    !isApiObject(value) ||
    !Array.isArray(value.items) ||
    value.items.length !== count ||
    !value.items.every(valid)
  )
    return INVALID_API_RESPONSE;
  const items: CalendarDay[] = value.items;
  if (
    items.some(
      (item, index) => item.day < from || item.day > to || (index > 0 && item.day <= (items[index - 1]?.day ?? "")),
    )
  )
    return INVALID_API_RESPONSE;
  return { ...result, data: { items: items.map(copy) } };
}
export async function saveCalendarDay(
  day: string,
  body: Record<string, unknown>,
  key: string,
): Promise<ApiResult<CalendarDayResult>> {
  if (!isCalendarDate(day)) return INVALID_API_RESPONSE;
  const result = await request<unknown>(`/owner/calendar/days/${day}`, { method: "PATCH", body, key });
  if (!result.ok) return result;
  const value = result.data;
  return isApiObject(value) &&
    (value.outcome === "done" || value.outcome === "unchanged") &&
    valid(value.day) &&
    value.day.day === day
    ? { ...result, data: { outcome: value.outcome, day: copy(value.day) } }
    : INVALID_API_RESPONSE;
}
