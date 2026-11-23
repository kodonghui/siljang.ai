/** API007의 사진 용도·응답·전송을 한 곳에서 검증한다. */
import { type ApiResult, request } from "./api";
import { INVALID_API_RESPONSE, isApiObject } from "./api-response";
export type PhotoPurpose = "license_photo" | "design_image";
export interface UploadedPhoto<P extends PhotoPurpose> {
  readonly uploadId: string;
  readonly purpose: P;
  readonly expiresAt: string;
}
export async function uploadPhoto<P extends PhotoPurpose>(
  purpose: P,
  file: File,
  signal?: AbortSignal,
): Promise<ApiResult<UploadedPhoto<P>>> {
  const body = new FormData();
  body.set("purpose", purpose);
  body.set("file", file);
  const result = await request<unknown>("/owner/uploads", { method: "POST", body, ...(signal ? { signal } : {}) });
  if (!result.ok) return result;
  const value = result.data;
  if (
    !isApiObject(value) ||
    typeof value.uploadId !== "string" ||
    !/^upl_[A-Za-z0-9_-]{20,200}$/.test(value.uploadId) ||
    value.purpose !== purpose ||
    typeof value.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(value.expiresAt))
  )
    return INVALID_API_RESPONSE;
  return { ...result, data: { uploadId: value.uploadId, purpose, expiresAt: value.expiresAt } };
}
