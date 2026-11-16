/**
 * 계좌번호와 원래 값의 암호화(TASK-025; 05 A23·5절 E20, REQ-191·135).
 *
 * - 가게 계좌번호(payment_accounts.account_number_enc)·환불 계좌번호(refunds.refund_account_enc)·대화 속 전화번호와
 *   계좌번호의 원래 값(masked_values.original_enc)은 저장하기 전에 앱이 AES-256-GCM으로 암호화한다. 값마다 새 12바이트
 *   nonce(crypto.getRandomValues), 16바이트 태그. 봉투는 `v<키 버전>:base64url(nonce‖암호문‖태그)`(채움 없음)이고
 *   데이터베이스는 이 모양만 CHECK로 본다(ENVELOPE_PATTERN과 같은 글, test/field-crypto.test.ts가 05와 견줌).
 * - 키: 설정(settings.ts)의 버전마다 32바이트 비밀 값에서 HKDF-SHA256으로 용도마다 따로 뽑는다(암호화 키와 같은 값 찾기
 *   HMAC 키는 다른 키, 05 E20 '다른 비밀 키'). 새로 쓰는 봉투는 지금 버전(FIELD_KEY_CURRENT), 읽기는 봉투에 적힌 버전의 키.
 * - 묶는 값(AAD): 쓰는 곳(FieldPurpose)과 가게 ID와 키 버전. 데이터베이스에 쓸 수 있는 사람이 봉투를 다른 가게·다른 컬럼으로
 *   옮겨도 풀리지 않는다(GCM이 거절). 정당하게 옮길 때(대화 속 계좌번호를 환불 계좌로 등)는 풀고 다시 암호화한다.
 * - 실패(꼴이 틀림·없는 버전·바뀐 암호문·다른 가게·다른 쓰는 곳)는 모두 FieldCryptoError 하나이고, 메시지에 평문·키·봉투를
 *   싣지 않는다(응답은 500 internal, 로그에는 이름만, 06 G6).
 * - 키 바꾸기 차례는 app/README.md 31. 앞 버전 봉투를 지금 버전으로 다시 감싸는 도구는 TASK-166.
 */
import { fromBase64Url, toBase64Url, toHex } from "./encoding";
import type { FieldKeySettings } from "./settings";
import { isUuid } from "./shop-scope";

/** 봉투를 쓰는 곳(테이블.컬럼, 마스킹 원본은 masked_values.original). AAD에 들어간다. */
export const FIELD_PURPOSES = [
  "payment_accounts.account_number",
  "refunds.refund_account",
  "masked_values.original",
] as const;
export type FieldPurpose = (typeof FIELD_PURPOSES)[number];

/** 봉투가 묶이는 곳. 같은 곳으로만 풀린다. */
export interface FieldContext {
  readonly purpose: FieldPurpose;
  readonly shopId: string;
}

/** 05의 봉투 CHECK와 같은 글(payment_accounts_account_number_enc_check 등 셋). */
export const ENVELOPE_PATTERN = "^v[1-9][0-9]{0,2}:[A-Za-z0-9_-]{39,}$";
const ENVELOPE = /^v([1-9][0-9]{0,2}):([A-Za-z0-9_-]{39,})$/;

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
/** 평문의 가장 긴 길이(UTF-8 바이트). 계좌번호·전화번호는 40자를 넘지 않는다(06 accountNumber maxLength 40). */
export const MAX_FIELD_BYTES = 256;

/** 봉투를 만들거나 풀지 못함. 메시지는 정해 둔 글뿐이다(평문·키·봉투 없음). */
export class FieldCryptoError extends Error {
  override readonly name = "FieldCryptoError";
}

export interface FieldCrypto {
  /** 새로 쓰는 봉투의 키 버전. */
  readonly currentVersion: number;
  /** 평문(1~256바이트)을 봉투로. 지금 버전의 키를 쓴다. */
  seal(plaintext: string, context: FieldContext): Promise<string>;
  /** 봉투를 평문으로. 봉투에 적힌 버전의 키를 쓴다. 풀지 못하면 FieldCryptoError. */
  open(envelope: string, context: FieldContext): Promise<string>;
  /** 같은 값 찾기의 HMAC-SHA256(16진수 64자), 지금 버전의 키. 쓸 때 쓴다. */
  valueHash(parts: readonly string[]): Promise<string>;
  /** 같은 값 찾기의 HMAC을 가진 모든 버전의 키로(지금 버전이 먼저). 찾을 때 쓴다(키를 바꾼 뒤에도 앞 값을 찾음). */
  valueHashes(parts: readonly string[]): Promise<readonly string[]>;
}

/** 봉투의 키 버전. 봉투 꼴이 아니면 null. 다시 감쌀 봉투(지금 버전이 아닌 것)를 고를 때 쓴다. */
export function envelopeVersion(envelope: string): number | null {
  const m = ENVELOPE.exec(envelope);
  return m === null ? null : Number(m[1]);
}

/** WebCrypto 키(Workers와 Node의 형식 이름이 달라 값의 형식으로 적음). */
type WebKey = Awaited<ReturnType<typeof crypto.subtle.deriveKey>>;

interface VersionKeys {
  readonly aes: WebKey;
  readonly mac: WebKey;
}

const utf8 = new TextEncoder();
const utf8Strict = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** 길이를 앞에 붙여 이어 붙인다(조각의 경계가 섞이지 않게). */
function framed(label: string, parts: readonly string[]): Uint8Array {
  return utf8.encode([label, ...parts].map((p) => `${p.length}:${p}`).join(""));
}

function aad(version: number, context: FieldContext): Uint8Array {
  if (!(FIELD_PURPOSES as readonly string[]).includes(context.purpose) || !isUuid(context.shopId)) {
    throw new FieldCryptoError("field context is not valid");
  }
  return framed("siljang-field-aad", [`v${version}`, context.purpose, context.shopId.toLowerCase()]);
}

async function deriveVersionKeys(version: number, secret: string): Promise<VersionKeys> {
  const raw = fromBase64Url(secret);
  if (raw === null || raw.length !== 32) throw new FieldCryptoError("field key is not 32 bytes");
  const base = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
  const params = (use: string) => ({
    name: "HKDF",
    hash: "SHA-256",
    salt: new Uint8Array(0),
    info: utf8.encode(`siljang field v${version} ${use}`),
  });
  const aes = await crypto.subtle.deriveKey(params("aes-256-gcm"), base, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  const mac = await crypto.subtle.deriveKey(
    params("value-hmac-sha256"),
    base,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
  return { aes, mac };
}

/** 설정의 키로 암호화 도구를 만든다. 키는 버전마다 처음 쓸 때 한 번 뽑는다. */
export function fieldCrypto(settings: FieldKeySettings): FieldCrypto {
  if (!settings.keys.has(settings.current)) throw new FieldCryptoError("current field key is not set");
  const derived = new Map<number, Promise<VersionKeys>>();
  const versions = [settings.current, ...[...settings.keys.keys()].filter((v) => v !== settings.current)];

  function keysOf(version: number): Promise<VersionKeys> {
    let p = derived.get(version);
    if (p === undefined) {
      const secret = settings.keys.get(version);
      if (secret === undefined) return Promise.reject(new FieldCryptoError("field key version is not set"));
      p = deriveVersionKeys(version, secret.reveal());
      // 실패한 뽑기는 남기지 않는다(다음에 다시 봄).
      p.catch(() => derived.delete(version));
      derived.set(version, p);
    }
    return p;
  }

  async function hashWith(version: number, parts: readonly string[]): Promise<string> {
    const { mac } = await keysOf(version);
    const sig = await crypto.subtle.sign("HMAC", mac, framed("siljang-value-hmac", parts));
    return toHex(new Uint8Array(sig));
  }

  return {
    currentVersion: settings.current,

    async seal(plaintext, context) {
      if (typeof plaintext !== "string" || plaintext === "") throw new FieldCryptoError("field value is empty");
      const bytes = utf8.encode(plaintext);
      if (bytes.length > MAX_FIELD_BYTES) throw new FieldCryptoError("field value is too long");
      const version = settings.current;
      const additionalData = aad(version, context);
      const { aes } = await keysOf(version);
      const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
      const sealed = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv: nonce, additionalData, tagLength: TAG_BYTES * 8 },
          aes,
          bytes,
        ),
      );
      const out = new Uint8Array(NONCE_BYTES + sealed.length);
      out.set(nonce, 0);
      out.set(sealed, NONCE_BYTES);
      return `v${version}:${toBase64Url(out)}`;
    },

    async open(envelope, context) {
      const m = typeof envelope === "string" ? ENVELOPE.exec(envelope) : null;
      if (m === null) throw new FieldCryptoError("field envelope is not valid");
      const version = Number(m[1]);
      const bytes = fromBase64Url(m[2] as string);
      if (bytes === null || bytes.length <= NONCE_BYTES + TAG_BYTES) {
        throw new FieldCryptoError("field envelope is not valid");
      }
      const additionalData = aad(version, context);
      const { aes } = await keysOf(version);
      let plain: ArrayBuffer;
      try {
        plain = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: bytes.subarray(0, NONCE_BYTES), additionalData, tagLength: TAG_BYTES * 8 },
          aes,
          bytes.subarray(NONCE_BYTES),
        );
      } catch {
        // 바뀐 암호문·다른 키·다른 가게·다른 쓰는 곳은 모두 같은 실패(원래 오류의 내용은 싣지 않음).
        throw new FieldCryptoError("field envelope could not be opened");
      }
      try {
        return utf8Strict.decode(plain);
      } catch {
        throw new FieldCryptoError("field envelope could not be opened");
      }
    },

    valueHash(parts) {
      return hashWith(settings.current, parts);
    },

    async valueHashes(parts) {
      return Promise.all(versions.map((v) => hashWith(v, parts)));
    },
  };
}
