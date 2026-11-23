import { type CalendarDay, isCalendarDate } from "./calendar-api";
import { numberOrText } from "./form-values";
export interface CalendarForm {
  closed: boolean;
  capacityOverride: string;
  manuallyClosed: boolean;
}
const firstDay = (month: string) =>
  /^\d{4}-\d{2}$/.test(month) && isCalendarDate(`${month}-01`) ? `${month}-01` : null;
export function shiftCalendarMonth(month: string, offset: number): string | null {
  const first = firstDay(month);
  if (!first || !Number.isInteger(offset)) return null;
  const date = new Date(`${first}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  if (!Number.isFinite(date.getTime())) return null;
  const day = date.toISOString().slice(0, 10);
  return isCalendarDate(day) ? day.slice(0, 7) : null;
}
export function calendarPeriod(month: string): { from: string; to: string } | null {
  const from = firstDay(month),
    after = shiftCalendarMonth(month, 2);
  if (!from || !after) return null;
  const end = new Date(`${after}-01T00:00:00Z`);
  end.setUTCDate(0);
  const to = end.toISOString().slice(0, 10);
  return isCalendarDate(to) ? { from, to } : null;
}
export function monthCells(month: string): (string | null)[] {
  const first = firstDay(month);
  const cells: (string | null)[] = Array(42).fill(null);
  if (!first) return cells;
  const date = new Date(`${first}T00:00:00Z`),
    offset = date.getUTCDay();
  for (let index = offset; index < cells.length && date.toISOString().slice(0, 7) === month; index++) {
    cells[index] = date.toISOString().slice(0, 10);
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return cells;
}
const seoulDate = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export const todayCalendarDate = (now = Date.now()): string => seoulDate.format(new Date(now));
export function calendarForm(value: CalendarDay): CalendarForm {
  return {
    closed: value.closed,
    capacityOverride: value.capacityOverride === null ? "" : String(value.capacityOverride),
    manuallyClosed: value.manuallyClosed,
  };
}
const capacity = (value: string) => (value.trim() === "" ? null : numberOrText(value));
export function calendarPatch(base: CalendarDay, form: CalendarForm): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  if (form.closed !== base.closed) patch.closed = form.closed;
  const cap = capacity(form.capacityOverride);
  if (cap !== base.capacityOverride) patch.capacityOverride = cap;
  if (form.manuallyClosed !== base.manuallyClosed) patch.manuallyClosed = form.manuallyClosed;
  return Object.keys(patch).length ? { baseRevision: base.revision, ...patch } : null;
}
export function rebaseCalendarDay(base: CalendarDay, mine: CalendarForm, latest: CalendarDay): CalendarForm {
  const result = calendarForm(latest);
  if (mine.closed !== base.closed) result.closed = mine.closed;
  if (mine.manuallyClosed !== base.manuallyClosed) result.manuallyClosed = mine.manuallyClosed;
  if (capacity(mine.capacityOverride) !== base.capacityOverride) result.capacityOverride = mine.capacityOverride;
  return result;
}
