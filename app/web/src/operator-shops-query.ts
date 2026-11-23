import {
  CHANGE_STATUSES,
  type ChangeStatus,
  REVIEW_CURSOR_PATTERN,
  REVIEW_STATUSES,
  type ReviewStatus,
} from "./operator-shops-api";
export type OperatorListFilter =
  | { readonly tab: "shops"; readonly status: ReviewStatus; readonly cursor: string | null }
  | { readonly tab: "identity"; readonly status: ChangeStatus; readonly cursor: string | null };
export function parseOperatorList(search: string): OperatorListFilter | null {
  const params = new URLSearchParams(search);
  if (["tab", "status", "cursor"].some((key) => params.getAll(key).length > 1)) return null;
  const tab = params.get("tab") ?? "shops",
    status = params.get("status") ?? "pending",
    cursor = params.get("cursor");
  if (cursor !== null && !REVIEW_CURSOR_PATTERN.test(cursor)) return null;
  if (tab === "shops" && REVIEW_STATUSES.some((item) => item === status))
    return { tab, status: status as ReviewStatus, cursor };
  if (tab === "identity" && CHANGE_STATUSES.some((item) => item === status))
    return { tab, status: status as ChangeStatus, cursor };
  return null;
}
export function operatorListHref(filter: OperatorListFilter): string {
  const params = new URLSearchParams();
  if (filter.tab === "identity") params.set("tab", "identity");
  if (filter.status !== "pending") params.set("status", filter.status);
  if (filter.cursor !== null) params.set("cursor", filter.cursor);
  const query = params.toString();
  return `/operator/shops${query ? `?${query}` : ""}`;
}
export function operatorEmptyMessage(filter: OperatorListFilter): string {
  if (filter.tab === "identity")
    return filter.status === "applied"
      ? "반영한 변경 요청이 없어요"
      : filter.status === "on_hold"
        ? "보류한 변경 요청이 없어요"
        : "확인할 변경 요청이 없어요";
  return filter.status === "verified"
    ? "확인된 가게가 없어요"
    : filter.status === "on_hold"
      ? "보류한 가게가 없어요"
      : "확인할 가게가 없어요";
}
export function appendReviewRows<T>(old: readonly T[], next: readonly T[], key: (row: T) => string): T[] {
  const rows = new Map(old.map((row) => [key(row), row]));
  for (const row of next) rows.set(key(row), row);
  return [...rows.values()];
}
