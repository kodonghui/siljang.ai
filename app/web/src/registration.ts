/** SCR-015의 API007·008. 전송은 api.ts만 거치고 본문/사진을 로그에 남기지 않는다. */
import { type ApiFailure, type ApiResult, request } from "./api";
import type { RegistrationValues } from "./registration-draft";
export const ENTRUSTMENT_TERMS_VERSION = "MVP-2026.11.v1";
export const LICENSE_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export interface UploadedLicensePhoto {
  readonly uploadId: string;
  readonly purpose: "license_photo";
  readonly expiresAt: string;
}
export interface RegisteredShop {
  readonly shopId: string;
  readonly licenseStatus: "pending" | "on_hold" | "verified";
}
const INVALID: ApiFailure = { ok: false, status: 502, problem: null, retryAfterSeconds: null };
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
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
export async function uploadLicensePhoto(file: File, signal?: AbortSignal): Promise<ApiResult<UploadedLicensePhoto>> {
  const body = new FormData();
  body.set("purpose", "license_photo");
  body.set("file", file);
  const result = await request<unknown>("/owner/uploads", { method: "POST", body, ...(signal ? { signal } : {}) });
  if (!result.ok) return result;
  const value = result.data;
  if (
    !object(value) ||
    typeof value.uploadId !== "string" ||
    !/^upl_[A-Za-z0-9_-]{20,200}$/.test(value.uploadId) ||
    value.purpose !== "license_photo" ||
    typeof value.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(value.expiresAt))
  )
    return INVALID;
  return { ...result, data: { uploadId: value.uploadId, purpose: "license_photo", expiresAt: value.expiresAt } };
}
export async function registerShop(body: Record<string, unknown>, key: string): Promise<ApiResult<RegisteredShop>> {
  const result = await request<unknown>("/owner/shop", { method: "POST", body, key });
  if (!result.ok) return result;
  const value = result.data;
  if (
    !object(value) ||
    typeof value.shopId !== "string" ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value.shopId) ||
    !["pending", "on_hold", "verified"].includes(String(value.licenseStatus))
  )
    return INVALID;
  return {
    ...result,
    data: { shopId: value.shopId, licenseStatus: value.licenseStatus as RegisteredShop["licenseStatus"] },
  };
}
