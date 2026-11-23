/**
 * 사진의 15분 서명 주소(TASK-022; 06 DEC-09 '15분 사는 서명 주소. 저장 위치는 포함하지 않음', licensePhotoUrl 등은
 * format uri·2048자까지). 주소를 만드는 도구(sign)와 주소로 사진을 내주는 경로(serveFile, app.ts의 openRoute)가 있다.
 * 06 계약 밖의 경로다(06 예시의 주소도 지어낸 다른 주소).
 * - 공개 포트폴리오 예외: /api/files/public/v1, 150초 구간 끝 뒤 150초 만료·공개 캐시(06 DEC-09).
 * - 주소: <요청의 origin>/api/files/v1/<token>?exp=<유닉스 초>&sig=<HMAC-SHA256 16진수 64자>.
 * - token은 저장 위치를 AES-GCM으로 감싼 것(base64url)이라 주소를 받은 사람도 저장 위치(가게 ID·용도)를 읽지 못한다.
 * - sig는 token과 exp를 묶는다. 기한을 늘리거나 다른 토큰에 붙이면 맞지 않는다.
 * - 두 키는 비밀 값 FILE_URL_KEY(32자 이상, settings.ts)에서 HKDF-SHA256으로 따로 뽑는다.
 * - 주소가 곧 권한이다(가진 사람은 15분 동안 그 사진을 봄). 주소를 내주는 API(가게 조회 API-009 등)가 그 사진을 볼 수 있는
 *   사람에게만 낸다. 내주는 경로는 세션·가게 범위를 보지 않고 데이터베이스도 보지 않는다.
 * - 틀린 주소·지난 주소·없는 파일은 모두 같은 404 not_found(있는지 알리지 않음, 06 DEC-02).
 */
import type { Context } from "hono";
import type { HonoEnv } from "./app";
import { fromBase64Url, fromHex, toBase64Url, toHex } from "./encoding";
import { ApiError } from "./problem";
import { limitPublicRequest } from "./public-rate";
import { FILE_RATE } from "./rate-limit";
import type { Secret } from "./settings";
import { assertStorageKey, STORAGE_KEY } from "./storage";
import { IMAGE_TYPES } from "./uploads";

/** 서명 주소가 사는 시간(06 DEC-09). */
export const FILE_URL_TTL_SECONDS = 15 * 60;

/** /api 뒤의 경로(app.ts의 선언). */
export const FILE_ROUTE = "/files/v1/:token";
/** 공개 포트폴리오 전용 주소. 일반 사진의15분 키/캐시와 분리한다. */
export const PUBLIC_FILE_ROUTE = "/files/public/v1/:token";
export const PUBLIC_FILE_INTERVAL_SECONDS = 150;
export const PUBLIC_FILE_MAX_TTL_SECONDS = 2 * PUBLIC_FILE_INTERVAL_SECONDS;

const VERSION = "v1";
const IV_BYTES = 12;
const TOKEN = /^[A-Za-z0-9_-]{40,1400}$/;
const EXP = /^[1-9][0-9]{0,11}$/;
const SIG = /^[0-9a-f]{64}$/;

const utf8 = new TextEncoder();

export interface OpenedFileUrl {
  readonly key: string;
  /** 주소가 끝나는 유닉스 초. */
  readonly exp: number;
}

export interface FileUrls {
  /** 저장 위치 key의 서명 주소. origin은 요청의 origin(같은 주소가 웹과 API를 냄). */
  sign(key: string, origin: string, now: Date): Promise<string>;
  /** 공개 포트폴리오는 같은 150초 구간에 같은 주소. 기한은 구간 끝 뒤 150초다. */
  signPublic(key: string, origin: string, now: Date): Promise<string>;
  openPublic(token: string, exp: string | undefined, sig: string | undefined, now: Date): Promise<OpenedFileUrl | null>;
  /** 주소의 token·exp·sig를 보고 저장 위치를 돌려준다. 틀리거나 지났으면 null. */
  open(token: string, exp: string | undefined, sig: string | undefined, now: Date): Promise<OpenedFileUrl | null>;
}

/** WebCrypto 키(Workers와 Node의 형식 이름이 달라 값의 형식으로 적음). */
type WebKey = Awaited<ReturnType<typeof crypto.subtle.deriveKey>>;

interface Keys {
  readonly aes: WebKey;
  readonly mac: WebKey;
  readonly nonce: WebKey;
}

async function deriveKeys(secret: Secret, domain = VERSION): Promise<Keys> {
  const base = await crypto.subtle.importKey("raw", utf8.encode(secret.reveal()), "HKDF", false, ["deriveKey"]);
  const params = (info: string) => ({
    name: "HKDF",
    hash: "SHA-256",
    salt: new Uint8Array(0),
    info: utf8.encode(`siljang file-url ${domain} ${info}`),
  });
  const aes = await crypto.subtle.deriveKey(params("aes"), base, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  const mac = await crypto.subtle.deriveKey(
    params("mac"),
    base,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
  const nonce = await crypto.subtle.deriveKey(
    params("nonce"),
    base,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
  return { aes, mac, nonce };
}

function signedText(token: string, exp: number): Uint8Array {
  return utf8.encode(`${VERSION}.${token}.${exp}`);
}

/** FILE_URL_KEY로 서명하고 여는 도구. 키는 처음 쓸 때 한 번 뽑는다. */
export function fileUrlSigner(secret: Secret): FileUrls {
  let keys: Promise<Keys> | undefined;
  let publicKeys: Promise<Keys> | undefined;
  const getKeys = (isPublic: boolean) => {
    if (isPublic) {
      publicKeys ??= deriveKeys(secret, "public-v1");
      return publicKeys;
    }
    keys ??= deriveKeys(secret);
    return keys;
  };
  const text = (token: string, exp: number, isPublic: boolean) =>
    isPublic ? utf8.encode(`public-v1.${token}.${exp}`) : signedText(token, exp);
  const aad = (exp: number) => utf8.encode(`public-v1.${exp}`);
  async function sign(key: string, origin: string, now: Date, isPublic: boolean): Promise<string> {
    assertStorageKey(key);
    const { aes, mac, nonce } = await getKeys(isPublic);
    const seconds = Math.floor(now.getTime() / 1000);
    const exp = isPublic
      ? Math.floor(seconds / PUBLIC_FILE_INTERVAL_SECONDS) * PUBLIC_FILE_INTERVAL_SECONDS + PUBLIC_FILE_MAX_TTL_SECONDS
      : seconds + FILE_URL_TTL_SECONDS;
    // 공개 전용 AES/서명/IV 키는 일반 사진 키와 분리한다. IV 입력은 내용과 기한의 모호하지 않은 짝이다.
    // 같은 저장 위치와 기한은 같은 암호문이다(다른 입력끼리 96비트 IV가 충돌할 확률은 남는다).
    const iv = isPublic
      ? new Uint8Array(await crypto.subtle.sign("HMAC", nonce, utf8.encode(JSON.stringify([key, exp])))).slice(
          0,
          IV_BYTES,
        )
      : crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const algorithm = isPublic ? { name: "AES-GCM", iv, additionalData: aad(exp) } : { name: "AES-GCM", iv };
    const sealed = new Uint8Array(await crypto.subtle.encrypt(algorithm, aes, utf8.encode(key)));
    const packed = new Uint8Array(IV_BYTES + sealed.byteLength);
    packed.set(iv, 0);
    packed.set(sealed, IV_BYTES);
    const token = toBase64Url(packed);
    const sig = toHex(new Uint8Array(await crypto.subtle.sign("HMAC", mac, text(token, exp, isPublic))));
    const route = isPublic ? "public/v1" : VERSION;
    return `${new URL(origin).origin}/api/files/${route}/${token}?exp=${exp}&sig=${sig}`;
  }
  async function open(
    token: string,
    expText: string | undefined,
    sigText: string | undefined,
    now: Date,
    isPublic: boolean,
  ): Promise<OpenedFileUrl | null> {
    if (!TOKEN.test(token) || expText === undefined || !EXP.test(expText) || sigText === undefined) return null;
    const sig = SIG.test(sigText) ? fromHex(sigText) : null;
    const exp = Number(expText);
    if (sig === null || exp * 1000 <= now.getTime()) return null;
    if (
      isPublic &&
      (exp % PUBLIC_FILE_INTERVAL_SECONDS !== 0 || exp * 1000 - now.getTime() > PUBLIC_FILE_MAX_TTL_SECONDS * 1000)
    )
      return null;
    const { aes, mac } = await getKeys(isPublic);
    if (!(await crypto.subtle.verify("HMAC", mac, sig, text(token, exp, isPublic)))) return null;
    const packed = fromBase64Url(token);
    if (packed === null || packed.byteLength <= IV_BYTES) return null;
    const iv = packed.subarray(0, IV_BYTES);
    let plain: ArrayBuffer;
    try {
      const algorithm = isPublic ? { name: "AES-GCM", iv, additionalData: aad(exp) } : { name: "AES-GCM", iv };
      plain = await crypto.subtle.decrypt(algorithm, aes, packed.subarray(IV_BYTES));
    } catch {
      return null;
    }
    let key: string;
    try {
      key = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(plain);
    } catch {
      return null;
    }
    if (key.length > 512 || !STORAGE_KEY.test(key)) return null;
    return { key, exp };
  }
  return {
    sign: (key, origin, now) => sign(key, origin, now, false),
    signPublic: (key, origin, now) => sign(key, origin, now, true),
    open: (token, exp, sig, now) => open(token, exp, sig, now, false),
    openPublic: (token, exp, sig, now) => open(token, exp, sig, now, true),
  };
}

/** 서명 주소로 사진 하나를 낸다(GET /api/files/v1/:token). */
export async function serveFile(c: Context<HonoEnv>, isPublic = false): Promise<Response> {
  await limitPublicRequest(c, FILE_RATE);
  const services = c.get("services");
  const now = services.now();
  const urls = services.fileUrls();
  const opened = await (isPublic ? urls.openPublic : urls.open)(
    c.req.param("token") ?? "",
    c.req.query("exp"),
    c.req.query("sig"),
    now,
  );
  if (opened === null) throw new ApiError("not_found");
  const object = await services.storage().get(opened.key);
  if (object === null) throw new ApiError("not_found");
  // 저장소 응답을 기다리는 동안 만료되었으면 내지 않는다. 캐시 나이도 실제 응답 시각에서 센다.
  const responseTime = services.now();
  if (opened.exp * 1000 <= responseTime.getTime()) {
    await object.body.cancel().catch(() => {});
    throw new ApiError("not_found");
  }
  const image = (IMAGE_TYPES as readonly string[]).includes(object.contentType);
  const remaining = Math.max(0, Math.floor((opened.exp * 1000 - responseTime.getTime()) / 1000));
  const headers = new Headers({
    "content-type": image ? object.contentType : "application/octet-stream",
    "content-disposition": image ? "inline" : "attachment",
    // 공개 포트폴리오만 공유 캐시하고 만료 뒤 재사용을 막는다. 일반 사진은 개인 캐시다.
    "cache-control": isPublic
      ? `public, max-age=${remaining}, s-maxage=${remaining}, must-revalidate`
      : `private, max-age=${remaining}`,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
  });
  if (isPublic) {
    headers.set("date", responseTime.toUTCString());
    headers.set("expires", new Date(opened.exp * 1000).toUTCString());
  }
  if (object.size > 0) headers.set("content-length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}
