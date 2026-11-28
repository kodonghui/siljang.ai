import { fromBase64Url, toBase64Url } from "./encoding";
import type { Secret } from "./settings";
import { isUuid } from "./shop-scope";

export const LEDGER_HEADERS = [
  "주문번호",
  "손님 이름",
  "연락처",
  "픽업 일시",
  "케이크",
  "문구",
  "금액",
  "결제 상태",
  "상태",
  "환불 금액",
  "인도 일시",
  "재제작",
] as const;
export const LEDGER_INTERNAL_HEADER = "실장님 기록 ID";
export const LEDGER_STORAGE_HEADERS = [...LEDGER_HEADERS, LEDGER_INTERNAL_HEADER] as const;
export const LEDGER_MAX_COLUMNS = 18278;
export interface LedgerSheetScope {
  readonly shopId: string;
  readonly spreadsheetId: string;
  readonly sheetId: number;
}
export interface VerifiedLedgerColumns {
  readonly start: number;
  readonly end: number;
  readonly movedRight: boolean;
}
export interface LedgerColumnPlan extends VerifiedLedgerColumns {
  readonly needsWrite: boolean;
  readonly columns: readonly { readonly header: string; readonly column: string }[];
}
export class LedgerColumnsOverflowError extends Error {
  override readonly name = "LedgerColumnsOverflowError";
}
const genuine = new WeakSet<object>(),
  HEADER_SET = new Set<string>(LEDGER_STORAGE_HEADERS);
function validScope(scope: LedgerSheetScope): boolean {
  return (
    isUuid(scope.shopId) &&
    /^[A-Za-z0-9_-]{20,100}$/.test(scope.spreadsheetId) &&
    Number.isSafeInteger(scope.sheetId) &&
    scope.sheetId >= 0 &&
    scope.sheetId <= 2147483647
  );
}
function validStart(start: number): boolean {
  return Number.isSafeInteger(start) && start >= 0 && start + LEDGER_STORAGE_HEADERS.length <= LEDGER_MAX_COLUMNS;
}
async function signingKey(key: Secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key.reveal()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
function data(scope: LedgerSheetScope, start: number, movedRight: boolean, legacy = false) {
  const headers = legacy ? LEDGER_HEADERS : LEDGER_STORAGE_HEADERS;
  return new TextEncoder().encode(
    JSON.stringify([
      "ledger-columns",
      1,
      scope.shopId.toLowerCase(),
      scope.spreadsheetId,
      scope.sheetId,
      start,
      start + headers.length,
      movedRight,
      headers,
    ]),
  );
}
/** 이전에 서명한 12개 열을 확인한다. 새 열을 만들 권한을 이 서명만으로 추측하지 않는다. */
export async function verifyLegacyLedgerColumns(
  key: Secret,
  scope: LedgerSheetScope,
  token: string,
  start: number,
): Promise<{ readonly movedRight: boolean } | null> {
  if (
    !validScope(scope) ||
    !Number.isSafeInteger(start) ||
    start < 0 ||
    start + LEDGER_HEADERS.length > LEDGER_MAX_COLUMNS
  )
    return null;
  const match = /^c1\.([a-z0-9]{1,3})\.([01])\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match || start.toString(36) !== match[1]) return null;
  const signature = fromBase64Url(match[3] as string),
    movedRight = match[2] === "1";
  if (!signature || toBase64Url(signature) !== match[3]) return null;
  if (
    !(await crypto.subtle.verify(
      "HMAC",
      await signingKey(key),
      signature as Uint8Array<ArrayBuffer>,
      data(scope, start, movedRight, true),
    ))
  )
    return null;
  return { movedRight };
}
export function ledgerColumnName(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0 || index >= LEDGER_MAX_COLUMNS)
    throw new RangeError("invalid ledger column");
  let n = index + 1,
    result = "";
  while (n > 0) {
    result = String.fromCharCode(65 + ((n - 1) % 26)) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}
export async function signLedgerColumns(
  key: Secret,
  scope: LedgerSheetScope,
  start: number,
  movedRight: boolean,
): Promise<string> {
  if (!validScope(scope) || !validStart(start) || typeof movedRight !== "boolean")
    throw new RangeError("invalid ledger column scope");
  const signature = toBase64Url(
    new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(key), data(scope, start, movedRight))),
  );
  return `c1.${start.toString(36)}.${movedRight ? 1 : 0}.${signature}`;
}
export async function verifyLedgerColumns(
  key: Secret,
  scope: LedgerSheetScope,
  token: string,
  start: number,
  end: number,
): Promise<VerifiedLedgerColumns | null> {
  if (!validScope(scope) || !validStart(start) || end !== start + LEDGER_STORAGE_HEADERS.length) return null;
  const match = /^c1\.([a-z0-9]{1,3})\.([01])\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (match === null || Number.parseInt(match[1] as string, 36) !== start || start.toString(36) !== match[1])
    return null;
  const signature = fromBase64Url(match[3] as string),
    movedRight = match[2] === "1";
  if (signature === null || toBase64Url(signature) !== match[3]) return null;
  if (
    !(await crypto.subtle.verify(
      "HMAC",
      await signingKey(key),
      signature as Uint8Array<ArrayBuffer>,
      data(scope, start, movedRight),
    ))
  )
    return null;
  const proof = Object.freeze({ start, end, movedRight });
  genuine.add(proof);
  return proof;
}
export function planLedgerColumns(
  columnCount: number,
  headers: readonly unknown[],
  verified: VerifiedLedgerColumns | null = null,
): LedgerColumnPlan {
  if (
    !Number.isSafeInteger(columnCount) ||
    columnCount < 1 ||
    columnCount > LEDGER_MAX_COLUMNS ||
    headers.length > columnCount
  )
    throw new RangeError("invalid ledger grid");
  if (verified !== null && !genuine.has(verified)) throw new TypeError("verified ledger columns are required");
  const reuse =
    verified !== null &&
    verified.end <= columnCount &&
    LEDGER_STORAGE_HEADERS.every((header, i) => headers[verified.start + i] === header);
  const start = reuse && verified !== null ? verified.start : columnCount;
  if (!validStart(start)) throw new LedgerColumnsOverflowError();
  const movedRight =
    reuse && verified !== null
      ? verified.movedRight
      : headers.some((value) => typeof value === "string" && HEADER_SET.has(value));
  return {
    start,
    end: start + LEDGER_STORAGE_HEADERS.length,
    movedRight,
    needsWrite: !reuse,
    columns: LEDGER_HEADERS.map((header, i) => ({ header, column: ledgerColumnName(start + i) })),
  };
}
