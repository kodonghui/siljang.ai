import { expect, it } from "vitest";
import { kakaoConsultationMessage } from "../src/kakao-consultation-message";
import { kakaoConfirmAnswerMessage } from "../src/kakao-order-request-message";
import { expectSchema } from "./support/contract";

const card = {
  kind: "change_request" as const,
  cardKey: "synthetic_change_request_key_01",
  title: "변경 요청",
  description: "주문번호 AB1234CD",
  confirmLabel: "변경 요청",
  blockId: "synthetic-card",
  changeRequest: {
    orderNo: "AB1234CD",
    currentVersion: 3,
    changes: [
      { label: "문구", before: "생일 축하해", after: "졸업 축하해 🎉" },
      { label: "픽업 날짜", before: "2026-11-28", after: "2026-11-29" },
      { label: "픽업 시간", before: "14:00", after: "15:30" },
    ],
    requiresOwnerApproval: true,
    expiresAt: "2026-11-28T06:30:00Z",
    timeZone: "Asia/Seoul",
  },
};

it("실제 상담 공통 표시가 변경 전후·현재 버전·마감 날짜 경고와 카드 기한을 보인다", () => {
  const body = kakaoConsultationMessage({ state: "normal", contents: [card] });
  expectSchema("SkillTemplateResponse", body);
  const text = JSON.stringify(body);
  for (const value of [
    "지금 버전 3",
    "문구: 생일 축하해 → 졸업 축하해 🎉",
    "픽업 날짜: 2026-11-28 → 2026-11-29",
    "픽업 시간: 14:00 → 15:30",
    "받을지 사장님이 정해요",
    "15:30까지 눌러 주세요",
  ])
    expect(text).toContain(value);
  expect(text).toContain("안 할래요");
});

it("카드 기한이 지나 새로 보낼 때 새 카드의 현재 값과 고정 안내를 함께 보인다", () => {
  const body = kakaoConfirmAnswerMessage({
    outcome: "card_expired",
    text: "시간이 지나 새 카드를 보내 드려요",
    card: { ...card, cardKey: "synthetic_change_request_fresh_01" },
  });
  expectSchema("SkillTemplateResponse", body);
  const text = JSON.stringify(body);
  expect(text).toContain("시간이 지나 새 카드를 보내 드려요");
  expect(text).toContain("지금 버전 3");
  expect(text).toContain("생일 축하해 → 졸업 축하해 🎉");
  expect(text).not.toContain(card.cardKey);
});

it.each([
  ["change_requested", "변경을 요청했어요. 사장님이 보고 알려 드려요"],
  ["declined", "알겠어요. 더 궁금한 것이 있으면 말씀해 주세요"],
] as const)("같은 변경 카드를 다시 누르면 첫 결과만 되돌린다(%s)", (outcome, text) => {
  const body = kakaoConfirmAnswerMessage({
    kind: "change_request",
    outcome: "card_used",
    text: "이미 처리했어요",
    firstResult: { outcome, text },
  });
  expectSchema("SkillTemplateResponse", body);
  expect(body.template.outputs).toEqual([{ simpleText: { text } }]);
});
