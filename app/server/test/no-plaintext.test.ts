import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sealAccountNumber } from "../src/account-number";
import { createApp } from "../src/app";
import { FieldCryptoError } from "../src/field-crypto";
import { maskValue } from "../src/masked-values";
import { openRoute } from "../src/routes";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { collectLogs, describeDb, newUuid, testDb } from "./support/db";
import { newFieldKey, randomDigits, singleKeyCrypto, testFieldCrypto } from "./support/field-keys";
import { createShop, type ShopFixture } from "./support/shops";

// 05 A23 끝난 조건(TASK-025): 계좌번호와 원래 값이 데이터베이스에 평문으로 남지 않는다. 앱의 도구로 가게 계좌·환불 계좌·
// 대화 속 전화번호·계좌번호·카드번호·긴 숫자를 쓴 뒤 데이터베이스의 모든 테이블의 모든 행(행 전체를 글로 바꿈)을 훑는다.
// 오류 응답과 로그에도 평문·키·봉투가 없다(06 G6).

/** 숫자를 a-b-c 꼴로 나눈 글(사람이 넣는 꼴). */
function dashed(digits: string, cuts: readonly number[]): string {
  const parts: string[] = [];
  let at = 0;
  for (const n of cuts) {
    parts.push(digits.slice(at, at + n));
    at += n;
  }
  parts.push(digits.slice(at));
  return parts.join("-");
}

describeDb("05 A23 계좌번호와 원래 값이 데이터베이스에 평문으로 남지 않음", () => {
  const db = testDb();
  let f: ShopFixture;
  const { fc } = singleKeyCrypto();

  beforeAll(async () => {
    f = await createShop(db, "평문없는가게");
  });

  afterAll(async () => {
    await db.close();
  });

  /** 데이터베이스의 모든 기본 테이블에서 행 전체의 글에 needles 가운데 하나라도 든 행 수(테이블마다). */
  async function scan(needles: readonly string[]): Promise<Record<string, number>> {
    const tables = await db.query<{ name: string }>(
      `SELECT table_name AS name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
    );
    expect(tables.rows.length).toBeGreaterThanOrEqual(50);
    const patterns = needles.map((n) => `%${n}%`);
    const hits: Record<string, number> = {};
    for (const { name } of tables.rows) {
      expect(name).toMatch(/^[a-z_][a-z0-9_]*$/);
      const r = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM public.${name} t WHERE t::text LIKE ANY($1::text[])`,
        [patterns],
      );
      const n = r.rows[0]?.n ?? 0;
      if (n > 0) hits[name] = n;
    }
    return hits;
  }

  it("가게 계좌·환불 계좌·대화 속 번호를 쓴 뒤 평문(숫자만인 꼴과 '-'를 넣은 꼴)은 어느 테이블에도 0건", async () => {
    const shopAccount = randomDigits(14);
    const refundAccount = randomDigits(12);
    const phone = `010${randomDigits(8)}`;
    const chatAccount = randomDigits(13);
    const card = randomDigits(16);
    const longNumber = randomDigits(13);

    // 가게 계좌(TBL-015)
    const a = await sealAccountNumber(fc, dashed(shopAccount, [6, 2]), "payment_accounts.account_number", f.shopId);
    await db.query(
      "UPDATE payment_accounts SET account_number_enc = $3, account_last4 = $4 WHERE shop_id = $1 AND id = $2",
      [f.shopId, f.paymentAccountId, a.enc, a.last4],
    );
    // 환불 계좌(TBL-033)
    const r = await sealAccountNumber(fc, dashed(refundAccount, [3, 3]), "refunds.refund_account", f.shopId);
    await db.query(
      `INSERT INTO refunds (id, shop_id, order_id, cause, cancelled_order_id, event_key, decision, amount, calculated_amount,
                            calc_basis, refund_bank_name, refund_account_enc, refund_account_last4, refund_holder_name)
       VALUES ($1, $2, $3, 'customer_cancel', $3, $4, 'full', 35000, 35000, '{"case":"no-plaintext"}', '시험은행', $5, $6, '시험손님')`,
      [newUuid(), f.shopId, f.orderId, `refund:${f.orderId}:cancel`, r.enc, r.last4],
    );
    // 대화 속 번호(TBL-019)
    const scope = createShopScope(f.shopId, { kind: "customer", channelId: f.channelId });
    await shopRequestDb(scope, db).transaction(async (tx) => {
      await maskValue(tx, fc, f.consultationId, "phone", phone);
      await maskValue(tx, fc, f.consultationId, "account", chatAccount);
      await maskValue(tx, fc, f.consultationId, "card", card);
      await maskValue(tx, fc, f.consultationId, "long_number", longNumber);
    });

    // 검사가 헛돌지 않는지: 일부러 남긴 표시 숫자는 찾음
    const canary = randomDigits(15);
    await db.query("UPDATE messages SET body_masked = $2 WHERE id = $1", [f.messageId, `표시 ${canary}`]);
    expect(await scan([canary])).toEqual({ messages: 1 });

    const needles = [
      shopAccount,
      dashed(shopAccount, [6, 2]),
      refundAccount,
      dashed(refundAccount, [3, 3]),
      phone,
      dashed(phone, [3, 4]),
      chatAccount,
      card,
      longNumber,
    ];
    expect(await scan(needles)).toEqual({});
    // 긴 숫자는 끝 4자리도 두지 않음(카드번호·전화번호·계좌번호의 끝 4자리는 가린 값으로 둠)
    const masked = await db.query<{ last4: string | null }>(
      "SELECT last4 FROM masked_values WHERE consultation_id = $1 AND kind = 'long_number'",
      [f.consultationId],
    );
    expect(masked.rows).toEqual([{ last4: null }]);
  });
});

describe("06 G6 봉투를 풀지 못한 오류의 응답과 로그", () => {
  it("500 internal과 요청 ID만, 로그에는 오류 이름만(평문·키·봉투 없음)", async () => {
    const key = newFieldKey();
    const shopId = crypto.randomUUID();
    const value = randomDigits(14);
    const env = await testFieldCrypto(new Map([[1, key]]), 1).seal(value, {
      purpose: "payment_accounts.account_number",
      shopId,
    });
    const { lines, sink } = collectLogs();
    const route = openRoute("GET", "/test/field-open", "시험용 경로(봉투를 다른 가게로 풀어 봄)", async (c) => {
      const opened = await c
        .get("services")
        .fieldCrypto()
        .open(env, { purpose: "payment_accounts.account_number", shopId: crypto.randomUUID() });
      return c.json({ opened });
    });
    const app = createApp({ logSink: sink, routes: [route] });
    const res = await app.request("/api/test/field-open", {}, { FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: key });
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(JSON.parse(body)).toMatchObject({ code: "internal", status: 500 });
    const all = `${body}\n${lines.join("\n")}`;
    expect(all).toContain(`"errorName":"${new FieldCryptoError("x").name}"`);
    for (const secret of [value, key, env.slice(3, 40)]) expect(all).not.toContain(secret);
  });
});
