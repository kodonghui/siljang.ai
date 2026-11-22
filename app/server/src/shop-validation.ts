/** 등록/설정에서 같은 연락처·통신판매업 규칙을 쓴다. 오류에는 입력 값을 넣지 않는다. */
import type { FieldError } from "./problem";

export interface ShopTextRule {
  min: number;
  max: number;
  pattern?: RegExp;
  nullable?: true;
  allowed?: readonly string[];
}
export function validateShopText(input: Record<string, unknown>, rules: Record<string, ShopTextRule>) {
  const values: Record<string, unknown> = {},
    errors: FieldError[] = [];
  for (const [name, rule] of Object.entries(rules)) {
    const value = input[name],
      field = `/${name}`;
    if (rule.nullable && (value === undefined || value === null)) values[name] = null;
    else if (value === undefined) errors.push({ field, code: "required" });
    else if (typeof value !== "string" || value.includes("\0")) errors.push({ field, code: "bad_format" });
    else if (rule.allowed && !rule.allowed.includes(value)) errors.push({ field, code: "not_allowed" });
    else if (value.trim() === "" || [...value].length < rule.min) errors.push({ field, code: "too_short" });
    else if ([...value].length > rule.max) errors.push({ field, code: "too_long" });
    else if (rule.pattern && !rule.pattern.test(value)) errors.push({ field, code: "bad_format" });
    else values[name] = value;
  }
  return { values, errors };
}
export const SHOP_IDENTITY_TEXT = {
  businessName: { min: 1, max: 60 },
  representativeName: { min: 1, max: 30 },
  businessRegNo: { min: 10, max: 10, pattern: /^[0-9]{10}$/ },
} as const satisfies Record<string, ShopTextRule>;
export const SHOP_PHOTO_UPLOAD_RULE = { min: 24, max: 204, pattern: /^upl_[A-Za-z0-9_-]{20,200}$/ };
export const SHOP_LICENSE_TEXT = {
  foodLicenseNo: { min: 1, max: 30 },
  foodBusinessType: { min: 1, max: 100, allowed: ["instant_sale_manufacturing", "bakery"] },
  licensePhotoUploadId: SHOP_PHOTO_UPLOAD_RULE,
} as const satisfies Record<string, ShopTextRule>;
export const SHOP_COMMON_TEXT = {
  name: { min: 1, max: 40 },
  contactPhone: { min: 8, max: 14, pattern: /^[0-9-]{8,14}$/ },
  businessAddress: { min: 1, max: 200 },
  contactEmail: { min: 3, max: 100, pattern: /^[^@\s]+@[^@\s]+$/ },
  mailOrderRegNo: { min: 1, max: 40, nullable: true },
  mailOrderAuthority: { min: 1, max: 40, nullable: true },
  mailOrderExemption: { min: 1, max: 200, nullable: true },
} as const satisfies Record<string, ShopTextRule>;

export function shopMailOrderErrors(values: {
  mailOrderRegNo?: unknown;
  mailOrderAuthority?: unknown;
  mailOrderExemption?: unknown;
}): FieldError[] {
  const errors: FieldError[] = [];
  if (values.mailOrderRegNo && values.mailOrderAuthority === null)
    errors.push({ field: "/mailOrderAuthority", code: "required" });
  if (values.mailOrderAuthority && values.mailOrderRegNo === null)
    errors.push({ field: "/mailOrderRegNo", code: "required" });
  if (values.mailOrderRegNo === null && values.mailOrderExemption === null)
    errors.push({ field: "/mailOrderRegNo", code: "required" });
  if (values.mailOrderRegNo && values.mailOrderExemption)
    errors.push({ field: "/mailOrderExemption", code: "not_allowed" });
  return errors;
}
