/** 카카오 발신 내용. 확인 카드는 서버가 저장한 표시 값만 받습니다. */
import type { ConfirmCardView } from "./confirm-card-store";
import {
  type KakaoCustomerNoticeButton,
  type KakaoCustomerNoticeDisplayView,
  type KakaoCustomerNoticePhotoOutput,
  type KakaoCustomerNoticeTextCarouselOutput,
  kakaoCustomerNoticeMessage,
} from "./kakao-customer-notice-message";
import { type KakaoMyOrderDisplayView, type KakaoMyOrderOutput, kakaoMyOrderMessage } from "./kakao-my-order-message";
import { kakaoOrderRequestContents } from "./kakao-order-request-content";
import { kakaoPaymentClaimMessage } from "./kakao-payment-claim-message";
import { type KakaoPaymentButton, type KakaoPaymentView, kakaoPaymentMessage } from "./kakao-payment-message";

/** 표시 직전에 만든 결제 자료. 메시지 본문이나 확인 카드 payload에 저장하지 않는다. */
export interface KakaoPaymentContent {
  readonly kind: "payment_notice";
  readonly view: KakaoPaymentView;
  readonly part?: number;
}
/** 본인 확인/환불 계산을 마친 서버 표시 값만 공통 전송에 넘긴다. 저장 메시지에는 쓰지 않는다. */
export interface KakaoMyOrderContent {
  readonly kind: "my_order";
  readonly view: KakaoMyOrderDisplayView;
  readonly part?: number;
}
/** 서버가 준비한 손님 안내. 사진과 동의 카드는 같은 세 출력 안에서 전한다. */
export interface KakaoCustomerNoticeContent {
  readonly kind: "customer_notice";
  readonly view: KakaoCustomerNoticeDisplayView;
  readonly part?: number;
}
export type KakaoMessageContent =
  | string
  | ConfirmCardView
  | KakaoPaymentContent
  | KakaoMyOrderContent
  | KakaoCustomerNoticeContent;
type MyOrderButton = Extract<KakaoMyOrderOutput, { readonly textCard: unknown }>["textCard"]["buttons"][number];
export type KakaoMessageOutput =
  | { readonly simpleText: { readonly text: string } }
  | {
      readonly textCard: {
        readonly title: string;
        readonly description: string;
        readonly buttons: readonly (KakaoPaymentButton | MyOrderButton | KakaoCustomerNoticeButton)[];
      };
    }
  | KakaoCustomerNoticePhotoOutput
  | KakaoCustomerNoticeTextCarouselOutput;
export interface KakaoQuickReply {
  readonly label: string;
  readonly action: "message";
  readonly messageText: string;
}
interface PresentationBody {
  readonly template: {
    readonly outputs: readonly KakaoMessageOutput[];
    readonly quickReplies?: readonly KakaoQuickReply[];
  };
}
/** 호출자의 우선순서를 보존하고 중복/열 개 한도를 한 곳에서 처리한다. */
export function limitKakaoQuickReplies(replies: readonly KakaoQuickReply[]): readonly KakaoQuickReply[] {
  return [...new Map(replies.map((reply) => [reply.messageText, reply])).values()].slice(0, 10);
}
type Presentation = KakaoPaymentContent | KakaoMyOrderContent | KakaoCustomerNoticeContent;
function isPresentation(content: KakaoMessageContent): content is Presentation {
  return (
    typeof content !== "string" &&
    (content.kind === "payment_notice" || content.kind === "my_order" || content.kind === "customer_notice")
  );
}
function presentationBody(content: Presentation): PresentationBody {
  if (content.kind === "payment_notice") return kakaoPaymentMessage(content.view);
  if (content.kind === "customer_notice") return kakaoCustomerNoticeMessage(content.view);
  if (!["normal", "stale", "empty"].includes(content.view.state))
    throw new RangeError("invalid my order content state");
  const body = kakaoMyOrderMessage(content.view);
  if (body.template === undefined) throw new RangeError("missing my order template");
  return { template: body.template };
}
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && [...value].length >= 1 && [...value].length <= max && !value.includes("\0");

export function expandKakaoMessageContents(contents: readonly KakaoMessageContent[]): KakaoMessageContent[] {
  return contents.flatMap<KakaoMessageContent>((content) => {
    if (isPresentation(content)) {
      const body = presentationBody(content);
      if (content.part === undefined) return body.template.outputs.map((_, part) => ({ ...content, part }));
      if (!Number.isSafeInteger(content.part) || content.part < 0 || content.part >= body.template.outputs.length)
        throw new RangeError("invalid presentation output part");
      return [content];
    }
    if (typeof content !== "string" && content.amountConfirmation !== undefined)
      return expandKakaoMessageContents([{ kind: "payment_notice", view: content.amountConfirmation }]);
    if (typeof content === "string" || content.kind !== "order_request") return [content];
    if (content.orderRequest === undefined) throw new RangeError("order card policy missing");
    return kakaoOrderRequestContents({ card: content, ...content.orderRequest });
  });
}
/** 같은 금액 카드의 같은 출력만 합친다. 다른 카드·글·여러 부분의 원문은 그대로 남긴다. */
export function mergeKakaoAmountConfirmations(
  previous: readonly KakaoMessageContent[],
  current: readonly KakaoMessageContent[],
): KakaoMessageContent[] {
  const seen = new Set<string>();
  return expandKakaoMessageContents([...previous, ...current]).filter((content) => {
    if (typeof content === "string" || content.kind !== "payment_notice" || content.view.state !== "amount-confirm")
      return true;
    const part = content.part ?? 0;
    const output = kakaoPaymentMessage(content.view).template.outputs[part];
    if (output === undefined) throw new RangeError("missing amount confirmation output");
    const identity = JSON.stringify([content.view.cardKey, part, output]);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}
export function kakaoMessageOutputs(contents: readonly KakaoMessageContent[]): KakaoMessageOutput[] {
  const expanded = expandKakaoMessageContents(contents);
  if (expanded.length > 3) throw new RangeError("too many Kakao outputs");
  return expanded.map((content) => {
    if (typeof content === "string") {
      if (!text(content, 1000)) throw new RangeError("invalid Kakao text");
      return { simpleText: { text: content } };
    }
    if (isPresentation(content)) {
      const output = presentationBody(content).template.outputs[content.part ?? 0];
      if (output === undefined) throw new RangeError("missing presentation output part");
      return output;
    }
    if (content.kind === "payment_claim" && content.paymentClaim !== undefined) {
      const output = kakaoPaymentClaimMessage({ state: "normal", ...content.paymentClaim }).template.outputs[0];
      if (output === undefined) throw new RangeError("missing payment claim output");
      return output;
    }
    if (
      !content ||
      !text(content.title, 50) ||
      !text(content.description, 400) ||
      [...content.title].length + [...content.description].length > 400 ||
      !text(content.confirmLabel, 14) ||
      !text(content.blockId, 200) ||
      !/^[A-Za-z0-9_-]{16,64}$/.test(content.cardKey)
    )
      throw new RangeError("invalid server Kakao card");
    return {
      textCard: {
        title: content.title,
        description: content.description,
        buttons: [
          {
            label: content.confirmLabel,
            action: "block",
            blockId: content.blockId,
            extra: { cardKey: content.cardKey, choice: "confirm" },
          },
          {
            label: "안 할래요",
            action: "block",
            blockId: content.blockId,
            extra: { cardKey: content.cardKey, choice: "decline" },
          },
        ],
      },
    };
  });
}

export function kakaoMessageTemplate(contents: readonly KakaoMessageContent[]): PresentationBody["template"] {
  const expanded = expandKakaoMessageContents(contents);
  const outputs = kakaoMessageOutputs(expanded);
  // 결제 행동을 먼저 보존하고 최근 주문 선택을 남은 자리에 넣는다.
  const paymentReplies = expanded.flatMap((content) =>
    typeof content !== "string" && content.kind === "payment_notice"
      ? (presentationBody(content).template.quickReplies ?? [])
      : [],
  );
  const orderReplies = expanded.flatMap((content) =>
    typeof content !== "string" && content.kind === "my_order"
      ? (presentationBody(content).template.quickReplies ?? [])
      : [],
  );
  const quickReplies = limitKakaoQuickReplies([...paymentReplies, ...orderReplies]);
  return { outputs, ...(quickReplies.length ? { quickReplies } : {}) };
}
