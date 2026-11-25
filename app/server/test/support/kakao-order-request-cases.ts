/** 실제 표시 함수/공통 카드 응답의 합성 자료. 실제 주문·동의 저장이나 카카오 수신은 수행하지 않는다. */
import { NOT_YOURS, RETRY_NEEDED } from "../../src/confirm-card-store";
import { kakaoConfirmCardReply } from "../../src/kakao-confirm-card";
import { kakaoOrderRequestMessage } from "../../src/kakao-order-request-message";
import { kakaoReply } from "../../src/kakao-reply";
import type { ShopRequest } from "../../src/routes";

const responder: Pick<ShopRequest, "json"> = {
  json: (body, status = 200, headers = {}) => Response.json(body, { status, headers }),
};
const card = {
  title: "주문 요청 확인",
  description:
    "픽업 2026-11-28 15:00\n크기 1호 · 바닐라 · 합성 기본 디자인\n문구 Happy 🎂 Day · 분홍\n합성 주문자 · 010-0000-0000\n알레르기 정보 동의 안 함\n35,000원 · 15:30까지 눌러 주세요",
  confirmLabel: "규정에 동의하고 주문 요청",
  blockId: "synthetic-card",
  cardKey: "synthetic_order_card_1234",
};
const policy = {
  version: 3,
  clauses: [
    { title: "제작 전 취소", condition: "제작 시작 전", effect: "취소 수수료를 빼고 환불" },
    { title: "제작 뒤 취소", condition: "제작 시작 뒤", effect: "운영규정의 단계별 환불 기준 적용" },
  ],
};
const summary = { policy, card, isFriend: false };
const orderer = { cardKey: card.cardKey, blockId: "synthetic-orderer" };
const customResult = "주문을 요청했어요(주문번호 ABC123). 사장님이 보고 알려 드릴게요";
export function orderRequestSamples() {
  return [
    { state: "normal", body: kakaoOrderRequestMessage({ state: "normal", ...summary }) },
    {
      state: "allergy",
      body: kakaoOrderRequestMessage({
        state: "allergy",
        mode: "consent",
        cardKey: card.cardKey,
        answerBlockId: "synthetic-allergy",
        cardBlockId: card.blockId,
      }),
    },
    { state: "orderer", body: kakaoOrderRequestMessage({ state: "orderer", ...orderer }) },
    {
      state: "done",
      body: kakaoOrderRequestMessage({ state: "done", kind: "custom", orderNo: "ABC123", isFriend: false }),
    },
    { state: "stale", body: kakaoOrderRequestMessage({ state: "stale", ...summary }) },
    { state: "expired", body: kakaoOrderRequestMessage({ state: "expired", ...summary }) },
    {
      state: "day-full",
      body: kakaoOrderRequestMessage({ state: "day-full", suggestedDays: ["2026-11-29", "2026-11-30", "2026-12-01"] }),
    },
    { state: "permission", body: kakaoOrderRequestMessage({ state: "permission", reason: "card_not_yours" }) },
    { state: "error", body: kakaoOrderRequestMessage({ state: "error", reason: "retry_needed" }) },
  ];
}
export interface OrderRequestResponseCase {
  readonly response: string;
  readonly state: string | null;
  readonly display: "skill" | "kakao-client" | "not-shown";
  readonly body: unknown;
}
export async function orderRequestResponseCases(): Promise<readonly OrderRequestResponseCase[]> {
  const rows: OrderRequestResponseCase[] = [];
  const add = (outcome: string, state: string, body: unknown) =>
    rows.push({ response: `API-071#200:${outcome}`, state, display: "skill", body });
  add("allergy_saved", "orderer", kakaoOrderRequestMessage({ state: "orderer", ...orderer }));
  add(
    "allergy_declined",
    "orderer",
    kakaoOrderRequestMessage({ state: "orderer", afterAllergyDeclined: true, ...orderer }),
  );
  add("orderer_saved", "normal", kakaoOrderRequestMessage({ state: "normal", ...summary }));
  add(
    "order_requested",
    "done",
    kakaoOrderRequestMessage({
      state: "done",
      kind: "standard",
      orderNo: "ABC123",
      isFriend: false,
      payment: ["합성 결제 안내 · 계좌와 결제 기한은 서버가 확인한 값으로 표시해요"],
    }),
  );
  add(
    "declined",
    "done",
    await kakaoConfirmCardReply(responder, {
      outcome: "declined",
      text: "알겠어요. 더 궁금한 것이 있으면 말씀해 주세요",
    }).json(),
  );
  add("input_invalid", "orderer", kakaoOrderRequestMessage({ state: "orderer", invalid: true, ...orderer }));
  add("card_stale", "stale", kakaoOrderRequestMessage({ state: "stale", ...summary }));
  add("card_expired", "expired", kakaoOrderRequestMessage({ state: "expired", ...summary }));
  add("card_not_yours", "permission", await kakaoConfirmCardReply(responder, NOT_YOURS).json());
  add(
    "card_used",
    "done",
    await kakaoConfirmCardReply(responder, {
      outcome: "card_used",
      text: "이미 처리했어요",
      firstResult: { outcome: "order_requested", text: customResult },
    }).json(),
  );
  add("day_full", "day-full", kakaoOrderRequestMessage({ state: "day-full", suggestedDays: ["2026-11-29"] }));
  add("order_limit_reached", "done", kakaoOrderRequestMessage({ state: "done", kind: "order-limit" }));
  add("retry_needed", "error", await kakaoConfirmCardReply(responder, RETRY_NEEDED).json());
  add("not_allowed_now", "stale", kakaoOrderRequestMessage({ state: "stale", currentStatus: "제작 중" }));
  add(
    "not_accepting",
    "permission",
    await kakaoReply(responder, "not_accepting", { contactPhone: "02-000-0000" }).json(),
  );
  add("server_error", "error", await kakaoReply(responder, "server_error").json());
  for (const outcome of [
    "payment_claimed",
    "amount_confirmed",
    "amount_declined",
    "change_requested",
    "order_cancelled",
    "issue_reported",
    "photo_consent_saved",
    "consent_withdrawn",
    "block_verified",
    "channel_linked",
  ])
    rows.push({ response: `API-071#200:${outcome}`, state: null, display: "not-shown", body: null });
  for (const response of ["401:skill_key_invalid", "422:validation_failed", "default:internal"])
    rows.push({ response: `API-071#${response}`, state: "error", display: "kakao-client", body: null });
  return rows;
}
