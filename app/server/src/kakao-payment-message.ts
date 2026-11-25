/** SCR-005 표시 함수. 결제 처리와 전달 시각의 저장은 업무 처리기가 맡습니다. */
import { isAccountNumber } from "./account-number";
import { toShopLocal } from "./time";

export interface KakaoPaymentView {
  readonly state: "normal";
  readonly kind: "first" | "reissue" | "difference";
  readonly orderNo: string;
  readonly amount: number;
  readonly account: { readonly bankName: string; readonly number: string; readonly holderName: string };
  readonly dueAt: string;
  readonly timeZone: string;
  readonly cardPaymentUrl?: string;
}

export function kakaoPaymentMessage(view: KakaoPaymentView) {
  if (
    !/^[A-Z0-9]{6,8}$/.test(view.orderNo) ||
    !Number.isSafeInteger(view.amount) ||
    view.amount < 1 ||
    view.amount > 10000000 ||
    !isAccountNumber(view.account.number)
  )
    throw new RangeError("invalid payment display");
  for (const value of [view.account.bankName, view.account.holderName])
    if (typeof value !== "string" || !value.trim() || [...value].length > 100 || /[\0\r\n]/.test(value))
      throw new RangeError("invalid payment account display");
  const due = toShopLocal(new Date(view.dueAt), view.timeZone);
  const title =
    view.kind === "reissue" ? "결제 기한을 연장했어요" : view.kind === "difference" ? "변경 차액" : "결제 안내";
  const text = `${title} · 주문번호 ${view.orderNo}\n결제할 금액 ${view.amount.toLocaleString("ko-KR")}원\n은행 ${view.account.bankName}\n계좌번호 ${view.account.number}\n예금주 ${view.account.holderName}\n${due.date} ${due.time}까지 보내 주세요`;
  let url: URL | null = null;
  if (view.cardPaymentUrl !== undefined) {
    url = new URL(view.cardPaymentUrl);
    if (url.protocol !== "https:" || url.username || url.password) throw new RangeError("invalid payment link display");
  }
  return {
    version: "2.0" as const,
    template: {
      outputs: [
        { simpleText: { text } },
        ...(url === null
          ? []
          : [
              {
                textCard: {
                  title: "카드 결제",
                  description: "가게의 결제 페이지를 열어요",
                  buttons: [{ label: "카드로 결제", action: "webLink" as const, webLinkUrl: url.href }],
                },
              },
            ]),
      ],
      quickReplies: [{ label: "결제했어요", action: "message" as const, messageText: "결제했어요" }],
    },
  };
}
