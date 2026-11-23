import { type ApiResult, request } from "./api";
import { INVALID_API_RESPONSE, isApiObject, isApiTimestamp, isApiVersion } from "./api-response";
import { parseProblem } from "./problems";

export interface VersionEntry {
  readonly version: number;
  readonly createdAt: string;
  readonly supersededAt: string | null;
}
export interface VersionList {
  readonly items: readonly VersionEntry[];
}
type HistoryPath = "/owner/price-list/versions" | "/owner/operating-rules/versions";
function isVersionList(value: unknown): value is VersionList {
  if (!isApiObject(value) || !Array.isArray(value.items) || value.items.length > 1000) return false;
  let previous = Infinity;
  for (const row of value.items) {
    if (
      !isApiObject(row) ||
      !isApiVersion(row.version) ||
      row.version >= previous ||
      !isApiTimestamp(row.createdAt) ||
      !(row.supersededAt === null || isApiTimestamp(row.supersededAt))
    )
      return false;
    previous = row.version;
  }
  return true;
}
export function parseVersion(raw: string): number | null {
  if (!/^\d{1,10}$/.test(raw)) return null;
  const value = Number(raw);
  return isApiVersion(value) ? value : null;
}
/** 06의 VersionList를 공유하는 두 화면은 같은 순서·범위·경로 규칙으로 읽는다. */
export function createVersionHistoryApi<T extends { readonly version: number | null }>(
  path: HistoryPath,
  validate: (value: unknown) => value is T,
) {
  return {
    async list(signal?: AbortSignal): Promise<ApiResult<VersionList>> {
      const result = await request<unknown>(path, { cache: "no-store", ...(signal ? { signal } : {}) });
      if (!result.ok) return result;
      if (!isVersionList(result.data)) return INVALID_API_RESPONSE;
      return {
        ...result,
        data: {
          items: result.data.items.map((row) => ({
            version: row.version,
            createdAt: row.createdAt,
            supersededAt: row.supersededAt,
          })),
        },
      };
    },
    async detail(raw: unknown, signal?: AbortSignal): Promise<ApiResult<T>> {
      const version = typeof raw === "string" ? parseVersion(raw) : null;
      if (version === null)
        return { ok: false, status: 404, problem: parseProblem({ code: "not_found" }, 404), retryAfterSeconds: null };
      const result = await request<unknown>(`${path}/${version}`, { cache: "no-store", ...(signal ? { signal } : {}) });
      if (!result.ok) return result;
      return validate(result.data) && result.data.version === version
        ? { ...result, data: result.data }
        : INVALID_API_RESPONSE;
    },
  };
}
