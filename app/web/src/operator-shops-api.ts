import { type ApiResult, request } from "./api";
import { INVALID_API_RESPONSE, isApiObject, isApiTimestamp, UUID_PATTERN } from "./api-response";
import { type BusinessIdentity, isBusinessIdentity } from "./shop-response";
export const REVIEW_CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
export const REVIEW_STATUSES = ["pending", "on_hold", "verified"] as const;
export const CHANGE_STATUSES = ["pending", "applied", "on_hold"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];
interface ShopHeader {
  readonly shopId: string;
  readonly name: string;
  readonly licenseStatus: ReviewStatus;
}
export interface ReviewShop extends BusinessIdentity, ShopHeader {
  readonly foodLicenseNo: string;
  readonly foodBusinessType: "instant_sale_manufacturing" | "bakery";
  readonly duplicateBusinessRegNo: boolean;
  readonly createdAt: string;
  readonly revision: string;
}
export interface IdentityChangeSummary extends BusinessIdentity {
  readonly changeId: string;
  readonly shop: ShopHeader;
  readonly status: ChangeStatus;
  readonly previous: BusinessIdentity;
  readonly paymentAccount: {
    readonly bankName: string;
    readonly holderName: string;
    readonly accountLast4: string;
    readonly holderMatchesNew: boolean;
  } | null;
  readonly requestedAt: string;
  readonly revision: string;
}
export interface ReviewPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}
export interface ReviewQuery<S> {
  readonly status: S;
  readonly cursor?: string | null;
}
const bounded = (value: unknown, max: number): value is string =>
  typeof value === "string" && [...value].length >= 1 && [...value].length <= max;
const matches = (value: unknown, pattern: RegExp): value is string => typeof value === "string" && pattern.test(value);
const member = <T extends readonly string[]>(value: unknown, choices: T): value is T[number] =>
  typeof value === "string" && choices.includes(value);
const version = (value: unknown): value is string => matches(value, /^[A-Za-z0-9._-]{1,64}$/);
function business(value: unknown): value is BusinessIdentity {
  return isBusinessIdentity(value) && bounded(value.businessName, 60) && bounded(value.representativeName, 30);
}
const copyBusiness = (value: BusinessIdentity): BusinessIdentity => ({
  businessName: value.businessName,
  representativeName: value.representativeName,
  businessRegNo: value.businessRegNo,
});
function shopHeader(value: unknown): value is ShopHeader {
  return (
    isApiObject(value) &&
    matches(value.shopId, UUID_PATTERN) &&
    bounded(value.name, 40) &&
    member(value.licenseStatus, REVIEW_STATUSES)
  );
}
function reviewShop(value: unknown): ReviewShop | null {
  if (
    !isApiObject(value) ||
    !business(value) ||
    !shopHeader(value) ||
    !bounded(value.foodLicenseNo, 30) ||
    !member(value.foodBusinessType, ["instant_sale_manufacturing", "bakery"] as const) ||
    typeof value.duplicateBusinessRegNo !== "boolean" ||
    !isApiTimestamp(value.createdAt) ||
    !version(value.revision)
  )
    return null;
  return {
    ...copyBusiness(value),
    shopId: value.shopId,
    name: value.name,
    licenseStatus: value.licenseStatus,
    foodLicenseNo: value.foodLicenseNo,
    foodBusinessType: value.foodBusinessType,
    duplicateBusinessRegNo: value.duplicateBusinessRegNo,
    createdAt: value.createdAt,
    revision: value.revision,
  };
}
function identityChange(value: unknown): IdentityChangeSummary | null {
  if (
    !isApiObject(value) ||
    !business(value) ||
    !matches(value.changeId, UUID_PATTERN) ||
    !shopHeader(value.shop) ||
    !member(value.status, CHANGE_STATUSES) ||
    !business(value.previous) ||
    !isApiTimestamp(value.requestedAt) ||
    !version(value.revision)
  )
    return null;
  const account = value.paymentAccount;
  if (
    account !== null &&
    (!isApiObject(account) ||
      !bounded(account.bankName, 30) ||
      !bounded(account.holderName, 30) ||
      !matches(account.accountLast4, /^[0-9]{4}$/) ||
      typeof account.holderMatchesNew !== "boolean")
  )
    return null;
  return {
    ...copyBusiness(value),
    changeId: value.changeId,
    shop: { shopId: value.shop.shopId, name: value.shop.name, licenseStatus: value.shop.licenseStatus },
    status: value.status,
    previous: copyBusiness(value.previous),
    paymentAccount:
      account === null
        ? null
        : {
            bankName: account.bankName as string,
            holderName: account.holderName as string,
            accountLast4: account.accountLast4 as string,
            holderMatchesNew: account.holderMatchesNew as boolean,
          },
    requestedAt: value.requestedAt,
    revision: value.revision,
  };
}
async function page<T>(
  path: string,
  query: ReviewQuery<string>,
  decode: (value: unknown) => T | null,
  key: (value: T) => string,
  accepts: (value: T) => boolean,
  signal?: AbortSignal,
): Promise<ApiResult<ReviewPage<T>>> {
  const params = new URLSearchParams({ status: query.status, limit: "20" });
  if (query.cursor !== null && query.cursor !== undefined) params.set("cursor", query.cursor);
  const result = await request<unknown>(`${path}?${params}`, { cache: "no-store", ...(signal ? { signal } : {}) });
  if (!result.ok) return result;
  const value = result.data;
  if (
    !isApiObject(value) ||
    !Array.isArray(value.items) ||
    value.items.length > 20 ||
    !(value.nextCursor === null || matches(value.nextCursor, REVIEW_CURSOR_PATTERN))
  )
    return INVALID_API_RESPONSE;
  const items: T[] = [],
    ids = new Set<string>();
  for (const raw of value.items) {
    const item = decode(raw);
    if (item === null || ids.has(key(item)) || !accepts(item)) return INVALID_API_RESPONSE;
    ids.add(key(item));
    items.push(item);
  }
  return { ...result, data: { items, nextCursor: value.nextCursor } };
}
export function fetchReviewShops(query: ReviewQuery<ReviewStatus>, signal?: AbortSignal) {
  return page(
    "/operator/shops",
    query,
    reviewShop,
    (item) => item.shopId,
    (item) => item.licenseStatus === query.status,
    signal,
  );
}
export function fetchIdentityChanges(query: ReviewQuery<ChangeStatus>, signal?: AbortSignal) {
  return page(
    "/operator/identity-changes",
    query,
    identityChange,
    (item) => item.changeId,
    (item) => item.status === query.status,
    signal,
  );
}
