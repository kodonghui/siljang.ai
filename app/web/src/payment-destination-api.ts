import { type ApiResult, request } from "./api";
import { INVALID_API_RESPONSE, isApiObject } from "./api-response";

export interface PaymentDestination {
  readonly bankName: string;
  readonly accountNumber: string;
  readonly holderName: string;
  readonly holderMismatchConfirmed: boolean | null;
  readonly cardPaymentUrl: string | null;
  readonly createdAt: string;
  readonly revision: string;
}
export interface PaymentDestinationResult {
  readonly outcome: "created" | "unchanged";
  readonly paymentDestination: PaymentDestination;
}
export const isAccountNumber = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 10 && value.length <= 40 && /^-*([0-9]-*){10,16}$/.test(value);
export function isCardPaymentUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    [...value].length < 9 ||
    [...value].length > 2048 ||
    !value.startsWith("https://") ||
    /\s/.test(value) ||
    [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
const name = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "" && !value.includes("\0") && [...value].length <= 30;
export function isPaymentDestination(value: unknown): value is PaymentDestination {
  return (
    isApiObject(value) &&
    name(value.bankName) &&
    isAccountNumber(value.accountNumber) &&
    name(value.holderName) &&
    (value.holderMismatchConfirmed === null || typeof value.holderMismatchConfirmed === "boolean") &&
    (value.cardPaymentUrl === null || isCardPaymentUrl(value.cardPaymentUrl)) &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    typeof value.revision === "string" &&
    /^[A-Za-z0-9._-]{1,64}$/.test(value.revision)
  );
}
function copy(value: PaymentDestination): PaymentDestination {
  return {
    bankName: value.bankName,
    accountNumber: value.accountNumber,
    holderName: value.holderName,
    holderMismatchConfirmed: value.holderMismatchConfirmed,
    cardPaymentUrl: value.cardPaymentUrl,
    createdAt: value.createdAt,
    revision: value.revision,
  };
}
export async function fetchPaymentDestination(signal?: AbortSignal): Promise<ApiResult<PaymentDestination>> {
  const result = await request<unknown>("/owner/payment-destination", {
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  if (!result.ok) return result;
  return isPaymentDestination(result.data) ? { ...result, data: copy(result.data) } : INVALID_API_RESPONSE;
}
export async function savePaymentDestination(
  body: Record<string, unknown>,
  key: string,
): Promise<ApiResult<PaymentDestinationResult>> {
  const result = await request<unknown>("/owner/payment-destination", { method: "PUT", body, key });
  if (!result.ok) return result;
  const value = result.data;
  return isApiObject(value) &&
    (value.outcome === "created" || value.outcome === "unchanged") &&
    isPaymentDestination(value.paymentDestination)
    ? { ...result, data: { outcome: value.outcome, paymentDestination: copy(value.paymentDestination) } }
    : INVALID_API_RESPONSE;
}
