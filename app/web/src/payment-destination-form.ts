import { cardPaymentUrlReason, isAccountNumber, type PaymentDestination } from "./payment-destination-api";
import type { FieldError } from "./problems";
export const PAYMENT_FIELDS = ["bankName", "accountNumber", "holderName", "cardPaymentUrl"] as const;
export type PaymentForm = Record<(typeof PAYMENT_FIELDS)[number], string>;
export function paymentForm(value: PaymentDestination | null): PaymentForm {
  return {
    bankName: value?.bankName ?? "",
    accountNumber: value?.accountNumber ?? "",
    holderName: value?.holderName ?? "",
    cardPaymentUrl: value?.cardPaymentUrl ?? "",
  };
}
export function paymentPayload(base: PaymentDestination | null, form: PaymentForm) {
  return {
    baseRevision: base?.revision ?? null,
    bankName: form.bankName,
    accountNumber: form.accountNumber,
    holderName: form.holderName,
    cardPaymentUrl: form.cardPaymentUrl.trim() === "" ? null : form.cardPaymentUrl,
  };
}
export function paymentIssues(form: PaymentForm): FieldError[] {
  const issues: FieldError[] = [];
  for (const key of ["bankName", "holderName"] as const) {
    const value = form[key];
    if (!value.trim()) issues.push({ field: `/${key}`, code: "required" });
    else if (value.includes("\0")) issues.push({ field: `/${key}`, code: "bad_format" });
    else if ([...value].length > 30) issues.push({ field: `/${key}`, code: "too_long" });
  }
  if (!form.accountNumber.trim()) issues.push({ field: "/accountNumber", code: "required" });
  else if (!isAccountNumber(form.accountNumber)) issues.push({ field: "/accountNumber", code: "bad_format" });
  if (form.cardPaymentUrl.trim()) {
    const reason = cardPaymentUrlReason(form.cardPaymentUrl);
    if (reason) issues.push({ field: "/cardPaymentUrl", code: reason });
  }
  return issues;
}
export function rebasePayment(
  base: PaymentDestination | null,
  mine: PaymentForm,
  latest: PaymentDestination,
): PaymentForm {
  const before = paymentForm(base),
    result = paymentForm(latest);
  for (const field of PAYMENT_FIELDS) if (mine[field] !== before[field]) result[field] = mine[field];
  return result;
}
