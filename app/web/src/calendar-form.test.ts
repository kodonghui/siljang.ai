import { expect, it } from "vitest";
import type { CalendarDay } from "./calendar-api";
import {
  calendarForm,
  calendarPatch,
  calendarPeriod,
  monthCells,
  rebaseCalendarDay,
  shiftCalendarMonth,
  todayCalendarDate,
} from "./calendar-form";

const base: CalendarDay = {
  day: "2026-11-21",
  weekdayClosed: false,
  closed: false,
  capacityOverride: 5,
  capacity: 5,
  held: 2,
  remaining: 3,
  full: false,
  manuallyClosed: false,
  overbooked: false,
  revision: "synthetic-base",
};
it("두 달 기간은 월 경계와 윤년을 지키고62일을 넘지 않는다", () => {
  expect(calendarPeriod("2026-12")).toEqual({ from: "2026-12-01", to: "2027-01-31" });
  expect(calendarPeriod("2024-02")).toEqual({ from: "2024-02-01", to: "2024-03-31" });
  expect(calendarPeriod("2026-13")).toBeNull();
  expect(calendarPeriod("other")).toBeNull();
});
it("월 이동은1일 기준으로 계산하고 연도를 넘긴다", () => {
  expect(shiftCalendarMonth("2026-12", 1)).toBe("2027-01");
  expect(shiftCalendarMonth("2026-01", -1)).toBe("2025-12");
  expect(shiftCalendarMonth("other", 1)).toBeNull();
});
it("달력42칸은 일요일 시작과 실제 말일을 지킨다", () => {
  const cells = monthCells("2026-11");
  expect(cells).toHaveLength(42);
  expect(cells[0]).toBe("2026-11-01");
  expect(cells[29]).toBe("2026-11-30");
  expect(cells[30]).toBeNull();
  const leap = monthCells("2024-02");
  expect(leap[4]).toBe("2024-02-01");
  expect(leap.filter(Boolean)).toHaveLength(29);
});
it("오늘은 서울 자정 경계를 따른다", () => {
  expect(todayCalendarDate(Date.parse("2026-11-20T14:59:59Z"))).toBe("2026-11-20");
  expect(todayCalendarDate(Date.parse("2026-11-20T15:00:00Z"))).toBe("2026-11-21");
});
it("변경이 없으면 저장하지 않고 지운 개수는 null로 보낸다", () => {
  const form = calendarForm(base);
  expect(calendarPatch(base, form)).toBeNull();
  form.capacityOverride = "";
  expect(calendarPatch(base, form)).toEqual({ baseRevision: "synthetic-base", capacityOverride: null });
});
it("허용하지 않은 숫자 표기는 원문으로 보내고 십진 정수만 바꾼다", () => {
  expect(calendarPatch(base, { ...calendarForm(base), capacityOverride: "1e2" })).toEqual({
    baseRevision: "synthetic-base",
    capacityOverride: "1e2",
  });
  expect(calendarPatch(base, { ...calendarForm(base), capacityOverride: "010" })).toEqual({
    baseRevision: "synthetic-base",
    capacityOverride: 10,
  });
});
it("충돌 뒤 내 변경만 최신 값에 적용하고 지운 개수도 보존한다", () => {
  const latest = { ...base, capacityOverride: 10, manuallyClosed: true, revision: "synthetic-latest" };
  const mine = { ...calendarForm(base), closed: true, capacityOverride: "" };
  const rebased = rebaseCalendarDay(base, mine, latest);
  expect(rebased).toEqual({ closed: true, capacityOverride: "", manuallyClosed: true });
  expect(calendarPatch(latest, rebased)).toEqual({
    baseRevision: "synthetic-latest",
    closed: true,
    capacityOverride: null,
  });
});
it("숫자 표기만 바꾼 필드는 충돌 때 다른 기기의 값으로 유지한다", () => {
  const latest = { ...base, capacityOverride: 10, revision: "synthetic-latest" };
  expect(rebaseCalendarDay(base, { ...calendarForm(base), closed: true, capacityOverride: "005" }, latest)).toEqual({
    closed: true,
    capacityOverride: "10",
    manuallyClosed: false,
  });
});
