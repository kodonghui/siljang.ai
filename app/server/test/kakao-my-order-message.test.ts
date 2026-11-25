import { expect, it } from "vitest";
import { type KakaoMyOrderView, kakaoMyOrderMessage } from "../src/kakao-my-order-message";
import { expectSchema } from "./support/contract";
import { myOrderSummary as order } from "./support/kakao-my-order-cases";

it("SCR007 현재 주문의 저장 값과 환불 계산값을 내 주문 카드에 보인다", () => {
  const body = kakaoMyOrderMessage({ state: "normal", order });
  expectSchema("SkillTemplateResponse", body);
  if (!("template" in body)) throw new Error("synthetic order template missing");
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
it.each([
  [{ state: "empty" }, "이 대화로 요청한 주문이 없어요"],
  [{ state: "loading" }, "답을 준비하고 있어요"],
  [{ state: "error", reason: "not_found" }, "찾을 수 없는 주문이에요"],
  [{ state: "permission", reason: "not_yours" }, "찾을 수 없는 주문이에요"],
  [{ state: "permission", reason: "circumstances" }, "사장님 확인 뒤 답드릴게요"],
  [
    { state: "permission", reason: "not_accepting", contactPhone: "02-123-4567" },
    "아직 상담을 받지 않아요. 가게로 연락해 주세요: 02-123-4567",
  ],
  [{ state: "handed-over", recommendChannel: true }, "채널을 추가하시면 답을 바로 받아 보실 수 있어요"],
  [{ state: "rate-limited" }, "잠시 뒤 다시 말씀해 주세요"],
  [{ state: "error", reason: "server_error" }, "잠시 뒤 다시 말씀해 주세요"],
  [{ state: "error", reason: "unsupported_message" }, "글이나 사진으로 말씀해 주세요"],
  [{ state: "error", reason: "photo_rejected" }, "사진은 한 장 20MB, 한 상담에 10장까지 받을 수 있어요"],
  [{ state: "error", reason: "photo_download_failed" }, "사진을 받지 못했어요. 다시 보내 주세요"],
] satisfies readonly (readonly [KakaoMyOrderView, string])[])(
  "%j 상태의 고정 응답은 주문을 노출하지 않음",
  (view, expected) => {
    const input = { ...view, order };
    const body = kakaoMyOrderMessage(input);
    expect(JSON.stringify(body)).toContain(expected);
    for (const privateValue of [order.orderNo, "36,000", "31,000", "합성 생일 축하"])
      expect(JSON.stringify(body)).not.toContain(privateValue);
  },
);
it("받은 주문은 신고로 이어지고 환불 결정과 보낸 날은 있을 때만 보임", () => {
  const body = kakaoMyOrderMessage({
    state: "normal",
    order: { ...order, status: "received", refund: { amount: 5000, sentAt: "2026-11-29T01:00:00Z" } },
  });
  const value = JSON.stringify(body);
  expect(value).toContain("문제가 있어요");
  expect(value).not.toContain("취소할래요");
  expect(value).toContain("환불 5,000원 · 11월 29일 보냄");
});
it("주문이 여럿이면 최근 요청 순서로 열 개까지 공개 번호/픽업 날짜 바로가기를 보임", () => {
  const orders = Array.from({ length: 12 }, (_, index) => ({
    orderNo: `AA${String(index).padStart(6, "0")}`,
    pickupAt: order.pickupAt,
    requestedAt: new Date(Date.parse("2026-11-25T00:00:00Z") + index * 1000).toISOString(),
  }));
  const original = JSON.stringify(orders);
  const body = kakaoMyOrderMessage({ state: "normal", orders, timeZone: "Asia/Seoul" });
  expectSchema("SkillTemplateResponse", body);
  if (!("template" in body) || !("quickReplies" in body.template)) throw new Error("synthetic order choices missing");
  expect(body.template.quickReplies).toHaveLength(10);
  expect(body.template.quickReplies?.[0]?.messageText).toBe("AA000011 내 주문");
  expect(JSON.stringify(body)).not.toContain("AA000000");
  expect(JSON.stringify(orders)).toBe(original);
});
it("긴 문구는 코드 포인트로 줄이고 환불과 마감 계산값은 보존함", () => {
  const body = kakaoMyOrderMessage({
    state: "normal",
    order: { ...order, contents: { ...order.contents, message: "🍰".repeat(700) } },
  });
  expectSchema("SkillTemplateResponse", body);
  if (!("template" in body)) throw new Error("synthetic order template missing");
  const output = body.template.outputs[0];
  if (output === undefined || !("textCard" in output)) throw new Error("synthetic order text card missing");
  expect([...output.textCard.title, ...output.textCard.description].length).toBeLessThanOrEqual(400);
  expect(output.textCard.description).toContain("…");
  expect(output.textCard.description).toContain("31,000원(제작 전 취소)");
  expect(JSON.stringify(body)).not.toMatch(/\\ud[89ab][0-9a-f]{2}/i);
});
it("반복 한도 뒤 응답은 조용하고 다른 사용자는 없는 번호와 같은 답", () => {
  const limited = kakaoMyOrderMessage({ state: "rate-limited", silent: true });
  if (!("template" in limited)) throw new Error("synthetic silent template missing");
  expect(limited.template.outputs).toEqual([]);
  expect(kakaoMyOrderMessage({ state: "permission", reason: "not_yours" })).toEqual(
    kakaoMyOrderMessage({ state: "error", reason: "not_found" }),
  );
});
it("결제 전과 보내기 전 환불을 완료된 시각으로 꾸미지 않음", () => {
  const body = kakaoMyOrderMessage({
    state: "stale",
    order: { ...order, paidAt: null, refund: { amount: 5000, sentAt: null } },
  });
  expect(JSON.stringify(body)).toContain("36,000원 · 결제 전");
  expect(JSON.stringify(body)).toContain("환불 5,000원 · 보내기 전");
  expect(JSON.stringify(body)).not.toContain("결제 확인 11월");
});
