/** SCR003의 응답 표시. 업무 상태·견적·가까운 날은 서버가 확인한 값을 받으며 이 모듈은 DB/AI/HTTP를 호출하지 않는다. */

import { kakaoChannelIdentifierError } from "./kakao-channel-input";
import { type KakaoMessageContent, kakaoMessageOutputs } from "./kakao-message-content";
import type { customerQuote } from "./quotes";
import { toShopLocal } from "./time";

export const KAKAO_CONSULTATION_TEXT = {
  loading: "답을 준비하고 있어요",
  empty: "다시 한번 말씀해 주시겠어요?",
  handoff: "사장님 확인 뒤 답드릴게요.",
  recommendChannel: "채널을 추가하시면 답을 바로 받아 보실 수 있어요",
  fixed: "이 가게 주문 상담만 도와드려요",
  rateLimited: "잠시 뒤 다시 말씀해 주세요",
  notAccepting: "아직 상담을 받지 않아요",
} as const;
const ERROR_TEXT = {
  server_error: "잠시 뒤 다시 말씀해 주세요",
  unsupported_message: "글이나 사진으로 말씀해 주세요",
  photo_rejected: "사진은 한 장 20MB, 한 상담에 10장까지 받을 수 있어요",
  photo_download_failed: "사진을 받지 못했어요. 다시 보내 주세요",
} as const;
export const KAKAO_TRIAL_LABELS = {
  card: "확인 카드",
  orderer_info: "주문자 정보",
  allergy_answer: "알레르기 답",
  depositor_name: "입금자 이름",
  review: "후기",
} as const;
export type KakaoTrialBlock = keyof typeof KAKAO_TRIAL_LABELS;
type TrialView =
  | { readonly state: "link-test"; readonly mode: "notice" | "linked" }
  | {
      readonly state: "link-test";
      readonly mode: "initial" | "verified";
      readonly next: KakaoTrialBlock;
      readonly blockId: string;
      readonly completed?: KakaoTrialBlock;
      readonly verifiedCount?: number;
    };
export type KakaoConsultationView =
  | {
      readonly state: "normal";
      readonly contents: readonly KakaoMessageContent[];
      readonly silent?: boolean;
      readonly suggestedDays?: readonly string[];
    }
  | { readonly state: "stale"; readonly contents: readonly string[] }
  | { readonly state: "fixed-answer"; readonly contents?: readonly string[] }
  | { readonly state: "loading" | "empty" }
  | { readonly state: "error"; readonly reason: keyof typeof ERROR_TEXT }
  | { readonly state: "permission"; readonly contactPhone?: string }
  | { readonly state: "handed-over"; readonly recommendChannel?: boolean }
  | { readonly state: "rate-limited"; readonly silent?: boolean }
  | TrialView;

function template(contents: readonly KakaoMessageContent[]) {
  return { version: "2.0" as const, template: { outputs: kakaoMessageOutputs(contents) } };
}
function dateReplies(days: readonly string[]) {
  if (days.length > 3 || new Set(days).size !== days.length) throw new RangeError("invalid suggested days");
  return days.map((day) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new RangeError("invalid suggested day");
    const date = new Date(`${day}T12:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day)
      throw new RangeError("invalid suggested day");
    return {
      action: "message" as const,
      label: `${Number(day.slice(5, 7))}월 ${Number(day.slice(8, 10))}일`,
      messageText: day,
    };
  });
}

/** 빈 AI 답을 언제 선택할지·두 번째 빈 답의 에스컬레이션은 업무 처리기의 몫이다. */
export function kakaoConsultationMessage(view: KakaoConsultationView) {
  switch (view.state) {
    case "loading":
      return { version: "2.0" as const, useCallback: true as const, data: { text: KAKAO_CONSULTATION_TEXT.loading } };
    case "normal": {
      if (view.silent) {
        if (view.contents.length !== 0 || (view.suggestedDays?.length ?? 0) > 0)
          throw new RangeError("silent response has content");
        return template([]);
      }
      if (view.contents.length === 0) throw new RangeError("answer content missing");
      const body = template(view.contents);
      const quickReplies = dateReplies(view.suggestedDays ?? []);
      return quickReplies.length === 0 ? body : { ...body, template: { ...body.template, quickReplies } };
    }
    case "stale":
      if (view.contents.length === 0) throw new RangeError("renewed content missing");
      return template(view.contents);
    case "fixed-answer":
      if (view.contents !== undefined && view.contents.length === 0) throw new RangeError("fixed content missing");
      return template(view.contents ?? [KAKAO_CONSULTATION_TEXT.fixed]);
    case "empty":
      return template([KAKAO_CONSULTATION_TEXT.empty]);
    case "error": {
      const text = ERROR_TEXT[view.reason];
      if (text === undefined) throw new RangeError("invalid error result");
      return template([text]);
    }
    case "permission": {
      const phone = view.contactPhone;
      if (
        phone !== undefined &&
        (phone.length < 1 || phone.length > 40 || [...phone].some((c) => c.charCodeAt(0) < 32))
      )
        throw new RangeError("invalid shop contact");
      return template([
        phone === undefined
          ? KAKAO_CONSULTATION_TEXT.notAccepting
          : `${KAKAO_CONSULTATION_TEXT.notAccepting}. 가게로 연락해 주세요: ${phone}`,
      ]);
    }
    case "handed-over":
      return template([
        `${KAKAO_CONSULTATION_TEXT.handoff}${view.recommendChannel ? ` ${KAKAO_CONSULTATION_TEXT.recommendChannel}` : ""}`,
      ]);
    case "rate-limited":
      return template(view.silent ? [] : [KAKAO_CONSULTATION_TEXT.rateLimited]);
    case "link-test": {
      if (view.mode === "notice")
        return template(["시험 안내예요. 이 안내가 보이면 손님에게 안내를 먼저 보낼 수 있어요"]);
      if (view.mode === "linked")
        return template(["시험 버튼 다섯이 모두 닿아 연결됐어요. 손님 안내는 다음 대화 때 전해요."]);
      if (view.mode !== "initial" && view.mode !== "verified") throw new RangeError("invalid trial mode");
      const label = Object.hasOwn(KAKAO_TRIAL_LABELS, view.next) ? KAKAO_TRIAL_LABELS[view.next] : undefined;
      if (label === undefined || kakaoChannelIdentifierError(view.blockId, 100) !== null)
        throw new RangeError("invalid trial block");
      const completed =
        view.completed !== undefined && Object.hasOwn(KAKAO_TRIAL_LABELS, view.completed)
          ? KAKAO_TRIAL_LABELS[view.completed]
          : undefined;
      if (
        view.mode === "verified" &&
        (completed === undefined ||
          !Number.isSafeInteger(view.verifiedCount) ||
          (view.verifiedCount ?? 0) < 1 ||
          (view.verifiedCount ?? 0) > 4)
      )
        throw new RangeError("invalid trial progress");
      return {
        version: "2.0" as const,
        template: {
          outputs: [
            {
              textCard: {
                title: "연결 확인",
                description:
                  view.mode === "initial"
                    ? "연결 문구를 받았어요. 시험 버튼 5개를 하나씩 눌러 주세요"
                    : `${completed} 블록이 닿았어요(${view.verifiedCount}/5). 다음 시험 버튼을 눌러 주세요`,
                buttons: [
                  {
                    label: `시험: ${label}`,
                    action: "block" as const,
                    blockId: view.blockId,
                    extra: { check: view.next },
                  },
                ],
              },
            },
          ],
        },
      };
    }
    default:
      throw new RangeError("invalid consultation view");
  }
}

/** 금액을 계산하지 않는다. customerQuote로 좁힌 실제 견적만 손님 문구로 만든다. */
export function kakaoQuoteMessage(
  quote: ReturnType<typeof customerQuote>,
  timeZone: string,
  options: { readonly custom?: boolean; readonly renewed?: boolean } = {},
) {
  if (!Number.isSafeInteger(quote.amount) || quote.amount < 1) throw new RangeError("invalid quote amount");
  let amount = `${quote.amount.toLocaleString("ko-KR")}원`;
  if (quote.displayKind === "range") {
    if (!Number.isSafeInteger(quote.amountMax) || (quote.amountMax ?? 0) < quote.amount)
      throw new RangeError("invalid quote range");
    amount = `${quote.amount.toLocaleString("ko-KR")}~${quote.amountMax?.toLocaleString("ko-KR")}원`;
  } else if ((quote.displayKind !== "fixed" && quote.displayKind !== "from") || quote.amountMax !== null)
    throw new RangeError("invalid quote display");
  else if (quote.displayKind === "from") amount += "부터";
  const until = toShopLocal(new Date(quote.validUntil), timeZone);
  const expires = `${Number(until.date.slice(5, 7))}월 ${Number(until.date.slice(8, 10))}일 ${until.time}`;
  const content = [
    ...(options.renewed ? ["새 견적이에요. 이 금액으로 주문할까요?"] : []),
    `${amount} · ${expires}까지`,
    "견적만으로 그날 자리를 잡아 두지는 않아요",
    ...(options.custom ? ["사장님이 보고 금액을 정해 수락해야 결제 안내가 가요"] : []),
  ].join("\n");
  return options.renewed
    ? kakaoConsultationMessage({ state: "stale", contents: [content] })
    : kakaoConsultationMessage({ state: "normal", contents: [content] });
}
