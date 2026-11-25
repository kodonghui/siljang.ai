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

it.each([
  [{ state: "done", kind: "custom" }, "알겠어요. 주문을 취소했어요"],
  [{ state: "done", kind: "difference" }, "알겠어요. 바꾸지 않고 원래 주문대로 할게요"],
  [{ state: "stale", reason: "notice_gone" }, "지금은 전할 안내가 없어요"],
  [{ state: "stale", reason: "deadline" }, "결제 기한이 지나 사장님이 확인하고 있어요"],
  [{ state: "permission", reason: "card_not_yours" }, "이 버튼은 카드를 받은 분만 누를 수 있어요"],
  [
    { state: "permission", reason: "not_accepting", contactPhone: "02-000-0000" },
    "아직 상담을 받지 않아요. 가게로 연락해 주세요: 02-000-0000",
  ],
  [{ state: "error", reason: "retry_needed" }, "다시 눌러 주세요"],
  [{ state: "error", reason: "server_error" }, "잠시 뒤 다시 말씀해 주세요"],
] as const)("닫힘/권한/오류 표시는 계좌 없이 정해진 말을 보인다(%j)", (view, expected) => {
  const body = kakaoPaymentMessage(view);
  expectSchema("SkillTemplateResponse", body);
  expect(JSON.stringify(body)).toContain(expected);
  expect(JSON.stringify(body)).not.toContain("계좌번호");
  expect(JSON.stringify(body)).not.toContain("결제했어요");
});

it.each([
  `https://payment.example/${"가".repeat(400)}`,
  "https://",
  "http://payment.example/unsafe",
  "https://synthetic-user:synthetic-pass@payment.example/",
])("기존 긴/잘못된 카드 링크가 있어도 계좌와 바로가기는 전한다(%s)", (cardPaymentUrl) => {
  const body = kakaoPaymentMessage({
    state: "normal",
    kind: "first",
    orderNo: "AB1234CD",
    amount: 35000,
    account: { bankName: "합성은행", number: "123456789012", holderName: "합성가게" },
    dueAt: "2026-11-25T12:00:00Z",
    timeZone: "Asia/Seoul",
    cardPaymentUrl,
  });
  expectSchema("SkillTemplateResponse", body);
  expect(JSON.stringify(body)).toContain("123456789012");
  expect(JSON.stringify(body)).toContain("결제했어요");
  expect(JSON.stringify(body)).not.toContain("webLink");
});

it("정규화한2048자 카드 링크는 버튼으로 전하면서도 계좌를 자르지 않는다", () => {
  const cardPaymentUrl = `https://pay.example/${"x".repeat(2028)}`;
  expect(cardPaymentUrl.length).toBe(2048);
  const body = kakaoPaymentMessage({
    state: "normal",
    kind: "first",
    orderNo: "AB1234CD",
    amount: 35000,
    account: { bankName: "합성은행", number: "123456789012", holderName: "합성가게" },
    dueAt: "2026-11-25T12:00:00Z",
    timeZone: "Asia/Seoul",
    cardPaymentUrl,
  });
  expectSchema("SkillTemplateResponse", body);
  expect(JSON.stringify(body)).toContain(cardPaymentUrl);
  expect(JSON.stringify(body)).toContain("123456789012");
  expect(body.template.outputs.length).toBeLessThanOrEqual(3);
});
