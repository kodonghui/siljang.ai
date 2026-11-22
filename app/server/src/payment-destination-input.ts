/** 결제 계좌 입력(API-025). 원래 계좌번호와 입력 값은 오류/로그에 싣지 않는다. */
import { isAccountNumber } from "./account-number";
import { ApiError, type FieldError, fieldError } from "./problem";

export interface PaymentDestinationInput {
  readonly baseRevision: string | null;
  readonly bankName: string;
  readonly accountNumber: string;
  readonly holderName: string;
  readonly cardPaymentUrl: string | null;
  readonly confirm: readonly "holder_mismatch"[];
}

export function parsePaymentDestination(raw: unknown): PaymentDestinationInput {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw fieldError("/", "bad_format");
  const input = raw as Record<string, unknown>;
  const errors: FieldError[] = [];
  const required = ["baseRevision", "bankName", "accountNumber", "holderName", "cardPaymentUrl"];
  for (const key of required) if (!Object.hasOwn(input, key)) errors.push({ field: `/${key}`, code: "required" });
  for (const key of Object.keys(input)) {
    if (!required.includes(key) && key !== "confirm")
      errors.push({ field: /^[A-Za-z0-9_]{1,100}$/.test(key) ? `/${key}` : "/", code: "unknown_field" });
  }
  if (
    input.baseRevision !== undefined &&
    input.baseRevision !== null &&
    (typeof input.baseRevision !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(input.baseRevision))
  )
    errors.push({ field: "/baseRevision", code: "bad_format" });
  for (const key of ["bankName", "holderName"] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.includes("\0")) errors.push({ field: `/${key}`, code: "bad_format" });
    else if (value.trim() === "") errors.push({ field: `/${key}`, code: "too_short" });
    else if ([...value].length > 30) errors.push({ field: `/${key}`, code: "too_long" });
  }
  if (input.accountNumber !== undefined && !isAccountNumber(input.accountNumber))
    errors.push({ field: "/accountNumber", code: "bad_format" });
  if (input.cardPaymentUrl !== undefined && input.cardPaymentUrl !== null) {
    const url = input.cardPaymentUrl;
    let valid =
      typeof url === "string" &&
      [...url].length >= 9 &&
      [...url].length <= 2048 &&
      /^https:\/\//.test(url) &&
      !/\s/.test(url) &&
      [...url].every((char) => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127);
    if (valid) {
      try {
        valid = new URL(url as string).protocol === "https:";
      } catch {
        valid = false;
      }
    }
    if (!valid) errors.push({ field: "/cardPaymentUrl", code: "bad_format" });
  }
  if (
    input.confirm !== undefined &&
    (!Array.isArray(input.confirm) || input.confirm.length > 1 || input.confirm.some((v) => v !== "holder_mismatch"))
  )
    errors.push({ field: "/confirm", code: "not_allowed" });
  if (errors.length) throw new ApiError("validation_failed", { errors: errors.slice(0, 50) });
  return { ...input, confirm: input.confirm ?? [] } as unknown as PaymentDestinationInput;
}
