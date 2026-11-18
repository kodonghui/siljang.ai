import { ExifOrientation, fourCC, joinBytes, requirePhoto, viewOf } from "./bytes";

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i += 1) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  return n;
});

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i += 1) crc = (CRC_TABLE[(crc ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 픽셀·색·투명도 및 APNG 표시를 위한 표준 청크. ICC와 임의 보조 청크는 남기지 않는다. */
const DISPLAY_CHUNKS = new Set([
  "PLTE",
  "tRNS",
  "cHRM",
  "gAMA",
  "sRGB",
  "sBIT",
  "cICP",
  "mDCV",
  "cLLI",
  "bKGD",
  "acTL",
  "fcTL",
  "fdAT",
]);

function exifChunk(tiff: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(tiff.length + 12);
  const view = viewOf(chunk);
  view.setUint32(0, tiff.length);
  chunk.set([0x65, 0x58, 0x49, 0x66], 4);
  chunk.set(tiff, 8);
  view.setUint32(tiff.length + 8, crc32(chunk, 4, tiff.length + 8));
  return chunk;
}

export function cleanPng(bytes: Uint8Array): Uint8Array {
  const view = viewOf(bytes);
  const orientation = new ExifOrientation();
  const signature = bytes.subarray(0, 8);
  const chunks: Uint8Array[] = [];
  let data = false;
  let chunkCount = 0;
  let pos = signature.length;
  while (pos < bytes.length) {
    requirePhoto(pos + 12 <= bytes.length && ++chunkCount <= 16384);
    const size = view.getUint32(pos);
    const kind = fourCC(bytes, pos + 4);
    const start = pos + 8;
    const end = start + size;
    requirePhoto(end + 4 <= bytes.length && crc32(bytes, pos + 4, end) === view.getUint32(end));
    const chunk = bytes.subarray(pos, end + 4);
    const first = pos === signature.length;
    pos = end + 4;
    if (first) {
      requirePhoto(kind === "IHDR" && size === 13 && view.getUint32(start) > 0 && view.getUint32(start + 4) > 0);
      chunks.push(chunk);
      continue;
    }
    if (kind === "IEND") {
      requirePhoto(size === 0 && data && pos === bytes.length);
      const tiff = orientation.write();
      const header = chunks[0];
      requirePhoto(header);
      return joinBytes([signature, header, ...(tiff ? [exifChunk(tiff)] : []), ...chunks.slice(1), chunk]);
    }
    if (kind === "IDAT") {
      data ||= size > 0;
      chunks.push(chunk);
    } else if (kind === "eXIf") {
      orientation.read(bytes.subarray(start, end));
    } else if (DISPLAY_CHUNKS.has(kind)) {
      chunks.push(chunk);
    } else {
      // 알 수 없는 필수 청크는 해석하지 못하므로 파일을 거절한다.
      requirePhoto((kind.charCodeAt(0) & 0x20) !== 0);
    }
  }
  requirePhoto(false);
}
