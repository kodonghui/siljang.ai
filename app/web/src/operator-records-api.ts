import { type ApiResult, request } from "./api";
import { INVALID_API_RESPONSE, isApiObject, UUID_PATTERN } from "./api-response";
import schemas from "./operator-record-schemas.json";

type Schema = {
  readonly $ref?: string;
  readonly anyOf?: readonly Schema[];
  readonly type?: string | readonly string[];
  readonly enum?: readonly unknown[];
  readonly format?: string;
  readonly pattern?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly items?: Schema;
  readonly properties?: Readonly<Record<string, Schema>>;
  readonly required?: readonly string[];
};
const invalid = Symbol("invalid");
function sanitize(value: unknown, schema: Schema): unknown {
  if (schema.$ref) {
    const key = schema.$ref.split("/").at(-1) as keyof typeof schemas;
    return schemas[key] ? sanitize(value, schemas[key] as Schema) : invalid;
  }
  if (schema.anyOf) {
    for (const option of schema.anyOf) {
      const result = sanitize(value, option);
      if (result !== invalid) return result;
    }
    return invalid;
  }
  const type =
    value === null
      ? "null"
      : Array.isArray(value)
        ? "array"
        : typeof value === "number" && Number.isInteger(value)
          ? "integer"
          : typeof value;
  const types = typeof schema.type === "string" ? [schema.type] : schema.type;
  if ((types && !types.includes(type)) || (schema.enum && !schema.enum.includes(value))) return invalid;
  if (typeof value === "string") {
    const length = [...value].length;
    if (
      length < (schema.minLength ?? 0) ||
      length > (schema.maxLength ?? Infinity) ||
      (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) ||
      (schema.format === "uuid" && !UUID_PATTERN.test(value)) ||
      (schema.format === "date-time" && !Number.isFinite(Date.parse(value)))
    )
      return invalid;
  }
  if (typeof value === "number" && (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)))
    return invalid;
  if (Array.isArray(value)) {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity) || !schema.items)
      return invalid;
    const out = value.map((item) => sanitize(item, schema.items as Schema));
    return out.includes(invalid) ? invalid : out;
  }
  if (isApiObject(value)) {
    if (!schema.properties || schema.required?.some((key) => !Object.hasOwn(value, key))) return invalid;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(schema.properties)) {
      if (!Object.hasOwn(value, key)) continue;
      const item = sanitize(value[key], child);
      if (item === invalid) return invalid;
      out[key] = item;
    }
    return out;
  }
  return value;
}
type Data = Record<string, unknown>;
async function verified(
  response: Promise<ApiResult<unknown>>,
  name: keyof typeof schemas,
  match: (data: Data) => boolean,
): Promise<ApiResult<Data>> {
  const result = await response;
  if (!result.ok) return result;
  const data = sanitize(result.data, schemas[name] as Schema);
  return isApiObject(data) && match(data) ? { ...result, data } : INVALID_API_RESPONSE;
}

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
  return verified(
    request(`${root(shop)}/records?${query}`, { cache: "no-store", ...(signal ? { signal } : {}) }),
    "OperatorRecordList",
    (data) => {
      if (data.kind !== kind || !Array.isArray(data.orders) || !Array.isArray(data.consultations)) return false;
      if (kind === "orders" ? data.consultations.length !== 0 : data.orders.length !== 0) return false;
      return data.orders.every(
        (row: Data) =>
          !row.kept ||
          [row.status, row.pickupAt, row.amount, row.customerNameMasked, row.customerPhoneMasked].every(
            (v) => v === null,
          ),
      );
    },
  );
}
export function fetchOperatorConsultation(shop: string, id: string, cursor?: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ limit: "20" });
  if (cursor) query.set("cursor", cursor);
  return verified(
    request(`${root(shop)}/consultations/${encodeURIComponent(id)}?${query}`, {
      cache: "no-store",
      ...(signal ? { signal } : {}),
    }),
    "OperatorConsultation",
    (data) => {
      if (data.consultationId !== id || !Array.isArray(data.maskedValues) || !Array.isArray(data.items)) return false;
      if (
        data.status === "deleted" &&
        (data.items.length || data.maskedValues.length || data.textCursor !== null || data.nextCursor !== null)
      )
        return false;
      return data.maskedValues.every(
        (item: Data) =>
          isApiObject(item) && !(["card", "long_number"].includes(String(item.kind)) && item.originalKept !== false),
      );
    },
  );
}
export function fetchOperatorOrder(shop: string, id: string, signal?: AbortSignal) {
  return verified(
    request(`${root(shop)}/orders/${encodeURIComponent(id)}`, { cache: "no-store", ...(signal ? { signal } : {}) }),
    "OperatorOrder",
    (data) => data.orderId === id,
  );
}
export function openOperatorOriginal(shop: string, body: OperatorOriginalInput, key: string, signal?: AbortSignal) {
  return verified(
    request(`${root(shop)}/originals`, { method: "POST", body, key, cache: "no-store", ...(signal ? { signal } : {}) }),
    "OriginalValue",
    (data) => {
      const fields = {
        masked_value: "maskedValue",
        order_contact: "orderContact",
        refund_account: "refundAccount",
        kept_record: "keptRecord",
        consultation_text: "consultationText",
      } as const;
      return (
        data.targetKind === body.targetKind &&
        data.targetId === body.targetId &&
        (body.targetKind !== "kept_record" ||
          (isApiObject(data.keptRecord) && data.keptRecord.keptRecordId === body.targetId)) &&
        (body.targetKind !== "consultation_text" ||
          (isApiObject(data.consultationText) && data.consultationText.consultationId === body.targetId)) &&
        Object.values(fields).every((field) =>
          field === fields[body.targetKind] ? isApiObject(data[field]) : data[field] === null,
        )
      );
    },
  );
}
