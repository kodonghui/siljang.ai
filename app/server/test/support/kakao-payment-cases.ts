/** 저장된 서버 표시 값의 합성 자료. 실제 결제 명령·발신·전달 시각 저장은 실행하지 않는다. */

import { kakaoConfirmCardReply } from "../../src/kakao-confirm-card";
import {
  type KakaoPaymentAmountView,
  type KakaoPaymentNormalView,
  kakaoPaymentMessage,
} from "../../src/kakao-payment-message";
import { kakaoReply } from "../../src/kakao-reply";
import type { ShopRequest } from "../../src/routes";

const responder: Pick<ShopRequest, "json"> = {
  json: (body, status = 200, headers = {}) => Response.json(body, { status, headers }),
};
export const paymentNormal: KakaoPaymentNormalView = {
  state: "normal",
  kind: "first",
  orderNo: "AB1234CD",
  amount: 75000,
  account: { bankName: "합성은행", number: "123456789012", holderName: "합성가게" },
  dueAt: "2026-11-28T12:00:00Z",
  timeZone: "Asia/Seoul",
  cardPaymentUrl: "https://payment.example/synthetic",
  adjustment: {
    requestedQuote: { amount: 70000, amountMax: null, displayKind: "from" },
    reason: "합성 디자인 장식을 추가해요",
  },
};
export const paymentAmount: KakaoPaymentAmountView = {
  state: "amount-confirm",
  kind: "custom",
  cardKey: "synthetic_amount_card_key_01",
  blockId: "synthetic-amount-card",
  expiresAt: "2026-11-28T06:30:00Z",
  timeZone: "Asia/Seoul",
  amount: 75000,
  requestedQuote: { amount: 70000, amountMax: null, displayKind: "from" },
  reason: "합성 디자인 장식을 추가해요",
};
export function paymentSamples() {
  return [
    { state: "normal", body: kakaoPaymentMessage(paymentNormal) },
    { state: "amount-confirm", body: kakaoPaymentMessage(paymentAmount) },
    { state: "done", body: kakaoPaymentMessage({ state: "done", kind: "custom" }) },
    { state: "deferred", body: kakaoPaymentMessage({ state: "deferred", notice: paymentNormal }) },
    { state: "stale", body: kakaoPaymentMessage({ state: "stale", reason: "deadline" }) },
    { state: "permission", body: kakaoPaymentMessage({ state: "permission", reason: "card_not_yours" }) },
    { state: "error", body: kakaoPaymentMessage({ state: "error", reason: "retry_needed" }) },
  ];
}
interface PaymentResponseCase {
  readonly response: string;
  readonly state: string | null;
  readonly display: "skill" | "kakao-client" | "not-shown" | "not-delivered";
  readonly body: unknown;
}
export async function paymentResponseCases(): Promise<readonly PaymentResponseCase[]> {
  const rows: PaymentResponseCase[] = [];
  const add = (response: string, state: string, body: unknown) =>
    rows.push({ response, state, display: "skill", body });
  add("API-073#200:notice_shown", "normal", kakaoPaymentMessage(paymentNormal));
  rows.push({ response: "API-073#200:notice_test", state: null, display: "not-shown", body: null });
  add("API-073#200:notice_gone", "stale", await kakaoReply(responder, "notice_gone").json());
  add("API-071#200:amount_confirmed", "normal", kakaoPaymentMessage({ ...paymentNormal, amountConfirmed: true }));
  add("API-071#200:amount_declined", "done", kakaoPaymentMessage({ state: "done", kind: "custom" }));
  add(
    "API-071#200:card_stale",
    "stale",
    kakaoPaymentMessage({ state: "stale", reason: "card_stale", replacement: paymentAmount }),
  );
  add("API-071#200:card_expired", "amount-confirm", kakaoPaymentMessage({ ...paymentAmount, refresh: "expired" }));
  add(
    "API-071#200:card_not_yours",
    "permission",
    kakaoPaymentMessage({ state: "permission", reason: "card_not_yours" }),
  );
  add(
    "API-071#200:card_used",
    "done",
    await kakaoConfirmCardReply(responder, {
      outcome: "card_used",
      text: "이미 처리했어요",
      firstResult: { outcome: "amount_declined", text: "알겠어요. 주문을 취소했어요" },
    }).json(),
  );
  add("API-071#200:retry_needed", "error", kakaoPaymentMessage({ state: "error", reason: "retry_needed" }));
  add(
    "API-071#200:not_allowed_now",
    "stale",
    kakaoPaymentMessage({ state: "stale", reason: "not_allowed_now", currentStatus: "주문이 취소됐어요" }),
  );
  add(
    "API-071#200:not_accepting",
    "permission",
    await kakaoReply(responder, "not_accepting", { contactPhone: "02-000-0000" }).json(),
  );
  add("API-071#200:server_error", "error", await kakaoReply(responder, "server_error").json());
  for (const outcome of [
    "allergy_saved",
    "allergy_declined",
    "orderer_saved",
    "order_requested",
    "payment_claimed",
    "change_requested",
    "order_cancelled",
    "issue_reported",
    "photo_consent_saved",
    "consent_withdrawn",
    "declined",
    "input_invalid",
    "day_full",
    "order_limit_reached",
    "block_verified",
    "channel_linked",
  ])
    rows.push({ response: `API-071#200:${outcome}`, state: null, display: "not-shown", body: null });
  for (const response of ["401:skill_key_invalid", "422:validation_failed", "default:internal"]) {
    rows.push({ response: `API-071#${response}`, state: "error", display: "kakao-client", body: null });
    rows.push({ response: `API-073#${response}`, state: "error", display: "not-delivered", body: null });
  }
  return rows;
}
