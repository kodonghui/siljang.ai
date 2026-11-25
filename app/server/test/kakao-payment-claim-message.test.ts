import { expect, it } from "vitest";
import { kakaoPaymentClaimMessage } from "../src/kakao-payment-claim-message";
import { expectSchema } from "./support/contract";

const normal = {
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
} as const;

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

it.each([
  [{ state: "done", kind: "claimed" }, "사장님께 알렸어요. 확인되면 알려 드릴게요"],
  [{ state: "done", kind: "declined" }, "알겠어요. 더 궁금한 것이 있으면 말씀해 주세요"],
  [{ state: "done", kind: "used", firstOutcome: "payment_claimed" }, "사장님께 알렸어요. 확인되면 알려 드릴게요"],
  [{ state: "done", kind: "used", firstOutcome: "declined" }, "알겠어요. 더 궁금한 것이 있으면 말씀해 주세요"],
  [{ state: "stale", currentStatus: "이미 결제가 확인됐어요" }, "지금은 할 수 없어요: 이미 결제가 확인됐어요"],
  [{ state: "permission", reason: "card_not_yours" }, "이 버튼은 카드를 받은 분만 누를 수 있어요"],
  [
    { state: "permission", reason: "not_accepting", contactPhone: "02-000-0000" },
    "아직 상담을 받지 않아요. 가게로 연락해 주세요: 02-000-0000",
  ],
  [{ state: "error", reason: "retry_needed" }, "다시 눌러 주세요"],
  [{ state: "error", reason: "server_error" }, "잠시 뒤 다시 말씀해 주세요"],
] as const)("닫힘/권한/오류에는 첫 결과나 지금 상태만 보이고 입금자를 숨긴다(%j)", (view, text) => {
  const body = kakaoPaymentClaimMessage({ ...normal, ...view });
  expectSchema("SkillTemplateResponse", body);
  expect(body.template.outputs).toEqual([{ simpleText: { text } }]);
  for (const value of [normal.orderNo, normal.depositorName, "35,000원"])
    expect(JSON.stringify(body)).not.toContain(value);
});

it.each([false, true])("입금자 이름은 전용 블록으로만 묻고 원래 이름을 다시 보내지 않는다(%s)", (invalid) => {
  const body = kakaoPaymentClaimMessage({ ...normal, state: "depositor", invalid });
  expectSchema("SkillTemplateResponse", body);
  const text = JSON.stringify(body);
  expect(text).toContain(invalid ? "입금자 이름은 1~30자로 넣어 주세요" : "입금자 이름을 1~30자로 알려 주세요");
  expect(text).toContain("입금자 이름 넣기");
  expect(text).toContain(normal.depositorBlockId);
  expect(text).not.toContain(normal.depositorName);
  expect(text).not.toContain('"action":"message"');
});

it.each(["stale", "expired"] as const)("바뀌거나 기한이 지난 카드는 새 키와 정해진 문구를 보인다(%s)", (state) => {
  const body = kakaoPaymentClaimMessage({ ...normal, state, cardKey: "synthetic_fresh_payment_claim_01" });
  expectSchema("SkillTemplateResponse", body);
  expect(JSON.stringify(body)).toContain(
    state === "stale" ? "내용이 바뀌었어요. 새 카드를 확인해 주세요" : "시간이 지나 새 카드를 보내 드려요",
  );
  expect(JSON.stringify(body)).toContain("synthetic_fresh_payment_claim_01");
});

it("결제 기한이 카드 기한보다 먼저 지나도 표시가 임의로 요청을 막지 않는다", () => {
  const body = kakaoPaymentClaimMessage({ ...normal, dueAt: "2026-11-28T00:00:00Z" });
  expectSchema("SkillTemplateResponse", body);
  expect(JSON.stringify(body)).toContain("결제 확인 요청");
  expect(JSON.stringify(body)).toContain("09:00");
});
