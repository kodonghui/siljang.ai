/** API-015: 운영 기록의 내용 없이 알림 종류/가게 요약/건수만 보인다. */
import { parseReviewQueue, reviewCursor } from "./license-review-input";
import { OPERATOR_ALERT_COUNT_MAX } from "./ops-events";
import { DEFAULT_TIME_ZONE } from "./owner-scope";
import type { OperatorRequest } from "./routes";
import { toShopIso } from "./time";

export async function listOperatorAlerts(r: OperatorRequest): Promise<Response> {
  const input = parseReviewQueue({ ...r.req.query(), status: "alerts" }, ["alerts"] as const),
    rows = await r.alerts.list(input),
    page = rows.slice(0, input.limit),
    last = page.at(-1);
  return r.json({
    items: page.map((row) => {
      if (!Number.isSafeInteger(row.count) || row.count < 0 || row.count > OPERATOR_ALERT_COUNT_MAX)
        throw new Error("invalid operator alert count");
      return {
        alertId: row.id,
        kind: row.kind,
        count: row.count,
        shop: row.shop_id === null ? null : { shopId: row.shop_id, name: row.shop_name },
        createdAt: toShopIso(row.created_at, row.time_zone ?? DEFAULT_TIME_ZONE),
      };
    }),
    nextCursor: rows.length > input.limit && last ? reviewCursor("alerts", last.cursor_at, last.id) : null,
  });
}
