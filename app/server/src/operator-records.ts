/** API-074~077. 운영자 기록은 접속기록을 남기는 가게 범위 트랜잭션에서만 읽는다. */
import {
  OperatorRecordCursorError,
  openOperatorRecordCursor,
  sealOperatorRecordCursor,
} from "./operator-record-cursor";
import { parseOperatorRecordList, parseOperatorRecordPage } from "./operator-record-input";
import { ApiError, fieldError } from "./problem";
import type { AccessRequest } from "./routes";

export async function getOperatorConsultation(r: AccessRequest): Promise<Response> {
  if (r.scope.via.kind !== "operator") throw new ApiError("not_found");
  const operatorId = r.scope.via.operatorId,
    consultationId = r.pathId("consultationId"),
    page = parseOperatorRecordPage(r.req.query());
  const scope = { shopId: r.scope.shopId, resourceId: consultationId, kind: "messages" as const };
  let after: { at: string; key: string } | null = null;
  if (page.cursor !== null) {
    const fc = r.services.fieldCrypto();
    try {
      after = await openOperatorRecordCursor(fc, scope, page.cursor);
    } catch (error) {
      if (error instanceof OperatorRecordCursorError) throw fieldError("query:cursor", "bad_format");
      throw error;
    }
  }
  return r.read(async (db) => {
    const headers = await db.run<{
      body: { consultationId: string; status: string; maskedValues: unknown[] };
      customer_id: string;
    }>("SELECT body,customer_id FROM read_operator_consultation($1,$2,$3)", [operatorId, consultationId]);
    const header = headers.rows[0];
    if (header === undefined) throw new ApiError("not_found");
    if (header.body.status === "deleted")
      return { body: { ...header.body, items: [], nextCursor: null }, subjects: [header.customer_id] };
    const found = await db.run<{ item: unknown; cursor_at: string; cursor_key: string }>(
      "SELECT item,cursor_at,cursor_key FROM read_operator_messages($1,$2,$3,$4::jsonb,$5)",
      [operatorId, consultationId, JSON.stringify(after ?? {}), page.limit + 1],
    );
    const shown = found.rows.slice(0, page.limit),
      last = shown.at(-1);
    const nextCursor =
      found.rows.length > page.limit && last !== undefined
        ? await sealOperatorRecordCursor(r.services.fieldCrypto(), scope, { at: last.cursor_at, key: last.cursor_key })
        : null;
    return {
      body: { ...header.body, items: shown.map((row) => row.item), nextCursor },
      subjects: [header.customer_id],
    };
  });
}

export async function listOperatorRecords(r: AccessRequest): Promise<Response> {
  if (r.scope.via.kind !== "operator") throw new ApiError("not_found");
  const operatorId = r.scope.via.operatorId,
    page = parseOperatorRecordList(r.req.query());
  const scope = { shopId: r.scope.shopId, resourceId: r.scope.shopId, kind: page.kind };
  let after: { at: string; key: string } | null = null;
  if (page.cursor !== null) {
    const fc = r.services.fieldCrypto();
    try {
      after = await openOperatorRecordCursor(fc, scope, page.cursor);
    } catch (error) {
      if (error instanceof OperatorRecordCursorError) throw fieldError("query:cursor", "bad_format");
      throw error;
    }
  }
  return r.read(async (db) => {
    const found = await db.run<{ item: unknown; customer_id: string; cursor_at: string; cursor_key: string }>(
      "SELECT item,customer_id,cursor_at,cursor_key FROM read_operator_record_list($1,$2,$3,$4::jsonb,$5,$6)",
      [operatorId, page.kind, JSON.stringify(after ?? {}), page.limit + 1, r.services.now()],
    );
    const shown = found.rows.slice(0, page.limit),
      last = shown.at(-1);
    const nextCursor =
      found.rows.length > page.limit && last !== undefined
        ? await sealOperatorRecordCursor(r.services.fieldCrypto(), scope, { at: last.cursor_at, key: last.cursor_key })
        : null;
    return {
      body: {
        kind: page.kind,
        orders: page.kind === "orders" ? shown.map((row) => row.item) : [],
        consultations: page.kind === "consultations" ? shown.map((row) => row.item) : [],
        nextCursor,
      },
      subjects: shown.map((row) => row.customer_id),
    };
  });
}

export async function getOperatorRecordOrder(r: AccessRequest): Promise<Response> {
  if (r.scope.via.kind !== "operator") throw new ApiError("not_found");
  const operatorId = r.scope.via.operatorId,
    orderId = r.pathId("orderId");
  return r.read(async (db) => {
    const selected = await db.run<{ body: unknown; customer_id: string }>(
      "SELECT body,customer_id FROM read_operator_order($1,$2,$3)",
      [operatorId, orderId],
    );
    const row = selected.rows[0];
    if (row === undefined) throw new ApiError("not_found");
    return { body: row.body, subjects: [row.customer_id] };
  });
}
