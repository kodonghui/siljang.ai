import { describe, expect, it } from "vitest";
import { addAllDay, addWithinReplyHours, isTimeZone, shopLocalToUtc, toShopLocal } from "../src/time";

// 04 G8: 가게 시간대로 계산하고 UTC로 저장. 답하는 시간 안에서만 세는 기다림(REQ-259)과 하루 내내 세는 기한.
const SEOUL = "Asia/Seoul";
const iso = (d: Date) => d.toISOString();
const kst = { timeZone: SEOUL, start: "09:00", end: "21:00" };

describe("가게 시간대와 UTC", () => {
  it("UTC 시각을 서울 날짜·시각·요일로(일요일 0)", () => {
    expect(toShopLocal(new Date("2026-11-15T14:30:00Z"), SEOUL)).toEqual({
      date: "2026-11-15",
      time: "23:30",
      weekday: 0,
    });
    expect(toShopLocal(new Date("2026-11-15T15:00:00Z"), SEOUL)).toEqual({
      date: "2026-11-16",
      time: "00:00",
      weekday: 1,
    });
  });

  it("서울 벽시계 값을 UTC로(+9시간)", () => {
    expect(iso(shopLocalToUtc("2026-11-16", "09:00", SEOUL))).toBe("2026-11-16T00:00:00.000Z");
    expect(iso(shopLocalToUtc("2026-01-01", "00:00:30", SEOUL))).toBe("2025-12-31T15:00:30.000Z");
  });

  it("서머타임 시간대: 없는 시각은 뒤로, 두 번 있는 시각은 앞의 것", () => {
    const ny = "America/New_York";
    expect(iso(shopLocalToUtc("2026-03-08", "02:30", ny))).toBe("2026-03-08T07:30:00.000Z");
    expect(iso(shopLocalToUtc("2026-11-01", "01:30", ny))).toBe("2026-11-01T05:30:00.000Z");
    expect(iso(shopLocalToUtc("2026-07-01", "12:00", ny))).toBe("2026-07-01T16:00:00.000Z");
  });

  it("틀린 값은 RangeError, 시간대 이름 확인", () => {
    expect(() => shopLocalToUtc("2026-13-01", "09:00", SEOUL)).toThrow(RangeError);
    expect(() => shopLocalToUtc("2026-02-30", "09:00", SEOUL)).toThrow(RangeError);
    expect(() => shopLocalToUtc("2026-11-16", "24:00", SEOUL)).toThrow(RangeError);
    expect(isTimeZone(SEOUL)).toBe(true);
    expect(isTimeZone("Mars/Base")).toBe(false);
  });
});

describe("하루 내내 세는 기한", () => {
  it("밤·휴무 없이 그대로 더함", () => {
    expect(iso(addAllDay(new Date("2026-11-15T14:30:00Z"), 72 * 3600_000))).toBe("2026-11-18T14:30:00.000Z");
    expect(() => addAllDay(new Date(), -1)).toThrow(RangeError);
  });
});

describe("답하는 시간 안에서만 세는 기다림(REQ-259, 기본 09:00~21:00)", () => {
  const at = (local: string) => shopLocalToUtc(local.slice(0, 10), local.slice(11), SEOUL);
  const local = (d: Date) => {
    const l = toShopLocal(d, SEOUL);
    return `${l.date} ${l.time}`;
  };

  it("안에서 시작하면 그대로 더함", () => {
    expect(local(addWithinReplyHours(at("2026-11-16 10:00"), 30, kst))).toBe("2026-11-16 10:30");
    expect(local(addWithinReplyHours(at("2026-11-16 10:00"), 660, kst))).toBe("2026-11-16 21:00");
  });

  it("끝을 넘으면 다음 날 시작부터 이어 셈", () => {
    expect(local(addWithinReplyHours(at("2026-11-16 20:30"), 60, kst))).toBe("2026-11-17 09:30");
    expect(local(addWithinReplyHours(at("2026-11-16 10:00"), 720, kst))).toBe("2026-11-17 10:00");
  });

  it("밖에서 시작하면 다음 답하는 시간의 시작부터 셈", () => {
    expect(local(addWithinReplyHours(at("2026-11-16 22:00"), 10, kst))).toBe("2026-11-17 09:10");
    expect(local(addWithinReplyHours(at("2026-11-16 08:00"), 30, kst))).toBe("2026-11-16 09:30");
    expect(local(addWithinReplyHours(at("2026-11-16 21:00"), 1, kst))).toBe("2026-11-17 09:01");
  });

  it("여러 날에 걸쳐 셈(사흘 치 720분 × 3)", () => {
    expect(local(addWithinReplyHours(at("2026-11-16 09:00"), 2160, kst))).toBe("2026-11-18 21:00");
  });

  it("가게가 정한 다른 답하는 시간도 따름, 0분은 그대로, 틀린 설정은 RangeError", () => {
    const short = { timeZone: SEOUL, start: "13:00", end: "14:00" };
    expect(local(addWithinReplyHours(at("2026-11-16 13:30"), 90, short))).toBe("2026-11-17 14:00");
    expect(local(addWithinReplyHours(at("2026-11-16 13:30"), 91, short))).toBe("2026-11-18 13:01");
    expect(iso(addWithinReplyHours(at("2026-11-16 22:00"), 0, kst))).toBe(iso(at("2026-11-16 22:00")));
    expect(() => addWithinReplyHours(new Date(), 10, { timeZone: SEOUL, start: "21:00", end: "09:00" })).toThrow(
      RangeError,
    );
    expect(() => addWithinReplyHours(new Date(), -5, kst)).toThrow(RangeError);
  });
});
