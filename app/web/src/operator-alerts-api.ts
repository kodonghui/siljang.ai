import { type ApiResult, request } from "./api";
import { INVALID_API_RESPONSE, isApiInteger, isApiObject, isApiTimestamp, UUID_PATTERN } from "./api-response";
import { REVIEW_CURSOR_PATTERN } from "./operator-shops-api";
export const OPERATOR_ALERT_LABELS = {
  channel_already_linked: "다른 가게에 이미 연결된 채널",
  privacy_transfer_missing: "처리방침 국외 이전 항목 누락",
  ai_failure_burst: "AI 실패 반복(5분에 5번)",
} as const;
export interface OperatorAlert {
  readonly alertId: string;
  readonly kind: keyof typeof OPERATOR_ALERT_LABELS;
  readonly shop: { readonly shopId: string; readonly name: string } | null;
  readonly count: number;
  readonly createdAt: string;
}
export interface OperatorAlertsQuery {
  readonly limit: number;
  readonly cursor: string | null;
}
export interface OperatorAlertsPage {
  readonly items: readonly OperatorAlert[];
  readonly nextCursor: string | null;
}
function alert(value: unknown): value is OperatorAlert {
  if (
    !isApiObject(value) ||
    typeof value.alertId !== "string" ||
    !UUID_PATTERN.test(value.alertId) ||
    typeof value.kind !== "string" ||
    !Object.hasOwn(OPERATOR_ALERT_LABELS, value.kind) ||
    !isApiInteger(value.count, 1000000) ||
    !isApiTimestamp(value.createdAt)
  )
    return false;
  const shop = value.shop;
  return (
    shop === null ||
    (isApiObject(shop) &&
      typeof shop.shopId === "string" &&
      UUID_PATTERN.test(shop.shopId) &&
      typeof shop.name === "string" &&
      [...shop.name].length >= 1 &&
      [...shop.name].length <= 40)
  );
}
export async function fetchOperatorAlerts(
  query: OperatorAlertsQuery,
  signal?: AbortSignal,
): Promise<ApiResult<OperatorAlertsPage>> {
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) return INVALID_API_RESPONSE;
  const params = new URLSearchParams({ limit: String(query.limit) });
  if (query.cursor !== null) params.set("cursor", query.cursor);
  const result = await request<unknown>(`/operator/alerts?${params}`, {
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  if (!result.ok) return result;
  const value = result.data;
  if (
    !isApiObject(value) ||
    !Array.isArray(value.items) ||
    value.items.length > query.limit ||
    !value.items.every(alert) ||
    !(
      value.nextCursor === null ||
      (typeof value.nextCursor === "string" && REVIEW_CURSOR_PATTERN.test(value.nextCursor))
    ) ||
    (value.nextCursor !== null && value.nextCursor === query.cursor) ||
    new Set(value.items.map((item) => item.alertId)).size !== value.items.length
  )
    return INVALID_API_RESPONSE;
  return {
    ...result,
    data: {
      items: value.items.map((item) => ({
        alertId: item.alertId,
        kind: item.kind,
        shop: item.shop === null ? null : { shopId: item.shop.shopId, name: item.shop.name },
        count: item.count,
        createdAt: item.createdAt,
      })),
      nextCursor: value.nextCursor,
    },
  };
}
