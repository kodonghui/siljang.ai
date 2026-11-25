import { FieldCryptoError } from "./field-crypto";
import { kakaoCallback } from "./kakao-callback";
import { kakaoPhotoUrl } from "./kakao-photo-download";
import { isUuid } from "./shop-scope";

export const KAKAO_PHOTO_PURPOSE = "messages.kakao_photo";
export type KakaoPhotoContext =
  | {
      readonly kind: "reference";
      readonly draftId: string;
      readonly urls: readonly string[];
      readonly callbackUrl?: string;
    }
  | {
      readonly kind: "review";
      readonly urls: readonly string[];
      readonly callbackUrl?: string;
      readonly review: { readonly orderId: string; readonly text: string; readonly consent: boolean };
    };

export function kakaoPhotoTrace(messageId: string, kind: "reference" | "review" = "reference"): string {
  if (!isUuid(messageId)) throw new FieldCryptoError("photo context is not valid");
  return `${kind === "review" ? "kakao-review-photo" : "kakao-photo"}:${messageId}`;
}
export function isKakaoPhotoTrace(value: unknown, messageId: string): boolean {
  return value === kakaoPhotoTrace(messageId) || value === kakaoPhotoTrace(messageId, "review");
}

function invalid(): never {
  throw new FieldCryptoError("photo context is not valid");
}
function read(value: unknown, receivedAt: Date): KakaoPhotoContext {
  if (
    typeof value !== "object" ||
    value === null ||
    !("v" in value) ||
    value.v !== 1 ||
    !("kind" in value) ||
    !("urls" in value) ||
    !Array.isArray(value.urls)
  )
    return invalid();
  if (value.kind !== "reference" && value.kind !== "review") return invalid();
  if (value.urls.length < 1 || value.urls.length > (value.kind === "reference" ? 1 : 5)) return invalid();
  const urls = value.urls.map((url: unknown) => {
    if (typeof url !== "string") return invalid();
    return kakaoPhotoUrl(url)?.toString() ?? invalid();
  });
  const callbackUrl = "callbackUrl" in value ? value.callbackUrl : undefined;
  if (callbackUrl !== undefined && (typeof callbackUrl !== "string" || kakaoCallback(callbackUrl, receivedAt) === null))
    return invalid();
  const common = { urls, ...(typeof callbackUrl === "string" ? { callbackUrl } : {}) };
  if (value.kind === "reference") {
    if (!("draftId" in value) || !isUuid(value.draftId)) return invalid();
    return { kind: "reference", draftId: value.draftId, ...common };
  }
  const review = "review" in value ? value.review : undefined;
  if (
    typeof review !== "object" ||
    review === null ||
    !("orderId" in review) ||
    !isUuid(review.orderId) ||
    !("text" in review) ||
    typeof review.text !== "string" ||
    !review.text.trim() ||
    [...review.text].length > 1000 ||
    review.text.includes("\0") ||
    !("consent" in review) ||
    typeof review.consent !== "boolean"
  )
    return invalid();
  return { kind: "review", ...common, review: { orderId: review.orderId, text: review.text, consent: review.consent } };
}

export function encodeKakaoPhotoContext(value: KakaoPhotoContext, receivedAt: Date): string {
  return JSON.stringify({ v: 1, ...read({ v: 1, ...value }, receivedAt) });
}
export function decodeKakaoPhotoContext(plain: string, receivedAt: Date): KakaoPhotoContext {
  let value: unknown;
  try {
    value = JSON.parse(plain);
  } catch {
    return invalid();
  }
  return read(value, receivedAt);
}

export const KAKAO_PHOTO_TEXT = {
  review_saved: "후기를 남겨 주셔서 고마워요",
  review_invalid: "후기는 1,000자, 사진은 5장까지 남길 수 있어요",
  review_not_allowed: "받으신 주문에만 후기를 남길 수 있어요",
  photo_received: "사진을 받았어요",
  photo_rejected: "사진은 한 장 20MB, 한 상담에 10장까지 받을 수 있어요",
  photo_download_failed: "사진을 받지 못했어요. 다시 보내 주세요",
} as const;
export type KakaoPhotoOutcome = keyof typeof KAKAO_PHOTO_TEXT;
