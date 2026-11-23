import { type ApiResult, request } from "./api";
import { INVALID_API_RESPONSE as INVALID, isApiObject as object, UUID_PATTERN } from "./api-response";

import { type UploadedPhoto, uploadPhoto } from "./photo-upload-api";

export type OptionGroup = "size" | "flavor" | "design" | "extra";
export type PriceKind = "fixed" | "from" | "range";
export interface PriceOption {
  readonly optionId: string;
  readonly group: OptionGroup;
  readonly name: string;
  readonly priceKind: PriceKind;
  readonly amount: number;
  readonly amountMax: number | null;
  readonly inStandard: boolean;
  readonly position: number;
}
export interface PriceRule {
  readonly kind: "exclude" | "surcharge";
  readonly optionAId: string;
  readonly optionBId: string;
  readonly amount: number | null;
}
export interface PriceDesign {
  readonly designId: string;
  readonly name: string;
  readonly imageUrl: string;
  readonly optionId: string | null;
  readonly inStandard: boolean;
  readonly position: number;
}
export interface PriceList {
  readonly version: number;
  readonly current: boolean;
  readonly createdAt: string;
  readonly supersededAt: string | null;
  readonly revision: string;
  readonly options: readonly PriceOption[];
  readonly rules: readonly PriceRule[];
  readonly designs: readonly PriceDesign[];
}
export interface PriceListResult {
  readonly outcome: "created" | "unchanged";
  readonly priceList: PriceList;
}
export type UploadedDesign = UploadedPhoto<"design_image">;
const text = (v: unknown): v is string => typeof v === "string";
const uuid = (v: unknown): v is string => text(v) && UUID_PATTERN.test(v);
const date = (v: unknown): v is string => text(v) && Number.isFinite(Date.parse(v));
const integer = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const name = (v: unknown): v is string => text(v) && v.length > 0 && v.length <= 30;
const member = (v: unknown, choices: readonly string[]) => text(v) && choices.includes(v);
const list = (v: unknown, max: number): v is unknown[] => Array.isArray(v) && v.length <= max;
function imageUrl(v: unknown): v is string {
  if (!text(v)) return false;
  try {
    const url = new URL(v);
    return ["https:", "http:"].includes(url.protocol) && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}
function option(v: unknown): v is PriceOption {
  return (
    object(v) &&
    uuid(v.optionId) &&
    name(v.name) &&
    member(v.group, ["size", "flavor", "design", "extra"]) &&
    member(v.priceKind, ["fixed", "from", "range"]) &&
    integer(v.amount, 0, 10000000) &&
    (v.amountMax === null || integer(v.amountMax, 0, 10000000)) &&
    typeof v.inStandard === "boolean" &&
    integer(v.position, 0, 32767)
  );
}
/** 현재/이전 버전의 공통 응답. 편집 경로에서는 current도 확인한다. */
export function isPriceList(v: unknown): v is PriceList {
  if (
    !object(v) ||
    !integer(v.version, 1, 2147483647) ||
    typeof v.current !== "boolean" ||
    !date(v.createdAt) ||
    !(v.supersededAt === null || date(v.supersededAt)) ||
    !text(v.revision) ||
    !/^[A-Za-z0-9._-]{1,64}$/.test(v.revision) ||
    !list(v.options, 100) ||
    !v.options.every(option) ||
    !list(v.rules, 500) ||
    !list(v.designs, 50)
  )
    return false;
  const options = new Set(v.options.map((o) => o.optionId));
  if (options.size !== v.options.length) return false;
  if (
    !v.rules.every(
      (r) =>
        object(r) &&
        member(r.kind, ["exclude", "surcharge"]) &&
        uuid(r.optionAId) &&
        uuid(r.optionBId) &&
        options.has(r.optionAId) &&
        options.has(r.optionBId) &&
        r.optionAId !== r.optionBId &&
        (r.kind === "exclude" ? r.amount === null : integer(r.amount, 1, 10000000)),
    )
  )
    return false;
  return v.designs.every(
    (d) =>
      object(d) &&
      uuid(d.designId) &&
      name(d.name) &&
      imageUrl(d.imageUrl) &&
      (d.optionId === null || (uuid(d.optionId) && options.has(d.optionId))) &&
      typeof d.inStandard === "boolean" &&
      integer(d.position, 0, 32767),
  );
}
export async function fetchPriceList(signal?: AbortSignal): Promise<ApiResult<PriceList>> {
  const result = await request<unknown>("/owner/price-list", { ...(signal ? { signal } : {}) });
  if (!result.ok) return result;
  return isPriceList(result.data) && result.data.current ? { ...result, data: result.data } : INVALID;
}
export async function savePriceList(body: Record<string, unknown>, key: string): Promise<ApiResult<PriceListResult>> {
  const result = await request<unknown>("/owner/price-list/versions", { method: "POST", body, key });
  if (!result.ok) return result;
  const value = result.data;
  return object(value) &&
    (value.outcome === "created" || value.outcome === "unchanged") &&
    isPriceList(value.priceList) &&
    value.priceList.current
    ? { ...result, data: { outcome: value.outcome, priceList: value.priceList } }
    : INVALID;
}
export function uploadDesignImage(file: File, signal?: AbortSignal): Promise<ApiResult<UploadedDesign>> {
  return uploadPhoto("design_image", file, signal);
}
