import { expect, it } from "vitest";
import { ledgerUncertainPlan } from "../src/ledger-uncertain";

it("불확실한 쓰기는 5분 뒤 확인하고 성공 뒤 30분 간격으로 24시간만 정리한다", () => {
  const now = new Date("2026-11-28T00:00:00Z");
  expect(ledgerUncertainPlan("uncertain", now, null, 0)).toEqual({
    nextAt: new Date("2026-11-28T00:05:00Z"),
    deadline: null,
    count: 0,
  });
  expect(ledgerUncertainPlan("written", now, null, 0)).toEqual({
    nextAt: new Date("2026-11-28T00:30:00Z"),
    deadline: new Date("2026-11-29T00:00:00Z"),
    count: 0,
  });
  expect(
    ledgerUncertainPlan("checked", new Date("2026-11-29T00:00:00Z"), new Date("2026-11-29T00:00:00Z"), 47),
  ).toEqual({ nextAt: null, deadline: null, count: 48 });
});
