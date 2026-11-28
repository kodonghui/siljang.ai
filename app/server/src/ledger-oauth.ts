/** 장부 권한의 state/PKCE는 사장님 로그인과 용도를 나누고 브라우저 쿠키/가게/사장님/주소에 묶는다. */
import { fromBase64Url, toBase64Url } from "./encoding";
import { parseLedgerAuthorization } from "./ledger-input";
import { newSessionToken } from "./operator-session";
import type { Secret } from "./settings";
import { isUuid } from "./shop-scope";

export const LEDGER_OAUTH_SECONDS = 600;
export const LEDGER_COOKIE = "siljang_ledger";
export interface LedgerOAuthScope {
  readonly shopId: string;
  readonly ownerId: string;
}
function scopeText(scope: LedgerOAuthScope): string {
  if (!isUuid(scope.shopId) || !isUuid(scope.ownerId)) throw new TypeError("ledger OAuth scope requires UUIDs");
  return `${scope.shopId.toLowerCase()}\0${scope.ownerId.toLowerCase()}`;
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
async function mac(key: Secret, value: string): Promise<string> {
  return toBase64Url(
    new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(key), new TextEncoder().encode(value))),
  );
}
function data(
  purpose: "ledger-state" | "ledger-pkce",
  scope: LedgerOAuthScope,
  nonce: string,
  redirect: string,
  expiry?: number,
): string {
  return `${purpose}\0${scopeText(scope)}\0${nonce}\0${expiry ?? ""}\0${redirect}`;
}
export async function startLedgerOAuth(key: Secret, scope: LedgerOAuthScope, redirect: string, now: Date) {
  parseLedgerAuthorization({ redirectUri: redirect });
  if (!Number.isFinite(now.getTime())) throw new TypeError("ledger OAuth requires a valid clock");
  const nonce = newSessionToken(),
    expires = now.getTime() + LEDGER_OAUTH_SECONDS * 1000;
  const signature = await mac(key, data("ledger-state", scope, nonce, redirect, expires));
  const verifier = await mac(key, data("ledger-pkce", scope, nonce, redirect));
  const challenge = toBase64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  );
  return { nonce, state: `${expires}.${signature}`, expiresAt: new Date(expires), challenge };
}
export async function verifyLedgerOAuth(
  key: Secret,
  scope: LedgerOAuthScope,
  state: string,
  nonce: string | null,
  redirect: string,
  now: Date,
): Promise<string | null> {
  if (nonce === null || !/^[A-Za-z0-9_-]{43}$/.test(nonce) || !Number.isFinite(now.getTime())) return null;
  if (!isUuid(scope.shopId) || !isUuid(scope.ownerId)) return null;
  const match = /^(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(state);
  if (match === null) return null;
  const expires = Number(match[1]);
  if (expires <= now.getTime() || expires > now.getTime() + LEDGER_OAUTH_SECONDS * 1000) return null;
  const signature = fromBase64Url(match[2] as string);
  if (signature === null || toBase64Url(signature) !== match[2]) return null;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await signingKey(key),
    signature as Uint8Array<ArrayBuffer>,
    new TextEncoder().encode(data("ledger-state", scope, nonce, redirect, expires)),
  );
  return valid ? mac(key, data("ledger-pkce", scope, nonce, redirect)) : null;
}
