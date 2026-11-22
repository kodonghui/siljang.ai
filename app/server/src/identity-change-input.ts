/** API-080 사업자 변경은 확인된 값 셋과 증빙 업로드 하나만 받는다. */

import { parseDecisionReview, parseReviewQueue } from "./license-review-input";
import { ApiError, fieldError } from "./problem";
import { businessRegChecksum } from "./shop-input";
import { SHOP_IDENTITY_TEXT, SHOP_PHOTO_UPLOAD_RULE, validateShopText } from "./shop-validation";

export const parseIdentityChangeList = (query: Record<string, string>) =>
  parseReviewQueue(query, ["pending", "applied", "on_hold"] as const, "not_allowed");
export const parseIdentityChangeReview = (raw: unknown) => parseDecisionReview(raw, "applied");
export type IdentityChangeListInput = ReturnType<typeof parseIdentityChangeList>;

export interface IdentityChangeInput {
  readonly baseRevision: string;
  readonly businessName: string;
  readonly representativeName: string;
  readonly businessRegNo: string;
  readonly evidencePhotoUploadId: string;
}
export function parseIdentityChange(raw: unknown): IdentityChangeInput {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw fieldError("/", "bad_format");
  const input = raw as Record<string, unknown>;
  const rules = {
    baseRevision: { min: 1, max: 64, pattern: /^[A-Za-z0-9._-]+$/ },
    ...SHOP_IDENTITY_TEXT,
    evidencePhotoUploadId: SHOP_PHOTO_UPLOAD_RULE,
  };
  const { errors } = validateShopText(input, rules);
  for (const key of Object.keys(input))
    if (!Object.hasOwn(rules, key))
      errors.push({ field: /^[A-Za-z0-9_]{1,100}$/.test(key) ? `/${key}` : "/", code: "unknown_field" });
  if (
    typeof input.businessRegNo === "string" &&
    /^[0-9]{10}$/.test(input.businessRegNo) &&
    !businessRegChecksum(input.businessRegNo)
  )
    errors.push({ field: "/businessRegNo", code: "checksum_failed" });
  if (errors.length) throw new ApiError("validation_failed", { errors: errors.slice(0, 50) });
  return input as unknown as IdentityChangeInput;
}
