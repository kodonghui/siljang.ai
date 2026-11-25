import { kakaoConsultationMessage } from "../../src/kakao-consultation-message";
import {
  type KakaoCustomerNoticeDisplayView,
  kakaoCustomerNoticeMessage,
} from "../../src/kakao-customer-notice-message";
import { kakaoReply } from "../../src/kakao-reply";
import type { ShopRequest } from "../../src/routes";

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

const show = (view: KakaoCustomerNoticeDisplayView) =>
  kakaoConsultationMessage({ state: "normal", contents: [{ kind: "customer_notice", view }] });
export function customerNoticeSamples() {
  return [
    {
      state: "normal",
      body: show({
        state: "normal",
        notice: {
          kind: "order_confirmed",
          orderNo: "AB1234CD",
          summary: "합성 주문 · 1호 초콜릿",
          pickupAt: "2026-11-27T06:00:00Z",
          timeZone: "Asia/Seoul",
          paidAmount: 36000,
          identity: {
            businessName: "합성 케이크 가게",
            representativeName: "합성 대표",
            address: "합성시 시험로 1",
            contactPhone: "02-000-0000",
          },
          regulation: "합성 주문에 저장한 취소·환불 규정 원문",
        },
      }),
    },
    { state: "photo-consent", body: show(customerNoticePhotoAsk) },
    {
      state: "deferred",
      body: kakaoConsultationMessage({
        state: "normal",
        contents: [
          "AI가 상담해요. 처리방침: https://privacy.example/policy",
          {
            kind: "customer_notice",
            view: { state: "deferred", notice: { kind: "owner_reply", text: "사장님이 남긴 합성 답 원문" } },
          },
          "현재 합성 상담 답",
        ],
      }),
    },
    { state: "stale", body: show({ state: "stale", reason: "gone" }) },
    { state: "error", body: kakaoCustomerNoticeMessage({ state: "error" }) },
  ];
}
export interface CustomerNoticeResponseCase {
  readonly response: string;
  readonly state: string | null;
  readonly display: "skill" | "not-shown" | "not-delivered";
  readonly body: unknown;
}
export async function customerNoticeResponseCases(): Promise<readonly CustomerNoticeResponseCase[]> {
  const responder: Pick<ShopRequest, "json"> = {
    json: (body, status = 200, headers = {}) => Response.json(body, { status, headers }),
  };
  const normal = customerNoticeSamples()[0];
  if (!normal) throw new Error("synthetic normal notice missing");
  return [
    { response: "API-073#200:notice_shown", state: "normal", display: "skill", body: normal.body },
    { response: "API-073#200:notice_test", state: null, display: "not-shown", body: null },
    {
      response: "API-073#200:notice_gone",
      state: "stale",
      display: "skill",
      body: await kakaoReply(responder, "notice_gone").json(),
    },
    ...["401:skill_key_invalid", "422:validation_failed", "default:internal"].map((outcome) => ({
      response: `API-073#${outcome}`,
      state: "error",
      display: "not-delivered" as const,
      body: null,
    })),
  ];
}
