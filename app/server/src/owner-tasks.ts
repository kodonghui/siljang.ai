/** API-040: 요약은 서버의 종류 이름만 사용하고 detail의 자유 입력은 돌려주지 않는다. */
import { fromBase64Url, toBase64Url } from "./encoding";
import { TASK_LABELS } from "./owner-alert-card";
import { ApiError, fieldError } from "./problem";
import type { AccessRequest } from "./routes";
import { isUuid } from "./shop-scope";
import { toShopIso } from "./time";

type TaskKind = keyof typeof TASK_LABELS;
interface TaskRow {
  id: string;
  kind: TaskKind;
  event_key: string;
  wait_status: string | null;
  wait_due_at: Date | null;
  opened_at: Date;
  closed_at: Date | null;
  order_id: string | null;
  handoff_id: string | null;
  change_request_id: string | null;
  issue_report_id: string | null;
  payment_request_id: string | null;
  refund_id: string | null;
  linked_order_id: string | null;
  order_no: string | null;
  customer_id: string | null;
  cursor_rank: number;
  cursor_phase: number;
  cursor_at: string;
}
export function ledgerDuplicateSummary(eventKey: string, orderNo: string | null): string | null {
  const id = eventKey.startsWith("task:ledger_duplicate:") ? eventKey.slice("task:ledger_duplicate:".length) : "";
  if (!isUuid(id) || orderNo === null || !/^[0-9A-Z]{6,8}$/.test(orderNo)) return null;
  return `장부에 같은 주문(주문번호 ${orderNo})이 두 줄 있어요. 하나를 지워 주세요`;
}
interface Cursor {
  rank: number;
  phase: number;
  at: string;
  id: string;
}
function input(query: Record<string, string>, shopId: string) {
  const status = query.status ?? "open";
  if (status !== "open" && status !== "closed") throw fieldError("query:status", "bad_format");
  if (query.limit !== undefined && !/^[0-9]+$/.test(query.limit)) throw fieldError("query:limit", "bad_format");
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw fieldError("query:limit", "out_of_range");
  let after: Cursor | null = null;
  if (query.cursor !== undefined) {
    try {
      if (query.cursor.length < 1 || query.cursor.length > 200) throw new Error();
      const bytes = fromBase64Url(query.cursor);
      if (bytes === null || toBase64Url(bytes) !== query.cursor) throw new Error();
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
      if (
        !Array.isArray(value) ||
        value.length !== 6 ||
        value[0] !== shopId ||
        value[1] !== status ||
        ![0, 1].includes(value[2]) ||
        ![0, 1].includes(value[3]) ||
        typeof value[4] !== "string" ||
        !/^-?[0-9]{1,20}$/.test(value[4]) ||
        !isUuid(value[5])
      )
        throw new Error();
      after = { rank: value[2], phase: value[3], at: value[4], id: value[5].toLowerCase() };
    } catch {
      throw fieldError("query:cursor", "bad_format");
    }
  }
  return { status, limit, after };
}
function cursor(shopId: string, status: string, row: TaskRow): string {
  return toBase64Url(
    new TextEncoder().encode(
      JSON.stringify([shopId, status, row.cursor_rank, row.cursor_phase, row.cursor_at, row.id]),
    ),
  );
}
function subject(row: TaskRow, shopId: string): { type: string; id: string | null } {
  switch (row.kind) {
    case "handoff":
      return { type: "handoff", id: row.handoff_id };
    case "change_request":
      return { type: "change_request", id: row.change_request_id };
    case "issue_report":
      return { type: "issue_report", id: row.issue_report_id };
    case "payment_claim":
    case "payment_mismatch":
    case "arrival_check":
      return { type: "payment_request", id: row.payment_request_id };
    case "refund_send":
      return { type: "refund", id: row.refund_id };
    case "ledger_relink":
      return { type: "ledger", id: null };
    case "license_on_hold":
      return { type: "shop", id: shopId };
    case "calendar_conflict":
      return { type: "calendar", id: null };
    default:
      return { type: "order", id: row.linked_order_id };
  }
}

export async function listOwnerTasks(r: AccessRequest): Promise<Response> {
  const via = r.scope.via;
  if (via.kind !== "owner") throw new ApiError("not_found");
  const expectedShop = r.req.header("X-Expected-Shop-Id");
  if (expectedShop !== undefined && (!isUuid(expectedShop) || expectedShop.toLowerCase() !== r.scope.shopId))
    throw new ApiError("unauthenticated");
  const filter = input(r.req.query(), r.scope.shopId);
  return r.read(async (db) => {
    const owner = await db.found<{ alert_channel_friend: boolean; time_zone: string }>(
      "SELECT o.alert_channel_friend,s.time_zone FROM shops s JOIN owners o ON o.id=s.owner_id WHERE s.id=$1 AND s.owner_id=$2",
      [via.ownerId],
    );
    const rank = "CASE WHEN t.wait_status='late' THEN 0 ELSE 1 END",
      phase = "CASE WHEN t.wait_due_at IS NULL THEN 1 ELSE 0 END";
    const at =
      filter.status === "open"
        ? "extract(epoch FROM coalesce(t.wait_due_at,t.opened_at))*1000000"
        : "extract(epoch FROM t.closed_at)*1000000";
    const after =
      filter.status === "open"
        ? `(${rank},${phase},${at},t.id)>($3::integer,$4::integer,$5::numeric,$6::uuid)`
        : `(${at}<$3::numeric OR (${at}=$3::numeric AND t.id>$4::uuid))`;
    const order =
      filter.status === "open" ? `${rank},${phase},coalesce(t.wait_due_at,t.opened_at),t.id` : "t.closed_at DESC,t.id";
    const afterAt = filter.status === "open" ? "$5" : "$3",
      limitParam = filter.status === "open" ? "$7" : "$5";
    const params =
      filter.status === "open"
        ? [
            filter.status,
            filter.after?.rank ?? 0,
            filter.after?.phase ?? 0,
            filter.after?.at ?? null,
            filter.after?.id ?? null,
            filter.limit + 1,
          ]
        : [filter.status, filter.after?.at ?? null, filter.after?.id ?? null, filter.limit + 1];
    const rows = (
      await db.run<TaskRow>(
        `SELECT t.id,t.kind,t.event_key,t.wait_status,t.wait_due_at,t.opened_at,t.closed_at,t.order_id,t.handoff_id,
       t.change_request_id,t.issue_report_id,t.payment_request_id,t.refund_id,o.id AS linked_order_id,o.order_no,
       coalesce(o.customer_id,c.customer_id) AS customer_id,${rank} AS cursor_rank,${phase} AS cursor_phase,
       (${at})::bigint::text AS cursor_at
       FROM owner_tasks t
       LEFT JOIN handoffs h ON h.shop_id=$1 AND h.id=t.handoff_id
       LEFT JOIN change_requests cr ON cr.shop_id=$1 AND cr.id=t.change_request_id
       LEFT JOIN issue_reports ir ON ir.shop_id=$1 AND ir.id=t.issue_report_id
       LEFT JOIN payment_requests pr ON pr.shop_id=$1 AND pr.id=t.payment_request_id
       LEFT JOIN refunds rf ON rf.shop_id=$1 AND rf.id=t.refund_id
       LEFT JOIN orders o ON o.shop_id=$1 AND o.id=coalesce(t.order_id,h.order_id,cr.order_id,ir.order_id,pr.order_id,rf.order_id)
       LEFT JOIN consultations c ON c.shop_id=$1 AND c.id=h.consultation_id
       WHERE t.shop_id=$1 AND (($2='open' AND t.closed_at IS NULL) OR ($2='closed' AND t.closed_at IS NOT NULL))
       AND (${afterAt}::numeric IS NULL OR ${after}) ORDER BY ${order} LIMIT ${limitParam}`,
        params,
      )
    ).rows;
    const page = rows.slice(0, filter.limit),
      last = page.at(-1);
    return {
      body: {
        items: page.map((row) => ({
          taskId: row.id,
          kind: row.kind,
          waitStatus: row.wait_status,
          waitDueAt: row.wait_due_at === null ? null : toShopIso(row.wait_due_at, owner.time_zone),
          order: row.linked_order_id === null ? null : { orderId: row.linked_order_id, orderNo: row.order_no },
          subject: subject(row, r.scope.shopId),
          summary:
            row.kind === "ledger_relink"
              ? (ledgerDuplicateSummary(row.event_key, row.order_no) ?? TASK_LABELS[row.kind])
              : TASK_LABELS[row.kind],
          openedAt: toShopIso(row.opened_at, owner.time_zone),
          closedAt: row.closed_at === null ? null : toShopIso(row.closed_at, owner.time_zone),
        })),
        nextCursor: rows.length > filter.limit && last ? cursor(r.scope.shopId, filter.status, last) : null,
        alertChannelFriend: owner.alert_channel_friend,
      },
      subjects: [...new Set(page.flatMap((row) => (row.customer_id === null ? [] : [row.customer_id])))],
    };
  });
}
