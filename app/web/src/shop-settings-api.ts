import { type ApiResult, request } from "./api";
import { INVALID_API_RESPONSE, isApiObject, UUID_PATTERN } from "./api-response";
import type { ShopSettingsSource } from "./shop-settings-form";

export interface ShopSettings extends ShopSettingsSource {
  readonly shopId: string;
  readonly businessName: string;
  readonly representativeName: string;
  readonly businessRegNo: string;
  readonly foodLicenseNo: string;
  readonly foodBusinessType: "instant_sale_manufacturing" | "bakery";
  readonly licenseStatus: "pending" | "on_hold" | "verified";
  readonly licenseHoldReason: string | null;
  readonly bookingUrl: string | null;
  readonly identityChange: { readonly status: "pending" | "approved" | "on_hold" } | null;
}
export interface SavedShopSettings {
  readonly outcome: "done" | "unchanged";
  readonly shop: ShopSettings;
}
function isShopSettings(value: unknown): value is ShopSettings {
  if (!isApiObject(value) || typeof value.shopId !== "string" || !UUID_PATTERN.test(value.shopId)) return false;
  const strings = [
    "name",
    "contactPhone",
    "businessAddress",
    "contactEmail",
    "businessName",
    "representativeName",
    "businessRegNo",
    "foodLicenseNo",
    "revision",
  ];
  if (strings.some((key) => typeof value[key] !== "string")) return false;
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(String(value.revision))) return false;
  const nullable = [
    "pickupAddress",
    "mailOrderRegNo",
    "mailOrderAuthority",
    "mailOrderExemption",
    "licenseHoldReason",
    "bookingUrl",
  ];
  if (nullable.some((key) => value[key] !== null && typeof value[key] !== "string")) return false;
  if (typeof value.completionPhotoEnabled !== "boolean") return false;
  for (const [key, min, max] of [
    ["idleCloseHours", 1, 720],
    ["ownerWaitMinutes", 10, 1440],
    ["dailyAiCostLimitKrw", 0, 1000000],
    ["awaitingPaymentLimit", 0, 10],
  ] as const) {
    const number = value[key];
    if (typeof number !== "number" || !Number.isSafeInteger(number) || number < min || number > max) return false;
  }
  if (!["instant_sale_manufacturing", "bakery"].includes(String(value.foodBusinessType))) return false;
  if (!["pending", "on_hold", "verified"].includes(String(value.licenseStatus))) return false;
  return (
    value.identityChange === null ||
    (isApiObject(value.identityChange) &&
      ["pending", "approved", "on_hold"].includes(String(value.identityChange.status)))
  );
}
export async function fetchShopSettings(signal?: AbortSignal): Promise<ApiResult<ShopSettings>> {
  const result = await request<unknown>("/owner/shop", { ...(signal ? { signal } : {}) });
  if (!result.ok) return result;
  return isShopSettings(result.data) ? { ...result, data: result.data } : INVALID_API_RESPONSE;
}
export async function saveShopSettings(
  body: Record<string, unknown>,
  key: string,
  signal?: AbortSignal,
): Promise<ApiResult<SavedShopSettings>> {
  const result = await request<unknown>("/owner/shop", { method: "PATCH", body, key, ...(signal ? { signal } : {}) });
  if (!result.ok) return result;
  const value = result.data;
  if (!isApiObject(value) || (value.outcome !== "done" && value.outcome !== "unchanged") || !isShopSettings(value.shop))
    return INVALID_API_RESPONSE;
  return { ...result, data: { outcome: value.outcome, shop: value.shop } };
}
