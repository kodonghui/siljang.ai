import { expect, it } from "vitest";
import { type KakaoMyOrderSummary, kakaoMyOrderMessage } from "../src/kakao-my-order-message";
import { expectSchema } from "./support/contract";

const order: KakaoMyOrderSummary = {
  orderNo: "AB1234CD",
  status: "confirmed",
  pickupAt: "2026-11-28T06:00:00Z",
  contents: { size: "1호", flavor: "생크림", design: "하트 레터링", options: ["초 추가"], message: "합성 생일 축하" },
  amount: 36000,
  paidAt: "2026-11-25T05:02:00Z",
  changeDeadline: "2026-11-26T05:00:00Z",
  refundNow: { amount: 31000, clause: "제작 전 취소" },
  timeZone: "Asia/Seoul",
};
it("SCR007 현재 주문의 저장 값과 환불 계산값을 내 주문 카드에 보인다", () => {
  const body = kakaoMyOrderMessage({ state: "normal", order });
  expectSchema("SkillTemplateResponse", body);
  expect(body.template.outputs).toHaveLength(1);
  const text = JSON.stringify(body);
  for (const value of [
    "내 주문 · AB1234CD",
    "주문 확정",
    "11월 28일",
    "15:00",
    "1호",
    "생크림",
    "하트 레터링",
    "초 추가",
    "합성 생일 축하",
    "36,000원",
    "결제 확인 11월 25일 14:02",
    "변경 마감: 11월 26일 14:00까지",
    "지금 취소하면 환불 31,000원(제작 전 취소)",
    "바꾸고 싶어요",
    "취소할래요",
  ])
    expect(text).toContain(value);
  expect(text).not.toContain("문제가 있어요");
});
