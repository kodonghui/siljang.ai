import type { OperatorAlertsQuery } from "./operator-alerts-api";
import { REVIEW_CURSOR_PATTERN } from "./operator-shops-api";
export function parseOperatorAlertsSearch(search: string): OperatorAlertsQuery | null {
  const params = new URLSearchParams(search);
  if (["limit", "cursor"].some((key) => params.getAll(key).length > 1)) return null;
  const raw = params.get("limit"),
    cursor = params.get("cursor");
  const limit = raw === null ? 20 : /^[0-9]+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (cursor !== null && !REVIEW_CURSOR_PATTERN.test(cursor)))
    return null;
  return { limit, cursor };
}
export function operatorAlertsHref(query: OperatorAlertsQuery): string {
  const params = new URLSearchParams();
  if (query.limit !== 20) params.set("limit", String(query.limit));
  if (query.cursor !== null) params.set("cursor", query.cursor);
  const search = params.toString();
  return `/operator/alerts${search ? `?${search}` : ""}`;
}
