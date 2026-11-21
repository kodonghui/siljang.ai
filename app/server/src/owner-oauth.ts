/** DEC-10: nonce는 브라우저 쿠키에만, state와 verifier는 용도를 나눈 HMAC으로 만든다. */
import { fromBase64Url, toBase64Url } from "./encoding";
import { newSessionToken } from "./operator-session";
import type { Secret } from "./settings";

export const LOGIN_COOKIE = "siljang_login";
export const OWNER_COOKIE = "siljang_owner";
export const LOGIN_SECONDS = 600;
export const OWNER_SESSION_SECONDS = 30 * 86400;
const ATTRS = "Path=/; HttpOnly; Secure; SameSite=Lax";

export function cookie(name: string, token: string, seconds: number): string {
  return `${name}=${token}; ${ATTRS}; Max-Age=${seconds}`;
}

export function readCookie(header: string | null | undefined, name: string): string | null {
  const found = (header ?? "")
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p.startsWith(`${name}=`));
  if (found.length !== 1) return null;
  const token = (found[0] as string).slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

async function macKey(key: Secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key.reveal()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function mac(key: Secret, data: string): Promise<string> {
  return toBase64Url(
    new Uint8Array(await crypto.subtle.sign("HMAC", await macKey(key), new TextEncoder().encode(data))),
  );
}

export async function ownerRateKey(key: Secret, ip: string): Promise<string> {
  return mac(key, `owner-rate\0${ip}`);
}

export async function pkceVerifier(key: Secret, nonce: string, redirect: string): Promise<string> {
  return mac(key, `owner-pkce\0${nonce}\0${redirect}`);
}

export async function loginState(key: Secret, redirect: string, now: Date) {
  const nonce = newSessionToken();
  const expires = now.getTime() + LOGIN_SECONDS * 1000;
  const signature = await mac(key, `owner-state\0${nonce}\0${expires}\0${redirect}`);
  const verifier = await pkceVerifier(key, nonce, redirect);
  const challenge = toBase64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  );
  return { nonce, state: `${expires}.${signature}`, expiresAt: new Date(expires), challenge };
}

export async function verifyLoginState(
  key: Secret,
  state: string,
  nonce: string | null,
  redirect: string,
  now: Date,
): Promise<string | null> {
  if (nonce === null) return null;
  const match = /^(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(state);
  if (match === null) return null;
  const expires = Number(match[1]);
  if (expires <= now.getTime() || expires > now.getTime() + LOGIN_SECONDS * 1000) return null;
  const signature = fromBase64Url(match[2] as string);
  if (signature === null || toBase64Url(signature) !== match[2]) return null;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await macKey(key),
    signature as Uint8Array<ArrayBuffer>,
    new TextEncoder().encode(`owner-state\0${nonce}\0${expires}\0${redirect}`),
  );
  return valid ? pkceVerifier(key, nonce, redirect) : null;
}
