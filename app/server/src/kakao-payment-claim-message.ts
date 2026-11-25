/** SCR006 표시 전용. 입금 확인 요청·자리·사장님 알림 저장은 업무 처리기가 담당한다. */
import { kakaoChannelIdentifierError } from "./kakao-channel-input";
import type { KakaoMessageOutput } from "./kakao-message-content";
import { toShopLocal } from "./time";
export interface KakaoPaymentClaimView {
  readonly state: "normal";
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

interface ClaimMessage {
  readonly version: "2.0";
  readonly template: { readonly outputs: readonly KakaoMessageOutput[] };
}
export function kakaoPaymentClaimMessage(view: KakaoPaymentClaimView): ClaimMessage {
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
  const description = `주문번호 ${view.orderNo}\n금액 ${view.amount.toLocaleString("ko-KR")}원\n결제 기한 ${due.date} ${due.time}\n입금자 ${view.depositorName}(주문자 이름)\n${expires.time}까지 눌러 주세요`;
  if ([...title, ...description].length > 400) throw new RangeError("claim card too long");
  const button = (label: string, blockId: string, choice: "confirm" | "decline") => ({
    label,
    action: "block" as const,
    blockId,
    extra: { cardKey: view.cardKey, choice },
  });
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
