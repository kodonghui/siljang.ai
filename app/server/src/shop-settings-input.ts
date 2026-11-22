/** API-010: 입력한 필드만 검사하며 통신판매업의 결합 조건은 잠근 현재 값과 합쳐 검사한다. */
import { ApiError, type FieldError, fieldError } from "./problem";
import { SHOP_COMMON_TEXT, type ShopTextRule, shopMailOrderErrors } from "./shop-validation";

export const SHOP_SETTING_COLUMNS = {
  name: "name",
  contactPhone: "contact_phone",
  businessAddress: "business_address",
  contactEmail: "contact_email",
  pickupAddress: "pickup_address",
  mailOrderRegNo: "mail_order_reg_no",
  mailOrderAuthority: "mail_order_authority",
  mailOrderExemption: "mail_order_exemption",
  completionPhotoEnabled: "completion_photo_enabled",
  idleCloseHours: "idle_close_hours",
  ownerWaitMinutes: "owner_wait_minutes",
  dailyAiCostLimitKrw: "daily_ai_cost_limit_krw",
  awaitingPaymentLimit: "awaiting_payment_limit",
} as const;
export interface ShopSettingsValues {
  name: string;
  contactPhone: string;
  businessAddress: string;
  contactEmail: string;
  pickupAddress: string | null;
  mailOrderRegNo: string | null;
  mailOrderAuthority: string | null;
  mailOrderExemption: string | null;
  completionPhotoEnabled: boolean;
  idleCloseHours: number;
  ownerWaitMinutes: number;
  dailyAiCostLimitKrw: number;
  awaitingPaymentLimit: number;
}
export type ShopSettingKey = keyof typeof SHOP_SETTING_COLUMNS;
export interface ShopSettingsInput {
  readonly baseRevision: string;
  readonly changes: Partial<ShopSettingsValues>;
}
const STRINGS: Partial<Record<ShopSettingKey, ShopTextRule>> = {
  ...SHOP_COMMON_TEXT,
  pickupAddress: { min: 1, max: 200, nullable: true },
};
const NUMBERS: Partial<Record<ShopSettingKey, readonly [number, number]>> = {
  idleCloseHours: [1, 720],
  ownerWaitMinutes: [10, 1440],
  dailyAiCostLimitKrw: [0, 1000000],
  awaitingPaymentLimit: [0, 10],
};
export function parseShopSettings(raw: unknown): ShopSettingsInput {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw fieldError("/", "bad_format");
  const input = raw as Record<string, unknown>,
    errors: FieldError[] = [],
    changes: Record<string, unknown> = {};
  if (input.baseRevision === undefined) errors.push({ field: "/baseRevision", code: "required" });
  else if (typeof input.baseRevision !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(input.baseRevision))
    errors.push({ field: "/baseRevision", code: "bad_format" });
  for (const [name, value] of Object.entries(input)) {
    if (name === "baseRevision") continue;
    const field = /^[A-Za-z0-9_]{1,100}$/.test(name) ? `/${name}` : "/";
    if (!Object.hasOwn(SHOP_SETTING_COLUMNS, name)) {
      errors.push({ field, code: "unknown_field" });
      continue;
    }
    const key = name as ShopSettingKey,
      text = STRINGS[key],
      range = NUMBERS[key];
    if (text) {
      if (value === null && text.nullable) changes[key] = null;
      else if (typeof value !== "string" || value.includes("\0")) errors.push({ field, code: "bad_format" });
      else if ([...value].length < text.min || value.trim() === "") errors.push({ field, code: "too_short" });
      else if ([...value].length > text.max) errors.push({ field, code: "too_long" });
      else if (text.pattern && !text.pattern.test(value)) errors.push({ field, code: "bad_format" });
      else changes[key] = value;
    } else if (range) {
      if (typeof value !== "number" || !Number.isSafeInteger(value)) errors.push({ field, code: "bad_format" });
      else if (value < range[0] || value > range[1]) errors.push({ field, code: "out_of_range" });
      else changes[key] = value;
    } else if (typeof value !== "boolean") errors.push({ field, code: "bad_format" });
    else changes[key] = value;
  }
  if (Object.keys(input).filter((k) => k !== "baseRevision").length === 0)
    errors.push({ field: "/", code: "required" });
  if (errors.length) throw new ApiError("validation_failed", { errors: errors.slice(0, 50) });
  return { baseRevision: input.baseRevision as string, changes: changes as Partial<ShopSettingsValues> };
}
export function validateShopMailOrder(
  values: Pick<ShopSettingsValues, "mailOrderRegNo" | "mailOrderAuthority" | "mailOrderExemption">,
): void {
  const errors = shopMailOrderErrors(values);
  if (errors.length) throw new ApiError("validation_failed", { errors });
}
