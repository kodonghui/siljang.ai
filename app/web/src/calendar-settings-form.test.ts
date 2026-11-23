import { expect, it } from "vitest";
import type { CalendarSettings } from "./calendar-settings-api";
import {
  rebaseSettings,
  settingsChanged,
  settingsForm,
  settingsIssues,
  settingsPayload,
} from "./calendar-settings-form";

const base: CalendarSettings = {
  closedWeekdays: [1, 7],
  dailyCapacity: 5,
  orderCutoffDays: 2,
  orderCutoffTime: "18:00",
  replyStart: "09:00",
  replyEnd: "21:00",
  dayBeforeNoticeTime: "18:00",
  reviewRequestTime: "11:00",
  updatedAt: "2026-11-12T11:40:00+09:00",
  revision: "synthetic-calendar",
};
it("처음 정하는 양식은 명시된 시각 기본값을 채우고 새 버전은 null이다", () => {
  const form = settingsForm(null);
  expect(form).toMatchObject({
    replyStart: "09:00",
    replyEnd: "21:00",
    dayBeforeNoticeTime: "18:00",
    reviewRequestTime: "11:00",
  });
  expect(settingsPayload(null, form)).toMatchObject({ baseRevision: null });
  expect(settingsIssues(form)).toEqual([]);
  expect(settingsChanged(null, form)).toBe(true);
});
it("저장에는 바꿀8필드와 본 revision만 넣고 숫자는 정수로 보낸다", () => {
  expect(settingsPayload(base, settingsForm(base))).toEqual({
    baseRevision: base.revision,
    closedWeekdays: [1, 7],
    dailyCapacity: 5,
    orderCutoffDays: 2,
    orderCutoffTime: "18:00",
    replyStart: "09:00",
    replyEnd: "21:00",
    dayBeforeNoticeTime: "18:00",
    reviewRequestTime: "11:00",
  });
});
it.each([
  { field: "dailyCapacity", value: "101", code: "out_of_range" },
  { field: "dailyCapacity", value: "", code: "required" },
  { field: "dailyCapacity", value: "Infinity", code: "bad_format" },
  { field: "dailyCapacity", value: "1e2", code: "bad_format" },
  { field: "orderCutoffDays", value: "31", code: "out_of_range" },
  { field: "orderCutoffDays", value: "-1", code: "bad_format" },
  { field: "orderCutoffTime", value: "24:00", code: "bad_format" },
  { field: "replyStart", value: "9:00", code: "bad_format" },
  { field: "replyEnd", value: "09:00", code: "not_after_start" },
  { field: "dayBeforeNoticeTime", value: "07:59", code: "out_of_range" },
  { field: "reviewRequestTime", value: "20:51", code: "out_of_range" },
  { field: "closedWeekdays", value: [1, 1], code: "duplicate" },
  { field: "closedWeekdays", value: [0], code: "out_of_range" },
])("$field의 $value는 필드 옆 오류로 보존한다", ({ field, value, code }) => {
  const form = { ...settingsForm(base), [field]: value };
  expect(settingsIssues(form)).toContainEqual({ field: `/${field}`, code });
});
it("숫자 원문은 임의 정수나 null로 바꾸지 않는다", () => {
  expect(
    settingsPayload(base, { ...settingsForm(base), dailyCapacity: "1e2", orderCutoffDays: "Infinity" }),
  ).toMatchObject({ dailyCapacity: "1e2", orderCutoffDays: "Infinity" });
});
it("숫자 표기와 요일 순서만 바뀌었으면 같은 설정이다", () => {
  expect(settingsChanged(base, { ...settingsForm(base), dailyCapacity: "005", closedWeekdays: [7, 1] })).toBe(false);
});
it("G3 재적용은 내 의미상 변경만 최신 필드 위에 옮긴다", () => {
  const latest = { ...base, dailyCapacity: 8, replyStart: "10:00", revision: "synthetic-latest" };
  const rebased = rebaseSettings(
    base,
    { ...settingsForm(base), dailyCapacity: "005", reviewRequestTime: "12:00", closedWeekdays: [2] },
    latest,
  );
  expect(rebased).toMatchObject({
    dailyCapacity: "8",
    replyStart: "10:00",
    reviewRequestTime: "12:00",
    closedWeekdays: [2],
  });
  expect(settingsPayload(latest, rebased).baseRevision).toBe("synthetic-latest");
});
