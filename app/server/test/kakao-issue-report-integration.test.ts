import { expect, it } from "vitest";
import { type KakaoIssueReportView, kakaoIssueReportMessage } from "../src/kakao-issue-report-message";
import {
  type KakaoMessageContent,
  kakaoMessageTemplate,
  mergeKakaoAmountConfirmations,
} from "../src/kakao-message-content";
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
it.each([
  normal,
  { ...normal, state: "expired", description: `가${"\u0301".repeat(999)}`, showMedicalNotice: true },
  { state: "permission", reason: "card_not_yours" },
] as const)("공통 발신이 신고 표시의 모든 출력을 순서대로 보존한다(%j)", (view) => {
  const content: KakaoMessageContent = { kind: "issue_card", view };
  const expected = kakaoIssueReportMessage(view);
  const expanded = mergeKakaoAmountConfirmations([], [content]);
  expect(expanded).toHaveLength(expected.template.outputs.length);
  const body = kakaoMessageTemplate(expanded);
  expectSchema("SkillTemplateResponse", body);
  expect(body).toEqual(expected);
});
