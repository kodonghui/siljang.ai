/** API-009와 Shop 결과를 설정/신고 화면에서 같은 계약으로 읽는다. */
import { isApiObject, UUID_PATTERN } from "./api-response";
import type { ShopSettingsSource } from "./shop-settings-form";
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
export interface ShopSettingsSummary {
  readonly priceListVersion: number | null;
  readonly operatingRulesVersion: number | null;
  readonly paymentConfigured: boolean;
  readonly kakaoChannelStatus: "not_started" | "pending" | "linked" | "failed" | null;
  readonly ledgerStatus: "linked" | "auth_lost" | null;
  readonly hasPortfolio: boolean;
  readonly hasReviews: boolean;
}
export interface ShopResponse extends ShopSettingsSource, BusinessIdentity {
  readonly shopId: string;
  readonly foodLicenseNo: string;
  readonly foodBusinessType: "instant_sale_manufacturing" | "bakery";
  readonly licenseStatus: "pending" | "verified" | "on_hold";
  readonly licenseHoldReason: string | null;
  readonly licensePhotoUrl: string;
  readonly licenseReviewedAt?: string | null;
  readonly bookingUrl: string | null;
  readonly identityChange: IdentityChange | null;
  readonly settingsSummary?: ShopSettingsSummary;
}
const text = (v: unknown): v is string => typeof v === "string";
const date = (v: unknown): v is string => text(v) && Number.isFinite(Date.parse(v));
const nullableText = (v: unknown): v is string | null => v === null || text(v);
const member = (v: unknown, choices: readonly string[]) => text(v) && choices.includes(v);
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
    isApiObject(v) &&
    business(v) &&
    text(v.changeId) &&
    UUID_PATTERN.test(v.changeId) &&
    member(v.status, ["pending", "applied", "on_hold"]) &&
    business(v.previous) &&
    photoUrl(v.evidencePhotoUrl) &&
    nullableText(v.holdReason) &&
    date(v.requestedAt) &&
    (v.reviewedAt === null || date(v.reviewedAt))
  );
}
function summary(v: unknown): v is ShopSettingsSummary {
  if (!isApiObject(v)) return false;
  for (const key of ["priceListVersion", "operatingRulesVersion"]) {
    const n = v[key];
    if (n !== null && (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1 || n > 2147483647)) return false;
  }
  return (
    ["paymentConfigured", "hasPortfolio", "hasReviews"].every((key) => typeof v[key] === "boolean") &&
    (v.kakaoChannelStatus === null || member(v.kakaoChannelStatus, ["not_started", "pending", "linked", "failed"])) &&
    (v.ledgerStatus === null || member(v.ledgerStatus, ["linked", "auth_lost"]))
  );
}
export function isShopResponse(v: unknown): v is ShopResponse {
  if (!isApiObject(v) || !business(v) || !text(v.shopId) || !UUID_PATTERN.test(v.shopId)) return false;
  if (["name", "contactPhone", "businessAddress", "contactEmail", "foodLicenseNo"].some((key) => !text(v[key])))
    return false;
  if (!text(v.revision) || !/^[A-Za-z0-9._-]{1,64}$/.test(v.revision)) return false;
  if (
    [
      "pickupAddress",
      "mailOrderRegNo",
      "mailOrderAuthority",
      "mailOrderExemption",
      "licenseHoldReason",
      "bookingUrl",
    ].some((key) => !nullableText(v[key]))
  )
    return false;
  if (typeof v.completionPhotoEnabled !== "boolean") return false;
  for (const [key, min, max] of [
    ["idleCloseHours", 1, 720],
    ["ownerWaitMinutes", 10, 1440],
    ["dailyAiCostLimitKrw", 0, 1000000],
    ["awaitingPaymentLimit", 0, 10],
  ] as const) {
    const n = v[key];
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n < min || n > max) return false;
  }
  return (
    member(v.foodBusinessType, ["instant_sale_manufacturing", "bakery"]) &&
    member(v.licenseStatus, ["pending", "verified", "on_hold"]) &&
    photoUrl(v.licensePhotoUrl) &&
    (v.licenseReviewedAt === undefined || v.licenseReviewedAt === null || date(v.licenseReviewedAt)) &&
    (v.identityChange === null || change(v.identityChange)) &&
    (v.settingsSummary === undefined || summary(v.settingsSummary))
  );
}
