/** 합성 표시 자료. 변경 명령·모델·카카오 발신은 호출하지 않는다. */
import { type ConfirmCardView, NOT_YOURS, RETRY_NEEDED } from "../../src/confirm-card-store";
import { CHANGE_REQUESTED_TEXT, kakaoChangeRequestMessage } from "../../src/kakao-change-request-message";
import { kakaoConfirmCardReply } from "../../src/kakao-confirm-card";
import { kakaoConsultationMessage } from "../../src/kakao-consultation-message";
import { kakaoReply } from "../../src/kakao-reply";
import type { ShopRequest } from "../../src/routes";

const responder: Pick<ShopRequest, "json"> = {
  json: (body, status = 200, headers = {}) => Response.json(body, { status, headers }),
};
export const changeRequestCard = {
  kind: "change_request",
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
} as const satisfies ConfirmCardView;
export function changeRequestSamples() {
  return [
    { state: "normal", body: kakaoConsultationMessage({ state: "normal", contents: [changeRequestCard] }) },
    { state: "done", body: kakaoChangeRequestMessage({ state: "done", outcome: "change_requested" }) },
    {
      state: "stale",
      body: kakaoChangeRequestMessage({ state: "stale", currentStatus: "앞의 변경 요청을 사장님이 보고 있어요" }),
    },
    {
      state: "expired",
      body: kakaoChangeRequestMessage({
        state: "expired",
        ...changeRequestCard.changeRequest,
        cardKey: "synthetic_change_request_fresh_01",
        blockId: changeRequestCard.blockId,
      }),
    },
    { state: "permission", body: kakaoChangeRequestMessage({ state: "permission", reason: "card_not_yours" }) },
    { state: "error", body: kakaoChangeRequestMessage({ state: "error", reason: "retry_needed" }) },
  ];
}
interface ResponseCase {
  readonly response: string;
  readonly state: string | null;
  readonly display: "skill" | "kakao-client" | "not-shown";
  readonly body: unknown;
}
export async function changeRequestResponseCases(): Promise<readonly ResponseCase[]> {
  const rows: ResponseCase[] = [];
  const add = (outcome: string, state: string, body: unknown) =>
    rows.push({ response: `API-071#200:${outcome}`, state, display: "skill", body });
  for (const [outcome, text] of [
    ["change_requested", CHANGE_REQUESTED_TEXT],
    ["declined", "알겠어요. 더 궁금한 것이 있으면 말씀해 주세요"],
  ] as const)
    add(
      outcome,
      "done",
      await kakaoConfirmCardReply(responder, { kind: "change_request", outcome: outcome, text: text }).json(),
    );
  for (const [outcome, state] of [
    ["card_stale", "stale"],
    ["card_expired", "expired"],
  ] as const)
    add(
      outcome,
      state,
      await kakaoConfirmCardReply(responder, {
        outcome: outcome,
        text: "오래된 안내를 그대로 보이지 않음",
        card: { ...changeRequestCard, cardKey: "synthetic_change_request_fresh_01" },
      }).json(),
    );
  add("card_not_yours", "permission", await kakaoConfirmCardReply(responder, NOT_YOURS).json());
  add(
    "card_used",
    "done",
    await kakaoConfirmCardReply(responder, {
      kind: "change_request",
      outcome: "card_used",
      text: "이미 처리했어요",
      firstResult: { outcome: "change_requested", text: CHANGE_REQUESTED_TEXT },
    }).json(),
  );
  add("retry_needed", "error", await kakaoConfirmCardReply(responder, RETRY_NEEDED).json());
  add(
    "not_allowed_now",
    "stale",
    kakaoChangeRequestMessage({
      state: "stale",
      currentStatus: "결제 전 주문이에요. 주문 요청을 취소하고 다시 요청할 수 있어요",
    }),
  );
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
    "order_cancelled",
    "issue_reported",
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
