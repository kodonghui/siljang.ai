import { readFileSync } from "node:fs";
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { fromBase64Url, toBase64Url, toHex } from "../src/encoding";
import {
  ENVELOPE_PATTERN,
  envelopeVersion,
  type FieldContext,
  FieldCryptoError,
  fieldCrypto,
  MAX_FIELD_BYTES,
} from "../src/field-crypto";
import { MissingSettingError } from "../src/request-key";
import { createServices } from "../src/services";
import { readSettings } from "../src/settings";
import { fieldKeySettings, newFieldKey, randomDigits, testFieldCrypto } from "./support/field-keys";

// 05 A23·E20 계좌번호와 원래 값의 암호화(TASK-025): 봉투 꼴, 묶는 값(AAD), 키 바꾸기, 같은 값 찾기 HMAC, 오류에 평문·키 없음.

const schema = readFileSync(new URL("../../../db/schema.sql", import.meta.url), "utf8");
const SHOP = crypto.randomUUID();
const OTHER_SHOP = crypto.randomUUID();
const ACCOUNT: FieldContext = { purpose: "payment_accounts.account_number", shopId: SHOP };
const ENVELOPE = new RegExp(ENVELOPE_PATTERN);

async function failure(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (e: unknown) => e,
  );
}

/** 봉투의 바이트 i를 바꾼 봉투. */
function flipped(envelope: string, i: number): string {
  const [head, body] = envelope.split(":") as [string, string];
  const bytes = fromBase64Url(body) as Uint8Array;
  bytes[i] = (bytes[i] as number) ^ 0x01;
  return `${head}:${toBase64Url(bytes)}`;
}

describe("05 E20 봉투", () => {
  it("05의 봉투 CHECK 셋이 ENVELOPE_PATTERN과 같은 글", () => {
    for (const column of ["account_number_enc", "refund_account_enc", "original_enc"]) {
      const m = new RegExp(`^\\s*${column}\\s+text[^\\n]*CHECK \\(${column} ~ '([^']+)'\\)`, "m").exec(schema);
      expect(m?.[1], column).toBe(ENVELOPE_PATTERN);
    }
  });

  it("봉투는 v<버전>:base64url(nonce 12바이트‖암호문‖태그 16바이트)이고 채움(=)이 없으며 CHECK를 지남", async () => {
    const fc = testFieldCrypto(new Map([[1, newFieldKey()]]), 1);
    for (const value of ["1", "110-123-456789", randomDigits(16), "가".repeat(80)]) {
      const env = await fc.seal(value, ACCOUNT);
      expect(env).toMatch(ENVELOPE);
      expect(env).not.toContain("=");
      expect(env.startsWith("v1:")).toBe(true);
      const bytes = fromBase64Url(env.slice(3)) as Uint8Array;
      expect(bytes.length).toBe(12 + new TextEncoder().encode(value).length + 16);
    }
    // 1바이트 값이 가장 짧은 봉투(39자, CHECK의 {39,})
    expect((await fc.seal("7", ACCOUNT)).length).toBe("v1:".length + 39);
  });

  it("같은 값도 봉투마다 nonce가 새로 만들어져 봉투가 다름", async () => {
    const fc = testFieldCrypto(new Map([[1, newFieldKey()]]), 1);
    const value = randomDigits(14);
    const seen = new Set<string>();
    const nonces = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const env = await fc.seal(value, ACCOUNT);
      seen.add(env);
      nonces.add(toHex((fromBase64Url(env.slice(3)) as Uint8Array).subarray(0, 12)));
    }
    expect(seen.size).toBe(200);
    expect(nonces.size).toBe(200);
  });

  it("풀면 원래 값(숫자와 '-', 한글)", async () => {
    const fc = testFieldCrypto(new Map([[1, newFieldKey()]]), 1);
    for (const value of ["123456-01-234567", randomDigits(11), "환불 계좌 원래 값"]) {
      expect(await fc.open(await fc.seal(value, ACCOUNT), ACCOUNT)).toBe(value);
    }
  });

  it("빈 값과 256바이트를 넘는 값은 봉투로 만들지 않음", async () => {
    const fc = testFieldCrypto(new Map([[1, newFieldKey()]]), 1);
    expect(await failure(fc.seal("", ACCOUNT))).toBeInstanceOf(FieldCryptoError);
    expect(await failure(fc.seal("1".repeat(MAX_FIELD_BYTES + 1), ACCOUNT))).toBeInstanceOf(FieldCryptoError);
    expect(await fc.seal("1".repeat(MAX_FIELD_BYTES), ACCOUNT)).toMatch(ENVELOPE);
  });

  it("nonce·암호문·태그의 어느 바이트를 바꿔도 풀리지 않음(GCM)", async () => {
    const fc = testFieldCrypto(new Map([[1, newFieldKey()]]), 1);
    const env = await fc.seal(randomDigits(14), ACCOUNT);
    const size = (fromBase64Url(env.slice(3)) as Uint8Array).length;
    for (const i of [0, 11, 12, 20, size - 17, size - 16, size - 1]) {
      expect(await failure(fc.open(flipped(env, i), ACCOUNT)), `byte ${i}`).toBeInstanceOf(FieldCryptoError);
    }
    expect(await failure(fc.open(env.slice(0, -2), ACCOUNT))).toBeInstanceOf(FieldCryptoError);
    expect(await failure(fc.open(`${env}AA`, ACCOUNT))).toBeInstanceOf(FieldCryptoError);
  });

  it("다른 가게·다른 쓰는 곳으로 옮긴 봉투는 풀리지 않음(AAD)", async () => {
    const fc = testFieldCrypto(new Map([[1, newFieldKey()]]), 1);
    const env = await fc.seal(randomDigits(12), ACCOUNT);
    expect(await failure(fc.open(env, { ...ACCOUNT, shopId: OTHER_SHOP }))).toBeInstanceOf(FieldCryptoError);
    expect(await failure(fc.open(env, { purpose: "refunds.refund_account", shopId: SHOP }))).toBeInstanceOf(
      FieldCryptoError,
    );
    expect(await failure(fc.open(env, { purpose: "masked_values.original", shopId: SHOP }))).toBeInstanceOf(
      FieldCryptoError,
    );
    // 가게 ID의 대소문자는 같은 가게
    expect(await fc.open(env, { ...ACCOUNT, shopId: SHOP.toUpperCase() })).toMatch(/^[0-9]{12}$/);
  });

  it("쓰는 곳·가게 ID가 정한 꼴이 아니면 만들지도 풀지도 않음", async () => {
    const fc = testFieldCrypto(new Map([[1, newFieldKey()]]), 1);
    const bad = [
      { purpose: "payment_accounts.account_number", shopId: "not-a-uuid" },
      { purpose: "orders.amount", shopId: SHOP },
    ] as unknown as FieldContext[];
    for (const context of bad) {
      expect(await failure(fc.seal("1234567890", context))).toBeInstanceOf(FieldCryptoError);
    }
  });

  it("봉투 꼴이 아닌 글은 FieldCryptoError(버전 0·1000, 채움, 짧은 몸통)", async () => {
    const fc = testFieldCrypto(new Map([[1, newFieldKey()]]), 1);
    const env = await fc.seal(randomDigits(12), ACCOUNT);
    for (const wrong of [env.replace(/^v1:/, "v0:"), env.replace(/^v1:/, "v1000:"), `${env}=`, "v1:AAAA", ""]) {
      expect(await failure(fc.open(wrong, ACCOUNT)), wrong.slice(0, 8)).toBeInstanceOf(FieldCryptoError);
    }
    expect(envelopeVersion(env)).toBe(1);
    expect(envelopeVersion("v12:abc")).toBeNull();
  });

  it("오류의 메시지·글·inspect에 평문·키·봉투가 없음(06 G6)", async () => {
    const key = newFieldKey();
    const fc = testFieldCrypto(new Map([[1, key]]), 1);
    const value = randomDigits(14);
    const env = await fc.seal(value, ACCOUNT);
    const errors = [
      await failure(fc.open(flipped(env, 20), ACCOUNT)),
      await failure(fc.open(env, { ...ACCOUNT, shopId: OTHER_SHOP })),
      await failure(testFieldCrypto(new Map([[2, newFieldKey()]]), 2).open(env, ACCOUNT)),
      await failure(fc.seal(`${value}${"9".repeat(MAX_FIELD_BYTES)}`, ACCOUNT)),
    ];
    for (const err of errors) {
      expect(err).toBeInstanceOf(FieldCryptoError);
      const text = [
        String(err),
        (err as Error).message,
        (err as Error).stack ?? "",
        inspect(err),
        JSON.stringify(err),
      ].join("\n");
      expect(text).not.toContain(value);
      expect(text).not.toContain(key);
      expect(text).not.toContain(env.slice(3, 30));
    }
  });
});

describe("키 바꾸기(05 E20 '키 버전을 봉투에 적어 바꿀 수 있게')", () => {
  it("v1로 쓴 값을 v2가 지금일 때 읽고, 새로 쓰면 v2", async () => {
    const k1 = newFieldKey();
    const k2 = newFieldKey();
    const value = randomDigits(13);
    const old = await testFieldCrypto(new Map([[1, k1]]), 1).seal(value, ACCOUNT);
    const rotated = testFieldCrypto(
      new Map([
        [1, k1],
        [2, k2],
      ]),
      2,
    );
    expect(rotated.currentVersion).toBe(2);
    expect(await rotated.open(old, ACCOUNT)).toBe(value);
    const fresh = await rotated.seal(value, ACCOUNT);
    expect(fresh.startsWith("v2:")).toBe(true);
    expect(envelopeVersion(fresh)).toBe(2);
    expect(await rotated.open(fresh, ACCOUNT)).toBe(value);
    // 바꾸기 중간(v2 키를 더했지만 지금은 아직 1): 둘 다 읽고 새로 쓰면 v1
    const staged = testFieldCrypto(
      new Map([
        [1, k1],
        [2, k2],
      ]),
      1,
    );
    expect(await staged.open(fresh, ACCOUNT)).toBe(value);
    expect((await staged.seal(value, ACCOUNT)).startsWith("v1:")).toBe(true);
  });

  it("앞 키(v1)를 빼면 v1 봉투는 일반 오류로 읽지 못함", async () => {
    const k1 = newFieldKey();
    const old = await testFieldCrypto(new Map([[1, k1]]), 1).seal(randomDigits(12), ACCOUNT);
    const only2 = testFieldCrypto(new Map([[2, newFieldKey()]]), 2);
    const err = await failure(only2.open(old, ACCOUNT));
    expect(err).toBeInstanceOf(FieldCryptoError);
    expect((err as Error).message).toBe("field key version is not set");
  });

  it("같은 키 글이라도 버전마다 다른 키라 버전 글자만 바꾼 봉투는 풀리지 않음", async () => {
    const k = newFieldKey();
    const both = testFieldCrypto(
      new Map([
        [1, k],
        [2, k],
      ]),
      1,
    );
    const env = await both.seal(randomDigits(12), ACCOUNT);
    expect(await failure(both.open(env.replace(/^v1:/, "v2:"), ACCOUNT))).toBeInstanceOf(FieldCryptoError);
  });

  it("지금 버전의 키가 없는 설정으로는 만들지 않음", () => {
    expect(() => fieldCrypto(fieldKeySettings(new Map([[1, newFieldKey()]]), 2))).toThrow(FieldCryptoError);
  });
});

describe("같은 값 찾기 HMAC(05 E20 '다른 비밀 키의 HMAC-SHA256')", () => {
  it("16진수 64자, 같은 조각이면 같고 조각이 하나라도 다르면 다름", async () => {
    const fc = testFieldCrypto(new Map([[1, newFieldKey()]]), 1);
    const parts = ["masked_values", SHOP, crypto.randomUUID(), "phone", "01012345678"];
    const h = await fc.valueHash(parts);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await fc.valueHash([...parts])).toBe(h);
    for (let i = 1; i < parts.length; i += 1) {
      const other = [...parts];
      other[i] = `${other[i]}0`;
      expect(await fc.valueHash(other)).not.toBe(h);
    }
  });

  it("조각의 경계가 섞이지 않음(['ab','c']와 ['a','bc']는 다름)", async () => {
    const fc = testFieldCrypto(new Map([[1, newFieldKey()]]), 1);
    expect(await fc.valueHash(["ab", "c"])).not.toBe(await fc.valueHash(["a", "bc"]));
  });

  it("HMAC 키는 암호화 키의 비밀 값 그대로가 아님(HKDF로 따로 뽑음)", async () => {
    const key = newFieldKey();
    const fc = testFieldCrypto(new Map([[1, key]]), 1);
    const raw = await crypto.subtle.importKey(
      "raw",
      fromBase64Url(key) as Uint8Array,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    // 같은 메시지(길이를 앞에 붙인 꼬리표와 조각)를 비밀 값 그대로의 키로 서명한 값과 다름
    const label = "siljang-value-hmac";
    const message = new TextEncoder().encode(`${label.length}:${label}1:x`);
    const plain = toHex(new Uint8Array(await crypto.subtle.sign("HMAC", raw, message)));
    expect(await fc.valueHash(["x"])).toMatch(/^[0-9a-f]{64}$/);
    expect(await fc.valueHash(["x"])).not.toBe(plain);
  });

  it("valueHashes는 지금 버전이 먼저이고 가진 버전마다 하나(키를 바꿔도 앞 버전의 값을 찾음)", async () => {
    const k1 = newFieldKey();
    const parts = ["masked_values", SHOP, "c", "account", "1101234567890"];
    const before = await testFieldCrypto(new Map([[1, k1]]), 1).valueHash(parts);
    const rotated = testFieldCrypto(
      new Map([
        [1, k1],
        [2, newFieldKey()],
      ]),
      2,
    );
    const hashes = await rotated.valueHashes(parts);
    expect(hashes).toHaveLength(2);
    expect(hashes[0]).toBe(await rotated.valueHash(parts));
    expect(hashes[1]).toBe(before);
    expect(hashes[0]).not.toBe(before);
  });
});

describe("설정과 서비스", () => {
  it("키가 없으면 암호화가 필요한 곳만 MissingSettingError(500 internal)", () => {
    const services = createServices({}, readSettings({}));
    expect(() => services.fieldCrypto()).toThrow(MissingSettingError);
  });

  it("FIELD_KEY_CURRENT·FIELD_KEY_V1이 있으면 같은 도구를 한 번 만들어 씀", async () => {
    const key = newFieldKey();
    const services = createServices({}, readSettings({ FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: key }));
    const fc = services.fieldCrypto();
    expect(services.fieldCrypto()).toBe(fc);
    const env = await fc.seal("1234567890", ACCOUNT);
    expect(await testFieldCrypto(new Map([[1, key]]), 1).open(env, ACCOUNT)).toBe("1234567890");
  });
});
