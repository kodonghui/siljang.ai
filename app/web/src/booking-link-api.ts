import { type ApiResult, request } from "./api";
import { INVALID_API_RESPONSE, isApiObject, isApiTimestamp } from "./api-response";
export const BOOKING_CONDITIONS = [
  "license_verified",
  "price_list",
  "operating_rules",
  "calendar",
  "payment_destination",
  "kakao_channel",
  "privacy_policy",
] as const;
export type BookingCondition = (typeof BOOKING_CONDITIONS)[number];
export interface BookingLink {
  readonly status: "issued" | "not_ready";
  readonly url: string | null;
  readonly issuedAt: string | null;
  readonly missing: readonly BookingCondition[];
  readonly recommended: readonly "pickup_address"[];
}
function url(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    [...value].length > 2048 ||
    /\s/.test(value) ||
    [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.username === "" && parsed.password === "";
  } catch {
    return false;
  }
}
function timestamp(value: unknown): value is string {
  if (
    !isApiTimestamp(value) ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
  )
    return false;
  return new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === value.slice(0, 10);
}
function valid(value: unknown): value is BookingLink {
  if (
    !isApiObject(value) ||
    !Array.isArray(value.missing) ||
    value.missing.length > 7 ||
    new Set(value.missing).size !== value.missing.length ||
    !value.missing.every(
      (item) => typeof item === "string" && BOOKING_CONDITIONS.some((condition) => condition === item),
    )
  )
    return false;
  if (
    !Array.isArray(value.recommended) ||
    value.recommended.length > 1 ||
    !value.recommended.every((item) => item === "pickup_address")
  )
    return false;
  return value.status === "issued"
    ? url(value.url) && timestamp(value.issuedAt) && value.missing.length === 0
    : value.status === "not_ready" && value.url === null && value.issuedAt === null && value.missing.length > 0;
}
export async function fetchBookingLink(signal?: AbortSignal): Promise<ApiResult<BookingLink>> {
  const result = await request<unknown>("/owner/booking-link", { cache: "no-store", ...(signal ? { signal } : {}) });
  if (!result.ok) return result;
  const value = result.data;
  return valid(value)
    ? {
        ...result,
        data: {
          status: value.status,
          url: value.url,
          issuedAt: value.issuedAt,
          missing: [...value.missing],
          recommended: [...value.recommended],
        },
      }
    : INVALID_API_RESPONSE;
}
