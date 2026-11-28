import { expect, it } from "vitest";
import { renderOwnerAlert } from "../src/owner-alert-card";
import { ledgerDuplicateSummary } from "../src/owner-tasks";

it("중복 장부 할 일은 검증된 주문번호만 넣어 직접 정리를 안내한다", () => {
  expect(ledgerDuplicateSummary("task:ledger_duplicate:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "ABC123")).toBe(
    "장부에 같은 주문(주문번호 ABC123)이 두 줄 있어요. 하나를 지워 주세요",
  );
  expect(ledgerDuplicateSummary("task:ledger_duplicate:bad", "<script>")).toBeNull();
});
it("중복 알림은 주문번호와 직접 정리할 행동을 안내한다", () => {
  expect(
    renderOwnerAlert(
      { kind: "ledger_failing", count: 1, duplicateOrderNo: "ABC123" },
      "normal",
      new URL("https://test.example"),
    )?.template.outputs[0].textCard.description,
  ).toBe("장부에 같은 주문(주문번호 ABC123)이 두 줄 있어요. 하나를 지워 주세요");
});
it("장부 변경 또는 행 제한은 주문번호와 확인·재연결을 안내한다", () => {
  const summary = ledgerDuplicateSummary("task:ledger_conflict:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "ABC123");
  expect(summary).toContain("5,000행");
  expect(summary).toContain("ABC123");
  expect(
    renderOwnerAlert(
      { kind: "ledger_failing", count: 1, conflictOrderNo: "ABC123" },
      "normal",
      new URL("https://test.example"),
    )?.template.outputs[0].textCard.description,
  ).toBe(summary);
});
