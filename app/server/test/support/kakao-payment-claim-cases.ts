/** 저장된 표시 값의 합성 자료. 이름 입력·결제 확인 요청과 실제 카카오 발신은 실행하지 않는다. */
import { NOT_YOURS, RETRY_NEEDED } from "../../src/confirm-card-store";
import { kakaoConfirmCardReply } from "../../src/kakao-confirm-card";
import { type KakaoPaymentClaimCard, kakaoPaymentClaimMessage } from "../../src/kakao-payment-claim-message";
import { kakaoReply } from "../../src/kakao-reply";
import type { ShopRequest } from "../../src/routes";

const responder: Pick<ShopRequest, "json"> = {
  json: (body, status = 200, headers = {}) => Response.json(body, { status, headers }),
};
export const paymentClaimCard: KakaoPaymentClaimCard = {
  orderNo: "AB1234CD",
  amount: 35000,
  dueAt: "2026-11-28T12:00:00Z",
  depositorName: "합성 주문자",
  expiresAt: "2026-11-28T06:30:00Z",
  timeZone: "Asia/Seoul",
  cardKey: "synthetic_payment_claim_key_01",
  cardBlockId: "synthetic-card",
  depositorBlockId: "synthetic-depositor",
};
export function paymentClaimSamples() {
  return [
    { state: "normal", body: kakaoPaymentClaimMessage({ state: "normal", ...paymentClaimCard }) },
    { state: "depositor", body: kakaoPaymentClaimMessage({ state: "depositor", ...paymentClaimCard }) },
    { state: "done", body: kakaoPaymentClaimMessage({ state: "done", kind: "claimed" }) },
    { state: "stale", body: kakaoPaymentClaimMessage({ state: "stale", ...paymentClaimCard }) },
    { state: "expired", body: kakaoPaymentClaimMessage({ state: "expired", ...paymentClaimCard }) },
    { state: "permission", body: kakaoPaymentClaimMessage({ state: "permission", reason: "card_not_yours" }) },
    { state: "error", body: kakaoPaymentClaimMessage({ state: "error", reason: "retry_needed" }) },
  ];
}
interface ClaimResponseCase {
  readonly response: string;
  readonly state: string | null;
  readonly display: "skill" | "kakao-client" | "not-shown";
  readonly body: unknown;
}
export async function paymentClaimResponseCases(): Promise<readonly ClaimResponseCase[]> {
  const rows: ClaimResponseCase[] = [];
  const add = (outcome: string, state: string, body: unknown) =>
    rows.push({ response: `API-071#200:${outcome}`, state, display: "skill", body });
  add(
    "payment_claimed",
    "done",
    await kakaoConfirmCardReply(responder, {
      outcome: "payment_claimed",
      text: "사장님께 알렸어요. 확인되면 알려 드릴게요",
    }).json(),
  );
  add(
    "declined",
    "done",
    await kakaoConfirmCardReply(responder, {
      outcome: "declined",
      text: "알겠어요. 더 궁금한 것이 있으면 말씀해 주세요",
    }).json(),
  );
  add(
    "input_invalid",
    "depositor",
    kakaoPaymentClaimMessage({ state: "depositor", invalid: true, ...paymentClaimCard }),
  );
  add("card_stale", "stale", kakaoPaymentClaimMessage({ state: "stale", ...paymentClaimCard }));
  add("card_expired", "expired", kakaoPaymentClaimMessage({ state: "expired", ...paymentClaimCard }));
  add("card_not_yours", "permission", await kakaoConfirmCardReply(responder, NOT_YOURS).json());
  add("card_used", "done", kakaoPaymentClaimMessage({ state: "done", kind: "used", firstOutcome: "payment_claimed" }));
  add("retry_needed", "error", await kakaoConfirmCardReply(responder, RETRY_NEEDED).json());
  add(
    "not_allowed_now",
    "stale",
    kakaoPaymentClaimMessage({ state: "stale", currentStatus: "이미 결제가 확인됐어요" }),
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
    "amount_confirmed",
    "amount_declined",
    "change_requested",
    "order_cancelled",
    "issue_reported",
    "photo_consent_saved",
    "consent_withdrawn",
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
