/**
 * 시험용 사진 바이트(TASK-022). 앞부분 시그니처만 진짜 꼴이고 나머지는 채운 값이다(서버는 시그니처로만 종류를 봄).
 * size는 전체 바이트 수.
 */
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

export const jpeg = (size = 2048) => filled([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...ascii("JFIF")], size);
export const png = (size = 2048) => filled([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], size);
export const webp = (size = 2048) => filled([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBPVP8 ")], size);
export const heic = (size = 2048) => filled(ftyp("heic", ["mif1", "heic"]), size);
/** 주 브랜드가 mif1이고 호환 브랜드에 heic가 있는 HEIC(아이폰이 쓰는 꼴 가운데 하나). */
export const heifWithHeic = (size = 2048) => filled(ftyp("mif1", ["mif1", "heic"]), size);
/** 받지 않는 것: AVIF(같은 HEIF 상자 꼴), 담은 것을 말하지 않는 HEIF, GIF, 글. */
export const avif = (size = 2048) => filled(ftyp("avif", ["mif1", "avif"]), size);
export const heifOnly = (size = 2048) => filled(ftyp("mif1", ["mif1", "miaf"]), size);
export const gif = (size = 2048) => filled(ascii("GIF89a"), size);
export const text = (size = 2048) => filled(ascii("just some text, not a photo"), size);
