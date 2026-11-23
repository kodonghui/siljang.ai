import { type ApiResult, request } from "./api";
import { INVALID_API_RESPONSE, isApiObject, isApiTimestamp } from "./api-response";
import { type CalendarConflict, parseCalendarConflicts } from "./calendar-conflicts";
export const CALENDAR_TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
export const NOTICE_TIME = /^((0[89]|1[0-9]):[0-5][0-9]|20:([0-4][0-9]|50))$/;
export interface CalendarSettings {
  readonly closedWeekdays: readonly number[];
  readonly dailyCapacity: number;
  readonly orderCutoffDays: number;
  readonly orderCutoffTime: string;
  readonly replyStart: string;
  readonly replyEnd: string;
  readonly dayBeforeNoticeTime: string;
  readonly reviewRequestTime: string;
  readonly updatedAt: string;
  readonly revision: string;
}
export interface CalendarSettingsResult {
  readonly outcome: "created" | "updated" | "unchanged";
  readonly calendar: CalendarSettings;
  readonly conflicts: readonly CalendarConflict[];
}
const integer = (value: unknown, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
function valid(value: unknown): value is CalendarSettings {
  return (
    isApiObject(value) &&
    Array.isArray(value.closedWeekdays) &&
    value.closedWeekdays.length <= 7 &&
    value.closedWeekdays.every((day) => integer(day, 7) && day >= 1) &&
    new Set(value.closedWeekdays).size === value.closedWeekdays.length &&
    integer(value.dailyCapacity, 100) &&
    integer(value.orderCutoffDays, 30) &&
    [value.orderCutoffTime, value.replyStart, value.replyEnd].every(
      (time) => typeof time === "string" && CALENDAR_TIME.test(time),
    ) &&
    typeof value.replyStart === "string" &&
    typeof value.replyEnd === "string" &&
    value.replyStart < value.replyEnd &&
    [value.dayBeforeNoticeTime, value.reviewRequestTime].every(
      (time) => typeof time === "string" && NOTICE_TIME.test(time),
    ) &&
    isApiTimestamp(value.updatedAt) &&
    typeof value.revision === "string" &&
    /^[A-Za-z0-9._-]{1,64}$/.test(value.revision)
  );
}
function copy(value: CalendarSettings): CalendarSettings {
  return {
    closedWeekdays: [...value.closedWeekdays],
    dailyCapacity: value.dailyCapacity,
    orderCutoffDays: value.orderCutoffDays,
    orderCutoffTime: value.orderCutoffTime,
    replyStart: value.replyStart,
    replyEnd: value.replyEnd,
    dayBeforeNoticeTime: value.dayBeforeNoticeTime,
    reviewRequestTime: value.reviewRequestTime,
    updatedAt: value.updatedAt,
    revision: value.revision,
  };
}
export async function fetchCalendarSettings(signal?: AbortSignal): Promise<ApiResult<CalendarSettings>> {
  const result = await request<unknown>("/owner/calendar", { cache: "no-store", ...(signal ? { signal } : {}) });
  if (!result.ok) return result;
  return valid(result.data) ? { ...result, data: copy(result.data) } : INVALID_API_RESPONSE;
}
export async function saveCalendarSettings(
  body: Record<string, unknown>,
  key: string,
): Promise<ApiResult<CalendarSettingsResult>> {
  const result = await request<unknown>("/owner/calendar", { method: "PUT", body, key });
  if (!result.ok) return result;
  const value = result.data;
  if (
    !isApiObject(value) ||
    typeof value.outcome !== "string" ||
    !["created", "updated", "unchanged"].includes(value.outcome) ||
    !valid(value.calendar)
  )
    return INVALID_API_RESPONSE;
  const conflicts =
    Array.isArray(value.conflicts) && value.conflicts.length === 0 ? [] : parseCalendarConflicts(value.conflicts);
  return conflicts === null
    ? INVALID_API_RESPONSE
    : {
        ...result,
        data: {
          outcome: value.outcome as CalendarSettingsResult["outcome"],
          calendar: copy(value.calendar),
          conflicts,
        },
      };
}
