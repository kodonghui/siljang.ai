/** API-012/014의 입력. 넣은 값은 오류 응답에 싣지 않는다. */
import { fromBase64Url, toBase64Url } from "./encoding";
import { ApiError, type FieldError, fieldError } from "./problem";
import { isUuid } from "./shop-scope";

export interface ReviewListInput {
  readonly status: "pending" | "on_hold" | "verified";
  readonly limit: number;
  readonly after: { readonly at: string; readonly id: string } | null;
}

export function reviewCursor(status: string, at: string, id: string): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify([status, at, id])));
}

export function parseReviewList(query: Record<string, string>): ReviewListInput {
  const status = query.status ?? "pending";
  if (!["pending", "on_hold", "verified"].includes(status)) throw fieldError("query:status", "bad_format");
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (query.limit !== undefined && !/^[0-9]+$/.test(query.limit))
  )
    throw fieldError("query:limit", "out_of_range");
  let after: ReviewListInput["after"] = null;
  if (query.cursor !== undefined) {
    try {
      if (query.cursor.length < 1 || query.cursor.length > 200) throw new Error();
      const bytes = fromBase64Url(query.cursor);
      if (bytes === null || toBase64Url(bytes) !== query.cursor) throw new Error();
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
      if (!Array.isArray(value) || value.length !== 3 || value[0] !== status || !isUuid(value[2])) throw new Error();
      if (typeof value[1] !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(value[1])) throw new Error();
      if (value[1].startsWith("0000-")) throw new Error();
      if (new Date(value[1]).toISOString() !== value[1].replace(/(\.\d{3})\d{3}Z$/, "$1Z")) throw new Error();
      after = { at: value[1], id: value[2].toLowerCase() };
    } catch {
      throw fieldError("query:cursor", "bad_format");
    }
  }
  return { status: status as ReviewListInput["status"], limit, after };
}

export interface LicenseReviewInput {
  readonly baseRevision: string;
  readonly decision: "verified" | "on_hold";
  readonly holdReason?: string;
}

export function parseLicenseReview(body: unknown): LicenseReviewInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw fieldError("/", "bad_format");
  const record = body as Record<string, unknown>,
    errors: FieldError[] = [];
  const text = (key: string, min: number, max: number, required: boolean, pattern?: RegExp) => {
    const value = record[key];
    if (value === undefined) {
      if (required) errors.push({ field: `/${key}`, code: "required" });
      return;
    }
    if (typeof value !== "string" || value.includes("\u0000")) errors.push({ field: `/${key}`, code: "bad_format" });
    else if ([...value].length < min) errors.push({ field: `/${key}`, code: "too_short" });
    else if ([...value].length > max) errors.push({ field: `/${key}`, code: "too_long" });
    else if (pattern && !pattern.test(value)) errors.push({ field: `/${key}`, code: "bad_format" });
  };
  text("baseRevision", 1, 64, true, /^[A-Za-z0-9._-]+$/);
  if (record.decision === undefined) errors.push({ field: "/decision", code: "required" });
  else if (record.decision !== "verified" && record.decision !== "on_hold")
    errors.push({ field: "/decision", code: "bad_format" });
  text("holdReason", 1, 200, record.decision === "on_hold");
  for (const key of Object.keys(record)) {
    if (["baseRevision", "decision", "holdReason"].includes(key)) continue;
    errors.push({ field: /^[A-Za-z0-9_]{1,100}$/.test(key) ? `/${key}` : "/", code: "unknown_field" });
  }
  if (errors.length) throw new ApiError("validation_failed", { errors: errors.slice(0, 50) });
  return record as unknown as LicenseReviewInput;
}
