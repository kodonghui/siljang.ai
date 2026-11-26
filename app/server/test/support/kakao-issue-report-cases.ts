/** SCR010 합성 표시 자료. 실제 신고 모으기·업무 명령·모델·카카오 발신은 호출하지 않는다. */
import { type ConfirmCardView, NOT_YOURS, RETRY_NEEDED } from "../../src/confirm-card-store";
import { kakaoConfirmCardReply } from "../../src/kakao-confirm-card";
import { kakaoConsultationMessage } from "../../src/kakao-consultation-message";
import { ISSUE_REPORTED_TEXT, kakaoIssueReportMessage } from "../../src/kakao-issue-report-message";
import { kakaoReply } from "../../src/kakao-reply";
import type { ShopRequest } from "../../src/routes";

const responder: Pick<ShopRequest, "json"> = {
  json: (body, status = 200, headers = {}) => Response.json(body, { status, headers }),
};
export const issueReportCard = {
  kind: "issue_report",
  cardKey: "synthetic_issue_report_key_01",
  blockId: "synthetic-card",
  title: "문제 신고",
  description: "일반 안내로 바꾸지 않는 합성 신고 준비 값",
  confirmLabel: "문제 신고",
  issueReport: {
    orderNo: "AB1234CD",
    receivedAt: "2026-11-26T06:00:00Z",
    description: "합성 케이크의 상태를 확인해 주세요. 사진 두 장을 함께 보냈어요.",
    photoCount: 2,
    showMedicalNotice: true,
    expiresAt: "2026-11-27T09:30:00Z",
    timeZone: "Asia/Seoul",
  },
} as const satisfies ConfirmCardView;

function view(state: "normal" | "stale" | "expired") {
  return { ...issueReportCard.issueReport, state, cardKey: issueReportCard.cardKey, blockId: issueReportCard.blockId };
}
export function issueReportSamples() {
  return [
    { state: "normal", body: kakaoConsultationMessage({ state: "normal", contents: [issueReportCard] }) },
    { state: "done", body: kakaoIssueReportMessage({ state: "done", outcome: "issue_reported" }) },
    { state: "stale", body: kakaoIssueReportMessage(view("stale")) },
    { state: "expired", body: kakaoIssueReportMessage(view("expired")) },
    { state: "permission", body: kakaoIssueReportMessage({ state: "permission", reason: "card_not_yours" }) },
    { state: "error", body: kakaoIssueReportMessage({ state: "error", reason: "retry_needed" }) },
  ];
}
interface ResponseCase {
  readonly response: string;
  readonly state: string | null;
  readonly display: "skill" | "kakao-client" | "not-shown";
  readonly body: unknown;
}
export async function issueReportResponseCases(): Promise<readonly ResponseCase[]> {
  const rows: ResponseCase[] = [];
  const add = (outcome: string, state: string, body: unknown) =>
    rows.push({ response: `API-071#200:${outcome}`, state, display: "skill", body });
  for (const [outcome, text] of [
    ["issue_reported", ISSUE_REPORTED_TEXT],
    ["declined", "알겠어요. 더 궁금한 것이 있으면 말씀해 주세요"],
  ] as const)
    add(outcome, "done", await kakaoConfirmCardReply(responder, { kind: "issue_report", outcome, text }).json());
  for (const [outcome, state] of [
    ["card_stale", "stale"],
    ["card_expired", "expired"],
  ] as const)
    add(
      outcome,
      state,
      await kakaoConfirmCardReply(responder, {
        outcome,
        text: "일반 안내로 바꾸지 않는 합성 갱신 값",
        card: { ...issueReportCard, cardKey: "synthetic_issue_report_fresh_01" },
      }).json(),
    );
  add("card_not_yours", "permission", await kakaoConfirmCardReply(responder, NOT_YOURS).json());
  add(
    "card_used",
    "done",
    await kakaoConfirmCardReply(responder, {
      kind: "issue_report",
      outcome: "card_used",
      text: "이미 처리했어요",
      firstResult: { outcome: "issue_reported", text: ISSUE_REPORTED_TEXT },
    }).json(),
  );
  add("retry_needed", "error", await kakaoConfirmCardReply(responder, RETRY_NEEDED).json());
  // 상태의 표시 형식만 대조한다. 실제 신고 업무 처리기는 TASK140에서 연결한다.
  add("not_allowed_now", "stale", kakaoIssueReportMessage({ state: "stale", reason: "not_received" }));
  add(
    "not_accepting",
    "permission",
    await kakaoReply(responder, "not_accepting", { contactPhone: "02-000-0000" }).json(),
  );
  add("server_error", "error", await kakaoReply(responder, "server_error").json());
  for (const outcome of [
    "allergy_saved",
    "allergy_declined",
    "orderer_saved",
    "order_requested",
    "payment_claimed",
    "amount_confirmed",
    "amount_declined",
    "change_requested",
    "order_cancelled",
    "photo_consent_saved",
    "consent_withdrawn",
    "input_invalid",
    "day_full",
    "order_limit_reached",
    "block_verified",
    "channel_linked",
  ])
    rows.push({ response: `API-071#200:${outcome}`, state: null, display: "not-shown", body: null });
  for (const response of ["401:skill_key_invalid", "422:validation_failed", "default:internal"])
    rows.push({ response: `API-071#${response}`, state: "error", display: "kakao-client", body: null });
  return rows;
}
