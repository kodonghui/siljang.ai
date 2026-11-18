import { ExifOrientation, fourCC, hasExifHeader, joinBytes, requirePhoto, viewOf } from "./bytes";

const EXIF_HEADER = Uint8Array.of(0x45, 0x78, 0x69, 0x66, 0, 0);
/** 기본 JFIF 헤더. 화소 비율 1:1이며 썸네일을 포함하지 않는다. */
const JFIF = Uint8Array.of(0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0);

function scanEnd(bytes: Uint8Array, start: number): number {
  let pos = bytes.indexOf(0xff, start);
  while (pos !== -1) {
    let next = pos + 1;
    while (bytes[next] === 0xff) next += 1;
    // 엔트로피 코드의 FF 00, 또는 재시작 마커만 스캔 내부에 있다.
    const marker = bytes[next] ?? -1;
    if (marker !== 0 && !(marker >= 0xd0 && marker <= 0xd7)) return pos;
    pos = bytes.indexOf(0xff, next + 1);
  }
  return bytes.length;
}

function orientationSegment(tiff: Uint8Array): Uint8Array {
  return joinBytes([Uint8Array.of(0xff, 0xe1, 0, 2 + EXIF_HEADER.length + tiff.length), EXIF_HEADER, tiff]);
}

// 카메라와 브라우저에서 쓰는 순차·프로그레시브 JPEG의 영상 마커. APPn·COM에는 임의 데이터가 올 수 있다.
const FRAMES = new Set([0xc0, 0xc1, 0xc2]);
const TABLES = new Set([0xc4, 0xdb, 0xdd]);

export function cleanJpeg(bytes: Uint8Array): Uint8Array {
  const view = viewOf(bytes);
  const orientation = new ExifOrientation();
  const segments: Uint8Array[] = [];
  let jfif = false;
  let adobe: Uint8Array | undefined;
  let frame = false;
  let scan = false;
  let markerCount = 0;
  let pos = 2;
  while (pos < bytes.length) {
    requirePhoto(bytes[pos] === 0xff && ++markerCount <= 16384);
    while (bytes[pos] === 0xff) pos += 1;
    const marker = bytes[pos++] ?? -1;
    if (marker === 0xd9) {
      requirePhoto(frame && scan && pos === bytes.length);
      const tiff = orientation.write();
      return joinBytes([
        bytes.subarray(0, 2),
        ...(jfif ? [JFIF] : []),
        ...(adobe ? [adobe] : []),
        ...(tiff ? [orientationSegment(tiff)] : []),
        ...segments,
        bytes.subarray(pos - 2),
      ]);
    }
    requirePhoto(pos + 2 <= bytes.length);
    const size = view.getUint16(pos);
    const end = pos + size;
    requirePhoto(size >= 2 && end <= bytes.length);
    const data = bytes.subarray(pos + 2, end);
    const start = pos - 2;
    pos = end;
    if (marker >= 0xe0 && marker <= 0xef) {
      if (marker === 0xe0 && fourCC(data, 0) === "JFIF" && data[4] === 0) {
        requirePhoto(data.length >= 14 && data.length === 14 + 3 * (data[12] ?? 0) * (data[13] ?? 0));
        jfif = true;
      }
      if (marker === 0xee && fourCC(data, 0) === "Adob" && data[4] === 0x65) {
        const transform = data[11];
        requirePhoto(data.length === 12 && transform !== undefined && transform <= 2 && adobe === undefined);
        // Adobe APP14의 색 변환 번호만 반영한다.
        adobe = Uint8Array.of(0xff, 0xee, 0, 14, 0x41, 0x64, 0x6f, 0x62, 0x65, 0, 100, 0, 0, 0, 0, transform);
      }
      if (marker === 0xe1 && hasExifHeader(data)) orientation.read(data.subarray(EXIF_HEADER.length));
      continue;
    }
    if (marker === 0xfe) continue;
    if (FRAMES.has(marker)) {
      requirePhoto(!frame && data.length >= 9 && data.length === 6 + 3 * (data[5] ?? 0));
      frame = true;
    } else if (marker === 0xda) {
      requirePhoto(frame && data.length >= 6 && data.length === 4 + 2 * (data[0] ?? 0));
      pos = scanEnd(bytes, end);
      requirePhoto(pos > end);
      scan = true;
    } else {
      requirePhoto(TABLES.has(marker) && (marker !== 0xdd || data.length === 2));
    }
    segments.push(bytes.subarray(start, pos));
  }
  requirePhoto(false);
}
