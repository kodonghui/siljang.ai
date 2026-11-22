/** API-011의 신고 번호/종류/사진 규칙은 가게 등록과 함께 쓴다. */
import { ApiError, fieldError } from "./problem";
import { SHOP_LICENSE_TEXT, type ShopTextRule, validateShopText } from "./shop-validation";

export interface LicenseResubmission {
  readonly baseRevision: string;
  readonly foodLicenseNo: string;
  readonly foodBusinessType: "instant_sale_manufacturing" | "bakery";
  readonly licensePhotoUploadId: string;
}
export function parseLicenseResubmission(raw: unknown): LicenseResubmission {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw fieldError("/", "bad_format");
  const input = raw as Record<string, unknown>;
  const rules: Record<string, ShopTextRule> = {
    baseRevision: { min: 1, max: 64, pattern: /^[A-Za-z0-9._-]+$/ },
    ...SHOP_LICENSE_TEXT,
  };
  const { errors } = validateShopText(input, rules);
  for (const name of Object.keys(input))
    if (!Object.hasOwn(rules, name))
      errors.push({ field: /^[A-Za-z0-9_]{1,100}$/.test(name) ? `/${name}` : "/", code: "unknown_field" });
  if (errors.length) throw new ApiError("validation_failed", { errors: errors.slice(0, 50) });
  return input as unknown as LicenseResubmission;
}
