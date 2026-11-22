/** 가게 등록 입력(API-008, SPEC-002). 검사 전의 입력은 저장하거나 로그에 남기지 않는다. */
import { ApiError, type FieldError, fieldError } from "./problem";
import { SHOP_COMMON_TEXT, type ShopTextRule, shopMailOrderErrors } from "./shop-validation";

export interface ShopRegistration {
  readonly name: string;
  readonly contactPhone: string;
  readonly businessAddress: string;
  readonly contactEmail: string;
  readonly businessName: string;
  readonly representativeName: string;
  readonly businessRegNo: string;
  readonly mailOrderRegNo: string | null;
  readonly mailOrderAuthority: string | null;
  readonly mailOrderExemption: string | null;
  readonly foodLicenseNo: string;
  readonly foodBusinessType: "instant_sale_manufacturing" | "bakery";
  readonly licensePhotoUploadId: string;
  readonly entrustmentTermsVersion: string;
  readonly entrustmentConsent: true;
}

const RULES: Record<string, ShopTextRule> = {
  ...SHOP_COMMON_TEXT,
  businessName: { min: 1, max: 60 },
  representativeName: { min: 1, max: 30 },
  businessRegNo: { min: 10, max: 10, pattern: /^[0-9]{10}$/ },
  foodLicenseNo: { min: 1, max: 30 },
  foodBusinessType: { min: 1, max: 100, allowed: ["instant_sale_manufacturing", "bakery"] },
  licensePhotoUploadId: { min: 24, max: 204, pattern: /^upl_[A-Za-z0-9_-]{20,200}$/ },
  entrustmentTermsVersion: { min: 1, max: 20, pattern: /^[0-9A-Za-z.-]+$/ },
};

export function businessRegChecksum(value: string): boolean {
  if (!/^[0-9]{10}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  const sum =
    weights.reduce((n, weight, i) => n + weight * (digits[i] ?? 0), 0) + Math.floor(((digits[8] ?? 0) * 5) / 10);
  return (10 - (sum % 10)) % 10 === digits[9];
}

export function parseShopRegistration(body: unknown): ShopRegistration {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw fieldError("/", "bad_format");
  const input = body as Record<string, unknown>;
  if (input.entrustmentConsent === false) throw new ApiError("consent_required");
  const errors: FieldError[] = [];
  const result: Record<string, unknown> = {};
  for (const [name, rule] of Object.entries(RULES)) {
    const value = input[name];
    const field = `/${name}`;
    if (rule.nullable && (value === undefined || value === null)) {
      result[name] = null;
      continue;
    }
    if (value === undefined) errors.push({ field, code: "required" });
    else if (typeof value !== "string" || value.includes("\0")) errors.push({ field, code: "bad_format" });
    else if (rule.allowed && !rule.allowed.includes(value)) errors.push({ field, code: "not_allowed" });
    else if ([...value].length < rule.min || value.trim() === "") errors.push({ field, code: "too_short" });
    else if ([...value].length > rule.max) errors.push({ field, code: "too_long" });
    else if (rule.pattern && !rule.pattern.test(value)) errors.push({ field, code: "bad_format" });
    else result[name] = value;
  }
  if (input.entrustmentConsent === undefined) errors.push({ field: "/entrustmentConsent", code: "required" });
  else if (input.entrustmentConsent !== true) errors.push({ field: "/entrustmentConsent", code: "bad_format" });
  for (const name of Object.keys(input))
    if (!Object.hasOwn(RULES, name) && name !== "entrustmentConsent")
      errors.push({ field: /^[A-Za-z0-9_]{1,100}$/.test(name) ? `/${name}` : "/", code: "unknown_field" });
  if (typeof result.businessRegNo === "string" && !businessRegChecksum(result.businessRegNo))
    errors.push({ field: "/businessRegNo", code: "checksum_failed" });
  errors.push(...shopMailOrderErrors(result));
  if (errors.length) throw new ApiError("validation_failed", { errors: errors.slice(0, 50) });
  return { ...result, entrustmentConsent: true } as unknown as ShopRegistration;
}
