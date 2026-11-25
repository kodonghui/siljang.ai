import { expect, it } from "vitest";
import { kakaoChannelIdentifierError } from "../src/kakao-channel-input";
import { kakaoPaymentMessage } from "../src/kakao-payment-message";
import { expectSchema } from "./support/contract";

const amountCard = {
  cardKey: "synthetic_amount_card_key_01",
  blockId: "amount-card-block",
  expiresAt: "2026-11-25T12:30:00Z",
  timeZone: "Asia/Seoul",
} as const;
const customAmount = {
  state: "amount-confirm",
  kind: "custom",
  ...amountCard,
  requestedQuote: { amount: 70000, amountMax: null, displayKind: "from" },
  amount: 75000,
  reason: "합성 디자인 장식을 추가해요",
} as const;

it.each(["\n", "\r\n", "\r", String.fromCodePoint(0x2028), String.fromCodePoint(0x2029)])(
  "기존 은행명과 예금주의 줄바꿈은 표시에서 공백으로 바꾼다(%j)",
  (separator) => {
    const body = kakaoPaymentMessage({
      state: "normal",
      kind: "first",
      orderNo: "AB1234CD",
      amount: 35000,
      account: { bankName: `합성${separator}은행`, number: "123456789012", holderName: `합성${separator}가게` },
      dueAt: "2026-11-25T12:00:00Z",
      timeZone: "Asia/Seoul",
    });
    expectSchema("SkillTemplateResponse", body);
    const texts = body.template.outputs.flatMap((o) => ("simpleText" in o ? [o.simpleText.text] : [])).join("");
    expect(texts).toContain("은행 합성 은행\n계좌번호 123456789012\n예금주 합성 가게\n");
  },
);

it.each(["synthetic.amount:card", "합성-금액-카드"])(
  "새 금액 카드도 설정에서 허용한 블록 ID를 보존한다(%s)",
  (blockId) => {
    expect(kakaoChannelIdentifierError(blockId, 100)).toBeNull();
    const body = kakaoPaymentMessage({ ...customAmount, blockId });
    expectSchema("SkillTemplateResponse", body);
    expect(JSON.stringify(body)).toContain(blockId);
  },
);

it.each(["synthetic card", "", "x".repeat(101), "synthetic\0card"])(
  "새 금액 카드는 설정에서 허용하지 않은 블록 ID를 거부한다(%j)",
  (blockId) => {
    expect(kakaoChannelIdentifierError(blockId, 100)).not.toBeNull();
    expect(() => kakaoPaymentMessage({ ...customAmount, blockId })).toThrow();
  },
);

it("요청 견적의0원부터 표시는 실제 결제 금액과 구별해 보존한다", () => {
  const body = kakaoPaymentMessage({
    ...customAmount,
    requestedQuote: { amount: 0, amountMax: null, displayKind: "from" },
  });
  expectSchema("SkillTemplateResponse", body);
  expect(JSON.stringify(body)).toContain("요청하신 견적 0원부터");
  expect(JSON.stringify(body)).toContain("75,000원");
});

it.each([
  [{ amount: 70000, amountMax: null, displayKind: "fixed" }, "70,000원"],
  [{ amount: 70000, amountMax: null, displayKind: "from" }, "70,000원부터"],
  [{ amount: 70000, amountMax: 90000, displayKind: "range" }, "70,000~90,000원"],
] as const)("새 금액 카드가 요청 견적의 표시와 사유를 보존하고 계좌를 숨긴다(%j)", (requestedQuote, display) => {
  const body = kakaoPaymentMessage({ ...customAmount, requestedQuote });
  expectSchema("SkillTemplateResponse", body);
  const text = JSON.stringify(body);
  for (const value of [
    "새 금액 확인",
    `요청하신 견적 ${display}`,
    "사장님이 정한 금액 75,000원",
    customAmount.reason,
    "21:30까지 눌러 주세요",
    "이 금액으로 할게요",
    "안 할래요",
  ])
    expect(text).toContain(value);
  for (const value of ["계좌번호", "webLink", "결제했어요"]) expect(text).not.toContain(value);
});

it("긴 변경 내용은 카드 앞 말풍선으로 나누고 차액 버튼과 마감을 보존한다", () => {
  const changes = "합성 디자인의 장식을 바꿔요.\n".repeat(45);
  const body = kakaoPaymentMessage({
    state: "amount-confirm",
    kind: "difference",
    ...amountCard,
    changes,
    currentAmount: 36000,
    newAmount: 56000,
    difference: 20000,
    changeDeadline: "2026-11-26T11:00:00Z",
  });
  expectSchema("SkillTemplateResponse", body);
  expect(body.template.outputs.length).toBeLessThanOrEqual(3);
  const texts = body.template.outputs
    .map((o) => ("simpleText" in o ? o.simpleText.text : o.textCard.description))
    .join("");
  expect(texts).toContain(changes);
  for (const value of ["지금 36,000원 → 새 금액 56,000원", "차액 20,000원", "변경 마감 11월 26일 20:00까지"])
    expect(texts).toContain(value);
  const cards = body.template.outputs.filter((o) => "textCard" in o);
  expect(cards).toHaveLength(1);
  expect(JSON.stringify(cards)).toContain("바꿀게요");
  expect(JSON.stringify(cards)).toContain("그대로 둘래요");
  expect(JSON.stringify(body)).not.toContain("계좌번호");
});

it("기한이 지난 새 금액 카드는 정해진 문구와 새 카드 키를 함께 보인다", () => {
  const body = kakaoPaymentMessage({ ...customAmount, refresh: "expired" });
  expectSchema("SkillTemplateResponse", body);
  expect(JSON.stringify(body)).toContain("시간이 지나 새 카드를 보내 드려요");
  expect(JSON.stringify(body)).toContain(amountCard.cardKey);
  expect(JSON.stringify(body)).not.toContain("계좌번호");
});

it("바뀐 새 금액 카드에는 현재 값의 새 카드와 바뀜 문구를 보인다", () => {
  const body = kakaoPaymentMessage({ state: "stale", reason: "card_stale", replacement: customAmount });
  expectSchema("SkillTemplateResponse", body);
  expect(JSON.stringify(body)).toContain("내용이 바뀌었어요. 새 카드를 확인해 주세요");
  expect(JSON.stringify(body)).toContain("75,000원");
});

it("닫힌 업무는 현재 상태만 표시하고 카드와 계좌를 보이지 않는다", () => {
  const body = kakaoPaymentMessage({ state: "stale", reason: "not_allowed_now", currentStatus: "주문이 취소됐어요" });
  expectSchema("SkillTemplateResponse", body);
  expect(body.template.outputs).toEqual([{ simpleText: { text: "지금은 할 수 없어요: 주문이 취소됐어요" } }]);
});

it("다음 대화 때 전하는 새 금액 카드도 계좌 없이 같은 확인 카드다", () => {
  const body = kakaoPaymentMessage({ state: "deferred", notice: customAmount });
  expect(body).toEqual(kakaoPaymentMessage(customAmount));
  expectSchema("SkillTemplateResponse", body);
});

it("확인한 새 금액의 결제 안내에는 요청 견적과 사유 및 확인 결과를 보인다", () => {
  const body = kakaoPaymentMessage({
    state: "normal",
    kind: "first",
    orderNo: "AB1234CD",
    amount: 75000,
    account: { bankName: "합성은행", number: "123456789012", holderName: "합성가게" },
    dueAt: "2026-11-25T12:00:00Z",
    timeZone: "Asia/Seoul",
    amountConfirmed: true,
    adjustment: { requestedQuote: customAmount.requestedQuote, reason: customAmount.reason },
  });
  expectSchema("SkillTemplateResponse", body);
  for (const value of [
    "새 금액을 확인했어요",
    "요청하신 견적 70,000원부터 → 75,000원",
    customAmount.reason,
    "123456789012",
  ])
    expect(JSON.stringify(body)).toContain(value);
});

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
