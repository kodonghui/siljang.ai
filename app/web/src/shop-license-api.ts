/** SCR-035의 비공개 신고증/사업자 정보. 전송은 api.ts만 사용한다. */
import { type ApiResult, request } from "./api";
import { INVALID_API_RESPONSE, isApiObject } from "./api-response";
import { isShopResponse, type ShopResponse } from "./shop-response";

export type { BusinessIdentity, IdentityChange } from "./shop-response";
export type LicenseShop = ShopResponse;
export interface LicenseResult {
  readonly outcome: "done";
  readonly shop: LicenseShop;
}
export interface IdentityResult {
  readonly outcome: "done" | "unchanged";
  readonly shop: LicenseShop;
}
export async function fetchShopLicense(signal?: AbortSignal): Promise<ApiResult<LicenseShop>> {
  const result = await request<unknown>("/owner/shop", { ...(signal ? { signal } : {}) });
  if (!result.ok) return result;
  return isShopResponse(result.data) ? { ...result, data: result.data } : INVALID_API_RESPONSE;
}
export async function resubmitLicense(body: Record<string, unknown>, key: string): Promise<ApiResult<LicenseResult>> {
  const result = await request<unknown>("/owner/shop/license", { method: "PUT", body, key });
  if (!result.ok) return result;
  const v = result.data;
  return isApiObject(v) && v.outcome === "done" && isShopResponse(v.shop)
    ? { ...result, data: { outcome: "done", shop: v.shop } }
    : INVALID_API_RESPONSE;
}
export async function requestIdentityChange(
  body: Record<string, unknown>,
  key: string,
): Promise<ApiResult<IdentityResult>> {
  const result = await request<unknown>("/owner/shop/identity-changes", { method: "POST", body, key });
  if (!result.ok) return result;
  const v = result.data;
  return isApiObject(v) && (v.outcome === "done" || v.outcome === "unchanged") && isShopResponse(v.shop)
    ? { ...result, data: { outcome: v.outcome, shop: v.shop } }
    : INVALID_API_RESPONSE;
}
