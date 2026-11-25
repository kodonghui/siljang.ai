import { describe, expect, it } from "vitest";
import { FieldCryptoError, MAX_FIELD_BYTES, MAX_KAKAO_PHOTO_CONTEXT_BYTES } from "../src/field-crypto";
import { decodeKakaoPhotoContext, encodeKakaoPhotoContext, KAKAO_PHOTO_PURPOSE } from "../src/kakao-photo-context";
import { singleKeyCrypto } from "./support/field-keys";

const NOW = new Date("2026-11-25T00:00:00Z");
describe("사진 주소의 수신 문맥과 별도 암호화 용도(TASK-065)", () => {
  it("가게와 수신 ID에 묶고 일반/콜백 상한256은 유지한다", async () => {
    const { fc } = singleKeyCrypto();
    const shopId = crypto.randomUUID(),
      recordId = crypto.randomUUID();
    const context = { purpose: KAKAO_PHOTO_PURPOSE, shopId, recordId } as const;
    const value = {
      kind: "reference",
      draftId: crypto.randomUUID(),
      urls: [`https://t1.daumcdn.net/${"a".repeat(1900)}`],
    } as const;
    const plain = encodeKakaoPhotoContext(value, NOW);
    expect(plain.length).toBeGreaterThan(MAX_FIELD_BYTES);
    const sealed = await fc.seal(plain, context);
    expect(sealed).not.toContain(value.urls[0]);
    expect(decodeKakaoPhotoContext(await fc.open(sealed, context), NOW)).toEqual(value);
    for (const other of [
      { ...context, recordId: crypto.randomUUID() },
      { ...context, shopId: crypto.randomUUID() },
      { purpose: "messages.kakao_callback", shopId } as const,
    ])
      await expect(fc.open(sealed, other)).rejects.toBeInstanceOf(FieldCryptoError);
    await expect(fc.seal("x".repeat(257), { purpose: "messages.kakao_callback", shopId })).rejects.toBeInstanceOf(
      FieldCryptoError,
    );
    await expect(fc.seal("x".repeat(MAX_KAKAO_PHOTO_CONTEXT_BYTES + 1), context)).rejects.toBeInstanceOf(
      FieldCryptoError,
    );
    await expect(fc.seal("value", { purpose: KAKAO_PHOTO_PURPOSE, shopId })).rejects.toBeInstanceOf(FieldCryptoError);
  });
  it.each(["https://example.test/photo.png", "http://t1.daumcdn.net/photo.png"])(
    "다른 주소는 저장 문맥에서도 거부한다(%s)",
    (url) => {
      expect(() =>
        encodeKakaoPhotoContext({ kind: "reference", draftId: crypto.randomUUID(), urls: [url] }, NOW),
      ).toThrow(FieldCryptoError);
    },
  );
  it.each([
    "not-json",
    '{"v":1,"kind":"reference","urls":[]}',
    '{"v":1,"kind":"review","urls":["https://t1.daumcdn.net/p"]}',
  ])("손상된 내부 문맥을 거부한다(%s)", (plain) => {
    expect(() => decodeKakaoPhotoContext(plain, NOW)).toThrow(FieldCryptoError);
  });
});
