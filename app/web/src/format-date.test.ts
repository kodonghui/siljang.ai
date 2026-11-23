import { expect, it } from "vitest";
import { formatSeoulTime } from "./format-date";

it.each([
  ["2026-11-20T15:00:00Z", "00:00"],
  ["2026-11-21T09:05:00+09:00", "09:05"],
  [Date.UTC(2026, 10, 21, 14, 55), "23:55"],
] as const)("서울 시:분 %s은 %s", (value, expected) => expect(formatSeoulTime(value)).toBe(expected));
