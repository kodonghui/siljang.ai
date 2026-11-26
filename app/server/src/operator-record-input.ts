import type { OpenTarget } from "./access-log";
import { fieldError } from "./problem";
import { isUuid } from "./shop-scope";

export type OriginalTargetKind = OpenTarget | "kept_record";
export interface OriginalOpenInput {
  readonly targetKind: OriginalTargetKind;
  readonly targetId: string;
  readonly reason: string;
  readonly cursor?: string;
}
export interface RecordPageInput {
  readonly limit: number;
  readonly cursor: string | null;
}
function validCursor(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) throw fieldError(field, "bad_format");
  return value;
}
export function parseOperatorRecordPage(query: Record<string, string>): RecordPageInput {
  if (query.limit !== undefined && !/^-?[0-9]+$/.test(query.limit)) throw fieldError("query:limit", "bad_format");
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw fieldError("query:limit", "out_of_range");
  return { limit, cursor: query.cursor === undefined ? null : validCursor(query.cursor, "query:cursor") };
}
export function parseOperatorRecordList(
  query: Record<string, string>,
): RecordPageInput & { readonly kind: "orders" | "consultations" } {
  const kind = query.kind ?? "orders";
  if (kind !== "orders" && kind !== "consultations") throw fieldError("query:kind", "bad_format");
  return { ...parseOperatorRecordPage(query), kind };
}
export function parseOriginalOpen(body: unknown): OriginalOpenInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw fieldError("/", "bad_format");
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record))
    if (!["targetKind", "targetId", "reason", "cursor"].includes(key))
      throw fieldError(/^[A-Za-z0-9_]{1,100}$/.test(key) ? `/${key}` : "/", "unknown_field");
  for (const key of ["targetKind", "targetId", "reason"])
    if (!Object.hasOwn(record, key)) throw fieldError(`/${key}`, "required");
  const targetKind = ["masked_value", "order_contact", "refund_account", "kept_record", "consultation_text"].find(
    (kind) => kind === record.targetKind,
  ) as OriginalTargetKind | undefined;
  if (targetKind === undefined) throw fieldError("/targetKind", "bad_format");
  if (!isUuid(record.targetId)) throw fieldError("/targetId", "bad_format");
  if (typeof record.reason !== "string" || record.reason.includes("\0")) throw fieldError("/reason", "bad_format");
  const reason = record.reason.trim(),
    length = [...reason].length;
  if (length < 5) throw fieldError("/reason", "too_short");
  if (length > 200) throw fieldError("/reason", "too_long");
  if (record.cursor !== undefined && targetKind !== "consultation_text") throw fieldError("/cursor", "not_allowed");
  return {
    targetKind,
    targetId: record.targetId.toLowerCase(),
    reason,
    ...(record.cursor === undefined ? {} : { cursor: validCursor(record.cursor, "/cursor") }),
  };
}
