/** 카카오 발신 내용. 확인 카드는 서버가 저장한 표시 값만 받습니다. */
import type { ConfirmCardView } from "./confirm-card-store";
import {
  type KakaoCustomerNoticeButton,
  type KakaoCustomerNoticeDisplayView,
  type KakaoCustomerNoticePhotoOutput,
  kakaoCustomerNoticeMessage,
} from "./kakao-customer-notice-message";
import { kakaoOrderRequestContents } from "./kakao-order-request-content";
import { kakaoPaymentClaimMessage } from "./kakao-payment-claim-message";
import { type KakaoPaymentButton, type KakaoPaymentView, kakaoPaymentMessage } from "./kakao-payment-message";

/** 표시 직전에 만든 결제 자료. 메시지 본문이나 확인 카드 payload에 저장하지 않는다. */
export interface KakaoPaymentContent {
  readonly kind: "payment_notice";
  readonly view: KakaoPaymentView;
  readonly part?: number;
}
/** 서버가 준비한 손님 안내. 사진과 동의 카드는 같은 세 출력 안에서 전한다. */
export interface KakaoCustomerNoticeContent {
  readonly kind: "customer_notice";
  readonly view: KakaoCustomerNoticeDisplayView;
  readonly part?: number;
}
export type KakaoMessageContent = string | ConfirmCardView | KakaoPaymentContent | KakaoCustomerNoticeContent;
export type KakaoMessageOutput =
  | { readonly simpleText: { readonly text: string } }
  | {
      readonly textCard: {
        readonly title: string;
        readonly description: string;
        readonly buttons: readonly (KakaoPaymentButton | KakaoCustomerNoticeButton)[];
      };
    }
  | KakaoCustomerNoticePhotoOutput;
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && [...value].length >= 1 && [...value].length <= max && !value.includes("\0");

export function expandKakaoMessageContents(contents: readonly KakaoMessageContent[]): KakaoMessageContent[] {
  return contents.flatMap<KakaoMessageContent>((content) => {
    if (typeof content !== "string" && content.kind === "customer_notice") {
      const body = kakaoCustomerNoticeMessage(content.view);
      if (content.part === undefined) return body.template.outputs.map((_, part) => ({ ...content, part }));
      if (!Number.isSafeInteger(content.part) || content.part < 0 || content.part >= body.template.outputs.length)
        throw new RangeError("invalid customer notice output part");
      return [content];
    }
    if (typeof content !== "string" && content.kind === "payment_notice") {
      const body = kakaoPaymentMessage(content.view);
      if (content.part === undefined) return body.template.outputs.map((_, part) => ({ ...content, part }));
      if (!Number.isSafeInteger(content.part) || content.part < 0 || content.part >= body.template.outputs.length)
        throw new RangeError("invalid payment output part");
      return [content];
    }
    if (typeof content === "string" || content.kind !== "order_request") return [content];
    if (content.orderRequest === undefined) throw new RangeError("order card policy missing");
    return kakaoOrderRequestContents({ card: content, ...content.orderRequest });
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
    if (content.kind === "payment_notice") {
      const output = kakaoPaymentMessage(content.view).template.outputs[content.part ?? 0];
      if (output === undefined) throw new RangeError("missing payment output part");
      return output;
    }
    if (content.kind === "customer_notice") {
      const output = kakaoCustomerNoticeMessage(content.view).template.outputs[content.part ?? 0];
      if (output === undefined) throw new RangeError("missing customer notice output part");
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

export function kakaoMessageTemplate(contents: readonly KakaoMessageContent[]) {
  const expanded = expandKakaoMessageContents(contents);
  const outputs = kakaoMessageOutputs(expanded);
  const replies = expanded.flatMap((content) =>
    typeof content !== "string" && content.kind === "payment_notice"
      ? (kakaoPaymentMessage(content.view).template.quickReplies ?? [])
      : [],
  );
  const quickReplies = [...new Map(replies.map((reply) => [reply.messageText, reply])).values()];
  return { outputs, ...(quickReplies.length ? { quickReplies } : {}) };
}
