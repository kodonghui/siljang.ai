import { ExifOrientation, fourCC, hasExifHeader, joinBytes, requirePhoto, viewOf } from "./bytes";

function chunkBytes(kind: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(8 + data.length + (data.length % 2));
  output.set(Array.from(kind, (character) => character.charCodeAt(0)));
  viewOf(output).setUint32(4, data.length, true);
  output.set(data, 8);
  return output;
}

function* chunksOf(bytes: Uint8Array, start: number): Generator<{ kind: string; data: Uint8Array; whole: Uint8Array }> {
  const view = viewOf(bytes);
  let count = 0;
  for (let pos = start; pos < bytes.length; ) {
    requirePhoto(pos + 8 <= bytes.length && ++count <= 16384);
    const kind = fourCC(bytes, pos);
    const size = view.getUint32(pos + 4, true);
    const end = pos + 8 + size;
    const next = end + (size % 2);
    requirePhoto(next <= bytes.length && (end === next || bytes[end] === 0));
    yield { kind, data: bytes.subarray(pos + 8, end), whole: bytes.subarray(pos, next) };
    pos = next;
  }
}

function isBitstream(kind: string, data: Uint8Array): boolean {
  if (kind === "VP8 ") {
    requirePhoto(
      data.length >= 10 && ((data[0] ?? 0) & 1) === 0 && data[3] === 0x9d && data[4] === 1 && data[5] === 0x2a,
    );
    return true;
  }
  if (kind === "VP8L") {
    requirePhoto(data.length >= 5 && data[0] === 0x2f);
    return true;
  }
  return false;
}

function cleanFrame(data: Uint8Array): Uint8Array {
  requirePhoto(data.length >= 16 && ((data[15] ?? 0) & 0xfc) === 0);
  const parts = [data.subarray(0, 16)];
  let image = false;
  let alpha = false;
  for (const chunk of chunksOf(data, 16)) {
    if (isBitstream(chunk.kind, chunk.data)) {
      requirePhoto(!image && (!alpha || chunk.kind === "VP8 "));
      image = true;
    } else if (chunk.kind === "ALPH") {
      requirePhoto(!alpha && !image && chunk.data.length > 0);
      alpha = true;
    } else {
      continue;
    }
    parts.push(chunk.whole);
  }
  requirePhoto(image);
  return chunkBytes("ANMF", joinBytes(parts));
}

export function cleanWebp(bytes: Uint8Array): Uint8Array {
  requirePhoto(bytes.length >= 12 && viewOf(bytes).getUint32(4, true) === bytes.length - 8);
  const orientation = new ExifOrientation();
  const parts: Uint8Array[] = [];
  let extended: Uint8Array<ArrayBuffer> | undefined;
  let still = false;
  let animation = false;
  let frame = false;
  let alpha = false;
  for (const { kind, data, whole } of chunksOf(bytes, 12)) {
    if (kind === "VP8X") {
      requirePhoto(whole.byteOffset === bytes.byteOffset + 12 && data.length === 10);
      requirePhoto(((data[0] ?? 0) & 0xc1) === 0 && data[1] === 0 && data[2] === 0 && data[3] === 0);
      extended = data.slice();
      continue;
    }
    if (kind === "EXIF") {
      requirePhoto(extended);
      orientation.read(hasExifHeader(data) ? data.subarray(6) : data);
      continue;
    }
    if (isBitstream(kind, data)) {
      requirePhoto(!still && !animation && (!alpha || kind === "VP8 "));
      still = true;
    } else if (kind === "ALPH") {
      requirePhoto(extended && !alpha && !still && !animation && data.length > 0);
      alpha = true;
    } else if (kind === "ANIM") {
      requirePhoto(extended && !animation && !still && !alpha && data.length === 6);
      animation = true;
    } else if (kind === "ANMF") {
      requirePhoto(animation);
      parts.push(cleanFrame(data));
      frame = true;
      continue;
    } else {
      continue;
    }
    parts.push(whole);
  }
  requirePhoto(still || frame);
  const tiff = orientation.write();
  if (extended) {
    requirePhoto(Boolean((extended[0] ?? 0) & 0x02) === animation);
    // EXIF, XMP, ICC 플래그를 지우고 새 방향 청크가 있을 때만 EXIF 플래그를 켠다.
    extended[0] = ((extended[0] ?? 0) & 0x12) | (tiff ? 0x08 : 0);
    parts.unshift(chunkBytes("VP8X", extended));
  }
  if (tiff) parts.push(chunkBytes("EXIF", tiff));
  const output = joinBytes([bytes.subarray(0, 12), ...parts]);
  viewOf(output).setUint32(4, output.length - 8, true);
  return output;
}
