/** 실제 운영자의 알림 세 종류만 읽는다. 내용/임의 SQL/가게 쓰기는 제공하지 않는다. */
import type { Queryable } from "./db";
import type { ReviewQueueInput } from "./license-review-input";
import { isOperatorScope, type OperatorScope } from "./operator-scope";
import { ForgedScopeError } from "./shop-scope";

export interface OperatorAlertRow {
  id: string;
  kind: "channel_already_linked" | "privacy_transfer_missing" | "ai_failure_burst";
  count: number;
  created_at: Date;
  cursor_at: string;
  shop_id: string | null;
  shop_name: string | null;
  time_zone: string | null;
}
export interface OperatorAlertDirectory {
  list(input: Pick<ReviewQueueInput<string>, "limit" | "after">): Promise<readonly OperatorAlertRow[]>;
}
export function operatorAlertDirectory(db: Queryable, operator: OperatorScope): OperatorAlertDirectory {
  if (!isOperatorScope(operator)) throw new ForgedScopeError("operator alerts require genuine operator scope");
  return {
    async list(input) {
      return (
        await db.query<OperatorAlertRow>(
          `SELECT e.id,e.kind,e.count,e.created_at,s.id AS shop_id,s.name AS shop_name,s.time_zone,
        to_char(e.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
        FROM ops_events e LEFT JOIN shops s ON s.id=e.shop_id
        WHERE e.kind IN ('channel_already_linked','privacy_transfer_missing','ai_failure_burst')
        AND ($1::timestamptz IS NULL OR e.created_at<$1::timestamptz OR (e.created_at=$1::timestamptz AND e.id>$2::uuid))
        ORDER BY e.created_at DESC,e.id ASC LIMIT $3`,
          [input.after?.at ?? null, input.after?.id ?? null, input.limit + 1],
        )
      ).rows;
    },
  };
}
