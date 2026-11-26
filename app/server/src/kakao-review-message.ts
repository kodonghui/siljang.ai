/** SCR012: 후기 블록의 질문과 결과 표시. 저장·사진 처리·게시 동의 판단은 수신 처리기가 맡는다. */
import { KAKAO_CONSULTATION_UNAVAILABLE_TEXT } from "./kakao-callback";
import { KAKAO_PHOTO_TEXT } from "./kakao-photo-context";
import { normalizeLineBreaks } from "./line-breaks";

export const KAKAO_REVIEW_TEXT = {
  review_saved: "후기를 남겨 주셔서 고마워요",
  review_not_allowed: "받으신 주문에만 후기를 남길 수 있어요",
  review_invalid: "후기는 1,000자, 사진은 5장까지 남길 수 있어요",
} as const;
export const KAKAO_REVIEW_QUESTIONS = [
  { name: "review_text", required: true, maximumCharacters: 1000 },
  { name: "review_photos", required: false, maximumImages: 5 },
  { name: "photo_consent", required: false, defaultValue: "동의 안 함" },
] as const;
export type KakaoReviewQuestion = (typeof KAKAO_REVIEW_QUESTIONS)[number]["name"];
export type KakaoReviewView =
  | { readonly state: "normal"; readonly question?: KakaoReviewQuestion; readonly orderNo?: string }
  | { readonly state: "done"; readonly firstResultText?: string }
  | { readonly state: "permission"; readonly reason: "review_not_allowed" }
  | { readonly state: "permission"; readonly reason: "not_accepting"; readonly contactPhone?: string }
  | { readonly state: "error"; readonly reason: "review_invalid" | "photo_download_failed" | "server_error" };
export interface KakaoReviewBody {
  readonly version: "2.0";
  readonly template: {
    readonly outputs: readonly { readonly simpleText: { readonly text: string } }[];
    readonly quickReplies?: readonly {
      readonly label: string;
      readonly action: "message";
      readonly messageText: string;
    }[];
  };
}
function text(value: string, maximum = 1000): string {
  if (typeof value !== "string") throw new RangeError("invalid review text");
  const normalized = normalizeLineBreaks(value);
  if (!normalized.trim() || normalized.includes("\0") || [...normalized].length > maximum)
    throw new RangeError("invalid review text");
  return normalized;
}
function body(value: string, quickReplies?: KakaoReviewBody["template"]["quickReplies"]): KakaoReviewBody {
  return {
    version: "2.0",
    template: { outputs: [{ simpleText: { text: text(value) } }], ...(quickReplies ? { quickReplies } : {}) },
  };
}
export function kakaoReviewMessage(view: KakaoReviewView): KakaoReviewBody {
  if (typeof view !== "object" || view === null) throw new RangeError("invalid review view");
  if (view.state === "done") return body(view.firstResultText ?? KAKAO_REVIEW_TEXT.review_saved);
  if (view.state === "permission") {
    if (view.reason === "review_not_allowed") return body(KAKAO_REVIEW_TEXT.review_not_allowed);
    if (view.reason !== "not_accepting") throw new RangeError("invalid review permission");
    return body(
      view.contactPhone === undefined
        ? KAKAO_CONSULTATION_UNAVAILABLE_TEXT
        : `${KAKAO_CONSULTATION_UNAVAILABLE_TEXT}. 가게로 연락해 주세요: ${text(view.contactPhone, 40)}`,
    );
  }
  if (view.state === "error") {
    if (view.reason === "review_invalid") return body(KAKAO_REVIEW_TEXT.review_invalid);
    if (view.reason === "photo_download_failed") return body(KAKAO_PHOTO_TEXT.photo_download_failed);
    if (view.reason === "server_error") return body("잠시 뒤 다시 말씀해 주세요");
    throw new RangeError("invalid review error");
  }
  if (view.state !== "normal") throw new RangeError("invalid review state");
  if (view.orderNo !== undefined && (typeof view.orderNo !== "string" || !/^[0-9A-Z]{6,8}$/.test(view.orderNo)))
    throw new RangeError("invalid review order number");
  const heading = view.orderNo === undefined ? "" : `주문번호 ${view.orderNo}\n`;
  const question = view.question ?? "review_text";
  if (question === "review_text") return body(`${heading}케이크는 어떠셨어요?\n후기는 1~1,000자로 남겨 주세요`);
  if (question === "review_photos") return body(`${heading}사진을 골라 주세요. 사진은 5장까지 남길 수 있어요`);
  if (question !== "photo_consent") throw new RangeError("invalid review question");
  return body(
    `${heading}언제든 철회할 수 있으니, 이 사진을 가게 포트폴리오와 예약 링크 페이지에 올려도 될지 알려 주세요\n답하지 않으면 '동의 안 함'으로 남아요`,
    [
      { label: "동의", action: "message", messageText: "동의" },
      { label: "동의 안 함", action: "message", messageText: "동의 안 함" },
    ],
  );
}
