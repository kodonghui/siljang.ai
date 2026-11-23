import { expect, it } from "vitest";
import { parseCalendarConflicts } from "./calendar-conflicts";
import { parseProblem } from "./problems";

const order = {
  orderId: "11111111-1111-4111-8111-111111111111",
  orderNo: "SYN001",
  status: "confirmed",
  pickupAt: "2026-11-21T14:00:00+09:00",
};
const conflict = { day: "2026-11-21", capacity: 1, held: 2, orders: [order] };
it("확인에 필요한 날짜와 그 가게 주문 정보만 읽는다", () => {
  const parsed = parseCalendarConflicts([
    { ...conflict, internal: "비공개", orders: [{ ...order, phone: "합성 비공개 번호" }] },
  ]);
  expect(parsed).toEqual([conflict]);
  expect(
    parseProblem(
      { code: "confirmation_required", confirm: [{ kind: "capacity_below_held" }], conflicts: [conflict] },
      409,
    )?.conflicts,
  ).toEqual([conflict]);
});
it.each(
  [
    [],
    Array(401).fill(conflict),
    [{ ...conflict, day: "2026-02-30" }],
    [{ ...conflict, capacity: 101 }],
    [{ ...conflict, held: -1 }],
    [{ ...conflict, orders: [] }],
    [{ ...conflict, orders: Array(101).fill(order) }],
    ...[{ orderId: "wrong" }, { orderNo: "private/value" }, { status: "internal_status" }, { pickupAt: "2026" }].map(
      (patch) => [{ ...conflict, orders: [{ ...order, ...patch }] }],
    ),
  ].map((value) => ({ value })),
)("계약 밖 관련 주문은 확인 자료로 쓰지 않는다 %#", ({ value }) => {
  expect(parseCalendarConflicts(value)).toBeNull();
  expect(
    parseProblem({ code: "confirmation_required", confirm: [{ kind: "capacity_below_held" }], conflicts: value }, 409),
  ).toBeNull();
});
