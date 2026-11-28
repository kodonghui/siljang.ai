/** API034/035의 입력 계약. 인가 코드·서명 상태는 오류에 싣지 않는다. */
import { fieldError } from "./problem";
export interface LedgerAuthorizationInput {
  readonly redirectUri: string;
}
export interface LedgerLinkInput {
  readonly baseRevision: string | null;
  readonly code: string;
  readonly state: string;
  readonly spreadsheetId: string;
  readonly sheetName: string;
}
function object(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw fieldError("/", "bad_format");
  const input = raw as Record<string, unknown>;
  for (const key of Object.keys(input))
    if (!keys.includes(key)) throw fieldError(/^[A-Za-z_]{1,100}$/.test(key) ? `/${key}` : "/", "unknown_field");
  for (const key of keys) if (!Object.hasOwn(input, key)) throw fieldError(`/${key}`, "required");
  return input;
}
function text(input: Record<string, unknown>, key: string, min: number, max: number, pattern?: RegExp): string {
  const value = input[key],
    field = `/${key}`;
  if (typeof value !== "string" || value.includes("\0")) throw fieldError(field, "bad_format");
  const n = [...value].length;
  if (n < min || value.trim() === "") throw fieldError(field, "too_short");
  if (n > max) throw fieldError(field, "too_long");
  if (pattern && !pattern.test(value)) throw fieldError(field, "bad_format");
  return value;
}
export function parseLedgerAuthorization(raw: unknown): LedgerAuthorizationInput {
  const input = object(raw, ["redirectUri"]),
    redirectUri = text(input, "redirectUri", 9, 2048, /^https:\/\//);
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    throw fieldError("/redirectUri", "bad_format");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    redirectUri.includes("#") ||
    [...redirectUri].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)
  )
    throw fieldError("/redirectUri", "bad_format");
  return { redirectUri };
}
export function parseLedgerLink(raw: unknown): LedgerLinkInput {
  const input = object(raw, ["baseRevision", "code", "state", "spreadsheetId", "sheetName"]);
  const sheetName = text(input, "sheetName", 1, 100);
  if ([...sheetName].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))
    throw fieldError("/sheetName", "bad_format");
  return {
    baseRevision: input.baseRevision === null ? null : text(input, "baseRevision", 1, 64, /^[A-Za-z0-9._-]+$/),
    code: text(input, "code", 1, 2048, /^\S+$/),
    state: text(input, "state", 16, 512, /^[A-Za-z0-9._-]+$/),
    spreadsheetId: text(input, "spreadsheetId", 20, 100, /^[A-Za-z0-9_-]+$/),
    sheetName,
  };
}
