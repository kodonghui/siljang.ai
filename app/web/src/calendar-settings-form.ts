import { CALENDAR_TIME, type CalendarSettings, NOTICE_TIME } from "./calendar-settings-api";
import { isIntegerText, numberOrText } from "./form-values";
import type { FieldError } from "./problems";
export const SETTING_NUMBERS = ["dailyCapacity", "orderCutoffDays"] as const;
export const SETTING_TIMES = [
  "orderCutoffTime",
  "replyStart",
  "replyEnd",
  "dayBeforeNoticeTime",
  "reviewRequestTime",
] as const;
export interface CalendarSettingsForm {
  closedWeekdays: number[];
  dailyCapacity: string;
  orderCutoffDays: string;
  orderCutoffTime: string;
  replyStart: string;
  replyEnd: string;
  dayBeforeNoticeTime: string;
  reviewRequestTime: string;
}
export function settingsForm(value: CalendarSettings | null): CalendarSettingsForm {
  return {
    closedWeekdays: [...(value?.closedWeekdays ?? [])],
    dailyCapacity: String(value?.dailyCapacity ?? 5),
    orderCutoffDays: String(value?.orderCutoffDays ?? 2),
    orderCutoffTime: value?.orderCutoffTime ?? "18:00",
    replyStart: value?.replyStart ?? "09:00",
    replyEnd: value?.replyEnd ?? "21:00",
    dayBeforeNoticeTime: value?.dayBeforeNoticeTime ?? "18:00",
    reviewRequestTime: value?.reviewRequestTime ?? "11:00",
  };
}
const weekdays = (value: readonly number[]) => [...value].sort((a, b) => a - b);
export function settingsPayload(base: CalendarSettings | null, form: CalendarSettingsForm): Record<string, unknown> {
  return {
    baseRevision: base?.revision ?? null,
    closedWeekdays: weekdays(form.closedWeekdays),
    dailyCapacity: numberOrText(form.dailyCapacity),
    orderCutoffDays: numberOrText(form.orderCutoffDays),
    orderCutoffTime: form.orderCutoffTime,
    replyStart: form.replyStart,
    replyEnd: form.replyEnd,
    dayBeforeNoticeTime: form.dayBeforeNoticeTime,
    reviewRequestTime: form.reviewRequestTime,
  };
}
export function settingsIssues(form: CalendarSettingsForm): FieldError[] {
  const issues: FieldError[] = [];
  const add = (field: string, code: FieldError["code"]) => issues.push({ field: `/${field}`, code });
  if (new Set(form.closedWeekdays).size !== form.closedWeekdays.length) add("closedWeekdays", "duplicate");
  if (form.closedWeekdays.length > 7 || form.closedWeekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7))
    add("closedWeekdays", "out_of_range");
  for (const key of SETTING_NUMBERS) {
    const value = form[key];
    if (!value.trim()) add(key, "required");
    else if (!isIntegerText(value)) add(key, "bad_format");
    else if (Number(value) > (key === "dailyCapacity" ? 100 : 30)) add(key, "out_of_range");
  }
  for (const key of SETTING_TIMES) {
    const value = form[key];
    if (!value.trim()) add(key, "required");
    else if (!CALENDAR_TIME.test(value)) add(key, "bad_format");
    else if ((key === "dayBeforeNoticeTime" || key === "reviewRequestTime") && !NOTICE_TIME.test(value))
      add(key, "out_of_range");
  }
  if (CALENDAR_TIME.test(form.replyStart) && CALENDAR_TIME.test(form.replyEnd) && form.replyEnd <= form.replyStart)
    add("replyEnd", "not_after_start");
  return issues;
}
export function settingsChanged(base: CalendarSettings | null, mine: CalendarSettingsForm): boolean {
  return (
    base === null ||
    JSON.stringify(settingsPayload(base, settingsForm(base))) !== JSON.stringify(settingsPayload(base, mine))
  );
}
export function rebaseSettings(
  base: CalendarSettings | null,
  mine: CalendarSettingsForm,
  latest: CalendarSettings,
): CalendarSettingsForm {
  const before = settingsForm(base),
    result = settingsForm(latest);
  if (JSON.stringify(weekdays(before.closedWeekdays)) !== JSON.stringify(weekdays(mine.closedWeekdays)))
    result.closedWeekdays = [...mine.closedWeekdays];
  for (const key of SETTING_NUMBERS) if (numberOrText(before[key]) !== numberOrText(mine[key])) result[key] = mine[key];
  for (const key of SETTING_TIMES) if (before[key] !== mine[key]) result[key] = mine[key];
  return result;
}
