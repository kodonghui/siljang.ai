/** SPEC-021 번호 검출과 마스킹. 입력/정규화한 숫자는 로그나 오류에 넣지 않는다. */
import type { FieldCrypto } from "./field-crypto";
import {
  MAX_PLACEHOLDER_NUMBER,
  MaskingFailedError,
  type MaskKind,
  maskedValuePlaceholderPattern,
  maskValue,
} from "./masked-values";
import type { ShopDb } from "./shop-scope";

const HANGUL_DIGITS: Readonly<Record<string, string>> = {
  공: "0",
  영: "0",
  일: "1",
  이: "2",
  삼: "3",
  사: "4",
  오: "5",
  육: "6",
  륙: "6",
  칠: "7",
  팔: "8",
  구: "9",
};
const DECIMAL = /^\p{Nd}$/u;
const NUMBER = /[+＋]?[\p{Nd}공영일이삼사오육륙칠팔구](?:[\s\p{Cf}\-‐‑‒–—−－]*[\p{Nd}공영일이삼사오육륙칠팔구])*/gu;
const BANK_FULL =
  /계좌|(?:KB국민|국민|신한|우리|하나|농협|기업|수협|산업|부산|경남|대구|광주|전북|제주|씨티|제일)은행|카카오뱅크|토스뱅크|케이뱅크|SC제일/;
const BANK_BEFORE =
  /(?:^|[^가-힣A-Za-z])(?:국민|신한|우리|하나|농협|기업|수협|우체국|새마을|신협|씨티|산업|부산|경남|대구|광주|전북|제주)[\s:：,()-]*$/;
const BANK_AFTER =
  /^[\s:：,()-]*(?:국민|신한|우리|하나|농협|기업|수협|우체국|새마을|신협|씨티|산업|부산|경남|대구|광주|전북|제주)(?:$|[^가-힣A-Za-z])/;
const DIGIT_CACHE = new Map<string, string>();

function digitOf(char: string): string | undefined {
  if (Object.hasOwn(HANGUL_DIGITS, char)) return HANGUL_DIGITS[char];
  if (!DECIMAL.test(char)) return undefined;
  const cached = DIGIT_CACHE.get(char);
  if (cached !== undefined) return cached;
  const normalized = char.normalize("NFKC");
  if (/^[0-9]$/.test(normalized)) {
    DIGIT_CACHE.set(char, normalized);
    return normalized;
  }
  // Unicode Nd는 0~9의 연속된 묶음이다. 수학 숫자는 여러 묶음이 붙어 있으므로10으로 나눈 나머지를 쓴다.
  const point = char.codePointAt(0) as number;
  let first = point;
  while (first > 0 && DECIMAL.test(String.fromCodePoint(first - 1))) first -= 1;
  const digit = String((point - first) % 10);
  DIGIT_CACHE.set(char, digit);
  return digit;
}

function digitsOf(text: string): string {
  return [...text]
    .map(digitOf)
    .filter((digit) => digit !== undefined)
    .join("");
}

function bankContext(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 40), start);
  const after = text.slice(end, end + 40);
  return BANK_FULL.test(before) || BANK_FULL.test(after) || BANK_BEFORE.test(before) || BANK_AFTER.test(after);
}

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = digits.length - 1, double = false; i >= 0; i -= 1, double = !double) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

function residentNumber(digits: string): boolean {
  if (!/^\d{6}[1-8]\d{6}$/.test(digits)) return false;
  const year = (["1", "2", "5", "6"].includes(digits[6] as string) ? 1900 : 2000) + Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const day = Number(digits.slice(4, 6));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function phoneDigits(raw: string, digits: string): string | null {
  const local = /^82(?:1[016789]|2|[3-6][1-5]|70)/.test(digits) ? `0${digits.slice(2)}` : digits;
  if (
    /^010\d{8}$/.test(local) ||
    /^01[16789]\d{7,8}$/.test(local) ||
    /^02\d{7,8}$/.test(local) ||
    /^0(?:[3-6][1-5]|70|80)\d{7,8}$/.test(local)
  )
    return local;
  if (/^01[016789]\d{4,5}$/.test(local) && /[-‐‑‒–—−－\s\p{Cf}공영일이삼사오육륙칠팔구]/u.test(raw)) return local;
  if (/^050[2-8]\d{7,8}$/.test(local)) return local;
  if (/^1[568]\d{6}$/.test(local) && /[-‐‑‒–—−－\s\p{Cf}]/u.test(raw)) return local;
  if (/^[+＋]/.test(raw) && /^[1-9]\d{8,14}$/.test(digits)) return digits;
  return null;
}

export interface MessageNumber {
  readonly start: number;
  readonly end: number;
  readonly kind: MaskKind;
  /** 숫자만인 정규화 값. 저장 모듈 외부로 보내거나 기록하지 않는다. */
  readonly digits: string;
}

export interface MaskingContext {
  readonly refundAccount?: boolean;
  /** 저장된 메시지의 시스템 표시자는 보존한다. 새 입력에는 쓰지 않는다. */
  readonly storedMessage?: boolean;
}

/** 공백으로 이어 적은 전화번호를 긴 숫자 하나로 합치지 않는다. 후보마다 최대20자리만 살핀다. */
function phonePieces(raw: string, start: number): readonly MessageNumber[] | null {
  const chunks = [...raw.matchAll(/[^\s\p{Cf}]+/gu)]
    .map((m) => ({
      start: m.index,
      end: m.index + m[0].length,
      digits: [...m[0]]
        .map(digitOf)
        .filter((n) => n !== undefined)
        .join(""),
    }))
    .filter((chunk) => chunk.digits !== "");
  if (chunks.length < 2) return null;
  const next: ({ end: number; digits: string } | undefined)[] = new Array(chunks.length + 1);
  next[chunks.length] = { end: chunks.length, digits: "" };
  for (let i = chunks.length - 1; i >= 0; i -= 1) {
    let digits = "";
    for (let j = i; j < chunks.length; j += 1) {
      const first = chunks[i],
        last = chunks[j];
      if (first === undefined || last === undefined) break;
      digits += last.digits;
      if (digits.length > 20) break;
      const phone = phoneDigits(raw.slice(first.start, last.end), digits);
      if (phone !== null && next[j + 1] !== undefined) {
        next[i] = { end: j + 1, digits: phone };
        break;
      }
    }
  }
  const result: MessageNumber[] = [];
  for (let i = 0; i < chunks.length; ) {
    const step = next[i],
      first = chunks[i],
      last = step === undefined ? undefined : chunks[step.end - 1];
    if (step === undefined || first === undefined || last === undefined) return null;
    result.push({ start: start + first.start, end: start + last.end, kind: "phone", digits: step.digits });
    i = step.end;
  }
  return result.length < 2 ? null : result;
}

/** 주문번호인6~8자리와 짧은 숫자는 보존한다. 주민등록번호 모양/유효 카드번호는 계좌 문맥보다 먼저 가린다. */
export function messageNumbers(text: string, context: MaskingContext = {}): readonly MessageNumber[] {
  const found: MessageNumber[] = [];
  for (const match of text.matchAll(NUMBER)) {
    let start = match.index,
      end = start + match[0].length;
    let raw = match[0];
    // 숫자 뒤의 조사 '이요/이고', 단어 끝의 '일'을 한글 숫자에 붙이지 않는다.
    if (
      /\p{Nd}/u.test(raw) &&
      /[가-힣]/u.test(text[end] ?? "") &&
      raw.endsWith("이") &&
      phoneDigits(raw, digitsOf(raw)) === null
    ) {
      raw = raw.slice(0, -1);
      end -= 1;
    }
    const prefix = /^[공영일이삼사오육륙칠팔구][\s\p{Cf}\-‐‑‒–—−－]*(?=\p{Nd})/u.exec(raw)?.[0];
    if (/[가-힣]/u.test(text[start - 1] ?? "") && prefix !== undefined) {
      raw = raw.slice(prefix.length);
      start += prefix.length;
    }
    const digits = digitsOf(raw);
    let kind: MaskKind;
    let canonical = digits;
    if (residentNumber(digits)) kind = "long_number";
    else if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) kind = "card";
    else {
      const phone = phoneDigits(raw, digits);
      if (phone === null) {
        const pieces = phonePieces(raw, start);
        if (pieces !== null) {
          found.push(...pieces);
          continue;
        }
      }
      if (phone !== null) {
        kind = "phone";
        canonical = phone;
      } else if (digits.length >= 10 && digits.length <= 16 && (context.refundAccount || bankContext(text, start, end)))
        kind = "account";
      else if (digits.length > 8) kind = "long_number";
      else continue;
    }
    found.push({ start, end, kind, digits: canonical });
  }
  return found;
}

/** 호출자의 트랜잭션 안에서 번호와 마스킹한 글을 준비한다. 본문 저장과 커밋은 호출자가 함께 한다. */
export async function maskMessageText(
  db: ShopDb,
  crypto: () => FieldCrypto,
  consultationId: string,
  text: string,
  context: MaskingContext = {},
): Promise<string> {
  const quoted = context.storedMessage ? text : text.replace(maskedValuePlaceholderPattern(), "［$1$2］");
  const numbers = messageNumbers(quoted, context);
  if (numbers.length === 0) return quoted;
  const counts = new Map<MaskKind, number>();
  const unique = new Set<string>();
  for (const number of numbers) {
    if (number.kind === "phone" || number.kind === "account") {
      const identity = `${number.kind}:${number.digits}`;
      if (unique.has(identity)) continue;
      unique.add(identity);
    }
    const count = (counts.get(number.kind) ?? 0) + 1;
    if (count > MAX_PLACEHOLDER_NUMBER) throw new MaskingFailedError("too many masked values in one message");
    counts.set(number.kind, count);
  }
  const fields = crypto();
  const reused = new Map<string, string>();
  const output: string[] = [];
  let offset = 0;
  for (const number of numbers) {
    const identity = number.kind === "phone" || number.kind === "account" ? `${number.kind}:${number.digits}` : null;
    let placeholder = identity === null ? undefined : reused.get(identity);
    if (placeholder === undefined) {
      placeholder = await maskValue(db, fields, consultationId, number.kind, number.digits);
      if (identity !== null) reused.set(identity, placeholder);
    }
    output.push(quoted.slice(offset, number.start), placeholder);
    offset = number.end;
  }
  output.push(quoted.slice(offset));
  return output.join("");
}

/** 수신 행과 마스킹 값은 호출자의 저장점/트랜잭션에서 함께 남긴다. */
export async function storeMaskedMessageText(
  db: ShopDb,
  crypto: () => FieldCrypto,
  source: { readonly messageId: string; readonly consultationId: string },
  text: string,
): Promise<void> {
  const body = await maskMessageText(db, crypto, source.consultationId, text);
  const result = await db.run(
    `UPDATE messages SET body_masked = $3 WHERE shop_id = $1 AND id = $2 AND consultation_id = $4
      AND direction = 'inbound' AND kind = 'text' AND body_masked IS NULL`,
    [source.messageId, body, source.consultationId],
  );
  if (result.rowCount !== 1) throw new MaskingFailedError("inbound message unavailable");
}
