/**
 * 마스킹한 값 저장(TASK-025; 05 A15·A23·E20, 04 SPEC-021 [노출], REQ-191~193). 테이블은 TBL-019 masked_values.
 *
 * - maskValue: 상담 안에서 찾은 번호 하나를 플레이스홀더(예: [전화번호1])로 바꿔 돌려주고 원래 값을 05대로 둔다.
 *   - 전화번호·계좌번호: 원래 값의 봉투(field-crypto.ts, 쓰는 곳 masked_values.original)와 같은 값 찾기 HMAC과 끝 4자리.
 *     같은 상담의 같은 값은 같은 플레이스홀더(행 하나, masked_values_value_uq).
 *   - 카드번호: 끝 4자리만(원래 값·HMAC 없음). 나올 때마다 새 번호(REQ-192).
 *   - 긴 숫자(8자리 넘음, 주민등록번호처럼 보이는 것 포함): 아무것도 두지 않음(끝 4자리도 없음, REQ-192).
 *   - 번호는 상담 안에서 종류마다 1부터 1씩. 상담 행을 잠가(FOR UPDATE) 같은 상담에 동시에 온 값을 차례로 매긴다.
 * - HMAC은 원래 값만이 아니라 가게·상담·종류와 함께 셈한다(같은 상담 안의 같은 값 찾기에만 쓰므로, 다른 상담·다른 가게의
 *   같은 번호를 해시로 이을 수 없게). 찾을 때는 가진 모든 키 버전의 HMAC으로 찾고 쓸 때는 지금 버전(키를 바꾼 뒤에도 앞 값을 찾음).
 * - 받는 값은 숫자만이다. 띄어쓰기·하이픈·한글 숫자를 숫자로 바꾸고 무엇을 무엇으로 볼지 나누는 일(SPEC-021 [입력])과 AI로
 *   보내는 일은 TASK-066, 원래 값을 보이는 경로(그 가게 사장님 화면, 사유를 적고 연 운영자 TASK-159와 접속기록 TASK-024)는
 *   그 작업이 권한을 보고 openMaskedValue를 부른다.
 * - 이 모듈은 로그를 쓰지 않는다. 실패는 이름 있는 오류로만 올린다(06 G6).
 */
import { type FieldCrypto, FieldCryptoError } from "./field-crypto";
import type { ShopDb } from "./shop-scope";

export const MASK_KINDS = ["phone", "account", "card", "long_number"] as const;
export type MaskKind = (typeof MASK_KINDS)[number];

/** 플레이스홀더의 이름(05 masked_values.placeholder CHECK). */
export const PLACEHOLDER_LABELS: Readonly<Record<MaskKind, string>> = {
  phone: "전화번호",
  account: "계좌번호",
  card: "카드번호",
  long_number: "긴숫자",
};

/** 플레이스홀더 번호의 끝(05 CHECK `[0-9]{1,3}`). */
export const MAX_PLACEHOLDER_NUMBER = 999;

/** 새 입력의 인용과 사장님 복원은 같은 표시자 범위를 쓴다. 호출마다 정규식 상태를 분리한다. */
export function maskedValuePlaceholderPattern(): RegExp {
  const labels = Object.values(PLACEHOLDER_LABELS)
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return new RegExp(`\\[(${labels})([0-9]{1,3})\\]`, "g");
}

/**
 * 받는 숫자의 자릿수. 계좌번호 10~16(06·SPEC-021), 카드번호 13~19(SPEC-021), 긴 숫자 9자리 이상(SPEC-021 '8자리 넘는').
 * 전화번호의 자릿수는 원본에 없어 끝 4자리를 둘 수 있는 4자리 이상만 본다(20자리까지, 나누는 규칙은 TASK-066).
 */
const DIGITS: Readonly<Record<MaskKind, RegExp>> = {
  phone: /^[0-9]{4,20}$/,
  account: /^[0-9]{10,16}$/,
  card: /^[0-9]{13,19}$/,
  long_number: /^[0-9]{9,}$/,
};

/** 원래 값을 두는 종류(05 masked_values_kept_chk). */
const KEEPS_ORIGINAL: ReadonlySet<MaskKind> = new Set<MaskKind>(["phone", "account"]);

/** 마스킹을 마치지 못함(상담의 번호가 999를 넘음). 부르는 쪽(TASK-066)은 AI를 부르지 않고 에스컬레이션한다(SPEC-021 [외부]). */
export class MaskingFailedError extends Error {
  override readonly name = "MaskingFailedError";
}

function hashParts(tx: ShopDb, consultationId: string, kind: MaskKind, digits: string): readonly string[] {
  return ["masked_values", tx.scope.shopId, consultationId, kind, digits];
}

/**
 * 상담의 번호 하나를 플레이스홀더로. 가게 범위 연결의 트랜잭션 안에서 부른다(상담 행을 잠금).
 * 다른 가게의 상담이나 없는 상담은 404 not_found(06 DEC-02)이고 아무것도 쓰지 않는다.
 */
export async function maskValue(
  tx: ShopDb,
  fc: FieldCrypto,
  consultationIdRaw: string,
  kind: MaskKind,
  digits: string,
): Promise<string> {
  if (!(MASK_KINDS as readonly string[]).includes(kind)) throw new TypeError("unknown mask kind");
  if (typeof digits !== "string" || !DIGITS[kind].test(digits)) {
    throw new TypeError(`${kind} must be digits only with the expected length`);
  }
  const consultationId = await tx.owned("consultations", consultationIdRaw, { lock: true });
  const keeps = KEEPS_ORIGINAL.has(kind);
  if (keeps) {
    const hashes = await fc.valueHashes(hashParts(tx, consultationId, kind, digits));
    const same = await tx.run<{ placeholder: string }>(
      `SELECT placeholder FROM masked_values
        WHERE shop_id = $1 AND consultation_id = $2 AND kind = $3 AND value_hmac = ANY($4::text[])`,
      [consultationId, kind, hashes],
    );
    const found = same.rows[0];
    if (found !== undefined) return found.placeholder;
  }
  const last = await tx.found<{ n: number }>(
    `SELECT coalesce(max(regexp_replace(placeholder, '[^0-9]', '', 'g')::int), 0) AS n
       FROM masked_values
      WHERE shop_id = $1 AND consultation_id = $2 AND kind = $3`,
    [consultationId, kind],
  );
  const next = last.n + 1;
  if (next > MAX_PLACEHOLDER_NUMBER)
    throw new MaskingFailedError("placeholder numbers are used up in this consultation");
  const placeholder = `[${PLACEHOLDER_LABELS[kind]}${next}]`;
  const originalEnc = keeps
    ? await fc.seal(digits, { purpose: "masked_values.original", shopId: tx.scope.shopId })
    : null;
  const valueHmac = keeps ? await fc.valueHash(hashParts(tx, consultationId, kind, digits)) : null;
  const last4 = kind === "long_number" ? null : digits.slice(-4);
  await tx.run(
    `INSERT INTO masked_values (shop_id, consultation_id, kind, placeholder, original_enc, value_hmac, last4)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [consultationId, kind, placeholder, originalEnc, valueHmac, last4],
  );
  return placeholder;
}

/** 플레이스홀더 하나의 원래 값. 카드번호는 끝 4자리만, 긴 숫자는 아무것도 없다. */
export interface MaskedOriginal {
  readonly kind: MaskKind;
  /** 전화번호·계좌번호의 원래 값(숫자만). 카드번호·긴 숫자는 null. */
  readonly original: string | null;
  readonly last4: string | null;
}

export interface StoredMaskedValue {
  readonly kind: MaskKind;
  readonly original_enc: string | null;
  readonly last4: string | null;
}

/** 볼 사람과 상담 범위를 확인한 호출자만 쓴다. 여러 표시 값을 읽을 때 같은 행을 다시 조회하지 않는다. */
export async function openStoredMaskedValue(
  row: StoredMaskedValue,
  shopId: string,
  getCrypto: () => FieldCrypto,
): Promise<MaskedOriginal> {
  if (row.kind === "card" || row.kind === "long_number" || row.original_enc === null)
    return { kind: row.kind, original: null, last4: row.last4 };
  const original = await getCrypto().open(row.original_enc, { purpose: "masked_values.original", shopId });
  if (!DIGITS[row.kind].test(original)) throw new FieldCryptoError("masked value does not hold digits");
  return { kind: row.kind, original, last4: row.last4 };
}

/**
 * 상담의 플레이스홀더를 원래 값으로. 볼 수 있는 사람인지(그 가게 사장님 화면, 사유를 적고 연 운영자와 접속기록)는 부르는
 * 작업이 먼저 본다. 다른 가게의 상담·없는 플레이스홀더는 404 not_found. 봉투를 풀지 못하면 FieldCryptoError.
 */
export async function openMaskedValue(
  tx: ShopDb,
  fc: FieldCrypto,
  consultationIdRaw: string,
  placeholder: string,
): Promise<MaskedOriginal> {
  const consultationId = await tx.owned("consultations", consultationIdRaw);
  const row = await tx.found<StoredMaskedValue>(
    `SELECT kind, original_enc, last4 FROM masked_values
      WHERE shop_id = $1 AND consultation_id = $2 AND placeholder = $3`,
    [consultationId, placeholder],
  );
  return openStoredMaskedValue(row, tx.scope.shopId, () => fc);
}
