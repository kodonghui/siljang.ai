import { request } from "./api";
export type OperatorRecordKind = "orders" | "consultations";
export interface OperatorOriginalInput {
  readonly targetKind: "masked_value" | "order_contact" | "refund_account" | "kept_record" | "consultation_text";
  readonly targetId: string;
  readonly reason: string;
  readonly cursor?: string;
}
const root = (shop: string) => `/operator/shops/${encodeURIComponent(shop)}`;
export function fetchOperatorRecords(shop: string, kind: OperatorRecordKind, cursor?: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ kind, limit: "20" });
  if (cursor) query.set("cursor", cursor);
  return request<unknown>(`${root(shop)}/records?${query}`, { cache: "no-store", signal });
}
export function fetchOperatorConsultation(shop: string, id: string, cursor?: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ limit: "20" });
  if (cursor) query.set("cursor", cursor);
  return request<unknown>(`${root(shop)}/consultations/${encodeURIComponent(id)}?${query}`, {
    cache: "no-store",
    signal,
  });
}
export function fetchOperatorOrder(shop: string, id: string, signal?: AbortSignal) {
  return request<unknown>(`${root(shop)}/orders/${encodeURIComponent(id)}`, { cache: "no-store", signal });
}
export function openOperatorOriginal(shop: string, body: OperatorOriginalInput, key: string, signal?: AbortSignal) {
  return request<unknown>(`${root(shop)}/originals`, { method: "POST", body, key, cache: "no-store", signal });
}
