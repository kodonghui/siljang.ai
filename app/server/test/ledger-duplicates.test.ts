import { describe, expect, it } from "vitest";
import { planLedgerDuplicateCleanup } from "../src/ledger-duplicates";

describe("장부 중복 정리", () => {
  const expected = ["A1B2C3", "고객", "test-event"];
  it("같은 ID와 같은 값이며 사장님 열이 빈 뒤쪽 행만 정리한다", () => {
    expect(
      planLedgerDuplicateCleanup(
        [
          { index: 4, owned: expected, other: [] },
          { index: 9, owned: expected, other: [""] },
        ],
        "test-event",
        expected,
      ),
    ).toEqual({ remove: [9], attention: false });
  });
  it("사장님이 우리 열이나 다른 열을 고친 행은 지우지 않고 확인을 요청한다", () => {
    expect(
      planLedgerDuplicateCleanup(
        [
          { index: 4, owned: expected, other: [] },
          { index: 9, owned: ["A1B2C3", "다른 값", "test-event"], other: [] },
          { index: 12, owned: expected, other: ["사장님 메모"] },
        ],
        "test-event",
        expected,
      ),
    ).toEqual({ remove: [], attention: true });
  });
  it("같은 주문의 다른 이벤트 행은 지우지 않고 확인을 요청한다", () => {
    expect(
      planLedgerDuplicateCleanup(
        [
          { index: 4, owned: expected, other: [] },
          { index: 9, owned: ["A1B2C3", "고객", "다른 ID"], other: [] },
        ],
        "test-event",
        expected,
      ),
    ).toEqual({ remove: [], attention: true });
  });
  it("뒤 이벤트가 원래 행의 ID를 바꾼 뒤 늦은 이전 요청이 추가돼도 중복을 발견한다", () => {
    expect(
      planLedgerDuplicateCleanup(
        [
          { index: 4, owned: ["A1B2C3", "최신 값", "new-event"], other: [] },
          { index: 9, owned: expected, other: [] },
        ],
        "test-event",
        expected,
      ),
    ).toEqual({ remove: [9], attention: false });
  });
});
