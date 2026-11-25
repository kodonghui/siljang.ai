import type { KakaoCustomerNoticeDisplayView } from "../../src/kakao-customer-notice-message";

export const customerNoticePhotos = Array.from({ length: 5 }, (_, index) => ({
  url: new URL(String(index), "https://photos.example/synthetic/").href,
  altText: "합성 완성 사진",
}));
export const customerNoticePhotoAsk = {
  state: "photo-consent",
  mode: "ask",
  orderNo: "AB1234CD",
  photos: customerNoticePhotos,
  cardKey: "synthetic_notice_consent_key",
  blockId: "synthetic-photo-consent",
  expiresAt: "2026-11-26T06:30:00Z",
  timeZone: "Asia/Seoul",
} as const satisfies KakaoCustomerNoticeDisplayView;
