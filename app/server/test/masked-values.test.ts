import { afterAll, beforeAll, expect, it } from "vitest";
import type { RequestDb } from "../src/db";
import { ENVELOPE_PATTERN, envelopeVersion, type FieldCrypto } from "../src/field-crypto";
import {
  MAX_PLACEHOLDER_NUMBER,
  MaskingFailedError,
  type MaskKind,
  maskValue,
  openMaskedValue,
} from "../src/masked-values";
import { ApiError } from "../src/problem";
import { createShopScope, type ShopScope, shopRequestDb } from "../src/shop-scope";
import { describeDb, newUuid, testDb } from "./support/db";
import { newFieldKey, randomDigits, testFieldCrypto } from "./support/field-keys";
import { createShop, type ShopFixture } from "./support/shops";

// 05 A15 마스킹한 값(TASK-025; 04 SPEC-021 [노출], REQ-191~193): 전화번호·계좌번호는 봉투·HMAC·끝 4자리, 같은 값은 같은
// 플레이스홀더, 카드번호는 끝 4자리만·나올 때마다 새 번호, 긴 숫자는 아무것도 두지 않음. 번호는 상담 행을 잠가 차례로 매김.

interface MaskedRow {
  kind: MaskKind;
  placeholder: string;
  original_enc: string | null;
  value_hmac: string | null;
  last4: string | null;
}

async function failure(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (e: unknown) => e,
  );
}

describeDb("05 A15 마스킹한 값 저장", () => {
  const db = testDb();
  let f: ShopFixture;
  let other: ShopFixture;
  let scope: ShopScope;
  const k1 = newFieldKey();
  const fc = testFieldCrypto(new Map([[1, k1]]), 1);

  beforeAll(async () => {
    f = await createShop(db, "마스킹가게");
    other = await createShop(db, "다른마스킹가게");
    scope = createShopScope(f.shopId, { kind: "customer", channelId: f.channelId });
  });

  afterAll(async () => {
    await db.close();
  });

  /** 같은 손님의 끝난 상담 하나(시험마다 새 상담, 손님마다 살아 있는 상담 하나 규칙을 피함). */
  async function newConsultation(x: ShopFixture = f): Promise<string> {
    const id = newUuid();
    await db.query(
      `INSERT INTO consultations (id, shop_id, customer_id, status, ended_at, last_customer_message_at)
       VALUES ($1, $2, $3, 'ended', now(), now())`,
      [id, x.shopId, x.customerId],
    );
    return id;
  }

  const mask = (consultationId: string, kind: MaskKind, digits: string, tool: FieldCrypto = fc, on: RequestDb = db) =>
    shopRequestDb(scope, on).transaction((tx) => maskValue(tx, tool, consultationId, kind, digits));

  const open = (consultationId: string, placeholder: string, tool: FieldCrypto = fc) =>
    shopRequestDb(scope, db).transaction((tx) => openMaskedValue(tx, tool, consultationId, placeholder));

  async function rows(consultationId: string): Promise<MaskedRow[]> {
    const r = await db.query<MaskedRow>(
      `SELECT kind, placeholder, original_enc, value_hmac, last4 FROM masked_values
        WHERE consultation_id = $1 ORDER BY kind, created_at, placeholder`,
      [consultationId],
    );
    return r.rows;
  }

  it("전화번호: 같은 번호는 같은 플레이스홀더(행 하나), 다른 번호는 다음 번호, 봉투·HMAC·끝 4자리를 둠", async () => {
    const c = await newConsultation();
    const a = `010${randomDigits(8)}`;
    const b = `010${randomDigits(8)}`;
    expect(await mask(c, "phone", a)).toBe("[전화번호1]");
    expect(await mask(c, "phone", b)).toBe("[전화번호2]");
    expect(await mask(c, "phone", a)).toBe("[전화번호1]");
    const r = await rows(c);
    expect(r).toHaveLength(2);
    for (const row of r) {
      expect(row.original_enc).toMatch(new RegExp(ENVELOPE_PATTERN));
      expect(row.value_hmac).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(r.map((row) => row.last4).sort()).toEqual([a.slice(-4), b.slice(-4)].sort());
    expect((await open(c, "[전화번호1]")).original).toBe(a);
    expect(await open(c, "[전화번호2]")).toEqual({ kind: "phone", original: b, last4: b.slice(-4) });
  });

  it("계좌번호는 종류마다 따로 셈([계좌번호1])이고, 같은 숫자라도 전화번호와 다른 행", async () => {
    const c = await newConsultation();
    const digits = randomDigits(11);
    expect(await mask(c, "phone", digits)).toBe("[전화번호1]");
    expect(await mask(c, "account", digits)).toBe("[계좌번호1]");
    expect(await mask(c, "account", digits)).toBe("[계좌번호1]");
    expect(await rows(c)).toHaveLength(2);
    expect((await open(c, "[계좌번호1]")).original).toBe(digits);
  });

  it("카드번호는 끝 4자리만 두고(원래 값·HMAC 없음) 같은 번호도 나올 때마다 새 번호(REQ-192)", async () => {
    const c = await newConsultation();
    const card = randomDigits(16);
    expect(await mask(c, "card", card)).toBe("[카드번호1]");
    expect(await mask(c, "card", card)).toBe("[카드번호2]");
    const r = await rows(c);
    expect(r).toHaveLength(2);
    for (const row of r) {
      expect(row).toMatchObject({ kind: "card", original_enc: null, value_hmac: null, last4: card.slice(-4) });
    }
    expect(await open(c, "[카드번호2]")).toEqual({ kind: "card", original: null, last4: card.slice(-4) });
  });

  it("긴 숫자는 아무것도 두지 않음(끝 4자리도 없음, REQ-192)", async () => {
    const c = await newConsultation();
    expect(await mask(c, "long_number", randomDigits(13))).toBe("[긴숫자1]");
    expect(await mask(c, "long_number", randomDigits(9))).toBe("[긴숫자2]");
    const r = await rows(c);
    expect(r.map((row) => [row.original_enc, row.value_hmac, row.last4])).toEqual([
      [null, null, null],
      [null, null, null],
    ]);
    expect(await open(c, "[긴숫자1]")).toEqual({ kind: "long_number", original: null, last4: null });
  });

  it("숫자만이 아니거나 자릿수가 맞지 않으면 TypeError이고 아무것도 쓰지 않음", async () => {
    const c = await newConsultation();
    const wrong: [MaskKind, string][] = [
      ["phone", "010-1234-5678"],
      ["phone", "123"],
      ["account", randomDigits(9)],
      ["account", randomDigits(17)],
      ["card", randomDigits(12)],
      ["card", randomDigits(20)],
      ["long_number", randomDigits(8)],
      ["phone", "０１０１２３４５６７８"],
    ];
    for (const [kind, digits] of wrong) {
      expect(await failure(mask(c, kind, digits)), `${kind} ${digits.length}`).toBeInstanceOf(TypeError);
    }
    expect(await failure(mask(c, "ssn" as MaskKind, randomDigits(13)))).toBeInstanceOf(TypeError);
    expect(await rows(c)).toHaveLength(0);
  });

  it("다른 가게의 상담·없는 상담·형식이 틀린 ID는 같은 404이고 쓴 행 0(06 DEC-02, G1)", async () => {
    const theirs = await newConsultation(other);
    for (const id of [theirs, newUuid(), "not-a-uuid"]) {
      const err = await failure(mask(id, "phone", `010${randomDigits(8)}`));
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("not_found");
    }
    expect(await rows(theirs)).toHaveLength(0);
    // 그 가게의 플레이스홀더도 이 가게 범위로는 열리지 않음
    const c = await newConsultation();
    await mask(c, "phone", `010${randomDigits(8)}`);
    const otherScope = createShopScope(other.shopId, { kind: "customer", channelId: other.channelId });
    const err = await failure(
      shopRequestDb(otherScope, db).transaction((tx) => openMaskedValue(tx, fc, c, "[전화번호1]")),
    );
    expect((err as ApiError).code).toBe("not_found");
    expect(((await failure(open(c, "[전화번호9]"))) as ApiError).code).toBe("not_found");
  });

  it("같은 상담에 동시에 온 번호: 연결 아홉이 함께 써도 번호가 겹치거나 비지 않고 같은 값은 같은 플레이스홀더", async () => {
    const c = await newConsultation();
    const values = Array.from({ length: 6 }, () => `010${randomDigits(8)}`);
    // 앞 셋은 두 번씩: 9번 부름(부름마다 연결 하나, 트랜잭션 하나), 행은 6
    const calls = [...values, values[0], values[1], values[2]] as string[];
    const conns = calls.map(() => testDb());
    try {
      const results = await Promise.all(calls.map((v, i) => mask(c, "phone", v, fc, conns[i])));
      const byValue = new Map<string, Set<string>>();
      calls.forEach((v, i) => {
        const set = byValue.get(v) ?? new Set<string>();
        set.add(results[i] as string);
        byValue.set(v, set);
      });
      for (const set of byValue.values()) expect(set.size).toBe(1);
      const r = await rows(c);
      expect(r).toHaveLength(6);
      expect(r.map((row) => row.placeholder).sort()).toEqual(
        Array.from({ length: 6 }, (_, i) => `[전화번호${i + 1}]`).sort(),
      );
    } finally {
      await Promise.all(conns.map((x) => x.close()));
    }
  });

  it("키를 바꾼 뒤(v2가 지금): v1로 쓴 같은 번호는 같은 플레이스홀더, 새 번호는 v2 봉투, 둘 다 열림", async () => {
    const c = await newConsultation();
    const a = `010${randomDigits(8)}`;
    const b = `010${randomDigits(8)}`;
    expect(await mask(c, "phone", a)).toBe("[전화번호1]");
    const rotated = testFieldCrypto(
      new Map([
        [1, k1],
        [2, newFieldKey()],
      ]),
      2,
    );
    expect(await mask(c, "phone", a, rotated)).toBe("[전화번호1]");
    expect(await mask(c, "phone", b, rotated)).toBe("[전화번호2]");
    const r = await rows(c);
    expect(r).toHaveLength(2);
    const versions = new Map(r.map((row) => [row.placeholder, envelopeVersion(row.original_enc ?? "")]));
    expect(versions.get("[전화번호1]")).toBe(1);
    expect(versions.get("[전화번호2]")).toBe(2);
    expect((await open(c, "[전화번호1]", rotated)).original).toBe(a);
    expect((await open(c, "[전화번호2]", rotated)).original).toBe(b);
  });

  it(`번호가 ${MAX_PLACEHOLDER_NUMBER}에 다다른 종류는 MaskingFailedError(부르는 쪽이 에스컬레이션)`, async () => {
    const c = await newConsultation();
    await db.query(
      `INSERT INTO masked_values (shop_id, consultation_id, kind, placeholder, last4)
       VALUES ($1, $2, 'card', $3, '1111')`,
      [f.shopId, c, `[카드번호${MAX_PLACEHOLDER_NUMBER}]`],
    );
    expect(await failure(mask(c, "card", randomDigits(16)))).toBeInstanceOf(MaskingFailedError);
    // 다른 종류는 1부터
    expect(await mask(c, "phone", `010${randomDigits(8)}`)).toBe("[전화번호1]");
  });

  it("HMAC은 상담마다 달라 다른 상담의 같은 번호를 해시로 잇지 못함", async () => {
    const c1 = await newConsultation();
    const c2 = await newConsultation();
    const a = `010${randomDigits(8)}`;
    await mask(c1, "phone", a);
    await mask(c2, "phone", a);
    const [h1] = (await rows(c1)).map((row) => row.value_hmac);
    const [h2] = (await rows(c2)).map((row) => row.value_hmac);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).not.toBe(h2);
  });
});
