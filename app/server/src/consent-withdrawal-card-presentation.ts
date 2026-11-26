/** 사진의 동의·게시 상태를 읽어 표시한다. 내리기·철회 쓰기는 수행하지 않는다. */
import { CustomerNoticeTemporarilyUnavailable } from "./customer-notice-content";
import { sqlStateOf } from "./db";
import { type KakaoConsentWithdrawalCard, NO_CONSENTED_PHOTOS_TEXT } from "./kakao-consent-withdrawal-message";
import { type ShopDb, withShopSavepoint } from "./shop-scope";

export interface ConsentWithdrawalBinding {
  readonly sourceHash: string;
}
export type ConsentWithdrawalSource =
  | {
      readonly available: true;
      readonly binding: ConsentWithdrawalBinding;
      readonly presentation: Omit<KakaoConsentWithdrawalCard, "cardKey" | "blockId" | "expiresAt">;
    }
  | { readonly available: false; readonly reason: "no_consented_photos" | "not_ready"; readonly text: string };
async function readSource(
  db: ShopDb,
  input: { readonly orderId: string; readonly customerId: string; readonly consultationId: string },
): Promise<ConsentWithdrawalSource> {
  const row = (
    await db.run<{
      order_no: string;
      time_zone: string;
      review_id: string | null;
      review_version: number | null;
      photos: { id: string; scope: "completion_photo" | "review_photo"; published: boolean }[];
    }>(
      "SELECT order_no,time_zone,review_id,review_version,photos FROM read_prepared_consent_withdrawal_card($1,$2,$3,$4)",
      [input.customerId, input.consultationId, input.orderId],
    )
  ).rows[0];
  if (row === undefined) return { available: false, reason: "not_ready", text: "잠시 뒤 다시 말씀해 주세요" };
  if (row.photos.length === 0)
    return { available: false, reason: "no_consented_photos", text: NO_CONSENTED_PHOTOS_TEXT };
  const data = [row.order_no, row.time_zone, row.review_id, row.review_version, row.photos];
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(data))));
  return {
    available: true,
    binding: { sourceHash: [...hash].map((value) => value.toString(16).padStart(2, "0")).join("") },
    presentation: {
      orderNo: row.order_no,
      timeZone: row.time_zone,
      completionPhotoCount: row.photos.filter((photo) => photo.scope === "completion_photo").length,
      reviewPhotoCount: row.photos.filter((photo) => photo.scope === "review_photo").length,
      publishedCount: row.photos.filter((photo) => photo.published).length,
    },
  };
}
export async function readPreparedConsentWithdrawalCard(
  db: ShopDb,
  input: { readonly orderId: string; readonly customerId: string; readonly consultationId: string },
): Promise<ConsentWithdrawalSource> {
  try {
    return await withShopSavepoint(db, (part) => readSource(part, input));
  } catch (error) {
    if (sqlStateOf(error) === "42501") throw new CustomerNoticeTemporarilyUnavailable();
    throw error;
  }
}
