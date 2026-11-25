/** 합성 표시 자료. 취소 명령·모델·카카오 발신은 호출하지 않는다. */
import { type ConfirmCardView, NOT_YOURS, RETRY_NEEDED } from "../../src/confirm-card-store";
import { CANCELLATION_PAID_TEXT, kakaoCancellationMessage } from "../../src/kakao-cancellation-message";
import { kakaoConfirmCardReply } from "../../src/kakao-confirm-card";
import { kakaoConsultationMessage } from "../../src/kakao-consultation-message";
import { kakaoReply } from "../../src/kakao-reply";
import type { ShopRequest } from "../../src/routes";

const responder: Pick<ShopRequest, "json"> = {
  json: (body, status = 200, headers = {}) => Response.json(body, { status, headers }),
};
export const cancellationCard = {
  kind: "cancel",
  cardKey: "synthetic_cancel_key_01",
  title: "주문 취소",
  description: "주문번호 AB1234CD",
  confirmLabel: "주문 취소하기",
  blockId: "synthetic-card",
  cancellation: {
    orderNo: "AB1234CD",
    pickupAt: "2026-11-28T06:00:00Z",
    refund: { kind: "calculated", amount: 24000, clauseNames: ["이틀 전 취소", "맞춤 재료 비용"] },
    timeZone: "Asia/Seoul",
  },
} as const satisfies ConfirmCardView;
export function cancellationSamples() {
  return [
    { state: "normal", body: kakaoConsultationMessage({ state: "normal", contents: [cancellationCard] }) },
    { state: "done", body: kakaoCancellationMessage({ state: "done", kind: "paid" }) },
    {
      state: "stale",
      body: kakaoCancellationMessage({ state: "stale", currentStatus: "이미 받은 주문이에요" }),
    },
    {
      state: "expired",
      body: kakaoCancellationMessage({
        state: "expired",
        ...cancellationCard.cancellation,
        cardKey: "synthetic_cancel_fresh_01",
        blockId: cancellationCard.blockId,
      }),
    },
    { state: "permission", body: kakaoCancellationMessage({ state: "permission", reason: "card_not_yours" }) },
    { state: "error", body: kakaoCancellationMessage({ state: "error", reason: "retry_needed" }) },
  ];
}
interface ResponseCase {
  readonly response: string;
  readonly state: string | null;
  readonly display: "skill" | "kakao-client" | "not-shown";
  readonly body: unknown;
}
export async function cancellationResponseCases(): Promise<readonly ResponseCase[]> {
  const rows: ResponseCase[] = [];
  const add = (outcome: string, state: string, body: unknown) =>
    rows.push({ response: `API-071#200:${outcome}`, state, display: "skill", body });
  for (const [outcome, text] of [
    ["order_cancelled", CANCELLATION_PAID_TEXT],
    ["declined", "알겠어요. 더 궁금한 것이 있으면 말씀해 주세요"],
  ] as const)
    add(
      outcome,
      "done",
      await kakaoConfirmCardReply(responder, { kind: "cancel", outcome: outcome, text: text }).json(),
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
        card: { ...cancellationCard, cardKey: "synthetic_cancel_fresh_01" },
      }).json(),
    );
  add("card_not_yours", "permission", await kakaoConfirmCardReply(responder, NOT_YOURS).json());
  add(
    "card_used",
    "done",
    await kakaoConfirmCardReply(responder, {
      kind: "cancel",
      outcome: "card_used",
      text: "이미 처리했어요",
      firstResult: { outcome: "order_cancelled", text: CANCELLATION_PAID_TEXT },
    }).json(),
  );
  add("retry_needed", "error", await kakaoConfirmCardReply(responder, RETRY_NEEDED).json());
  add(
    "not_allowed_now",
    "stale",
    kakaoCancellationMessage({
      state: "stale",
      currentStatus: "이미 받은 주문이에요",
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
    "change_requested",
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
