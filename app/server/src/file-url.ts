/**
 * 사진의 15분 서명 주소(TASK-022; 06 DEC-09 '15분 사는 서명 주소. 저장 위치는 포함하지 않음', licensePhotoUrl 등은
 * format uri·2048자까지). 주소를 만드는 도구(sign)와 주소로 사진을 내주는 경로(serveFile, app.ts의 openRoute)가 있다.
 * 06 계약 밖의 경로다(06 예시의 주소도 지어낸 다른 주소).
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
import type { Secret } from "./settings";
import { assertStorageKey, STORAGE_KEY } from "./storage";
import { IMAGE_TYPES } from "./uploads";

/** 서명 주소가 사는 시간(06 DEC-09). */
export const FILE_URL_TTL_SECONDS = 15 * 60;

/** /api 뒤의 경로(app.ts의 선언). */
export const FILE_ROUTE = "/files/v1/:token";

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
  /** 주소의 token·exp·sig를 보고 저장 위치를 돌려준다. 틀리거나 지났으면 null. */
  open(token: string, exp: string | undefined, sig: string | undefined, now: Date): Promise<OpenedFileUrl | null>;
}

/** WebCrypto 키(Workers와 Node의 형식 이름이 달라 값의 형식으로 적음). */
type WebKey = Awaited<ReturnType<typeof crypto.subtle.deriveKey>>;

interface Keys {
  readonly aes: WebKey;
  readonly mac: WebKey;
}

async function deriveKeys(secret: Secret): Promise<Keys> {
  const base = await crypto.subtle.importKey("raw", utf8.encode(secret.reveal()), "HKDF", false, ["deriveKey"]);
  const params = (info: string) => ({
    name: "HKDF",
    hash: "SHA-256",
    salt: new Uint8Array(0),
    info: utf8.encode(`siljang file-url ${VERSION} ${info}`),
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
  return { aes, mac };
}

function signedText(token: string, exp: number): Uint8Array {
  return utf8.encode(`${VERSION}.${token}.${exp}`);
}

/** FILE_URL_KEY로 서명하고 여는 도구. 키는 처음 쓸 때 한 번 뽑는다. */
export function fileUrlSigner(secret: Secret): FileUrls {
  let keys: Promise<Keys> | undefined;
  const getKeys = () => {
    keys ??= deriveKeys(secret);
    return keys;
  };
  return {
    async sign(key, origin, now) {
      assertStorageKey(key);
      const { aes, mac } = await getKeys();
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, utf8.encode(key)));
      const packed = new Uint8Array(IV_BYTES + sealed.byteLength);
      packed.set(iv, 0);
      packed.set(sealed, IV_BYTES);
      const token = toBase64Url(packed);
      const exp = Math.floor(now.getTime() / 1000) + FILE_URL_TTL_SECONDS;
      const sig = toHex(new Uint8Array(await crypto.subtle.sign("HMAC", mac, signedText(token, exp))));
      return `${new URL(origin).origin}/api/files/${VERSION}/${token}?exp=${exp}&sig=${sig}`;
    },
    async open(token, expText, sigText, now) {
      if (!TOKEN.test(token) || expText === undefined || !EXP.test(expText) || sigText === undefined) return null;
      const sig = SIG.test(sigText) ? fromHex(sigText) : null;
      const exp = Number(expText);
      if (sig === null || exp * 1000 <= now.getTime()) return null;
      const { aes, mac } = await getKeys();
      if (!(await crypto.subtle.verify("HMAC", mac, sig, signedText(token, exp)))) return null;
      const packed = fromBase64Url(token);
      if (packed === null || packed.byteLength <= IV_BYTES) return null;
      let plain: ArrayBuffer;
      try {
        plain = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: packed.subarray(0, IV_BYTES) },
          aes,
          packed.subarray(IV_BYTES),
        );
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
    },
  };
}

/** 서명 주소로 사진 하나를 낸다(GET /api/files/v1/:token). */
export async function serveFile(c: Context<HonoEnv>): Promise<Response> {
  const services = c.get("services");
  const now = services.now();
  const opened = await services
    .fileUrls()
    .open(c.req.param("token") ?? "", c.req.query("exp"), c.req.query("sig"), now);
  if (opened === null) throw new ApiError("not_found");
  const object = await services.storage().get(opened.key);
  if (object === null) throw new ApiError("not_found");
  const image = (IMAGE_TYPES as readonly string[]).includes(object.contentType);
  const remaining = Math.max(0, opened.exp - Math.floor(now.getTime() / 1000));
  const headers = new Headers({
    "content-type": image ? object.contentType : "application/octet-stream",
    "content-disposition": image ? "inline" : "attachment",
    // 주소마다 사는 동안만, 그 사람의 브라우저에만 둔다(공유 캐시에 두지 않음).
    "cache-control": `private, max-age=${remaining}`,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
  });
  if (object.size > 0) headers.set("content-length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}
