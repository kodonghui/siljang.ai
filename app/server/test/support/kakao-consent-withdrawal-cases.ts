/** SCR013 합성 표시 자료. 실제 철회 업무·모델·카카오 발신은 호출하지 않는다. */
import { type ConfirmCardView, NOT_YOURS, RETRY_NEEDED } from "../../src/confirm-card-store";
import { kakaoConfirmCardReply } from "../../src/kakao-confirm-card";
import {
  CONSENT_WITHDRAWN_TEXT,
  kakaoConsentWithdrawalMessage,
  NO_CONSENTED_PHOTOS_TEXT,
} from "../../src/kakao-consent-withdrawal-message";
import { kakaoConsultationMessage } from "../../src/kakao-consultation-message";
import { kakaoReply } from "../../src/kakao-reply";
import type { ShopRequest } from "../../src/routes";

const responder: Pick<ShopRequest, "json"> = {
  json: (body, status = 200, headers = {}) => Response.json(body, { status, headers }),
};
export const consentWithdrawalCard = {
  kind: "consent_withdrawal",
  cardKey: "synthetic_consent_withdrawal_149",
  blockId: "synthetic-card",
  title: "사진 게시 동의 철회",
  description: "서버에서 준비한 합성 철회 카드",
  confirmLabel: "동의 철회",
  consentWithdrawal: {
    orderNo: "AB1234CD",
    completionPhotoCount: 2,
    reviewPhotoCount: 3,
    publishedCount: 2,
    expiresAt: "2026-11-27T09:30:00Z",
    timeZone: "Asia/Seoul",
  },
} as const satisfies ConfirmCardView;
function view(state: "normal" | "stale" | "expired") {
  return {
    ...consentWithdrawalCard.consentWithdrawal,
    state,
    cardKey: consentWithdrawalCard.cardKey,
    blockId: consentWithdrawalCard.blockId,
  };
}
export function consentWithdrawalSamples() {
  return [
    { state: "normal", body: kakaoConsultationMessage({ state: "normal", contents: [consentWithdrawalCard] }) },
    { state: "done", body: kakaoConsentWithdrawalMessage({ state: "done", outcome: "consent_withdrawn" }) },
    { state: "stale", body: kakaoConsentWithdrawalMessage(view("stale")) },
    { state: "expired", body: kakaoConsentWithdrawalMessage(view("expired")) },
    { state: "permission", body: kakaoConsentWithdrawalMessage({ state: "permission", reason: "card_not_yours" }) },
    { state: "error", body: kakaoConsentWithdrawalMessage({ state: "error", reason: "retry_needed" }) },
  ];
}
interface ResponseCase {
  readonly response: string;
  readonly state: string | null;
  readonly display: "skill" | "kakao-client" | "not-shown";
  readonly body: unknown;
}
export async function consentWithdrawalResponseCases(): Promise<readonly ResponseCase[]> {
  const rows: ResponseCase[] = [];
  const add = (outcome: string, state: string, body: unknown) =>
    rows.push({ response: `API-071#200:${outcome}`, state, display: "skill", body });
  for (const [outcome, text] of [
    ["consent_withdrawn", CONSENT_WITHDRAWN_TEXT],
    ["declined", "알겠어요. 더 궁금한 것이 있으면 말씀해 주세요"],
  ] as const)
    add(outcome, "done", await kakaoConfirmCardReply(responder, { kind: "consent_withdrawal", outcome, text }).json());
  for (const [outcome, state] of [
    ["card_stale", "stale"],
    ["card_expired", "expired"],
  ] as const)
    add(
      outcome,
      state,
      await kakaoConfirmCardReply(responder, {
        outcome,
        text: "새 카드",
        card: { ...consentWithdrawalCard, cardKey: "synthetic_consent_fresh_149" },
      }).json(),
    );
  add("card_not_yours", "permission", await kakaoConfirmCardReply(responder, NOT_YOURS).json());
  add(
    "card_used",
    "done",
    await kakaoConfirmCardReply(responder, {
      kind: "consent_withdrawal",
      outcome: "card_used",
      text: "이미 처리했어요",
      firstResult: { outcome: "consent_withdrawn", text: CONSENT_WITHDRAWN_TEXT },
    }).json(),
  );
  add("retry_needed", "error", await kakaoConfirmCardReply(responder, RETRY_NEEDED).json());
  add(
    "not_allowed_now",
    "stale",
    await kakaoConfirmCardReply(responder, {
      kind: "consent_withdrawal",
      outcome: "not_allowed_now",
      text: NO_CONSENTED_PHOTOS_TEXT,
    }).json(),
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
    "change_requested",
    "order_cancelled",
    "issue_reported",
    "photo_consent_saved",
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
