export function reviewReasonIssue(value: string): "bad_format" | "too_short" | "too_long" | null {
  if (value.includes("\u0000")) return "bad_format";
  if (value.trim().length === 0) return "too_short";
  return [...value].length > 200 ? "too_long" : null;
}
export function reviewPayload(baseRevision: string, decision: "verified" | "applied" | "on_hold", holdReason: string) {
  return { baseRevision, decision, ...(decision === "on_hold" ? { holdReason } : {}) };
}
export function reviewAvailability(value: {
  readonly licenseStatus: "pending" | "on_hold" | "verified";
  readonly hasAccount: boolean;
  readonly hasPendingChange: boolean;
}) {
  return {
    canVerify: value.licenseStatus !== "verified" && value.hasAccount && !value.hasPendingChange,
    canHold: value.licenseStatus !== "verified",
    canReviewIdentity: value.hasPendingChange,
  };
}
