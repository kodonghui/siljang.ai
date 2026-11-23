import { type ApiFailure, type ApiResult, request } from "./api";
import { INVALID_API_RESPONSE, isApiObject, isApiTimestamp, isApiVersion } from "./api-response";
export interface OverseasTransfer {
  readonly recipient: string;
  readonly country: string;
  readonly personalData: string;
  readonly whenAndHow: string;
  readonly purposeAndRetention: string;
  readonly howToRefuse: string;
}
export interface PublicPrivacyPolicy {
  readonly shopName: string;
  readonly version: number;
  readonly body: string;
  readonly overseasTransfers: readonly OverseasTransfer[];
  readonly publishedAt: string;
}
export const isPublicShopSlug = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9][a-z0-9-]{2,39}$/.test(value);
const NOT_FOUND: ApiFailure = { ok: false, status: 404, problem: null, retryAfterSeconds: null };
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && [...value].length <= max && !value.includes("\u0000");
function transfer(value: unknown): value is OverseasTransfer {
  return (
    isApiObject(value) &&
    text(value.recipient, 200) &&
    text(value.country, 100) &&
    text(value.personalData, 500) &&
    text(value.whenAndHow, 500) &&
    text(value.purposeAndRetention, 500) &&
    text(value.howToRefuse, 1000)
  );
}
const copyTransfer = (value: OverseasTransfer): OverseasTransfer => ({
  recipient: value.recipient,
  country: value.country,
  personalData: value.personalData,
  whenAndHow: value.whenAndHow,
  purposeAndRetention: value.purposeAndRetention,
  howToRefuse: value.howToRefuse,
});
export async function fetchPublicPrivacy(slug: string, signal?: AbortSignal): Promise<ApiResult<PublicPrivacyPolicy>> {
  if (!isPublicShopSlug(slug)) return NOT_FOUND;
  const result = await request<unknown>(`/public/shops/${encodeURIComponent(slug)}/privacy-policy`, {
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  if (!result.ok) return result;
  const value = result.data;
  if (
    !isApiObject(value) ||
    !text(value.shopName, 40) ||
    !isApiVersion(value.version) ||
    !text(value.body, 100000) ||
    !Array.isArray(value.overseasTransfers) ||
    value.overseasTransfers.length < 1 ||
    value.overseasTransfers.length > 20 ||
    !value.overseasTransfers.every(transfer) ||
    !isApiTimestamp(value.publishedAt)
  )
    return INVALID_API_RESPONSE;
  return {
    ...result,
    data: {
      shopName: value.shopName,
      version: value.version,
      body: value.body,
      overseasTransfers: value.overseasTransfers.map(copyTransfer),
      publishedAt: value.publishedAt,
    },
  };
}
