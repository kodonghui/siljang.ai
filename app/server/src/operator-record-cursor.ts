import type { FieldCrypto } from "./field-crypto";
import { isUuid } from "./shop-scope";

export type OperatorRecordKind = "orders" | "consultations" | "messages";
export interface OperatorRecordCursorScope {
  readonly shopId: string;
  readonly resourceId: string;
  readonly kind: OperatorRecordKind;
}
export interface OperatorRecordPosition {
  readonly at: string;
  readonly key: string;
}
export class OperatorRecordCursorError extends Error {
  override readonly name = "OperatorRecordCursorError";
}
function invalid(): never {
  throw new OperatorRecordCursorError("invalid operator record cursor");
}
export function validateOperatorRecordPosition(scope: OperatorRecordCursorScope, position: OperatorRecordPosition) {
  if (
    !isUuid(scope.shopId) ||
    !isUuid(scope.resourceId) ||
    !["orders", "consultations", "messages"].includes(scope.kind)
  )
    invalid();
  const at = position.at;
  if (typeof at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(at) || at.startsWith("0000-"))
    invalid();
  const millis = `${at.slice(0, 23)}Z`,
    parsed = new Date(millis);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== millis) invalid();
  if (scope.kind === "messages") {
    if (!/^[1-9][0-9]{0,18}$/.test(position.key) || BigInt(position.key) > 9223372036854775807n) invalid();
  } else if (!isUuid(position.key)) invalid();
}
function context(scope: OperatorRecordCursorScope) {
  return { purpose: "operator.records_cursor" as const, shopId: scope.shopId, recordId: scope.resourceId };
}
/** 키 버전 밖의 길이는 고정한다. 순번·마이크로초·다른 API의 페이지는 드러내거나 섞지 않는다. */
export async function sealOperatorRecordCursor(
  fc: FieldCrypto,
  scope: OperatorRecordCursorScope,
  position: OperatorRecordPosition,
): Promise<string> {
  validateOperatorRecordPosition(scope, position);
  const text = JSON.stringify([scope.kind, position.at, position.key.toLowerCase()]);
  if (text.length > 104) invalid();
  return (await fc.seal(text.padEnd(104, " "), context(scope))).replace(":", "_");
}
export async function openOperatorRecordCursor(
  fc: FieldCrypto,
  scope: OperatorRecordCursorScope,
  cursor: string,
): Promise<OperatorRecordPosition> {
  try {
    const match = /^v([1-9][0-9]{0,2})_([A-Za-z0-9_-]{176})$/.exec(cursor);
    if (!match) invalid();
    const text = await fc.open(`v${match[1]}:${match[2]}`, context(scope));
    if (text.length !== 104) invalid();
    const value: unknown = JSON.parse(text);
    if (
      !Array.isArray(value) ||
      value.length !== 3 ||
      value[0] !== scope.kind ||
      typeof value[1] !== "string" ||
      typeof value[2] !== "string"
    )
      invalid();
    const position = { at: value[1], key: value[2] };
    validateOperatorRecordPosition(scope, position);
    return position;
  } catch {
    return invalid();
  }
}
