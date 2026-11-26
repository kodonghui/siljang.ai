/** API075가 보인 페이지의 글만 여는 증표. 원문과 메시지 ID는 증표에 넣지 않는다. */
import { fromBase64Url, toBase64Url } from "./encoding";
import type { FieldCrypto } from "./field-crypto";
import { type OperatorRecordPosition, validateOperatorRecordPosition } from "./operator-record-cursor";
import { isUuid } from "./shop-scope";
export interface OperatorRecordPageScope {
  readonly shopId: string;
  readonly consultationId: string;
  readonly operatorId: string;
}
export interface OperatorRecordPageInput {
  readonly first: OperatorRecordPosition | null;
  readonly last: OperatorRecordPosition | null;
  readonly messageIds: readonly string[];
}
export interface OperatorRecordPage {
  readonly first: OperatorRecordPosition | null;
  readonly last: OperatorRecordPosition | null;
  readonly idsHash: string;
}
export class OperatorRecordPageError extends Error {
  override readonly name = "OperatorRecordPageError";
}
const BYTES = 111,
  TTL = 600000;
function invalid(): never {
  throw new OperatorRecordPageError("invalid operator record page");
}
function context(scope: OperatorRecordPageScope) {
  if (!isUuid(scope.shopId) || !isUuid(scope.consultationId) || !isUuid(scope.operatorId)) invalid();
  return {
    purpose: "operator.records_page" as const,
    shopId: scope.shopId,
    recordId: scope.consultationId,
    actorId: scope.operatorId,
  };
}
function position(scope: OperatorRecordPageScope, p: OperatorRecordPosition) {
  validateOperatorRecordPosition({ shopId: scope.shopId, resourceId: scope.consultationId, kind: "messages" }, p);
}
function micros(at: string): bigint {
  return BigInt(new Date(`${at.slice(0, 23)}Z`).getTime()) * 1000n + BigInt(at.slice(23, 26));
}
function base36(value: string): bigint {
  if (!/^-?[0-9a-z]{1,13}$/.test(value)) invalid();
  const negative = value.startsWith("-"),
    digits = negative ? value.slice(1) : value;
  let n = 0n;
  for (const c of digits) n = n * 36n + BigInt(Number.parseInt(c, 36));
  if (negative) n = -n;
  if (n.toString(36) !== value) invalid();
  return n;
}
function at(value: string): string {
  const n = base36(value),
    remainder = ((n % 1000n) + 1000n) % 1000n,
    ms = Number((n - remainder) / 1000n);
  if (!Number.isSafeInteger(ms)) invalid();
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, -1)}${remainder.toString().padStart(3, "0")}Z`;
}
function compare(a: OperatorRecordPosition, b: OperatorRecordPosition): number {
  const times = micros(a.at) - micros(b.at);
  return times < 0n ? -1 : times > 0n ? 1 : BigInt(a.key) < BigInt(b.key) ? -1 : BigInt(a.key) > BigInt(b.key) ? 1 : 0;
}
export async function operatorRecordPageHash(ids: readonly string[]): Promise<string> {
  if (!Array.isArray(ids) || ids.length > 20 || ids.some((id) => !isUuid(id))) invalid();
  const normalized = ids.map((id) => id.toLowerCase());
  if (new Set(normalized).size !== ids.length) invalid();
  return toBase64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(normalized)))),
  );
}
export async function sealOperatorRecordPage(
  fc: FieldCrypto,
  scope: OperatorRecordPageScope,
  page: OperatorRecordPageInput,
  now: Date,
): Promise<string> {
  try {
    const ctx = context(scope),
      hash = await operatorRecordPageHash(page.messageIds);
    if (!Number.isFinite(now.getTime())) invalid();
    let bounds = ["-", "-", "-", "-"];
    if (page.messageIds.length === 0) {
      if (page.first !== null || page.last !== null) invalid();
    } else {
      if (page.first === null || page.last === null) invalid();
      position(scope, page.first);
      position(scope, page.last);
      const order = compare(page.first, page.last);
      if (order > 0 || (page.messageIds.length === 1 && order !== 0) || (page.messageIds.length > 1 && order === 0))
        invalid();
      bounds = [
        micros(page.first.at).toString(36),
        BigInt(page.first.key).toString(36),
        micros(page.last.at).toString(36),
        BigInt(page.last.key).toString(36),
      ];
    }
    const payload = ["p", ...bounds, BigInt(now.getTime() + TTL).toString(36), hash].join(".");
    if (payload.length > BYTES) invalid();
    return (await fc.seal(payload.padEnd(BYTES, " "), ctx)).replace(":", "_");
  } catch {
    return invalid();
  }
}
export async function openOperatorRecordPage(
  fc: FieldCrypto,
  scope: OperatorRecordPageScope,
  token: string,
  now: Date,
): Promise<OperatorRecordPage> {
  try {
    const match = /^v([1-9][0-9]{0,2})_([A-Za-z0-9_-]{186})$/.exec(token);
    if (!match) invalid();
    const payload = await fc.open(`v${match[1]}:${match[2]}`, context(scope));
    if (payload.length !== BYTES) invalid();
    const parts = payload.trimEnd().split(".");
    if (parts.length !== 7) invalid();
    const [tag, fa, fk, la, lk, expires, hash] = parts as [string, string, string, string, string, string, string];
    const decoded = fromBase64Url(hash);
    if (tag !== "p" || !decoded || decoded.length !== 32 || toBase64Url(decoded) !== hash) invalid();
    const expiry = Number(base36(expires));
    if (
      !Number.isFinite(now.getTime()) ||
      !Number.isSafeInteger(expiry) ||
      expiry <= now.getTime() ||
      expiry > now.getTime() + TTL
    )
      invalid();
    if (fa === "-" && fk === "-" && la === "-" && lk === "-") return { first: null, last: null, idsHash: hash };
    const first = { at: at(fa), key: base36(fk).toString() },
      last = { at: at(la), key: base36(lk).toString() };
    position(scope, first);
    position(scope, last);
    if (compare(first, last) > 0) invalid();
    return { first, last, idsHash: hash };
  } catch {
    return invalid();
  }
}
