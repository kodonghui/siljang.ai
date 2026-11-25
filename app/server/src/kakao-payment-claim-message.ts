/** SCR006 표시 전용. 입금 확인 요청·자리·사장님 알림 저장은 업무 처리기가 담당한다. */
import { kakaoChannelIdentifierError } from "./kakao-channel-input";
import type { KakaoMessageOutput } from "./kakao-message-content";
import { toShopLocal } from "./time";
export interface KakaoPaymentClaimCard {
  readonly orderNo: string;
  readonly amount: number;
  readonly dueAt: string;
  readonly depositorName: string;
  readonly expiresAt: string;
  readonly timeZone: string;
  readonly cardKey: string;
  readonly cardBlockId: string;
  readonly depositorBlockId: string;
}

export type KakaoPaymentClaimView =
  | ({ readonly state: "normal" | "stale" | "expired" } & KakaoPaymentClaimCard)
  | ({ readonly state: "depositor"; readonly invalid?: boolean } & Pick<
      KakaoPaymentClaimCard,
      "cardKey" | "depositorBlockId"
    >)
  | { readonly state: "done"; readonly kind: "claimed" | "declined" }
  | { readonly state: "done"; readonly kind: "used"; readonly firstOutcome: "payment_claimed" | "declined" }
  | { readonly state: "stale"; readonly currentStatus: string }
  | { readonly state: "permission"; readonly reason: "card_not_yours" }
  | { readonly state: "permission"; readonly reason: "not_accepting"; readonly contactPhone: string }
  | { readonly state: "error"; readonly reason: "retry_needed" | "server_error" };

interface ClaimMessage {
  readonly version: "2.0";
  readonly template: { readonly outputs: readonly KakaoMessageOutput[] };
}
export function kakaoPaymentClaimMessage(view: KakaoPaymentClaimView): ClaimMessage {
  switch (view.state) {
    case "normal":
    case "expired":
      return claimCardMessage(view, view.state === "expired" ? "시간이 지나 새 카드를 보내 드려요" : undefined);
    case "stale":
      return "currentStatus" in view
        ? textMessage(`지금은 할 수 없어요: ${checkedText(view.currentStatus, 100)}`)
        : claimCardMessage(view, "내용이 바뀌었어요. 새 카드를 확인해 주세요");
    case "depositor": {
      const description = view.invalid ? "입금자 이름은 1~30자로 넣어 주세요" : "입금자 이름을 1~30자로 알려 주세요";
      return {
        version: "2.0",
        template: {
          outputs: [
            {
              textCard: {
                title: "입금자 이름",
                description,
                buttons: [claimButton(view.cardKey, "입금자 이름 넣기", view.depositorBlockId, "confirm")],
              },
            },
          ],
        },
      };
    }
    case "done": {
      const result =
        view.kind === "used" ? view.firstOutcome : view.kind === "claimed" ? "payment_claimed" : "declined";
      if (result !== "payment_claimed" && result !== "declined") throw new RangeError("invalid first claim result");
      return textMessage(
        result === "payment_claimed"
          ? "사장님께 알렸어요. 확인되면 알려 드릴게요"
          : "알겠어요. 더 궁금한 것이 있으면 말씀해 주세요",
      );
    }
    case "permission": {
      if (view.reason === "card_not_yours") return textMessage("이 버튼은 카드를 받은 분만 누를 수 있어요");
      if (!/^[0-9-]{8,14}$/.test(view.contactPhone)) throw new RangeError("invalid claim contact");
      return textMessage(`아직 상담을 받지 않아요. 가게로 연락해 주세요: ${view.contactPhone}`);
    }
    case "error":
      return textMessage(view.reason === "retry_needed" ? "다시 눌러 주세요" : "잠시 뒤 다시 말씀해 주세요");
    default:
      throw new RangeError("invalid claim state");
  }
}
function checkedText(value: string, max: number) {
  if (typeof value !== "string" || !value.trim() || [...value].length > max || value.includes("\0"))
    throw new RangeError("invalid claim text");
  return value;
}
function textMessage(text: string): ClaimMessage {
  return { version: "2.0", template: { outputs: [{ simpleText: { text } }] } };
}
function claimButton(cardKey: string, label: string, blockId: string, choice: "confirm" | "decline") {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(cardKey) || kakaoChannelIdentifierError(blockId, 100) !== null)
    throw new RangeError("invalid claim action");
  return { label, action: "block" as const, blockId, extra: { cardKey, choice } };
}
function claimCardMessage(view: KakaoPaymentClaimCard, notice?: string): ClaimMessage {
  if (
    !/^[A-Z0-9]{6,8}$/.test(view.orderNo) ||
    !Number.isSafeInteger(view.amount) ||
    view.amount < 1 ||
    view.amount > 10000000 ||
    !/^[A-Za-z0-9_-]{16,64}$/.test(view.cardKey)
  )
    throw new RangeError("invalid claim presentation");
  if (
    kakaoChannelIdentifierError(view.cardBlockId, 100) !== null ||
    kakaoChannelIdentifierError(view.depositorBlockId, 100) !== null
  )
    throw new RangeError("invalid claim action");
  if (
    typeof view.depositorName !== "string" ||
    !view.depositorName.trim() ||
    [...view.depositorName].length > 30 ||
    view.depositorName.includes("\0")
  )
    throw new RangeError("invalid claim name");
  if (!Number.isFinite(Date.parse(view.dueAt)) || !Number.isFinite(Date.parse(view.expiresAt)))
    throw new RangeError("invalid claim date");
  const due = toShopLocal(new Date(view.dueAt), view.timeZone),
    expires = toShopLocal(new Date(view.expiresAt), view.timeZone);
  const title = "결제 확인 요청";
  const description = `${notice ? `${notice}\n` : ""}주문번호 ${view.orderNo}\n금액 ${view.amount.toLocaleString("ko-KR")}원\n결제 기한 ${due.date} ${due.time}\n입금자 ${view.depositorName}(주문자 이름)\n${expires.time}까지 눌러 주세요`;
  if ([...title, ...description].length > 400) throw new RangeError("claim card too long");
  const button = (label: string, blockId: string, choice: "confirm" | "decline") =>
    claimButton(view.cardKey, label, blockId, choice);
  return {
    version: "2.0",
    template: {
      outputs: [
        {
          textCard: {
            title,
            description,
            buttons: [
              button("결제 확인 요청", view.cardBlockId, "confirm"),
              button("입금자 이름이 달라요", view.depositorBlockId, "confirm"),
              button("안 할래요", view.cardBlockId, "decline"),
            ],
          },
        },
      ],
    },
  };
}
