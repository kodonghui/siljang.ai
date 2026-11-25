import { fromBase64Url, toBase64Url } from "./encoding";
import type { FieldCrypto } from "./field-crypto";

export interface ConsultationSnapshot {
  transaction: string;
  ceiling: string;
}
export interface ConsultationPosition {
  at: string;
  sequence: string;
}
export interface ConsultationCursor extends ConsultationPosition {
  snapshot: ConsultationSnapshot;
}
export type ConsultationReadDirection = "forward" | "backward";
const MAX_I64 = 9223372036854775807n,
  MAX_U64 = 18446744073709551615n,
  PAYLOAD_BYTES = 120;
export class ConsultationCursorError extends Error {
  override readonly name = "ConsultationCursorError";
}
function invalid(): never {
  throw new ConsultationCursorError("invalid consultation cursor");
}
function unsigned(text: string): bigint {
  if (!/^(0|[1-9][0-9]{0,18})$/.test(text)) invalid();
  const value = BigInt(text);
  if (value > MAX_I64) invalid();
  return value;
}
function snapshotParts(text: string) {
  const parts = text.split(":");
  if (parts.length !== 3) invalid();
  const xmin = unsigned(parts[0] ?? ""),
    xmax = unsigned(parts[1] ?? "");
  if (xmin < 1n || xmax < xmin) invalid();
  const active = parts[2] === "" ? [] : (parts[2] ?? "").split(",").map(unsigned);
  let previous = xmin - 1n;
  for (const id of active) {
    if (id < xmin || id >= xmax || id <= previous) invalid();
    previous = id;
  }
  return { xmin, xmax, active };
}
function put(bytes: number[], value: bigint) {
  if (value < 0n || value > MAX_U64) invalid();
  do {
    const part = Number(value & 127n);
    value >>= 7n;
    bytes.push(part | (value > 0n ? 128 : 0));
  } while (value > 0n);
}
class Reader {
  at = 0;
  constructor(readonly bytes: Uint8Array) {}
  integer(): bigint {
    let result = 0n;
    for (let n = 0; n < 10; n++) {
      const byte = this.bytes[this.at++];
      if (byte === undefined) invalid();
      result |= BigInt(byte & 127) << BigInt(7 * n);
      if ((byte & 128) === 0) {
        if (result > MAX_U64 || (n > 0 && byte === 0)) invalid();
        return result;
      }
    }
    return invalid();
  }
}

/** 고정200자 AES-GCM 봉투. 전역 순번·진행 중 트랜잭션 수는 길이로도 드러내지 않는다. */
export async function sealConsultationCursor(
  fc: FieldCrypto,
  shopId: string,
  consultationId: string,
  position: ConsultationPosition,
  snapshot: ConsultationSnapshot,
  direction: ConsultationReadDirection = "forward",
): Promise<string> {
  if (direction !== "forward" && direction !== "backward") invalid();
  const clock = snapshotParts(snapshot.transaction),
    at = BigInt(position.at),
    sequence = unsigned(position.sequence),
    ceiling = unsigned(snapshot.ceiling);
  if (at < -MAX_I64 - 1n || at > MAX_I64 || sequence < 1n || sequence > ceiling) invalid();
  const bytes = [direction === "forward" ? 3 : 4];
  put(bytes, at >= 0n ? at * 2n : -at * 2n - 1n);
  put(bytes, sequence);
  put(bytes, ceiling);
  put(bytes, clock.xmin);
  put(bytes, clock.xmax - clock.xmin);
  put(bytes, BigInt(clock.active.length));
  let previous = clock.xmin;
  for (const id of clock.active) {
    put(bytes, id - previous);
    previous = id;
  }
  const raw = String.fromCharCode(...bytes),
    size = new TextEncoder().encode(raw).length;
  if (size > PAYLOAD_BYTES) throw new RangeError("consultation cursor capacity exceeded");
  const envelope = await fc.seal(raw + "\0".repeat(PAYLOAD_BYTES - size), {
    purpose: "consultations.message_cursor",
    shopId,
    recordId: consultationId,
  });
  const match = /^v([1-9][0-9]{0,2}):([A-Za-z0-9_-]+)$/.exec(envelope);
  if (!match) invalid();
  const sealed = fromBase64Url(match[2] ?? "");
  if (sealed === null || sealed.length !== 148) invalid();
  const packed = new Uint8Array(150);
  new DataView(packed.buffer).setUint16(0, Number(match[1]));
  packed.set(sealed, 2);
  return toBase64Url(packed);
}

export async function openConsultationCursor(
  fc: FieldCrypto,
  shopId: string,
  consultationId: string,
  token: string,
  direction: ConsultationReadDirection = "forward",
): Promise<ConsultationCursor> {
  if (direction !== "forward" && direction !== "backward") invalid();
  const bytes = fromBase64Url(token);
  if (token.length !== 200 || bytes === null || bytes.length !== 150 || toBase64Url(bytes) !== token) invalid();
  const version = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(0);
  if (version < 1 || version > 999) invalid();
  const value = await fc.open(`v${version}:${toBase64Url(bytes.subarray(2))}`, {
    purpose: "consultations.message_cursor",
    shopId,
    recordId: consultationId,
  });
  if (new TextEncoder().encode(value).length !== PAYLOAD_BYTES || [...value].some((ch) => ch.charCodeAt(0) > 255))
    invalid();
  const payload = Uint8Array.from(value, (ch) => ch.charCodeAt(0));
  if (payload[0] !== (direction === "forward" ? 3 : 4)) invalid();
  const reader = new Reader(payload);
  reader.at = 1;
  const signed = reader.integer(),
    at = (signed & 1n) === 0n ? signed / 2n : -(signed + 1n) / 2n;
  const sequence = reader.integer(),
    ceiling = reader.integer(),
    xmin = reader.integer(),
    xmax = xmin + reader.integer(),
    count = reader.integer();
  if (
    at < -MAX_I64 - 1n ||
    at > MAX_I64 ||
    sequence < 1n ||
    sequence > ceiling ||
    ceiling > MAX_I64 ||
    xmin < 1n ||
    xmax > MAX_I64 ||
    count > BigInt(payload.length - reader.at)
  )
    invalid();
  const active: bigint[] = [];
  let previous = xmin;
  for (let n = 0; n < Number(count); n++) {
    const id = previous + reader.integer();
    if (id < xmin || id >= xmax || (n > 0 && id <= previous)) invalid();
    active.push(id);
    previous = id;
  }
  if (payload.subarray(reader.at).some((byte) => byte !== 0)) invalid();
  return {
    at: at.toString(),
    sequence: sequence.toString(),
    snapshot: { transaction: `${xmin}:${xmax}:${active.join(",")}`, ceiling: ceiling.toString() },
  };
}
