import { numberOrText } from "./form-values";
/** SCR-034/API-010의 편집 가능 값. 사업자 신원·영업 신고 값은 저장 본문에 넣지 않는다. */
export interface ShopEditableSettings {
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
export type ShopSettingsSource = ShopEditableSettings & { readonly revision: string };
export type ShopSettingsForm = {
  [Key in keyof ShopEditableSettings]: ShopEditableSettings[Key] extends boolean ? boolean : string;
};
export function settingsForm(shop: ShopSettingsSource): ShopSettingsForm {
  return {
    name: shop.name,
    contactPhone: shop.contactPhone,
    businessAddress: shop.businessAddress,
    contactEmail: shop.contactEmail,
    pickupAddress: shop.pickupAddress ?? "",
    mailOrderRegNo: shop.mailOrderRegNo ?? "",
    mailOrderAuthority: shop.mailOrderAuthority ?? "",
    mailOrderExemption: shop.mailOrderExemption ?? "",
    completionPhotoEnabled: shop.completionPhotoEnabled,
    idleCloseHours: String(shop.idleCloseHours),
    ownerWaitMinutes: String(shop.ownerWaitMinutes),
    dailyAiCostLimitKrw: String(shop.dailyAiCostLimitKrw),
    awaitingPaymentLimit: String(shop.awaitingPaymentLimit),
  };
}
export function settingsPatch(original: ShopSettingsSource, form: ShopSettingsForm): Record<string, unknown> | null {
  const nullable = (value: string) => (value === "" ? null : value);
  const registered = form.mailOrderRegNo.trim() !== "";
  const values = {
    name: form.name,
    contactPhone: form.contactPhone,
    businessAddress: form.businessAddress,
    contactEmail: form.contactEmail,
    pickupAddress: nullable(form.pickupAddress),
    mailOrderRegNo: registered ? form.mailOrderRegNo : null,
    mailOrderAuthority: registered ? nullable(form.mailOrderAuthority) : null,
    mailOrderExemption: registered ? null : nullable(form.mailOrderExemption),
    completionPhotoEnabled: form.completionPhotoEnabled,
    idleCloseHours: numberOrText(form.idleCloseHours),
    ownerWaitMinutes: numberOrText(form.ownerWaitMinutes),
    dailyAiCostLimitKrw: numberOrText(form.dailyAiCostLimitKrw),
    awaitingPaymentLimit: numberOrText(form.awaitingPaymentLimit),
  };
  const changed = Object.entries(values).filter(
    ([key, value]) => value !== original[key as keyof ShopEditableSettings],
  );
  return changed.length === 0 ? null : { baseRevision: original.revision, ...Object.fromEntries(changed) };
}
