import { expect, it } from "vitest";
import { kakaoConsultationMessage } from "../src/kakao-consultation-message";
import { kakaoConfirmAnswerMessage } from "../src/kakao-order-request-message";
import { expectSchema } from "./support/contract";

const base = {
  kind: "cancel" as const,
  cardKey: "synthetic_cancel_card_key_01",
  title: "주문 취소",
  description: "주문번호 AB1234CD",
  confirmLabel: "주문 취소",
  blockId: "synthetic-card",
};
const cancellation = {
  orderNo: "AB1234CD",
  pickupAt: "2026-11-28T06:00:00Z",
  timeZone: "Asia/Seoul",
  refund: { kind: "calculated" as const, amount: 24000, clauseNames: ["이틀 전 취소", "맞춤 재료 비용"] },
};

it("상담 공통 표시가 서버 환불 계산값·조문·픽업 일시와 취소 전용 행동을 보인다", () => {
  const card = { ...base, cancellation };
  const body = kakaoConsultationMessage({ state: "normal", contents: [card] });
  expectSchema("SkillTemplateResponse", body);
  for (const text of [
    "11월 28일 15:00",
    "지금 취소하면 환불 24,000원(이틀 전 취소, 맞춤 재료 비용)",
    "주문 취소하기",
    "취소 안 함",
  ])
    expect(JSON.stringify(body)).toContain(text);
});

it("결제 전 주문에는 환불 계산값 대신 정해진 안내를 보인다", () => {
  const card = { ...base, cancellation: { ...cancellation, refund: { kind: "unpaid" as const } } };
  const body = kakaoConsultationMessage({ state: "normal", contents: [card] });
  expectSchema("SkillTemplateResponse", body);
  expect(JSON.stringify(body)).toContain("결제 전이라 환불할 금액이 없어요");
  expect(JSON.stringify(body)).not.toContain("지금 취소하면 환불");
});

it("재제작 주문에 서버가 원래 주문으로 계산한 환불0원을 결제 전으로 바꾸지 않는다", () => {
  const card = {
    ...base,
    cancellation: {
      ...cancellation,
      refund: { kind: "calculated" as const, amount: 0, clauseNames: ["맞춤 재료 비용"] },
    },
  };
  const body = kakaoConsultationMessage({ state: "normal", contents: [card] });
  expectSchema("SkillTemplateResponse", body);
  expect(JSON.stringify(body)).toContain("환불 0원(맞춤 재료 비용)");
  expect(JSON.stringify(body)).not.toContain("결제 전이라");
});

it.each(["주문을 취소했어요. 환불은 사장님이 정한 뒤 알려 드려요", "주문을 취소했어요"])(
  "같은 취소 카드를 다시 누르면 결제 상태에 맞던 첫 결과만 보인다(%s)",
  (text) => {
    const body = kakaoConfirmAnswerMessage({
      kind: "cancel",
      outcome: "card_used",
      text: "이미 처리했어요",
      firstResult: { outcome: "order_cancelled", text },
    });
    expectSchema("SkillTemplateResponse", body);
    expect(body.template.outputs).toEqual([{ simpleText: { text } }]);
  },
);
