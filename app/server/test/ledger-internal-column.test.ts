import { expect, it } from "vitest";
import { LEDGER_HEADERS, LEDGER_INTERNAL_HEADER, planLedgerColumns } from "../src/ledger-sheet-columns";

it("장부 내부 ID 둘은 표시 열 목록에 넣지 않는다", () => {
  const plan = planLedgerColumns(26, []);
  expect(LEDGER_HEADERS).not.toContain(LEDGER_INTERNAL_HEADER);
  expect(plan.end - plan.start).toBe(LEDGER_HEADERS.length + 2);
  expect(plan.columns).toHaveLength(LEDGER_HEADERS.length);
});
