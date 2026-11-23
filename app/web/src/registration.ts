/** SCR-015의 API007·008. 전송은 api.ts만 거치고 본문/사진을 로그에 남기지 않는다. */
import { type ApiResult, request } from "./api";
import { INVALID_API_RESPONSE as INVALID, isApiObject as object, UUID_PATTERN } from "./api-response";
import { type UploadedPhoto, uploadPhoto } from "./photo-upload-api";
import type { RegistrationValues } from "./registration-draft";
export const ENTRUSTMENT_TERMS_VERSION = "MVP-2026.11.v1";
export const LICENSE_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export type UploadedLicensePhoto = UploadedPhoto<"license_photo">;
export interface RegisteredShop {
  readonly shopId: string;
  readonly licenseStatus: "pending" | "on_hold" | "verified";
}
export function registrationPayload(
  values: RegistrationValues,
  uploadId: string,
  consent: boolean,
): Record<string, unknown> {
  const hasNumber = values.mailOrderRegNo.trim() !== "";
  return {
    ...values,
    mailOrderRegNo: hasNumber ? values.mailOrderRegNo : null,
    mailOrderAuthority: hasNumber ? values.mailOrderAuthority : null,
    mailOrderExemption: hasNumber ? null : values.mailOrderExemption,
    licensePhotoUploadId: uploadId,
    entrustmentTermsVersion: ENTRUSTMENT_TERMS_VERSION,
    entrustmentConsent: consent,
  };
}
export function uploadLicensePhoto(file: File, signal?: AbortSignal): Promise<ApiResult<UploadedLicensePhoto>> {
  return uploadPhoto("license_photo", file, signal);
}
export async function registerShop(body: Record<string, unknown>, key: string): Promise<ApiResult<RegisteredShop>> {
  const result = await request<unknown>("/owner/shop", { method: "POST", body, key });
  if (!result.ok) return result;
  const value = result.data;
  if (
    !object(value) ||
    typeof value.shopId !== "string" ||
    !UUID_PATTERN.test(value.shopId) ||
    !["pending", "on_hold", "verified"].includes(String(value.licenseStatus))
  )
    return INVALID;
  return {
    ...result,
    data: { shopId: value.shopId, licenseStatus: value.licenseStatus as RegisteredShop["licenseStatus"] },
  };
}
