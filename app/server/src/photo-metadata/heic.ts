import { fourCC, joinBytes, requirePhoto, viewOf } from "./bytes";

interface Box {
  readonly type: string;
  readonly start: number;
  readonly data: number;
  readonly end: number;
}

function readBoxes(bytes: Uint8Array, start: number, end: number): Box[] {
  const view = viewOf(bytes);
  const boxes: Box[] = [];
  for (let at = start; at < end; ) {
    requirePhoto(at + 8 <= end && boxes.length < 4096);
    const size32 = view.getUint32(at);
    const header = size32 === 1 ? 16 : 8;
    requirePhoto(at + header <= end);
    const size = size32 === 0 ? end - at : size32 === 1 ? Number(view.getBigUint64(at + 8)) : size32;
    requirePhoto(size >= header && size <= end - at);
    boxes.push({ type: fourCC(bytes, at + 4), start: at, data: at + header, end: at + size });
    at += size;
  }
  return boxes;
}

function one(boxes: readonly Box[], type: string): Box | undefined {
  const match = boxes.filter((box) => box.type === type);
  requirePhoto(match.length <= 1);
  return match[0];
}

function requiredBox(boxes: readonly Box[], type: string): Box {
  const box = one(boxes, type);
  requirePhoto(box);
  return box;
}

function boxHeader(type: string, size: number): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(8);
  viewOf(header).setUint32(0, size);
  header.set(
    Array.from(type, (character) => character.charCodeAt(0)),
    4,
  );
  return header;
}

function makeBox(type: string, ...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  return joinBytes([boxHeader(type, 8 + parts.reduce((total, part) => total + part.length, 0)), ...parts]);
}

class Reader {
  private readonly view: DataView;
  position: number;

  constructor(
    private readonly bytes: Uint8Array,
    start: number,
    private readonly end: number,
  ) {
    this.view = viewOf(bytes);
    this.position = start;
  }

  number(width: number): number {
    requirePhoto(this.position + width <= this.end);
    let result = 0;
    for (let i = 0; i < width; i += 1) result = result * 256 + this.view.getUint8(this.position++);
    requirePhoto(Number.isSafeInteger(result));
    return result;
  }

  finished(): void {
    requirePhoto(this.position === this.end);
  }

  segment(from: number): Uint8Array {
    return this.bytes.subarray(from, this.position);
  }
}

function numberBytes(n: number, width: 2 | 4): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(width);
  if (width === 2) viewOf(output).setUint16(0, n);
  else viewOf(output).setUint32(0, n);
  return output;
}

const STILL_ITEMS = new Set(["hvc1", "grid", "iden"]);

function imageItems(bytes: Uint8Array, box: Box): { kept: Set<number>; all: Set<number>; info: Uint8Array } {
  const reader = new Reader(bytes, box.data, box.end);
  const fullBox = reader.number(4);
  requirePhoto(fullBox === 0 || fullBox === 0x01000000);
  const countWidth = fullBox === 0 ? 2 : 4;
  const count = reader.number(countWidth);
  const entries = readBoxes(bytes, reader.position, box.end);
  requirePhoto(count === entries.length);
  const kept = new Set<number>();
  const all = new Set<number>();
  const cleaned: Uint8Array[] = [];
  for (const entry of entries) {
    const item = new Reader(bytes, entry.data, entry.end);
    const version = item.number(1);
    const flags = item.number(3);
    requirePhoto(entry.type === "infe" && (version === 2 || version === 3) && flags <= 1);
    const id = item.number(version === 2 ? 2 : 4);
    requirePhoto(id !== 0 && !all.has(id));
    all.add(id);
    const protection = item.number(2);
    item.number(4);
    const type = fourCC(bytes, item.position - 4);
    requirePhoto(bytes.subarray(item.position, entry.end).includes(0));
    if (!STILL_ITEMS.has(type)) continue;
    requirePhoto(protection === 0);
    kept.add(id);
    cleaned.push(makeBox("infe", item.segment(entry.data), Uint8Array.of(0)));
  }
  return { kept, all, info: makeBox("iinf", numberBytes(fullBox, 4), numberBytes(kept.size, countWidth), ...cleaned) };
}

interface Extent {
  readonly source: Box;
  readonly start: number;
  readonly end: number;
  readonly kept: boolean;
}

function imageLocations(
  bytes: Uint8Array,
  box: Box,
  media: readonly Box[],
  itemData: Box | undefined,
  items: ReturnType<typeof imageItems>,
): { locations: Uint8Array; extents: Extent[] } {
  const reader = new Reader(bytes, box.data, box.end);
  const version = reader.number(1);
  requirePhoto(version <= 2 && reader.number(3) === 0);
  const sizes = reader.number(2);
  const offsetWidth = sizes >>> 12;
  const lengthWidth = (sizes >>> 8) & 15;
  const baseWidth = (sizes >>> 4) & 15;
  const indexWidth = sizes & 15;
  requirePhoto(offsetWidth <= 8 && lengthWidth <= 8 && baseWidth <= 8 && indexWidth <= 8);
  requirePhoto(version !== 0 || indexWidth === 0);
  const idWidth = version === 2 ? 4 : 2;
  const count = reader.number(idWidth);
  requirePhoto(count <= items.all.size);
  const extents: Extent[] = [];
  const rows: Uint8Array[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    const at = reader.position;
    const id = reader.number(idWidth);
    requirePhoto(items.all.has(id) && !seen.has(id));
    seen.add(id);
    const kept = items.kept.has(id);
    const method = version === 0 ? 0 : reader.number(2);
    requirePhoto((method === 0 || method === 1) && reader.number(2) === 0);
    const base = reader.number(baseWidth);
    const parts = reader.number(2);
    requirePhoto(parts <= 4096 - extents.length && (!kept || parts > 0));
    for (let part = 0; part < parts; part += 1) {
      requirePhoto(reader.number(indexWidth) === 0);
      const offset = reader.number(offsetWidth);
      const length = reader.number(lengthWidth);
      const start = base + offset + (method === 1 ? (itemData?.data ?? -1) : 0);
      const end = start + length;
      requirePhoto(Number.isSafeInteger(end) && length > 0);
      const source =
        method === 1 ? itemData : media.find((candidate) => start >= candidate.data && end <= candidate.end);
      requirePhoto(source && start >= source.data && end <= source.end);
      extents.push({ source, start, end, kept });
    }
    if (kept) rows.push(reader.segment(at));
  }
  reader.finished();
  requirePhoto(rows.length === items.kept.size);
  // 원본 위치가 겹치면 제거할 항목의 바이트가 영상 복사 범위에 들어갈 수 있다.
  extents.sort((a, b) => a.start - b.start);
  let previousEnd = 0;
  for (const extent of extents) {
    requirePhoto(previousEnd <= extent.start);
    previousEnd = extent.end;
  }
  return {
    locations: makeBox(
      "iloc",
      numberBytes(version << 24, 4),
      numberBytes(sizes, 2),
      numberBytes(rows.length, idWidth),
      ...rows,
    ),
    extents: extents.filter((extent) => extent.kept),
  };
}

function cleanReferences(bytes: Uint8Array, box: Box, items: ReturnType<typeof imageItems>): Uint8Array | undefined {
  const view = viewOf(bytes);
  requirePhoto(box.end - box.data >= 4);
  const fullBox = view.getUint32(box.data);
  requirePhoto(fullBox === 0 || fullBox === 0x01000000);
  const width = fullBox === 0 ? 2 : 4;
  const kept: Uint8Array[] = [];
  for (const entry of readBoxes(bytes, box.data + 4, box.end)) {
    const reader = new Reader(bytes, entry.data, entry.end);
    const from = reader.number(width);
    requirePhoto(items.all.has(from));
    const count = reader.number(2);
    const to: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const id = reader.number(width);
      requirePhoto(items.all.has(id));
      to.push(id);
    }
    reader.finished();
    if (!items.kept.has(from) || entry.type === "cdsc") continue;
    requirePhoto(["dimg", "thmb", "auxl", "prem"].includes(entry.type) && to.every((id) => items.kept.has(id)));
    kept.push(makeBox(entry.type, reader.segment(entry.data)));
  }
  return kept.length ? makeBox("iref", numberBytes(fullBox, 4), ...kept) : undefined;
}

const IMAGE_PROPERTIES = new Set([
  "hvcC",
  "ispe",
  "pixi",
  "irot",
  "imir",
  "clap",
  "pasp",
  "rloc",
  "lsel",
  "a1lx",
  "a1op",
  "mdcv",
  "clli",
]);
const AUX_TYPES = new Set([
  "urn:mpeg:hevc:2015:auxid:1",
  "urn:mpeg:hevc:2015:auxid:2",
  "urn:mpeg:mpegB:cicp:systems:auxiliary:alpha",
]);

function keepProperty(bytes: Uint8Array, box: Box): boolean {
  const size = box.end - box.data;
  if (box.type === "colr") return size === 11 && fourCC(bytes, box.data) === "nclx";
  if (box.type === "auxC") {
    if (size < 5 || size > 128 || viewOf(bytes).getUint32(box.data) !== 0 || bytes[box.end - 1] !== 0) return false;
    return AUX_TYPES.has(new TextDecoder().decode(bytes.subarray(box.data + 4, box.end - 1)));
  }
  if (box.type === "irot" || box.type === "imir") {
    requirePhoto(size === 1 && viewOf(bytes).getUint8(box.data) <= (box.type === "irot" ? 3 : 1));
  }
  return IMAGE_PROPERTIES.has(box.type);
}

function cleanProperties(bytes: Uint8Array, box: Box, items: ReturnType<typeof imageItems>): Uint8Array {
  const children = readBoxes(bytes, box.data, box.end);
  const container = requiredBox(children, "ipco");
  const properties = readBoxes(bytes, container.data, container.end);
  const mapped = new Map<number, number>();
  const filtered: Uint8Array[] = [];
  for (const [i, property] of properties.entries()) {
    if (!keepProperty(bytes, property)) continue;
    mapped.set(i + 1, filtered.length + 1);
    filtered.push(bytes.subarray(property.start, property.end));
  }
  const associations: Uint8Array[] = [];
  const associated = new Set<number>();
  for (const entry of children.filter((child) => child.type === "ipma")) {
    const reader = new Reader(bytes, entry.data, entry.end);
    const version = reader.number(1);
    const flags = reader.number(3);
    requirePhoto(version <= 1 && flags <= 1);
    const idWidth = version === 0 ? 2 : 4;
    const associationWidth = flags === 0 ? 1 : 2;
    const essentialMask = flags === 0 ? 0x80 : 0x8000;
    const count = reader.number(4);
    requirePhoto(count <= items.all.size);
    const rows: Uint8Array[] = [];
    const groupItems = new Set<number>();
    for (let i = 0; i < count; i += 1) {
      const id = reader.number(idWidth);
      requirePhoto(items.all.has(id) && !groupItems.has(id));
      groupItems.add(id);
      const kept = items.kept.has(id);
      const size = reader.number(1);
      const values: number[] = [];
      for (let a = 0; a < size; a += 1) {
        const value = reader.number(associationWidth);
        const index = value & (essentialMask - 1);
        const essential = value & essentialMask;
        requirePhoto(index <= properties.length);
        if (!kept || index === 0) continue;
        const mappedIndex = mapped.get(index);
        if (mappedIndex === undefined) {
          // ICC는 지운다. 다른 필수 표시 속성을 해석할 수 없으면 파일을 받지 않는다.
          requirePhoto(!essential || properties[index - 1]?.type === "colr");
          continue;
        }
        associated.add(id);
        const newValue = mappedIndex | essential;
        if (associationWidth === 2) values.push(newValue >>> 8);
        values.push(newValue & 0xff);
      }
      if (kept)
        rows.push(joinBytes([numberBytes(id, idWidth), Uint8Array.of(values.length / associationWidth, ...values)]));
    }
    reader.finished();
    if (rows.length)
      associations.push(makeBox("ipma", numberBytes((version << 24) | flags, 4), numberBytes(rows.length, 4), ...rows));
  }
  requirePhoto(associated.size > 0);
  return makeBox("iprp", makeBox("ipco", ...filtered), ...associations);
}

function writeCleanMeta(bytes: Uint8Array, output: Uint8Array, meta: Box, media: readonly Box[]): void {
  const view = viewOf(bytes);
  requirePhoto(meta.data + 4 <= meta.end && view.getUint32(meta.data) === 0);
  const children = readBoxes(bytes, meta.data + 4, meta.end);
  const handler = requiredBox(children, "hdlr");
  const primary = requiredBox(children, "pitm");
  const location = requiredBox(children, "iloc");
  const info = requiredBox(children, "iinf");
  const properties = requiredBox(children, "iprp");
  const references = one(children, "iref");
  const itemData = one(children, "idat");
  requirePhoto(
    handler.end - handler.data >= 24 &&
      view.getUint32(handler.data) === 0 &&
      fourCC(bytes, handler.data + 8) === "pict",
  );
  const items = imageItems(bytes, info);
  requirePhoto(primary.end - primary.data >= 4);
  const primaryVersion = view.getUint32(primary.data);
  const width = primaryVersion === 0 ? 2 : 4;
  requirePhoto(primaryVersion === 0 || primaryVersion === 0x01000000);
  const primaryReader = new Reader(bytes, primary.data + 4, primary.end);
  requirePhoto(items.kept.has(primaryReader.number(width)));
  primaryReader.finished();
  const cleanLocation = imageLocations(bytes, location, media, itemData, items);
  const cleanRef = references && cleanReferences(bytes, references, items);
  const cleanProps = cleanProperties(bytes, properties, items);
  const parts = new Map<Box, Uint8Array>([
    [primary, makeBox("pitm", bytes.subarray(primary.data, primary.end))],
    [location, cleanLocation.locations],
    [info, items.info],
    [properties, cleanProps],
  ]);
  if (references && cleanRef) parts.set(references, cleanRef);
  // Opaque payload is not copied wholesale: bytes outside retained item extents stay zero.
  const itemDataSize = itemData ? 8 + itemData.end - itemData.data : 0;
  const handlerSize = 8 + handler.end - handler.data;
  const available = meta.end - meta.data - 4;
  const remaining =
    available - handlerSize - itemDataSize - [...parts.values()].reduce((n, part) => n + part.length, 0);
  requirePhoto(remaining >= 0);
  const padding = remaining < 8 ? remaining : 0;
  const handlerBody = new Uint8Array(handlerSize - 8 + padding);
  handlerBody.set([0x70, 0x69, 0x63, 0x74], 8);
  parts.set(handler, makeBox("hdlr", handlerBody));
  let at = meta.data + 4;
  let idatOut = 0;
  for (const child of children) {
    const part = parts.get(child);
    if (part) {
      output.set(part, at);
      at += part.length;
    } else if (child === itemData) {
      output.set(boxHeader("idat", itemDataSize), at);
      idatOut = at + 8;
      at += itemDataSize;
    }
  }
  if (remaining >= 8) output.set(boxHeader("free", remaining), at);
  for (const { source, start, end } of cleanLocation.extents) {
    output.set(bytes.subarray(start, end), source === itemData ? idatOut + start - source.data : start);
  }
}

/** Still HEIC의 영상 항목과 표시 속성만 남긴다. 파일 오프셋을 유지하고 나머지 미디어 바이트는 0으로 둔다. */
export function cleanHeic(bytes: Uint8Array): Uint8Array {
  const boxes = readBoxes(bytes, 0, bytes.length);
  const fileType = requiredBox(boxes, "ftyp");
  const meta = requiredBox(boxes, "meta");
  const media = boxes.filter((box) => box.type === "mdat");
  requirePhoto(fileType.start === 0 && fileType.data === 8 && fileType.end >= 16 && fileType.end % 4 === 0);
  // 동영상·사진 시퀀스의 트랙과 외부 참조는 항목 기반의 사진 처리 범위 밖이다.
  requirePhoto(!boxes.some((box) => box.type === "moov" || box.type === "moof"));
  const output = new Uint8Array(bytes.length);
  output.set(bytes.subarray(0, fileType.end));
  for (const box of boxes.slice(1)) {
    if (box.type === "mdat" || box === meta) {
      output.set(bytes.subarray(box.start, box.data), box.start);
    } else {
      output.set(boxHeader("free", box.end - box.start), box.start);
    }
  }
  writeCleanMeta(bytes, output, meta, media);
  return output;
}
