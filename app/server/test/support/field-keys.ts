import { toBase64Url } from "../../src/encoding";
import { type FieldCrypto, fieldCrypto } from "../../src/field-crypto";
import { type FieldKeySettings, Secret } from "../../src/settings";

/**
 * 계좌번호·원래 값 암호화의 시험용 키(TASK-025). 실행 중에 무작위로 만들어 저장소 글에 키가 남지 않게 한다
 * (tools/check-no-keys.mjs, 11단계 계약: 시험은 키 없이 지나야 함).
 */
export function newFieldKey(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** 버전 → 키 글(base64url 43자). */
export type FieldKeyTexts = ReadonlyMap<number, string>;

export function fieldKeySettings(keys: FieldKeyTexts, current: number): FieldKeySettings {
  return { current, keys: new Map([...keys].map(([version, text]) => [version, new Secret(text)])) };
}

export function testFieldCrypto(keys: FieldKeyTexts, current: number): FieldCrypto {
  return fieldCrypto(fieldKeySettings(keys, current));
}

/** 키 버전 하나(v1)만 가진 도구와 그 키 글. */
export function singleKeyCrypto(): { readonly keys: FieldKeyTexts; readonly fc: FieldCrypto } {
  const keys = new Map([[1, newFieldKey()]]);
  return { keys, fc: testFieldCrypto(keys, 1) };
}

/** 시험마다 다른 숫자 n자리(앞자리 0 포함). 다른 시험·준비 자료의 번호와 겹치지 않게. */
export function randomDigits(n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => String(b % 10)).join("");
}
