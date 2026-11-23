/** API018/019는 읽기 전용이며 화면의 버전 번호만 경로로 만든다. */
import { type ApiResult, request } from "./api";
import { INVALID_API_RESPONSE, isApiObject } from "./api-response";
import {
  isPriceList,
  MAX_PRICE_VERSION,
  type PriceList,
  isPriceTimestamp as timestamp,
  isPriceVersion as version,
} from "./price-list-api";
import { parseProblem } from "./problems";
export interface PriceVersion {
  readonly version: number;
  readonly createdAt: string;
  readonly supersededAt: string | null;
}
export interface PriceVersions {
  readonly items: readonly PriceVersion[];
}
export async function fetchPriceListVersions(signal?: AbortSignal): Promise<ApiResult<PriceVersions>> {
  const result = await request<unknown>("/owner/price-list/versions", { ...(signal ? { signal } : {}) });
  if (!result.ok) return result;
  const data = result.data;
  if (!isApiObject(data) || !Array.isArray(data.items) || data.items.length > 1000) return INVALID_API_RESPONSE;
  let previous = MAX_PRICE_VERSION + 1;
  const rows: PriceVersion[] = [];
  for (const [i, row] of data.items.entries()) {
    if (
      !isApiObject(row) ||
      !version(row.version) ||
      row.version >= previous ||
      !timestamp(row.createdAt) ||
      !(row.supersededAt === null || timestamp(row.supersededAt)) ||
      (i > 0 && row.supersededAt === null)
    )
      return INVALID_API_RESPONSE;
    rows.push({ version: row.version, createdAt: row.createdAt, supersededAt: row.supersededAt });
    previous = row.version;
  }
  return { ...result, data: { items: rows } };
}
export function priceVersion(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^\d{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  return version(n) ? n : null;
}
export async function fetchPriceListVersion(raw: unknown, signal?: AbortSignal): Promise<ApiResult<PriceList>> {
  const n = priceVersion(raw);
  if (n === null)
    return { ok: false, status: 404, problem: parseProblem({ code: "not_found" }, 404), retryAfterSeconds: null };
  const result = await request<unknown>(`/owner/price-list/versions/${n}`, { ...(signal ? { signal } : {}) });
  if (!result.ok) return result;
  return isPriceList(result.data) && result.data.version === n
    ? { ...result, data: result.data }
    : INVALID_API_RESPONSE;
}
