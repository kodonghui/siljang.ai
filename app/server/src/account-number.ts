/**
 * 계좌번호 저장 도구(TASK-025; 05 A23·E20, 06 accountNumber, REQ-191).
 * - 가게 계좌(TBL-015 payment_accounts)와 환불 계좌(TBL-033 refunds)의 계좌번호는 봉투(field-crypto.ts)와 끝 4자리(숫자만 센
 *   마지막 4자리)로만 둔다. 평문 컬럼은 없다.
 * - 평문 형식(숫자와 '-', 숫자만 10~16자리)은 06 API가 본다. 이 모듈의 ACCOUNT_NUMBER_PATTERN·길이는 06 계약의 글과 같고
 *   (test/account-number.test.ts가 06과 견줌), 경로(TASK-040 API-024·025, TASK-125)는 계약 검사로 422를 낸 뒤 이 도구를 부른다.
 * - 보이는 곳: 그 가게 사장님 화면, 그 가게 손님의 결제 안내(보일 때 채움, TASK-093), 사유를 적고 연 운영자(TASK-159).
 *   어디서 풀지는 부르는 작업이 정하고, 이 도구는 풀어 주기만 한다.
 */
import type { FieldContext, FieldCrypto } from "./field-crypto";

/** 06 accountNumber의 pattern(API-024·025·070 등 요청 본문). */
export const ACCOUNT_NUMBER_PATTERN = "^-*([0-9]-*){10,16}$";
/** 06 accountNumber의 minLength·maxLength. */
export const ACCOUNT_NUMBER_LENGTH = { min: 10, max: 40 } as const;

const ACCOUNT_NUMBER = new RegExp(ACCOUNT_NUMBER_PATTERN);

/** 계좌번호를 두는 곳. */
export type AccountPurpose = Extract<
  FieldContext["purpose"],
  "payment_accounts.account_number" | "refunds.refund_account"
>;

/** 06 형식의 계좌번호인지(숫자와 '-', 숫자만 10~16자리, 10~40자). */
export function isAccountNumber(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= ACCOUNT_NUMBER_LENGTH.min &&
    value.length <= ACCOUNT_NUMBER_LENGTH.max &&
    ACCOUNT_NUMBER.test(value)
  );
}

/** 계좌번호의 끝 4자리(숫자만 셈). 운영자 화면과 목록의 가린 값(SPEC-073). */
export function accountLast4(accountNumber: string): string {
  const digits = accountNumber.replace(/[^0-9]/g, "");
  if (digits.length < 4) throw new TypeError("account number has fewer than 4 digits");
  return digits.slice(-4);
}

/** 데이터베이스에 둘 계좌번호: 봉투와 끝 4자리(함께 씀, refunds_account_pair_chk). */
export interface SealedAccountNumber {
  readonly enc: string;
  readonly last4: string;
}

/**
 * 계좌번호를 봉투와 끝 4자리로. 평문은 06 형식이어야 한다(아니면 TypeError: 경로가 먼저 422로 막았어야 함).
 * 평문은 받은 그대로(숫자와 '-') 암호화한다. 사장님이 넣은 꼴 그대로 보이게(06 응답의 accountNumber).
 */
export async function sealAccountNumber(
  fc: FieldCrypto,
  accountNumber: string,
  purpose: AccountPurpose,
  shopId: string,
): Promise<SealedAccountNumber> {
  if (!isAccountNumber(accountNumber)) throw new TypeError("account number does not match the 06 pattern");
  const enc = await fc.seal(accountNumber, { purpose, shopId });
  return { enc, last4: accountLast4(accountNumber) };
}

/** 봉투를 계좌번호로. 다른 가게·다른 곳의 봉투는 FieldCryptoError. */
export function openAccountNumber(
  fc: FieldCrypto,
  enc: string,
  purpose: AccountPurpose,
  shopId: string,
): Promise<string> {
  return fc.open(enc, { purpose, shopId });
}
