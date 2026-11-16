import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ACCOUNT_NUMBER_LENGTH,
  ACCOUNT_NUMBER_PATTERN,
  accountLast4,
  isAccountNumber,
  openAccountNumber,
  sealAccountNumber,
} from "../src/account-number";
import { sqlStateOf } from "../src/db";
import { ENVELOPE_PATTERN, FieldCryptoError } from "../src/field-crypto";
import { contract } from "./support/contract";
import { describeDb, newUuid, testDb } from "./support/db";
import { randomDigits, singleKeyCrypto } from "./support/field-keys";
import { createShop, type ShopFixture } from "./support/shops";

// 05 A23 계좌번호의 암호화(TASK-025): 가게 계좌(TBL-015)·환불 계좌(TBL-033)는 봉투와 끝 4자리만. 평문 형식은 06과 같은 글.

interface StringSchema {
  readonly pattern?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
}

/** 06 계약에서 accountNumber 속성의 스키마를 모두 모은다. */
function accountNumberSchemas(node: unknown, out: StringSchema[] = []): StringSchema[] {
  if (Array.isArray(node)) {
    for (const item of node) accountNumberSchemas(item, out);
  } else if (typeof node === "object" && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (key === "accountNumber" && typeof value === "object" && value !== null && "type" in value) {
        out.push(value as StringSchema);
      }
      accountNumberSchemas(value, out);
    }
  }
  return out;
}

async function failure(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (e: unknown) => e,
  );
}

describe("06 accountNumber 형식", () => {
  it("06에서 숫자 10~16자리를 받는 accountNumber는 모두 이 모듈과 같은 pattern·길이", () => {
    const schemas = accountNumberSchemas(contract).filter((s) => s.minLength === ACCOUNT_NUMBER_LENGTH.min);
    expect(schemas.length).toBeGreaterThanOrEqual(4);
    for (const s of schemas) {
      expect(s.pattern).toBe(ACCOUNT_NUMBER_PATTERN);
      expect(s.maxLength).toBe(ACCOUNT_NUMBER_LENGTH.max);
    }
  });

  it("숫자와 '-'만, 숫자만 세어 10~16자리, 10~40자", () => {
    for (const ok of ["123456-01-234567", "110-123-456789", "1234567890", "1234567890123456", "-1234567890-"]) {
      expect(isAccountNumber(ok), ok).toBe(true);
    }
    for (const bad of [
      "123456789",
      "12345678901234567",
      "110 123 456789",
      "110-123-45678a",
      "１２３４５６７８９０",
      `${"-".repeat(31)}1234567890`,
      12345678901,
      null,
    ]) {
      expect(isAccountNumber(bad), String(bad)).toBe(false);
    }
  });

  it("끝 4자리는 숫자만 셈", () => {
    expect(accountLast4("123456-01-234567")).toBe("4567");
    expect(accountLast4("110-123-45678-9")).toBe("6789");
    expect(accountLast4("1234567890--")).toBe("7890");
  });

  it("06 형식이 아닌 값은 봉투로 만들지 않음(경로가 먼저 422로 막음)", async () => {
    const { fc } = singleKeyCrypto();
    const err = await failure(sealAccountNumber(fc, "12345", "payment_accounts.account_number", newUuid()));
    expect(err).toBeInstanceOf(TypeError);
    expect((err as Error).message).not.toContain("12345");
  });
});

describeDb("05 A23 계좌번호를 봉투와 끝 4자리로", () => {
  const db = testDb();
  let f: ShopFixture;
  let other: ShopFixture;
  const { fc } = singleKeyCrypto();

  beforeAll(async () => {
    f = await createShop(db, "계좌가게");
    other = await createShop(db, "다른계좌가게");
  });

  afterAll(async () => {
    await db.close();
  });

  it("가게 계좌: 봉투가 05 CHECK를 지나고, 읽어 풀면 넣은 그대로", async () => {
    const accountNumber = `${randomDigits(6)}-${randomDigits(2)}-${randomDigits(6)}`;
    const sealed = await sealAccountNumber(fc, accountNumber, "payment_accounts.account_number", f.shopId);
    expect(sealed.enc).toMatch(new RegExp(ENVELOPE_PATTERN));
    expect(sealed.last4).toBe(accountNumber.slice(-4));
    await db.query(
      "UPDATE payment_accounts SET account_number_enc = $3, account_last4 = $4 WHERE shop_id = $1 AND id = $2",
      [f.shopId, f.paymentAccountId, sealed.enc, sealed.last4],
    );
    const r = await db.query<{ account_number_enc: string; account_last4: string }>(
      "SELECT account_number_enc, account_last4 FROM payment_accounts WHERE id = $1",
      [f.paymentAccountId],
    );
    const row = r.rows[0];
    expect(row?.account_last4).toBe(sealed.last4);
    expect(
      await openAccountNumber(fc, row?.account_number_enc ?? "", "payment_accounts.account_number", f.shopId),
    ).toBe(accountNumber);
    // 다른 가게의 계좌로 옮긴 봉투는 풀리지 않음(AAD)
    expect(
      await failure(openAccountNumber(fc, sealed.enc, "payment_accounts.account_number", other.shopId)),
    ).toBeInstanceOf(FieldCryptoError);
  });

  it("평문 계좌번호는 데이터베이스가 거절(23514 CHECK)", async () => {
    const err = await failure(
      db.query("UPDATE payment_accounts SET account_number_enc = $2 WHERE id = $1", [
        f.paymentAccountId,
        "110-123-456789",
      ]),
    );
    expect(sqlStateOf(err)).toBe("23514");
  });

  it("환불 계좌: 봉투와 끝 4자리를 함께 쓰고(refunds_account_pair_chk), 가게 계좌의 봉투로는 풀리지 않음", async () => {
    const accountNumber = `${randomDigits(3)}-${randomDigits(3)}-${randomDigits(6)}`;
    const sealed = await sealAccountNumber(fc, accountNumber, "refunds.refund_account", f.shopId);
    const refundId = newUuid();
    await db.query(
      `INSERT INTO refunds (id, shop_id, order_id, cause, cancelled_order_id, event_key, decision, amount, calculated_amount,
                            calc_basis, method, refund_bank_name, refund_account_enc, refund_account_last4, refund_holder_name)
       VALUES ($1, $2, $3, 'customer_cancel', $3, $4, 'full', 35000, 35000, '{"case":"task-025"}', 'bank_transfer', '시험은행',
               $5, $6, '시험손님')`,
      [refundId, f.shopId, f.orderId, `refund:${f.orderId}:cancel`, sealed.enc, sealed.last4],
    );
    const r = await db.query<{ refund_account_enc: string }>("SELECT refund_account_enc FROM refunds WHERE id = $1", [
      refundId,
    ]);
    const enc = r.rows[0]?.refund_account_enc ?? "";
    expect(await openAccountNumber(fc, enc, "refunds.refund_account", f.shopId)).toBe(accountNumber);
    expect(await failure(openAccountNumber(fc, enc, "payment_accounts.account_number", f.shopId))).toBeInstanceOf(
      FieldCryptoError,
    );
    // 봉투만 있고 끝 4자리가 없으면 데이터베이스가 거절
    const err = await failure(db.query("UPDATE refunds SET refund_account_last4 = NULL WHERE id = $1", [refundId]));
    expect(sqlStateOf(err)).toBe("23514");
  });
});
