/** 등록/설정에서 같은 연락처·통신판매업 규칙을 쓴다. 오류에는 입력 값을 넣지 않는다. */
import type { FieldError } from "./problem";

export interface ShopTextRule {
  min: number;
  max: number;
  pattern?: RegExp;
  nullable?: true;
  allowed?: readonly string[];
}
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
