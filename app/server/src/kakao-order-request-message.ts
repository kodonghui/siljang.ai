/** SCR004 표시 전용. 동의·주문자 정보 저장과 주문/자리 확보는 서버 업무 처리기가 담당한다. */
import { type ConfirmCardAnswer, type ConfirmCardView, NOT_YOURS, RETRY_NEEDED } from "./confirm-card-store";
import { kakaoChannelIdentifierError } from "./kakao-channel-input";
import {
  type KakaoMessageContent,
  type KakaoMessageOutput,
  kakaoMessageOutputs,
  kakaoMessageTemplate,
} from "./kakao-message-content";

import { type KakaoOrderPolicy, kakaoOrderRequestContents } from "./kakao-order-request-content";
import { kakaoPaymentClaimMessage } from "./kakao-payment-claim-message";

export type { KakaoOrderPolicy } from "./kakao-order-request-content";
export { kakaoOrderTerms } from "./kakao-order-request-content";

interface Summary {
  readonly policy: KakaoOrderPolicy;
  readonly card: ConfirmCardView;
  readonly isFriend: boolean;
  readonly afterAllergyDeclined?: boolean;
}
interface InputCard {
  readonly cardKey: string;
  readonly answerBlockId: string;
  readonly cardBlockId: string;
}
export type KakaoOrderRequestView =
  | ({ readonly state: "normal" | "stale" | "expired" } & Summary)
  | { readonly state: "stale"; readonly currentStatus: string }
  | ({ readonly state: "allergy"; readonly mode: "consent" | "answer" | "invalid" } & InputCard)
  | {
      readonly state: "orderer";
      readonly invalid?: boolean;
      readonly afterAllergyDeclined?: boolean;
      readonly cardKey: string;
      readonly blockId: string;
    }
  | { readonly state: "day-full"; readonly suggestedDays: readonly string[] }
  | { readonly state: "permission"; readonly reason: "card_not_yours" }
  | { readonly state: "permission"; readonly reason: "not_accepting"; readonly contactPhone: string }
  | { readonly state: "error"; readonly reason: "retry_needed" | "server_error" }
  | { readonly state: "done"; readonly kind: "declined" }
  | { readonly state: "done"; readonly kind: "order-limit" }
  | { readonly state: "done"; readonly kind: "custom"; readonly orderNo: string; readonly isFriend: boolean }
  | {
      readonly state: "done";
      readonly kind: "standard";
      readonly orderNo: string;
      readonly isFriend: boolean;
      readonly payment: readonly KakaoMessageContent[];
    }
  | { readonly state: "done"; readonly kind: "used"; readonly firstResult: ConfirmCardAnswer };

const ALLERGY_ANSWER = "알레르기가 있는 재료를 200자까지 알려 주세요(없으면 없음)";
const ALLERGY_DECLINED = "알겠어요. 알레르기는 묻지 않고 빼야 할 재료만으로 주문을 이어갈게요";
const ALLERGY_CONSENT =
  "쓰는 목적: 이 주문의 케이크 만들기\n받는 항목: 알레르기가 있는 재료\n보는 사람: 이 가게 사장님\n지우는 때: 주문이 끝나고 30일 뒤\n동의하지 않아도 돼요. 그러면 알레르기는 묻지 않고 빼야 할 재료만으로 주문해요";
const length = (value: string) => [...value].length;
interface OrderMessage {
  readonly version: "2.0";
  readonly template: {
    readonly outputs: readonly KakaoMessageOutput[];
    readonly quickReplies?: readonly {
      readonly label: string;
      readonly action: "message";
      readonly messageText: string;
    }[];
  };
}
function validText(value: string, max = 1000) {
  if (typeof value !== "string" || length(value) < 1 || length(value) > max || value.includes("\0"))
    throw new RangeError("invalid order presentation text");
  return value;
}
function template(contents: readonly KakaoMessageContent[]) {
  return { version: "2.0" as const, template: kakaoMessageTemplate(contents) };
}
function inputButton(label: string, blockId: string, cardKey: string, choice: "confirm" | "decline") {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(cardKey) || kakaoChannelIdentifierError(blockId, 100) !== null)
    throw new RangeError("invalid order input action");
  return { label: validText(label, 14), action: "block" as const, blockId, extra: { cardKey, choice } };
}
function inputCard(
  title: string,
  description: string,
  buttons: Extract<KakaoMessageOutput, { textCard: unknown }>["textCard"]["buttons"],
) {
  validText(title, 50);
  validText(description, 400);
  if (length(title) + length(description) > 400 || buttons.length > 3) throw new RangeError("invalid order input card");
  return { version: "2.0" as const, template: { outputs: [{ textCard: { title, description, buttons } }] } };
}
export function kakaoConfirmAnswerMessage(answer: ConfirmCardAnswer) {
  if (answer.card?.amountConfirmation !== undefined) return template([answer.card]);
  if (answer.kind === "payment_claim") {
    if (answer.outcome === "input_invalid" && answer.depositorInput !== undefined)
      return kakaoPaymentClaimMessage({ state: "depositor", invalid: true, ...answer.depositorInput });
    if (answer.outcome === "payment_claimed") return kakaoPaymentClaimMessage({ state: "done", kind: "claimed" });
    if (answer.outcome === "declined") return kakaoPaymentClaimMessage({ state: "done", kind: "declined" });
    if (answer.outcome === "card_used" && answer.firstResult?.outcome === "payment_claimed")
      return kakaoPaymentClaimMessage({ state: "done", kind: "used", firstOutcome: "payment_claimed" });
  }
  if (answer.card?.kind === "payment_claim" && answer.card.paymentClaim !== undefined) {
    return kakaoPaymentClaimMessage({
      state: answer.outcome === "card_expired" ? "expired" : answer.outcome === "card_stale" ? "stale" : "normal",
      ...answer.card.paymentClaim,
    });
  }
  if (answer.card?.kind === "order_request") {
    if (!answer.card.orderRequest || answer.firstResult) throw new RangeError("order card policy missing");
    return kakaoOrderRequestMessage({
      state: answer.outcome === "card_expired" ? "expired" : answer.outcome === "card_stale" ? "stale" : "normal",
      card: answer.card,
      ...answer.card.orderRequest,
    });
  }
  return template([
    answer.text,
    ...(answer.firstResult === undefined ? [] : [answer.firstResult.text]),
    ...(answer.card === undefined ? [] : [answer.card]),
  ]);
}
export function kakaoOrderRequestMessage(view: KakaoOrderRequestView): OrderMessage {
  switch (view.state) {
    case "normal":
    case "stale":
    case "expired": {
      if ("currentStatus" in view) return template([`지금은 할 수 없어요: ${validText(view.currentStatus, 100)}`]);
      return template(kakaoOrderRequestContents(view));
    }
    case "allergy":
      return inputCard(
        "알레르기 정보",
        view.mode === "consent" ? ALLERGY_CONSENT : ALLERGY_ANSWER,
        view.mode === "consent"
          ? [
              inputButton("동의하고 알려 주기", view.answerBlockId, view.cardKey, "confirm"),
              inputButton("동의 안 함", view.cardBlockId, view.cardKey, "decline"),
            ]
          : [inputButton("알레르기 알려 주기", view.answerBlockId, view.cardKey, "confirm")],
      );
    case "orderer": {
      const body = inputCard(
        "주문자 정보",
        view.invalid ? "이름은 1~30자, 연락처는 숫자와 '-'로 8~14자로 넣어 주세요" : "픽업과 급한 연락에 써요",
        [inputButton("이름·연락처 넣기", view.blockId, view.cardKey, "confirm")],
      );
      return view.afterAllergyDeclined
        ? { ...body, template: { outputs: [...kakaoMessageOutputs([ALLERGY_DECLINED]), ...body.template.outputs] } }
        : body;
    }
    case "day-full": {
      const days = view.suggestedDays;
      if (days.length > 3 || new Set(days).size !== days.length) throw new RangeError("invalid nearby days");
      const quickReplies = days.map((day) => {
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
          !Number.isFinite(Date.parse(`${day}T00:00:00Z`)) ||
          new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day
        )
          throw new RangeError("invalid nearby day");
        return {
          label: `${Number(day.slice(5, 7))}월 ${Number(day.slice(8))}일`,
          action: "message" as const,
          messageText: day,
        };
      });
      const body = template([
        days.length
          ? "그 사이 그날이 다 찼어요. 이날은 어떠세요?"
          : "가까운 날에 자리가 없어요. 사장님께 확인을 요청할 수 있어요",
      ]);
      return { ...body, template: { ...body.template, quickReplies } };
    }
    case "permission":
      return template([
        view.reason === "card_not_yours"
          ? NOT_YOURS.text
          : `아직 상담을 받지 않아요. 가게로 연락해 주세요: ${validText(view.contactPhone, 40)}`,
      ]);
    case "error":
      return template([view.reason === "retry_needed" ? RETRY_NEEDED.text : "잠시 뒤 다시 말씀해 주세요"]);
    case "done": {
      if (view.kind === "declined") return template(["알겠어요. 더 궁금한 것이 있으면 말씀해 주세요"]);
      if (view.kind === "order-limit") return template(["사장님이 확인한 뒤 알려 드릴게요"]);
      if (view.kind === "used") return kakaoConfirmAnswerMessage(view.firstResult);
      if (!/^[0-9A-Z]{6,8}$/.test(view.orderNo)) throw new RangeError("invalid display order number");
      const result = `주문을 요청했어요(주문번호 ${view.orderNo}). ${view.kind === "standard" ? "결제가 확인되면 확정돼요" : "사장님이 보고 알려 드릴게요"}${view.isFriend ? "" : ". 채널을 추가하시면 답을 바로 받아 보실 수 있어요"}`;
      if (view.kind === "standard" && view.payment.length === 0) throw new RangeError("payment presentation missing");
      return template([result, ...(view.kind === "standard" ? view.payment : [])]);
    }
  }
}
