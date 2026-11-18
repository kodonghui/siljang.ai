import { InvalidPhoto } from "./bytes";
import { cleanHeic } from "./heic";
import { cleanJpeg } from "./jpeg";
import { cleanPng } from "./png";
import { cleanWebp } from "./webp";

/** 받는 사진 종류(06 Upload.contentType, 05 사진 테이블의 content_type). */
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/heic", "image/webp"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs"]);
const HEIF_GENERIC = new Set(["mif1", "msf1"]);

/** 내용의 시그니처로 본 사진 종류. 모르는 내용은 null. */
export function sniffImage(bytes: Uint8Array): ImageType | null {
  const ascii = (from: number, length: number) =>
    bytes.byteLength >= from + length ? String.fromCharCode(...bytes.subarray(from, from + length)) : "";
  if (JPEG.every((value, i) => bytes[i] === value)) return "image/jpeg";
  if (PNG.every((value, i) => bytes[i] === value)) return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  if (ascii(4, 4) === "ftyp") {
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    if (size < 16 || size > 4096) return null;
    const major = ascii(8, 4);
    if (HEIC_BRANDS.has(major)) return "image/heic";
    if (HEIF_GENERIC.has(major)) {
      const end = Math.min(size, bytes.byteLength);
      for (let i = 16; i + 4 <= end; i += 4) if (HEIC_BRANDS.has(ascii(i, 4))) return "image/heic";
    }
  }
  return null;
}

const CLEANERS = {
  "image/jpeg": cleanJpeg,
  "image/png": cleanPng,
  "image/heic": cleanHeic,
  "image/webp": cleanWebp,
};

/**
 * G10. 사진을 보관하기 전에 호출한다(API-007, 카카오 사진 수신).
 * 알려진 형식의 표시 데이터만 유지한다. 형식이 맞지 않거나 깨졌으면 null을 돌려준다.
 */
export function sanitizePhoto(bytes: Uint8Array): { contentType: ImageType; bytes: Uint8Array } | null {
  const contentType = sniffImage(bytes);
  if (contentType === null) return null;
  try {
    return { contentType, bytes: CLEANERS[contentType](bytes) };
  } catch (error) {
    if (error instanceof InvalidPhoto) return null;
    throw error;
  }
}
