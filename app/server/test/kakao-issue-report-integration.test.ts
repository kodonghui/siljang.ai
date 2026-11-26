import { expect, it } from "vitest";
import type { ConfirmCardView } from "../src/confirm-card-store";
import { kakaoConfirmCardReply } from "../src/kakao-confirm-card";
import { kakaoConsultationMessage } from "../src/kakao-consultation-message";
import { type KakaoIssueReportView, kakaoIssueReportMessage } from "../src/kakao-issue-report-message";
import { type KakaoMessageContent, mergeKakaoAmountConfirmations } from "../src/kakao-message-content";
import { expectSchema } from "./support/contract";

const normal = {
  state: "normal",
  orderNo: "ABCD1234",
  receivedAt: "2026-11-26T06:00:00Z",
  description: "합성 신고 설명",
  photoCount: 1,
  showMedicalNotice: false,
  expiresAt: "2026-11-27T09:30:00Z",
  timeZone: "Asia/Seoul",
  cardKey: "IssueCardFixture147key",
  blockId: "issue-block",
} satisfies KakaoIssueReportView;
const { cardKey, blockId, state: _state, ...issueReport } = normal;
const prepared: ConfirmCardView = {
  kind: "issue_report",
  cardKey,
  blockId,
  title: "문제 신고",
  description: "일반 안내만으로 대체하면 안 되는 합성 준비 값",
  confirmLabel: "문제 신고",
  issueReport,
};
it.each(["normal", "stale", "expired"] as const)(
  "서버가 준비한 신고 카드가 공통 정상/버튼 응답에서 전용 표시로 이어진다(%s)",
  async (state) => {
    const body =
      state === "normal"
        ? kakaoConsultationMessage({ state: "normal", contents: [prepared] })
        : await kakaoConfirmCardReply(
            { json: (value, status = 200, headers = {}) => Response.json(value, { status, headers }) },
            { outcome: state === "stale" ? "card_stale" : "card_expired", text: "일반 카드 안내", card: prepared },
          ).json();
    expectSchema("SkillTemplateResponse", body);
    expect(body).toEqual(kakaoIssueReportMessage({ ...normal, state }));
  },
);
it("서버가 준비한 큰 그래핌/진료 안내의 세 출력도 공통 정상 응답에서 보존한다", () => {
  const longReport = { ...issueReport, description: `가${"\u0301".repeat(999)}`, showMedicalNotice: true };
  const view = { ...normal, ...longReport };
  const body = kakaoConsultationMessage({ state: "normal", contents: [{ ...prepared, issueReport: longReport }] });
  expect(body).toEqual(kakaoIssueReportMessage(view));
  expect(body.template?.outputs).toHaveLength(3);
});
it.each([
  normal,
  { ...normal, state: "expired", description: `가${"\u0301".repeat(999)}`, showMedicalNotice: true },
  { state: "permission", reason: "card_not_yours" },
] as const)("공통 발신이 신고 표시의 모든 출력을 순서대로 보존한다($state)", (view) => {
  const content: KakaoMessageContent = { kind: "issue_card", view };
  const expected = kakaoIssueReportMessage(view);
  const expanded = mergeKakaoAmountConfirmations([], [content]);
  expect(expanded).toHaveLength(expected.template.outputs.length);
  const body = kakaoConsultationMessage({ state: "normal", contents: expanded });
  expectSchema("SkillTemplateResponse", body);
  expect(body).toEqual(expected);
});
