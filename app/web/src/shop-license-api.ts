/** SCR-035의 비공개 신고증/사업자 정보. 전송은 api.ts만 사용한다. */
import { type ApiResult, request } from "./api";
import { INVALID_API_RESPONSE, isApiObject, UUID_PATTERN } from "./api-response";

export interface BusinessIdentity {
  readonly businessName: string;
  readonly representativeName: string;
  readonly businessRegNo: string;
}
export interface IdentityChange extends BusinessIdentity {
  readonly changeId: string;
  readonly status: "pending" | "applied" | "on_hold";
  readonly previous: BusinessIdentity;
  readonly evidencePhotoUrl: string;
  readonly holdReason: string | null;
  readonly requestedAt: string;
  readonly reviewedAt: string | null;
}
export interface LicenseShop extends BusinessIdentity {
  readonly shopId: string;
  readonly name: string;
  readonly revision: string;
  readonly foodLicenseNo: string;
  readonly foodBusinessType: "instant_sale_manufacturing" | "bakery";
  readonly licenseStatus: "pending" | "verified" | "on_hold";
  readonly licenseHoldReason: string | null;
  readonly licensePhotoUrl: string;
  readonly licenseReviewedAt?: string | null;
  readonly identityChange: IdentityChange | null;
}
export interface LicenseResult {
  readonly outcome: "done";
  readonly shop: LicenseShop;
}
export interface IdentityResult {
  readonly outcome: "done" | "unchanged";
  readonly shop: LicenseShop;
}
const text = (v: unknown): v is string => typeof v === "string";
const date = (v: unknown): v is string => text(v) && Number.isFinite(Date.parse(v));
const nullableText = (v: unknown): v is string | null => v === null || text(v);
function photoUrl(v: unknown): v is string {
  if (!text(v)) return false;
  try {
    const url = new URL(v);
    return ["https:", "http:"].includes(url.protocol) && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}
function business(v: unknown): v is BusinessIdentity {
  return (
    isApiObject(v) &&
    text(v.businessName) &&
    text(v.representativeName) &&
    text(v.businessRegNo) &&
    /^\d{10}$/.test(v.businessRegNo)
  );
}
function change(v: unknown): v is IdentityChange {
  return (
    business(v) &&
    isApiObject(v) &&
    text(v.changeId) &&
    UUID_PATTERN.test(v.changeId) &&
    ["pending", "applied", "on_hold"].includes(String(v.status)) &&
    business(v.previous) &&
    photoUrl(v.evidencePhotoUrl) &&
    nullableText(v.holdReason) &&
    date(v.requestedAt) &&
    (v.reviewedAt === null || date(v.reviewedAt))
  );
}
function shop(v: unknown): v is LicenseShop {
  return (
    business(v) &&
    isApiObject(v) &&
    text(v.shopId) &&
    UUID_PATTERN.test(v.shopId) &&
    text(v.name) &&
    text(v.revision) &&
    /^[A-Za-z0-9._-]{1,64}$/.test(v.revision) &&
    text(v.foodLicenseNo) &&
    ["instant_sale_manufacturing", "bakery"].includes(String(v.foodBusinessType)) &&
    ["pending", "verified", "on_hold"].includes(String(v.licenseStatus)) &&
    nullableText(v.licenseHoldReason) &&
    photoUrl(v.licensePhotoUrl) &&
    (v.licenseReviewedAt === undefined || v.licenseReviewedAt === null || date(v.licenseReviewedAt)) &&
    (v.identityChange === null || change(v.identityChange))
  );
}
export async function fetchShopLicense(signal?: AbortSignal): Promise<ApiResult<LicenseShop>> {
  const result = await request<unknown>("/owner/shop", { ...(signal ? { signal } : {}) });
  if (!result.ok) return result;
  return shop(result.data) ? { ...result, data: result.data } : INVALID_API_RESPONSE;
}
export async function resubmitLicense(body: Record<string, unknown>, key: string): Promise<ApiResult<LicenseResult>> {
  const result = await request<unknown>("/owner/shop/license", { method: "PUT", body, key });
  if (!result.ok) return result;
  const v = result.data;
  return isApiObject(v) && v.outcome === "done" && shop(v.shop)
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
  return isApiObject(v) && (v.outcome === "done" || v.outcome === "unchanged") && shop(v.shop)
    ? { ...result, data: { outcome: v.outcome, shop: v.shop } }
    : INVALID_API_RESPONSE;
}
