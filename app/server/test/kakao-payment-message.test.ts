import { expect, it } from "vitest";
import { kakaoPaymentMessage } from "../src/kakao-payment-message";
import { expectSchema } from "./support/contract";

it("첫 결제 안내는 자기 계좌·기한과 카드 결제 버튼·결제했어요 바로가기를 표시한다", () => {
  const body = kakaoPaymentMessage({
    state: "normal",
    kind: "first",
    orderNo: "AB1234CD",
    amount: 35000,
    account: { bankName: "합성은행", number: "123456789012", holderName: "합성가게" },
    dueAt: "2026-11-25T12:00:00Z",
    timeZone: "Asia/Seoul",
    cardPaymentUrl: "https://payment.example/synthetic",
  });
  expectSchema("SkillTemplateResponse", body);
  const text = JSON.stringify(body);
  for (const value of [
    "AB1234CD",
    "35,000원",
    "합성은행",
    "123456789012",
    "합성가게",
    "21:00",
    "카드로 결제",
    "결제했어요",
  ])
    expect(text).toContain(value);
});
