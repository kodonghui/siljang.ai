import { describe, expect, it } from "vitest";
import { type KakaoIssueReportView, kakaoIssueReportMessage } from "../src/kakao-issue-report-message";
import { expectSchema } from "./support/contract";

const card = {
  state: "normal",
  orderNo: "ABCD1234",
  receivedAt: "2026-11-26T06:00:00Z",
  description: "케이크 장식이 옆으로 무너졌어요",
  photoCount: 2,
  showMedicalNotice: false,
  expiresAt: "2026-11-27T09:30:00Z",
  timeZone: "Asia/Seoul",
  cardKey: "IssueCardFixture147key",
  blockId: "issue-block",
} satisfies KakaoIssueReportView;
const texts = (view: KakaoIssueReportView) => {
  const body = kakaoIssueReportMessage(view);
  expectSchema("SkillTemplateResponse", body);
  expect(body.template.outputs.length).toBeLessThanOrEqual(3);
  return body.template.outputs
    .map((output) =>
      "simpleText" in output ? output.simpleText.text : `${output.textCard.title}\n${output.textCard.description}`,
    )
    .join("\n");
};
describe("SCR010 문제 신고 표시(TASK-147)", () => {
  it.each([0, 5])("사진%s장인 신고 카드가 현재 저장 값을 표시하고 두 명령만 보낸다", (photoCount) => {
    const body = kakaoIssueReportMessage({ ...card, photoCount });
    expectSchema("SkillTemplateResponse", body);
    expect(body.template.outputs).toHaveLength(1);
    const action = body.template.outputs.find((output) => "textCard" in output)?.textCard;
    if (action === undefined) throw new Error("문제 신고 행동 카드 없음");
    expect(action.title).toBe("문제 신고");
    expect(action.description).toContain("ABCD1234");
    expect(action.description).toContain("2026-11-26");
    expect(action.description).toContain(`사진 ${photoCount}장`);
    expect(action.description).toContain(card.description);
    expect(action.description).toContain("18:30까지 눌러 주세요");
    expect([...action.title, ...action.description].length).toBeLessThanOrEqual(400);
    expect(action.buttons).toEqual(
      (["confirm", "decline"] as const).map((choice) => ({
        label: choice === "confirm" ? "문제 신고" : "안 할래요",
        action: "block",
        blockId: card.blockId,
        extra: { cardKey: card.cardKey, choice },
      })),
    );
    expect(texts({ ...card, photoCount })).not.toMatch(/기한 뒤|보상받을 수 없|환불해 드|재제작해 드/u);
  });
  it.each([
    ["stale", "내용이 바뀌었어요. 새 카드를 확인해 주세요"],
    ["expired", "시간이 지나 새 카드를 보내 드려요"],
  ] as const)("%s 상태는 알림과 지금 값의 새 카드를 함께 표시한다", (state, notice) => {
    const body = kakaoIssueReportMessage({ ...card, state });
    expect(texts({ ...card, state })).toContain(notice);
    expect(body.template.outputs.filter((output) => "textCard" in output)).toHaveLength(1);
  });
  it.each([
    ["issue_reported", "신고를 받았어요. 사장님이 보시고 정하실 거예요"],
    ["declined", "알겠어요. 더 궁금한 것이 있으면 말씀해 주세요"],
  ] as const)("완료의 처음 결과를 그대로 표시한다(%s)", (outcome, expected) => {
    expect(texts({ state: "done", outcome })).toBe(expected);
  });
  it("받기 전인 주문에는 신고 카드를 보이지 않는다", () => {
    expect(texts({ state: "stale", reason: "not_received" })).toBe("지금은 할 수 없어요: 아직 받지 않은 주문이에요");
  });
  it.each([
    [{ state: "permission", reason: "card_not_yours" }, "이 버튼은 카드를 받은 분만 누를 수 있어요"],
    [
      { state: "permission", reason: "not_accepting", contactPhone: "02-000-0000" },
      "아직 상담을 받지 않아요. 가게로 연락해 주세요: 02-000-0000",
    ],
    [{ state: "error", reason: "retry_needed" }, "다시 눌러 주세요"],
    [{ state: "error", reason: "server_error" }, "잠시 뒤 다시 말씀해 주세요"],
  ] as const)("권한과 서버 결과에는 정한 말만 표시한다(%j)", (view, expected) => {
    expect(texts(view)).toBe(expected);
  });
  it("몸이 불편한 신고의 정한 안내를 더하고 원인·책임·보상을 말하지 않는다", () => {
    const result = texts({ ...card, showMedicalNotice: true });
    expect(result).toContain("몸이 불편하시면 병원 진료를 먼저 받으세요");
    expect(result).not.toMatch(/가게 과실|책임이 있|환불해 드|재제작해 드/u);
  });
});
