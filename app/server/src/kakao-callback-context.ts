/** 콜백 주소와 수신에서 확인한 주문번호의 내부 저장 형식. 전체를 기존 AES 봉투로 감쌉니다. */
import { fromBase64Url, toBase64Url, toHex } from "./encoding";
import { FieldCryptoError } from "./field-crypto";
import { type KakaoCallback, kakaoCallback } from "./kakao-callback";
import type { KakaoOrderReference } from "./kakao-order-reference";
import { isUuid } from "./shop-scope";

const PREFIX = "https://bot-api.kakao.com/v1/callback/";
// 2: + 수신 UUID의 base64url 22자 + 번호 길이/상태 1자 + 번호 최대12자 + 고정 접두사를 뺀 주소.
// 원래 주소 최대256자에서 38자를 빼므로 가장 긴 평문도255바이트. 일반 필드 암호화 상한256을 유지합니다.
export function encodeKakaoCallbackContext(
  callback: KakaoCallback,
  messageId: string,
  reference: KakaoOrderReference,
): string {
  if (!isUuid(messageId) || !callback.url.toString().startsWith(PREFIX))
    throw new FieldCryptoError("invalid callback context");
  const hex = messageId.replaceAll("-", "");
  const bytes = new Uint8Array(Array.from({ length: 16 }, (_, i) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)));
  const value = reference.kind === "explicit" ? reference.orderNo : "";
  const marker = reference.kind === "none" ? "n" : reference.kind === "ambiguous" ? "x" : value.length.toString(16);
  if (reference.kind === "explicit" && !/^[0-9A-Z]{6,12}$/.test(value))
    throw new FieldCryptoError("invalid callback context");
  return `2:${toBase64Url(bytes)}${marker}${value}${callback.url.toString().slice(PREFIX.length)}`;
}

export interface StoredKakaoCallbackContext {
  readonly url: string;
  /** 옛 URL 전용 봉투는 수신 번호를 확인할 수 없으므로 undefined입니다. */
  readonly reference?: KakaoOrderReference;
}
export function decodeKakaoCallbackContext(
  plain: string,
  receivedAt: Date,
  expectedMessageId?: string,
): StoredKakaoCallbackContext {
  if (plain.startsWith("https://")) return { url: plain };
  if (!plain.startsWith("2:")) throw new FieldCryptoError("invalid callback context");
  const bytes = fromBase64Url(plain.slice(2, 24));
  if (bytes === null || bytes.length !== 16) throw new FieldCryptoError("invalid callback context");
  const hex = toHex(bytes);
  const messageId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  if (!isUuid(messageId) || (expectedMessageId !== undefined && messageId !== expectedMessageId.toLowerCase()))
    throw new FieldCryptoError("invalid callback context");
  const marker = plain[24];
  let reference: KakaoOrderReference,
    offset = 25;
  if (marker === "n") reference = { kind: "none" };
  else if (marker === "x") reference = { kind: "ambiguous" };
  else {
    if (marker === undefined || !/^[6-9a-c]$/.test(marker)) throw new FieldCryptoError("invalid callback context");
    const length = Number.parseInt(marker, 16),
      orderNo = plain.slice(offset, offset + length);
    if (!/^[0-9A-Z]{6,12}$/.test(orderNo) || orderNo.length !== length)
      throw new FieldCryptoError("invalid callback context");
    reference = { kind: "explicit", orderNo };
    offset += length;
  }
  const url = PREFIX + plain.slice(offset);
  if (kakaoCallback(url, receivedAt) === null) throw new FieldCryptoError("invalid callback context");
  return { url, reference };
}
