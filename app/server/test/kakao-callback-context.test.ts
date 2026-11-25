import { describe, expect, it } from "vitest";
import { FieldCryptoError, MAX_FIELD_BYTES } from "../src/field-crypto";
import { kakaoCallback } from "../src/kakao-callback";
import { decodeKakaoCallbackContext, encodeKakaoCallbackContext } from "../src/kakao-callback-context";
import { type KakaoOrderReference, kakaoOrderReference } from "../src/kakao-order-reference";
import { newFieldKey, testFieldCrypto } from "./support/field-keys";

const NOW = new Date("2026-11-25T00:00:00Z");
const MESSAGE = "3120102e-c345-4500-8910-123456789abc";
const URL_PREFIX = "https://bot-api.kakao.com/v1/callback/";
const URL_VALUE = `${URL_PREFIX}synthetic_callback`;

function encode(reference: KakaoOrderReference, url = URL_VALUE) {
  const callback = kakaoCallback(url, NOW);
  if (callback === null) throw new Error("합성 콜백 주소 오류");
  return encodeKakaoCallbackContext(callback, MESSAGE, reference);
}

describe("수신 주문번호와 암호화 콜백 문맥(TASK-081)", () => {
  it.each([
    ["주문을 취소해 주세요", { kind: "none" }],
    ["주문번호 abc123 취소", { kind: "explicit", orderNo: "ABC123" }],
    ["9999999999 취소", { kind: "explicit", orderNo: "9999999999" }],
    ["ABC123와 abc123 주문", { kind: "explicit", orderNo: "ABC123" }],
    ["ABC123 또는 SECOND12 취소", { kind: "ambiguous" }],
    ["주문번호 ABC1234567890 취소", { kind: "none" }],
  ] as const)("마스킹 전에 원문에서 번호 후보를 정한다: %s", (text, expected) => {
    expect(kakaoOrderReference(text)).toEqual(expected);
  });

  it.each([
    { kind: "none" },
    { kind: "ambiguous" },
    { kind: "explicit", orderNo: "ABC123" },
    { kind: "explicit", orderNo: "9999999999" },
  ] as const)("상태 $kind를 수신 UUID와 함께 복원한다", (reference) => {
    expect(decodeKakaoCallbackContext(encode(reference), NOW, MESSAGE)).toEqual({ url: URL_VALUE, reference });
  });

  it("최장256자 주소와12자 번호도 기존256바이트 암호화 상한에 들어간다", async () => {
    const url = `${URL_PREFIX}${"a".repeat(180)}?q=${"b".repeat(256 - URL_PREFIX.length - 183)}`;
    expect(url).toHaveLength(256);
    const reference = { kind: "explicit", orderNo: "ABC123456789" } as const;
    const plain = encode(reference, url);
    expect(new TextEncoder().encode(plain).length).toBe(255);
    expect(MAX_FIELD_BYTES).toBe(256);
    const fields = testFieldCrypto(new Map([[1, newFieldKey()]]), 1);
    const context = { purpose: "messages.kakao_callback", shopId: crypto.randomUUID() } as const;
    const envelope = await fields.seal(plain, context);
    expect(envelope).not.toContain(reference.orderNo);
    expect(decodeKakaoCallbackContext(await fields.open(envelope, context), NOW, MESSAGE)).toEqual({ url, reference });
  });

  it("옛 URL 전용 봉투는 번호 확인 없음으로 구분한다", () => {
    expect(decodeKakaoCallbackContext(URL_VALUE, NOW, MESSAGE)).toEqual({ url: URL_VALUE });
  });

  it("다른 수신으로 옮겨진 문맥을 거부한다", () => {
    expect(() => decodeKakaoCallbackContext(encode({ kind: "none" }), NOW, crypto.randomUUID())).toThrow(
      FieldCryptoError,
    );
  });

  it.each(["zbad", "6ABCDE", "n../other", "n"])("손상된 내부 문맥을 거부한다(%s)", (suffix) => {
    const plain = encode({ kind: "none" }).slice(0, 24) + suffix;
    expect(() => decodeKakaoCallbackContext(plain, NOW, MESSAGE)).toThrow(FieldCryptoError);
  });
});
