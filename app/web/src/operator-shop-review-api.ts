import { type ApiResult, request } from "./api";
import { INVALID_API_RESPONSE, isApiObject, isApiTimestamp, UUID_PATTERN } from "./api-response";
import { isHttpsUrl } from "./api-url";
import type { OperatorIdentity } from "./operator";

import {
  isReviewBusinessIdentity as business,
  copyReviewBusinessIdentity as copyBusiness,
  copyReviewShopHeader as copyHeader,
  isReviewShopHeader as header,
  matchesReviewValue as matches,
  type ShopHeader,
  isReviewText as text,
  isReviewRevision as version,
} from "./operator-shops-api";
import type { BusinessIdentity } from "./shop-response";

interface AccountSummary {
  readonly bankName: string;
  readonly holderName: string;
  readonly accountLast4: string;
}
export interface ReviewedIdentityChange extends BusinessIdentity {
  readonly changeId: string;
  readonly shop: ShopHeader;
  readonly status: "pending" | "applied" | "on_hold";
  readonly previous: BusinessIdentity;
  readonly evidencePhotoUrl: string;
  readonly paymentAccount: (AccountSummary & { readonly holderMatchesNew: boolean }) | null;
  readonly holdReason: string | null;
  readonly requestedAt: string;
  readonly reviewedAt: string | null;
  readonly reviewedBy: OperatorIdentity | null;
  readonly revision: string;
}
export interface ReviewShopDetail extends BusinessIdentity, ShopHeader {
  readonly contactPhone: string;
  readonly businessAddress: string;
  readonly contactEmail: string;
  readonly mailOrderRegNo: string | null;
  readonly mailOrderAuthority: string | null;
  readonly mailOrderExemption: string | null;
  readonly foodLicenseNo: string;
  readonly foodBusinessType: "instant_sale_manufacturing" | "bakery";
  readonly licensePhotoUrl: string;
  readonly licenseHoldReason: string | null;
  readonly licenseReviewedAt: string | null;
  readonly licenseReviewedBy: OperatorIdentity | null;
  readonly pendingIdentityChange: ReviewedIdentityChange | null;
  readonly duplicates: readonly ShopHeader[];
  readonly paymentAccount:
    | (AccountSummary & {
        readonly holderMatches: boolean;
        readonly holderMismatchConfirmed: boolean | null;
        readonly holderCheckedAt: string | null;
        readonly holderCheckedBy: OperatorIdentity | null;
        readonly createdAt: string;
      })
    | null;
  readonly createdAt: string;
  readonly revision: string;
}
export interface LicenseReviewResult {
  readonly outcome: "done" | "unchanged";
  readonly shop: ReviewShopDetail;
}
export interface IdentityReviewResult {
  readonly outcome: "done" | "unchanged";
  readonly change: ReviewedIdentityChange;
}
const nullableText = (value: unknown, max: number): value is string | null => value === null || text(value, max);
const nullableTime = (value: unknown): value is string | null => value === null || isApiTimestamp(value);
const photo = (value: unknown): value is string => isHttpsUrl(value, { rejectUserInfo: true });
function operator(value: unknown): value is OperatorIdentity | null {
  return (
    value === null || (isApiObject(value) && matches(value.operatorId, UUID_PATTERN) && text(value.displayName, 40))
  );
}
const copyOperator = (value: OperatorIdentity | null): OperatorIdentity | null =>
  value === null ? null : { operatorId: value.operatorId, displayName: value.displayName };
function account(value: unknown): value is AccountSummary {
  return (
    isApiObject(value) &&
    text(value.bankName, 30) &&
    text(value.holderName, 30) &&
    matches(value.accountLast4, /^[0-9]{4}$/)
  );
}
const copyAccount = (value: AccountSummary): AccountSummary => ({
  bankName: value.bankName,
  holderName: value.holderName,
  accountLast4: value.accountLast4,
});
function identity(value: unknown): value is ReviewedIdentityChange {
  return (
    isApiObject(value) &&
    business(value) &&
    matches(value.changeId, UUID_PATTERN) &&
    header(value.shop) &&
    (value.status === "pending" || value.status === "applied" || value.status === "on_hold") &&
    business(value.previous) &&
    photo(value.evidencePhotoUrl) &&
    (value.paymentAccount === null ||
      (account(value.paymentAccount) &&
        "holderMatchesNew" in value.paymentAccount &&
        typeof value.paymentAccount.holderMatchesNew === "boolean")) &&
    nullableText(value.holdReason, 200) &&
    isApiTimestamp(value.requestedAt) &&
    nullableTime(value.reviewedAt) &&
    operator(value.reviewedBy) &&
    (value.reviewedAt === null) === (value.reviewedBy === null) &&
    version(value.revision)
  );
}
const copyIdentity = (value: ReviewedIdentityChange): ReviewedIdentityChange => ({
  ...copyBusiness(value),
  changeId: value.changeId,
  shop: copyHeader(value.shop),
  status: value.status,
  previous: copyBusiness(value.previous),
  evidencePhotoUrl: value.evidencePhotoUrl,
  paymentAccount:
    value.paymentAccount === null
      ? null
      : { ...copyAccount(value.paymentAccount), holderMatchesNew: value.paymentAccount.holderMatchesNew },
  holdReason: value.holdReason,
  requestedAt: value.requestedAt,
  reviewedAt: value.reviewedAt,
  reviewedBy: copyOperator(value.reviewedBy),
  revision: value.revision,
});
function detail(value: unknown): value is ReviewShopDetail {
  if (
    !isApiObject(value) ||
    !business(value) ||
    !header(value) ||
    !matches(value.contactPhone, /^[0-9-]{8,14}$/) ||
    !text(value.businessAddress, 200) ||
    !text(value.contactEmail, 100, 3) ||
    !/^[^@\s]+@[^@\s]+$/.test(value.contactEmail) ||
    !nullableText(value.mailOrderRegNo, 40) ||
    !nullableText(value.mailOrderAuthority, 40) ||
    !nullableText(value.mailOrderExemption, 200) ||
    !text(value.foodLicenseNo, 30) ||
    (value.foodBusinessType !== "instant_sale_manufacturing" && value.foodBusinessType !== "bakery") ||
    !photo(value.licensePhotoUrl) ||
    !nullableText(value.licenseHoldReason, 200) ||
    !nullableTime(value.licenseReviewedAt) ||
    !operator(value.licenseReviewedBy) ||
    (value.licenseReviewedAt === null) !== (value.licenseReviewedBy === null) ||
    !(
      value.pendingIdentityChange === null ||
      (identity(value.pendingIdentityChange) &&
        value.pendingIdentityChange.status === "pending" &&
        value.pendingIdentityChange.shop.shopId === value.shopId)
    ) ||
    !Array.isArray(value.duplicates) ||
    value.duplicates.length > 20 ||
    !value.duplicates.every(header) ||
    value.duplicates.some((item) => item.shopId === value.shopId) ||
    new Set(value.duplicates.map((item) => item.shopId)).size !== value.duplicates.length ||
    !isApiTimestamp(value.createdAt) ||
    !version(value.revision)
  )
    return false;
  const payment = value.paymentAccount;
  return (
    payment === null ||
    (isApiObject(payment) &&
      account(payment) &&
      typeof payment.holderMatches === "boolean" &&
      (payment.holderMismatchConfirmed === null || typeof payment.holderMismatchConfirmed === "boolean") &&
      nullableTime(payment.holderCheckedAt) &&
      operator(payment.holderCheckedBy) &&
      (payment.holderCheckedAt === null) === (payment.holderCheckedBy === null) &&
      isApiTimestamp(payment.createdAt))
  );
}
const copyDetail = (value: ReviewShopDetail): ReviewShopDetail => ({
  ...copyBusiness(value),
  ...copyHeader(value),
  contactPhone: value.contactPhone,
  businessAddress: value.businessAddress,
  contactEmail: value.contactEmail,
  mailOrderRegNo: value.mailOrderRegNo,
  mailOrderAuthority: value.mailOrderAuthority,
  mailOrderExemption: value.mailOrderExemption,
  foodLicenseNo: value.foodLicenseNo,
  foodBusinessType: value.foodBusinessType,
  licensePhotoUrl: value.licensePhotoUrl,
  licenseHoldReason: value.licenseHoldReason,
  licenseReviewedAt: value.licenseReviewedAt,
  licenseReviewedBy: copyOperator(value.licenseReviewedBy),
  pendingIdentityChange: value.pendingIdentityChange === null ? null : copyIdentity(value.pendingIdentityChange),
  duplicates: value.duplicates.map(copyHeader),
  paymentAccount:
    value.paymentAccount === null
      ? null
      : {
          ...copyAccount(value.paymentAccount),
          holderMatches: value.paymentAccount.holderMatches,
          holderMismatchConfirmed: value.paymentAccount.holderMismatchConfirmed,
          holderCheckedAt: value.paymentAccount.holderCheckedAt,
          holderCheckedBy: copyOperator(value.paymentAccount.holderCheckedBy),
          createdAt: value.paymentAccount.createdAt,
        },
  createdAt: value.createdAt,
  revision: value.revision,
});
export async function fetchReviewShop(shopId: string, signal?: AbortSignal): Promise<ApiResult<ReviewShopDetail>> {
  if (!UUID_PATTERN.test(shopId)) return INVALID_API_RESPONSE;
  const targetId = shopId.toLowerCase();
  const result = await request<unknown>(`/operator/shops/${targetId}`, {
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  if (!result.ok) return result;
  return detail(result.data) && result.data.shopId === targetId
    ? { ...result, data: copyDetail(result.data) }
    : INVALID_API_RESPONSE;
}
async function postDecision<T>(
  id: string,
  path: (id: string) => string,
  body: Record<string, unknown>,
  key: string,
  decode: (value: Record<string, unknown>, outcome: "done" | "unchanged", id: string) => T | null,
  signal?: AbortSignal,
): Promise<ApiResult<T>> {
  if (!UUID_PATTERN.test(id)) return INVALID_API_RESPONSE;
  const targetId = id.toLowerCase();
  const result = await request<unknown>(path(targetId), {
    method: "POST",
    cache: "no-store",
    body,
    key,
    ...(signal ? { signal } : {}),
  });
  if (!result.ok) return result;
  const value = result.data;
  if (!isApiObject(value) || (value.outcome !== "done" && value.outcome !== "unchanged")) return INVALID_API_RESPONSE;
  const data = decode(value, value.outcome, targetId);
  return data === null ? INVALID_API_RESPONSE : { ...result, data };
}
export function reviewLicense(
  shopId: string,
  body: Record<string, unknown>,
  key: string,
  signal?: AbortSignal,
): Promise<ApiResult<LicenseReviewResult>> {
  return postDecision(
    shopId,
    (id) => `/operator/shops/${id}/license-review`,
    body,
    key,
    (value, outcome, id) =>
      detail(value.shop) && value.shop.shopId === id && value.shop.licenseStatus === body.decision
        ? { outcome, shop: copyDetail(value.shop) }
        : null,
    signal,
  );
}
export function reviewIdentityChange(
  changeId: string,
  body: Record<string, unknown>,
  key: string,
  signal?: AbortSignal,
): Promise<ApiResult<IdentityReviewResult>> {
  return postDecision(
    changeId,
    (id) => `/operator/identity-changes/${id}/review`,
    body,
    key,
    (value, outcome, id) =>
      identity(value.change) && value.change.changeId === id && value.change.status === body.decision
        ? { outcome, change: copyIdentity(value.change) }
        : null,
    signal,
  );
}
