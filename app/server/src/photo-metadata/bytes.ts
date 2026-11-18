/** 사진 컨테이너 구조가 깨졌거나 이 모듈이 처리하지 못하는 형식. */
export class InvalidPhoto extends Error {}

export function requirePhoto(condition: unknown): asserts condition {
  if (!condition) throw new InvalidPhoto();
}

export function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function fourCC(bytes: Uint8Array, at: number): string {
  const data = bytes.subarray(at, at + 4);
  return String.fromCharCode(...data);
}

export function joinBytes(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let at = 0;
  for (const part of parts) {
    output.set(part, at);
    at += part.length;
  }
  return output;
}

export function hasExifHeader(bytes: Uint8Array): boolean {
  return fourCC(bytes, 0) === "Exif" && bytes[4] === 0 && bytes[5] === 0;
}

/** 원본 EXIF에서 0번 IFD의 Orientation(0x0112) 하나만 읽는다. 다른 IFD와 값은 읽지 않는다. */
export class ExifOrientation {
  private value: number | undefined;

  read(tiff: Uint8Array): void {
    requirePhoto(tiff.length >= 8);
    const littleEndian = tiff[0] === 0x49 && tiff[1] === 0x49;
    requirePhoto(littleEndian || (tiff[0] === 0x4d && tiff[1] === 0x4d));
    const view = viewOf(tiff);
    requirePhoto(view.getUint16(2, littleEndian) === 42);
    const start = view.getUint32(4, littleEndian);
    requirePhoto(start >= 8 && start + 2 <= tiff.length);
    const count = view.getUint16(start, littleEndian);
    requirePhoto(start + 2 + count * 12 + 4 <= tiff.length);
    for (let i = 0; i < count; i += 1) {
      const at = start + 2 + i * 12;
      if (view.getUint16(at, littleEndian) !== 0x0112) continue;
      requirePhoto(view.getUint16(at + 2, littleEndian) === 3 && view.getUint32(at + 4, littleEndian) === 1);
      const value = view.getUint16(at + 8, littleEndian);
      requirePhoto(value >= 1 && value <= 8 && (this.value === undefined || this.value === value));
      this.value = value;
    }
  }

  /** 방향 적용이 필요한 경우에만 Orientation과 빈 다음 IFD 포인터를 가진 새 TIFF를 쓴다. */
  write(): Uint8Array<ArrayBuffer> | undefined {
    if (this.value === undefined || this.value === 1) return undefined;
    return Uint8Array.of(
      0x4d,
      0x4d,
      0,
      42,
      0,
      0,
      0,
      8,
      0,
      1,
      1,
      0x12,
      0,
      3,
      0,
      0,
      0,
      1,
      0,
      this.value,
      0,
      0,
      0,
      0,
      0,
      0,
    );
  }
}
