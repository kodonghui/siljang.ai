import {
  assertStorageKey,
  type ObjectList,
  type ObjectStore,
  StorageUnavailableError,
  type StoredObject,
  type StoredObjectInfo,
} from "../../src/storage";

type Op = "put" | "head" | "get" | "copy" | "delete" | "list";

/**
 * 시험용 메모리 저장소(TASK-022). 진짜 저장소(S3Store)와 같은 약속을 지킨다: 키 꼴 검사, 없는 객체는 null·false,
 * 목록은 키 순서(바이트 순)와 startAfter·max. failOn에 넣은 동작은 StorageUnavailableError를 던진다(503 시험).
 */
export class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, { readonly body: Uint8Array; readonly contentType: string }>();
  readonly failOn = new Set<Op>();
  readonly calls: Op[] = [];

  #touch(op: Op): void {
    this.calls.push(op);
    if (this.failOn.has(op)) throw new StorageUnavailableError(`${op}: no response`);
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    this.#touch("put");
    this.objects.set(assertStorageKey(key), { body: body.slice(), contentType });
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    this.#touch("head");
    const o = this.objects.get(assertStorageKey(key));
    return o === undefined ? null : { key, size: o.body.byteLength, contentType: o.contentType };
  }

  async get(key: string): Promise<StoredObject | null> {
    this.#touch("get");
    const o = this.objects.get(assertStorageKey(key));
    if (o === undefined) return null;
    const bytes = o.body.slice();
    return {
      key,
      size: bytes.byteLength,
      contentType: o.contentType,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    };
  }

  async copy(from: string, to: string): Promise<boolean> {
    this.#touch("copy");
    const o = this.objects.get(assertStorageKey(from));
    if (o === undefined) return false;
    this.objects.set(assertStorageKey(to), o);
    return true;
  }

  async delete(key: string): Promise<void> {
    this.#touch("delete");
    this.objects.delete(assertStorageKey(key));
  }

  async list(prefix: string, startAfter: string, max: number): Promise<ObjectList> {
    this.#touch("list");
    const keys = [...this.objects.keys()]
      .filter((k) => k.startsWith(prefix) && k > startAfter)
      .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    return { keys: keys.slice(0, max), truncated: keys.length > max };
  }

  /** prefix로 시작하는 키(시험이 남은 파일을 셈). */
  keys(prefix = ""): string[] {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
}
