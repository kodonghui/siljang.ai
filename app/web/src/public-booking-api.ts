import { type ApiFailure, type ApiResult, request } from "./api";
import { INVALID_API_RESPONSE, isApiObject, isApiVersion } from "./api-response";
import { isPublicShopSlug } from "./public-privacy-api";

export interface PublicPriceOption {
  readonly group: "size" | "flavor" | "design" | "extra";
  readonly name: string;
  readonly priceKind: "fixed" | "from" | "range";
  readonly amount: number;
  readonly amountMax: number | null;
  readonly inStandard: boolean;
}
export interface PublicBookingPage {
  readonly shop: {
    readonly name: string;
    readonly businessName: string;
    readonly representativeName: string;
    readonly businessAddress: string;
    readonly contactPhone: string;
    readonly contactEmail: string;
    readonly businessRegNo: string;
    readonly mailOrderRegNo: string | null;
    readonly mailOrderAuthority: string | null;
    readonly mailOrderExemption: string | null;
    readonly pickupAddress: string | null;
  };
  readonly priceList: {
    readonly version: number;
    readonly options: readonly PublicPriceOption[];
    readonly designs: readonly { readonly name: string; readonly imageUrl: string; readonly inStandard: boolean }[];
  };
  readonly days: readonly { readonly day: string; readonly status: "open" | "closed" | "day_off" }[];
  readonly portfolio: readonly { readonly imageUrl: string }[];
  readonly privacyPolicyUrl: string;
  readonly inquiryUrl: string | null;
}
const text = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.trim().length > 0 && !v.includes("\0") && [...v].length <= max;
const nullableText = (v: unknown, max: number): v is string | null => v === null || text(v, max);
const money = (v: unknown): v is number => Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 10_000_000;
function url(v: unknown): v is string {
  if (!text(v, 2048)) return false;
  try {
    const parsed = new URL(v);
    return ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}
function option(v: unknown): v is PublicPriceOption {
  return (
    isApiObject(v) &&
    ["size", "flavor", "design", "extra"].includes(String(v.group)) &&
    text(v.name, 30) &&
    ["fixed", "from", "range"].includes(String(v.priceKind)) &&
    money(v.amount) &&
    (v.priceKind === "range" ? money(v.amountMax) && v.amountMax >= v.amount : v.amountMax === null) &&
    typeof v.inStandard === "boolean"
  );
}
function bookingPage(v: unknown): v is PublicBookingPage {
  if (!isApiObject(v) || !isApiObject(v.shop) || !isApiObject(v.priceList)) return false;
  const shop = v.shop,
    list = v.priceList;
  if (
    !text(shop.name, 40) ||
    !text(shop.businessName, 60) ||
    !text(shop.representativeName, 30) ||
    !text(shop.businessAddress, 200) ||
    typeof shop.contactPhone !== "string" ||
    !/^[0-9-]{8,14}$/.test(shop.contactPhone) ||
    !text(shop.contactEmail, 100) ||
    !/^[^@\s]+@[^@\s]+$/.test(shop.contactEmail) ||
    typeof shop.businessRegNo !== "string" ||
    !/^\d{10}$/.test(shop.businessRegNo) ||
    !nullableText(shop.mailOrderRegNo, 40) ||
    !nullableText(shop.mailOrderAuthority, 40) ||
    !nullableText(shop.mailOrderExemption, 200) ||
    !nullableText(shop.pickupAddress, 200)
  )
    return false;
  if (
    !isApiVersion(list.version) ||
    !Array.isArray(list.options) ||
    list.options.length > 100 ||
    !list.options.every(option) ||
    !Array.isArray(list.designs) ||
    list.designs.length > 50 ||
    !list.designs.every(
      (d) => isApiObject(d) && text(d.name, 30) && url(d.imageUrl) && typeof d.inStandard === "boolean",
    ) ||
    !Array.isArray(v.portfolio) ||
    v.portfolio.length > 100 ||
    !v.portfolio.every((p) => isApiObject(p) && url(p.imageUrl)) ||
    !url(v.privacyPolicyUrl) ||
    !(v.inquiryUrl === null || url(v.inquiryUrl))
  )
    return false;
  if (
    v.inquiryUrl !== null &&
    (new URL(v.inquiryUrl).protocol !== "https:" || new URL(v.inquiryUrl).hostname !== "pf.kakao.com")
  )
    return false;
  if (!Array.isArray(v.days) || v.days.length < 60 || v.days.length > 61) return false;
  let previous: number | null = null;
  for (const day of v.days) {
    if (
      !isApiObject(day) ||
      typeof day.day !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(day.day) ||
      !["open", "closed", "day_off"].includes(String(day.status))
    )
      return false;
    const time = Date.parse(`${day.day}T00:00:00Z`);
    if (
      !Number.isFinite(time) ||
      new Date(time).toISOString().slice(0, 10) !== day.day ||
      (previous !== null && time - previous !== 86_400_000)
    )
      return false;
    previous = time;
  }
  return true;
}
const notFound: ApiFailure = { ok: false, status: 404, problem: null, retryAfterSeconds: null };
/** API-038의 공개 필드만 복사한다. ID·남은 자리·손님/주문 기록은 화면 상태로 옮기지 않는다. */
export async function fetchPublicBooking(slug: string, signal?: AbortSignal): Promise<ApiResult<PublicBookingPage>> {
  if (!isPublicShopSlug(slug)) return notFound;
  const response = await request<unknown>(`/public/shops/${encodeURIComponent(slug)}`, {
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) return response;
  const v = response.data;
  if (!bookingPage(v)) return INVALID_API_RESPONSE;
  const s = v.shop;
  return {
    ...response,
    data: {
      shop: {
        name: s.name,
        businessName: s.businessName,
        representativeName: s.representativeName,
        businessAddress: s.businessAddress,
        contactPhone: s.contactPhone,
        contactEmail: s.contactEmail,
        businessRegNo: s.businessRegNo,
        mailOrderRegNo: s.mailOrderRegNo,
        mailOrderAuthority: s.mailOrderAuthority,
        mailOrderExemption: s.mailOrderExemption,
        pickupAddress: s.pickupAddress,
      },
      priceList: {
        version: v.priceList.version,
        options: v.priceList.options.map((o) => ({
          group: o.group,
          name: o.name,
          priceKind: o.priceKind,
          amount: o.amount,
          amountMax: o.amountMax,
          inStandard: o.inStandard,
        })),
        designs: v.priceList.designs.map((d) => ({ name: d.name, imageUrl: d.imageUrl, inStandard: d.inStandard })),
      },
      days: v.days.map((d) => ({ day: d.day, status: d.status })),
      portfolio: v.portfolio.map((p) => ({ imageUrl: p.imageUrl })),
      privacyPolicyUrl: v.privacyPolicyUrl,
      inquiryUrl: v.inquiryUrl,
    },
  };
}
