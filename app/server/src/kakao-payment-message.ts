/** SCR-005 표시 함수. 결제 처리와 전달 시각의 저장은 업무 처리기가 맡습니다. */
import { isAccountNumber } from "./account-number";
import { kakaoChannelIdentifierError } from "./kakao-channel-input";
import { CARD_PAYMENT_URL_MAX_LENGTH } from "./payment-destination-input";
import { toShopLocal } from "./time";

interface PaymentQuote {
  readonly amount: number;
  readonly amountMax: number | null;
  readonly displayKind: "fixed" | "from" | "range";
}
interface AmountCard {
  readonly cardKey: string;
  readonly blockId: string;
  readonly expiresAt: string;
  readonly timeZone: string;
  readonly refresh?: "expired" | "stale";
}
export type KakaoPaymentAmountView = AmountCard &
  (
    | {
        readonly state: "amount-confirm";
        readonly kind: "custom";
        readonly requestedQuote: PaymentQuote;
        readonly amount: number;
        readonly reason: string;
      }
    | {
        readonly state: "amount-confirm";
        readonly kind: "difference";
        readonly changes: string;
        readonly currentAmount: number;
        readonly newAmount: number;
        readonly difference: number;
        readonly changeDeadline: string;
      }
  );

export interface KakaoPaymentNormalView {
  readonly state: "normal";
  readonly kind: "first" | "reissue" | "difference";
  readonly orderNo: string;
  readonly amount: number;
  readonly account: { readonly bankName: string; readonly number: string; readonly holderName: string };
  readonly dueAt: string;
  readonly timeZone: string;
  readonly cardPaymentUrl?: string;
  /** 실제 전달을 아직 관측하지 않은 안내 읽기는 상대 시간과 상한을 보인다. */
  readonly deliveryWindow?: { readonly hours: number };
  readonly amountConfirmed?: boolean;
  readonly adjustment?: { readonly requestedQuote: PaymentQuote; readonly reason: string };
}

export type KakaoPaymentView =
  | KakaoPaymentNormalView
  | KakaoPaymentAmountView
  | { readonly state: "deferred"; readonly notice: KakaoPaymentNormalView | KakaoPaymentAmountView }
  | { readonly state: "done"; readonly kind: "custom" | "difference" }
  | { readonly state: "stale"; readonly reason: "notice_gone" | "deadline" }
  | { readonly state: "stale"; readonly reason: "card_stale"; readonly replacement: KakaoPaymentAmountView }
  | { readonly state: "stale"; readonly reason: "not_allowed_now"; readonly currentStatus: string }
  | { readonly state: "permission"; readonly reason: "card_not_yours" }
  | { readonly state: "permission"; readonly reason: "not_accepting"; readonly contactPhone: string }
  | { readonly state: "error"; readonly reason: "retry_needed" | "server_error" };

export type KakaoPaymentButton =
  | { readonly label: string; readonly action: "webLink"; readonly webLinkUrl: string }
  | {
      readonly label: string;
      readonly action: "block";
      readonly blockId: string;
      readonly extra: { readonly cardKey: string; readonly choice: "confirm" | "decline" };
    };
export type KakaoPaymentOutput =
  | { readonly simpleText: { readonly text: string } }
  | {
      readonly textCard: {
        readonly title: string;
        readonly description: string;
        readonly buttons: readonly KakaoPaymentButton[];
      };
    };
export interface KakaoPaymentMessage {
  readonly version: "2.0";
  readonly template: {
    readonly outputs: readonly KakaoPaymentOutput[];
    readonly quickReplies?: readonly {
      readonly label: string;
      readonly action: "message";
      readonly messageText: string;
    }[];
  };
}
const checkedText = (value: string, max: number) => {
  if (typeof value !== "string" || !value.trim() || [...value].length > max || value.includes("\0"))
    throw new RangeError("invalid payment presentation text");
  return value;
};
function money(amount: number, minimum = 1) {
  if (!Number.isSafeInteger(amount) || amount < minimum || amount > 10000000)
    throw new RangeError("invalid payment amount");
  return amount.toLocaleString("ko-KR");
}
function quoteDisplay(quote: PaymentQuote) {
  const amount = money(quote.amount, 0);
  if (quote.displayKind === "range") {
    if (quote.amountMax === null || quote.amountMax < quote.amount) throw new RangeError("invalid payment quote");
    return `${amount}~${money(quote.amountMax, 0)}원`;
  }
  if (quote.displayKind !== "from" && quote.displayKind !== "fixed") throw new RangeError("invalid payment quote");
  return `${amount}원${quote.displayKind === "from" ? "부터" : ""}`;
}
function localDate(value: string, timeZone: string) {
  if (!Number.isFinite(Date.parse(value))) throw new RangeError("invalid payment date");
  return toShopLocal(new Date(value), timeZone);
}
export function kakaoPaymentMessage(view: KakaoPaymentView): KakaoPaymentMessage {
  if (view.state === "normal") return paymentNormalMessage(view);
  if (view.state === "amount-confirm") return paymentAmountMessage(view);
  // 다음 대화에 실제로 넣는 시점의 표시 값만 받는다. 발신 대기 중에는 호출하지 않는다.
  if (view.state === "deferred") return kakaoPaymentMessage(view.notice);
  let text: string;
  switch (view.state) {
    case "done":
      text = view.kind === "custom" ? "알겠어요. 주문을 취소했어요" : "알겠어요. 바꾸지 않고 원래 주문대로 할게요";
      break;
    case "stale":
      if (view.reason === "card_stale") return paymentAmountMessage({ ...view.replacement, refresh: "stale" });
      text =
        view.reason === "not_allowed_now"
          ? `지금은 할 수 없어요: ${checkedText(view.currentStatus, 100)}`
          : view.reason === "notice_gone"
            ? "지금은 전할 안내가 없어요"
            : "결제 기한이 지나 사장님이 확인하고 있어요";
      break;
    case "permission":
      if (view.reason === "card_not_yours") text = "이 버튼은 카드를 받은 분만 누를 수 있어요";
      else {
        if (!/^[0-9-]{8,14}$/.test(view.contactPhone)) throw new RangeError("invalid payment contact display");
        text = `아직 상담을 받지 않아요. 가게로 연락해 주세요: ${view.contactPhone}`;
      }
      break;
    case "error":
      text = view.reason === "retry_needed" ? "다시 눌러 주세요" : "잠시 뒤 다시 말씀해 주세요";
      break;
    default:
      throw new RangeError("invalid payment state");
  }
  return { version: "2.0" as const, template: { outputs: [{ simpleText: { text } }] } };
}

function paymentNormalMessage(view: KakaoPaymentNormalView): KakaoPaymentMessage {
  if (
    !/^[A-Z0-9]{6,8}$/.test(view.orderNo) ||
    !Number.isSafeInteger(view.amount) ||
    view.amount < 1 ||
    view.amount > 10000000 ||
    !isAccountNumber(view.account.number)
  )
    throw new RangeError("invalid payment display");
  for (const value of [view.account.bankName, view.account.holderName])
    if (typeof value !== "string" || !value.trim() || [...value].length > 100 || value.includes("\0"))
      throw new RangeError("invalid payment account display");
  // 저장 원문은 보존한다. API025가 허용하는 줄바꿈은 안내의 한 행에서 공백으로 표시한다.
  const bankName = view.account.bankName.replace(/[\r\n\u0085\u2028\u2029]+/gu, " ");
  const holderName = view.account.holderName.replace(/[\r\n\u0085\u2028\u2029]+/gu, " ");
  const due = localDate(view.dueAt, view.timeZone);
  const title =
    view.kind === "reissue" ? "결제 기한을 연장했어요" : view.kind === "difference" ? "변경 차액" : "결제 안내";
  const adjustment =
    view.adjustment === undefined
      ? ""
      : `\n요청하신 견적 ${quoteDisplay(view.adjustment.requestedQuote)} → ${money(view.amount)}원\n사유: ${checkedText(view.adjustment.reason, 200)}`;
  if (view.deliveryWindow && (!Number.isSafeInteger(view.deliveryWindow.hours) || view.deliveryWindow.hours < 1))
    throw new RangeError("invalid payment delivery window");
  const deadline = view.deliveryWindow
    ? `이 안내가 전달된 때부터 ${view.deliveryWindow.hours}시간 안(상한 ${due.date} ${due.time})`
    : `${due.date} ${due.time}까지 보내 주세요`;
  const text = checkedText(
    `${view.amountConfirmed ? "새 금액을 확인했어요\n" : ""}${title} · 주문번호 ${view.orderNo}${adjustment}\n결제할 금액 ${money(view.amount)}원\n은행 ${bankName}\n계좌번호 ${view.account.number}\n예금주 ${holderName}\n${deadline}`,
    1000,
  );
  let url: URL | null = null;
  if (view.cardPaymentUrl !== undefined) {
    try {
      const candidate = new URL(view.cardPaymentUrl);
      if (
        candidate.protocol === "https:" &&
        !candidate.username &&
        !candidate.password &&
        candidate.href.length <= CARD_PAYMENT_URL_MAX_LENGTH
      )
        url = candidate;
    } catch {
      // 기존 잘못된 링크가 계좌 안내 전체를 막지 않게 한다.
    }
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

function paymentAmountMessage(view: KakaoPaymentAmountView): KakaoPaymentMessage {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(view.cardKey) || kakaoChannelIdentifierError(view.blockId, 100) !== null)
    throw new RangeError("invalid payment card action");
  const expires = localDate(view.expiresAt, view.timeZone);
  const refresh =
    view.refresh === "expired"
      ? "시간이 지나 새 카드를 보내 드려요\n"
      : view.refresh === "stale"
        ? "내용이 바뀌었어요. 새 카드를 확인해 주세요\n"
        : "";
  let details: string;
  if (view.kind === "custom")
    details = `요청하신 견적 ${quoteDisplay(view.requestedQuote)}\n사장님이 정한 금액 ${money(view.amount)}원\n사유: ${checkedText(view.reason, 200)}`;
  else {
    money(view.currentAmount, 0);
    money(view.newAmount);
    if (view.newAmount - view.currentAmount !== view.difference) throw new RangeError("invalid payment difference");
    const deadline = localDate(view.changeDeadline, view.timeZone);
    details = `${checkedText(view.changes, 2000)}\n지금 ${money(view.currentAmount, 0)}원 → 새 금액 ${money(view.newAmount)}원\n차액 ${money(view.difference)}원\n변경 마감 ${Number(deadline.date.slice(5, 7))}월 ${Number(deadline.date.slice(8))}일 ${deadline.time}까지`;
  }
  const title = "새 금액 확인";
  const description = `${refresh}${details}\n${expires.time}까지 눌러 주세요`;
  const before: KakaoPaymentOutput[] = [];
  if ([...title, ...description].length > 400) {
    const chars = [...`${refresh}${details}`];
    for (let at = 0; at < chars.length; at += 1000)
      before.push({ simpleText: { text: chars.slice(at, at + 1000).join("") } });
  }
  const buttons: KakaoPaymentButton[] = [
    {
      label: view.kind === "custom" ? "이 금액으로 할게요" : "바꿀게요",
      action: "block",
      blockId: view.blockId,
      extra: { cardKey: view.cardKey, choice: "confirm" },
    },
    {
      label: view.kind === "custom" ? "안 할래요" : "그대로 둘래요",
      action: "block",
      blockId: view.blockId,
      extra: { cardKey: view.cardKey, choice: "decline" },
    },
  ];
  const outputs: KakaoPaymentOutput[] = [
    ...before,
    { textCard: { title, description: before.length ? `${expires.time}까지 눌러 주세요` : description, buttons } },
  ];
  if (outputs.length > 3) throw new RangeError("too many payment outputs");
  return { version: "2.0", template: { outputs } };
}
