import { readFileSync } from "node:fs";

function filled(head: readonly number[], size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(Math.max(size, head.length));
  bytes.set(head, 0);
  for (let i = head.length; i < bytes.length; i += 1) bytes[i] = (i * 31) & 0xff;
  return bytes;
}

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/** ftyp 상자(크기·'ftyp'·주 브랜드·작은 버전·호환 브랜드들). */
function ftyp(major: string, compatible: readonly string[]): number[] {
  const size = 16 + compatible.length * 4;
  return [0, 0, 0, size, ...ascii("ftyp"), ...ascii(major), 0, 0, 0, 0, ...compatible.flatMap(ascii)];
}

type Format = "jpg" | "png" | "heic" | "webp";

export function photoFixture(
  format: Format,
  variant: "clean" | "metadata" | "rotated" = "clean",
): Uint8Array<ArrayBuffer> {
  return new Uint8Array(readFileSync(new URL(`../fixtures/photos/${variant}.${format}`, import.meta.url)));
}

/** 지정 크기까지 내용이 없는 JPEG COM 세그먼트를 더한다. */
export function jpeg(size = 0): Uint8Array<ArrayBuffer> {
  const clean = photoFixture("jpg");
  if (size <= clean.length) return clean;
  const result = new Uint8Array(size);
  const view = new DataView(result.buffer);
  result.set(clean.subarray(0, 2));
  for (let at = 2; at < size - clean.length + 2; ) {
    const remaining = size - clean.length + 2 - at;
    if (remaining < 4) throw new Error("JPEG COM segment needs four bytes");
    let length = Math.min(remaining, 65537);
    if (remaining > length && remaining - length < 4) length -= 4;
    result.set([0xff, 0xfe], at);
    view.setUint16(at + 2, length - 2);
    at += length;
  }
  result.set(clean.subarray(2), size - clean.length + 2);
  return result;
}

export const png = () => photoFixture("png");
export const webp = () => photoFixture("webp");
export const heic = () => photoFixture("heic");
/** 주 브랜드가 mif1이고 호환 브랜드에 heic가 있는 HEIC. */
export function heifWithHeic(): Uint8Array<ArrayBuffer> {
  const bytes = heic();
  bytes.set(ascii("mif1"), 8);
  return bytes;
}
/** 받지 않는 것: AVIF(같은 HEIF 상자 꼴), 담은 것을 말하지 않는 HEIF, GIF, 글. */
export const avif = (size = 2048) => filled(ftyp("avif", ["mif1", "avif"]), size);
export const heifOnly = (size = 2048) => filled(ftyp("mif1", ["mif1", "miaf"]), size);
export const gif = (size = 2048) => filled(ascii("GIF89a"), size);
export const text = (size = 2048) => filled(ascii("just some text, not a photo"), size);
