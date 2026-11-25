import { expect, it } from "vitest";
import { kakaoPaymentClaimMessage } from "../src/kakao-payment-claim-message";
import { expectSchema } from "./support/contract";

it("결제 확인 요청 카드에 자기 주문의 요약과 세 버튼을 표시한다", () => {
  const body = kakaoPaymentClaimMessage({
    state: "normal",
    orderNo: "AB1234CD",
    amount: 35000,
    dueAt: "2026-11-28T12:00:00Z",
    depositorName: "합성 주문자",
    expiresAt: "2026-11-28T06:30:00Z",
    timeZone: "Asia/Seoul",
    cardKey: "synthetic_payment_claim_key_01",
    cardBlockId: "synthetic-card",
    depositorBlockId: "synthetic-depositor",
  });
  expectSchema("SkillTemplateResponse", body);
  const text = JSON.stringify(body);
  for (const value of [
    "결제 확인 요청",
    "AB1234CD",
    "35,000원",
    "21:00",
    "입금자 합성 주문자(주문자 이름)",
    "15:30까지 눌러 주세요",
    "입금자 이름이 달라요",
    "안 할래요",
  ])
    expect(text).toContain(value);
  expect(text).not.toContain('"action":"message"');
});
