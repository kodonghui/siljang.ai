import { type ApiResult, request } from "./api";
import { INVALID_API_RESPONSE, isApiObject, isApiTimestamp, UUID_PATTERN } from "./api-response";

export const TASK_LABELS = {
  handoff: "에스컬레이션 건",
  custom_order: "맞춤 주문",
  change_request: "변경 요청",
  issue_report: "문제 신고",
  payment_claim: "결제 확인 요청",
  payment_mismatch: "맞추는 중",
  payment_overdue: "결제 기한 지남",
  refund_decision: "환불 결정",
  paid_after_cancel: "취소 뒤 들어온 입금",
  refund_send: "환불 보내기",
  arrival_check: "들어온 입금 대조",
  ledger_relink: "장부 다시 연결",
  license_on_hold: "영업 신고 보류",
  calendar_conflict: "영업 캘린더 기준을 넘는 날",
} as const;
export type TaskKind = keyof typeof TASK_LABELS;
export type TaskStatus = "open" | "closed";
export type WaitStatus = "waiting" | "late" | "answered" | "closed_no_answer" | null;
export interface OwnerTask {
  readonly taskId: string;
  readonly kind: TaskKind;
  readonly waitStatus: WaitStatus;
  readonly waitDueAt: string | null;
  readonly order: { readonly orderId: string; readonly orderNo: string } | null;
  readonly subject: { readonly type: string; readonly id: string | null } | null;
  readonly summary: string;
  readonly openedAt: string;
  readonly closedAt: string | null;
}
export interface OwnerTasksQuery {
  readonly status: TaskStatus;
  readonly limit: number;
  readonly cursor: string | null;
}
export interface OwnerTasksPage {
  readonly items: readonly OwnerTask[];
  readonly nextCursor: string | null;
  readonly alertChannelFriend: boolean;
}
export const TASK_CURSOR = /^[A-Za-z0-9_-]{1,200}$/;
const uuid = (v: unknown): v is string => typeof v === "string" && UUID_PATTERN.test(v);
const dateOrNull = (v: unknown): v is string | null => v === null || isApiTimestamp(v);
const subjectType: Record<TaskKind, string> = {
  handoff: "handoff",
  custom_order: "order",
  change_request: "change_request",
  issue_report: "issue_report",
  payment_claim: "payment_request",
  payment_mismatch: "payment_request",
  payment_overdue: "order",
  refund_decision: "order",
  paid_after_cancel: "order",
  refund_send: "refund",
  arrival_check: "payment_request",
  ledger_relink: "ledger",
  license_on_hold: "shop",
  calendar_conflict: "calendar",
};
function task(value: unknown): value is OwnerTask {
  if (
    !isApiObject(value) ||
    !uuid(value.taskId) ||
    typeof value.kind !== "string" ||
    !Object.hasOwn(TASK_LABELS, value.kind) ||
    ![null, "waiting", "late", "answered", "closed_no_answer"].includes(value.waitStatus as WaitStatus) ||
    !dateOrNull(value.waitDueAt) ||
    !isApiTimestamp(value.openedAt) ||
    !dateOrNull(value.closedAt) ||
    typeof value.summary !== "string" ||
    [...value.summary].length > 200 ||
    value.summary.includes("\0")
  )
    return false;
  if (
    value.order !== null &&
    (!isApiObject(value.order) ||
      !uuid(value.order.orderId) ||
      typeof value.order.orderNo !== "string" ||
      !/^[A-Z0-9]{6,8}$/.test(value.order.orderNo))
  )
    return false;
  if (
    value.subject !== null &&
    (!isApiObject(value.subject) ||
      value.subject.type !== subjectType[value.kind as TaskKind] ||
      !(value.subject.id === null || uuid(value.subject.id)))
  )
    return false;
  return true;
}
export function taskHref(row: OwnerTask): string | null {
  const id = row.subject?.id;
  if (row.kind === "ledger_relink") return "/owner/ledger";
  if (row.kind === "calendar_conflict") return "/owner/calendar";
  if (row.kind === "license_on_hold") return row.subject === null ? null : "/owner/shop/license";
  if (!id) return null;
  if (row.kind === "handoff") return `/owner/handoffs/${id}`;
  if (row.kind === "change_request") return `/owner/change-requests/${id}`;
  if (row.kind === "issue_report") return `/owner/issue-reports/${id}`;
  if (row.kind === "refund_send") return `/owner/refunds/${id}`;
  if (["payment_claim", "payment_mismatch", "arrival_check"].includes(row.kind)) return `/owner/payment-requests/${id}`;
  const action =
    row.kind === "custom_order"
      ? "custom-decision"
      : row.kind === "payment_overdue"
        ? "overdue-decision"
        : "refund-decision";
  return `/owner/orders/${id}/${action}`;
}
export function parseOwnerTasksSearch(search: string): OwnerTasksQuery | null {
  const p = new URLSearchParams(search);
  if (["status", "limit", "cursor"].some((k) => p.getAll(k).length > 1)) return null;
  const status = p.get("status") ?? "open",
    raw = p.get("limit"),
    limit = raw === null ? 20 : /^[0-9]+$/.test(raw) ? Number(raw) : NaN,
    cursor = p.get("cursor");
  return (status === "open" || status === "closed") &&
    Number.isInteger(limit) &&
    limit >= 1 &&
    limit <= 100 &&
    (cursor === null || TASK_CURSOR.test(cursor))
    ? { status, limit, cursor }
    : null;
}
export function ownerTasksHref(query: OwnerTasksQuery): string {
  const p = new URLSearchParams();
  if (query.status !== "open") p.set("status", query.status);
  if (query.limit !== 20) p.set("limit", String(query.limit));
  if (query.cursor !== null) p.set("cursor", query.cursor);
  const search = p.toString();
  return `/owner${search ? `?${search}` : ""}`;
}
export async function fetchOwnerTasks(
  query: OwnerTasksQuery,
  signal?: AbortSignal,
): Promise<ApiResult<OwnerTasksPage>> {
  if (!parseOwnerTasksSearch(ownerTasksHref(query).slice("/owner".length))) return INVALID_API_RESPONSE;
  const p = new URLSearchParams({ status: query.status, limit: String(query.limit) });
  if (query.cursor !== null) p.set("cursor", query.cursor);
  const r = await request<unknown>(`/owner/tasks?${p}`, { cache: "no-store", ...(signal ? { signal } : {}) });
  if (!r.ok) return r;
  const v = r.data;
  if (
    !isApiObject(v) ||
    !Array.isArray(v.items) ||
    v.items.length > query.limit ||
    !v.items.every(task) ||
    typeof v.alertChannelFriend !== "boolean" ||
    !(
      v.nextCursor === null ||
      (typeof v.nextCursor === "string" && TASK_CURSOR.test(v.nextCursor) && v.nextCursor !== query.cursor)
    ) ||
    new Set(v.items.map((row) => row.taskId)).size !== v.items.length
  )
    return INVALID_API_RESPONSE;
  return {
    ...r,
    data: {
      items: v.items.map((row) => ({
        taskId: row.taskId,
        kind: row.kind,
        waitStatus: row.waitStatus,
        waitDueAt: row.waitDueAt,
        order: row.order ? { orderId: row.order.orderId, orderNo: row.order.orderNo } : null,
        subject: row.subject ? { type: row.subject.type, id: row.subject.id } : null,
        summary: row.summary,
        openedAt: row.openedAt,
        closedAt: row.closedAt,
      })),
      nextCursor: v.nextCursor,
      alertChannelFriend: v.alertChannelFriend,
    },
  };
}
