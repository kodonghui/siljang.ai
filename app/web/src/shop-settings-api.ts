import { type ApiResult, request } from "./api";
import { INVALID_API_RESPONSE, isApiObject } from "./api-response";
import { isShopResponse, type ShopResponse } from "./shop-response";

export type { ShopSettingsSummary } from "./shop-response";
export type ShopSettings = ShopResponse;
export interface SavedShopSettings {
  readonly outcome: "done" | "unchanged";
  readonly shop: ShopSettings;
}
export async function fetchShopSettings(signal?: AbortSignal): Promise<ApiResult<ShopSettings>> {
  const result = await request<unknown>("/owner/shop", { ...(signal ? { signal } : {}) });
  if (!result.ok) return result;
  return isShopResponse(result.data) ? { ...result, data: result.data } : INVALID_API_RESPONSE;
}
export async function saveShopSettings(
  body: Record<string, unknown>,
  key: string,
  signal?: AbortSignal,
): Promise<ApiResult<SavedShopSettings>> {
  const result = await request<unknown>("/owner/shop", { method: "PATCH", body, key, ...(signal ? { signal } : {}) });
  if (!result.ok) return result;
  const v = result.data;
  return isApiObject(v) && (v.outcome === "done" || v.outcome === "unchanged") && isShopResponse(v.shop)
    ? { ...result, data: { outcome: v.outcome, shop: v.shop } }
    : INVALID_API_RESPONSE;
}
