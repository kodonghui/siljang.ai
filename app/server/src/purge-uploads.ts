import { isUuid } from "./shop-scope";
import { type ObjectStore, StorageUnavailableError } from "./storage";
import { parseUploadId, UPLOAD_TTL_MS } from "./uploads";

// 앱의 사진 경로 밖에 숫자·ID로 된 진행 위치만 둔다. 응답·로그에는 싣지 않는다.
const CURSOR = "maintenance/purge/tmp-cursor.json";

function bounded<T>(work: () => Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve().then(work),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new StorageUnavailableError("purge: timed out")), ms);
    }),
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

async function readCursor(store: ObjectStore, timeoutMs: number): Promise<string> {
  return bounded(async () => {
    const object = await store.get(CURSOR);
    if (object === null) return "";
    const reader = object.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 1024) return "";
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.byteLength;
      }
      try {
        const saved: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (
          typeof saved !== "object" ||
          saved === null ||
          !("version" in saved) ||
          saved.version !== 1 ||
          !("after" in saved)
        )
          return "";
        const after = saved.after;
        return typeof after === "string" && after.startsWith("tmp/") && after.length <= 512 ? after : "";
      } catch {
        return "";
      }
    } finally {
      void reader.cancel().catch(() => {});
    }
  }, timeoutMs);
}

export interface UploadPurgeSummary {
  readonly scanned: number;
  readonly deleted: number;
  readonly failed: number;
  readonly complete: boolean;
}

export interface UploadPurgeOptions {
  readonly batch?: number;
  readonly pages?: number;
  readonly timeoutMs?: number;
  readonly shouldStop?: () => boolean;
}

export async function purgeUnusedUploads(
  store: ObjectStore,
  now: Date,
  options: UploadPurgeOptions = {},
): Promise<UploadPurgeSummary> {
  const batch = options.batch ?? 100;
  const pages = options.pages ?? 20;
  const timeoutMs = options.timeoutMs ?? 4000;
  if (
    Number.isNaN(now.getTime()) ||
    !Number.isInteger(batch) ||
    batch < 1 ||
    batch > 1000 ||
    !Number.isInteger(pages) ||
    pages < 1 ||
    pages > 100 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 5000
  ) {
    throw new RangeError("invalid upload purge limits");
  }
  const shouldStop = options.shouldStop ?? (() => false);
  let after = await readCursor(store, timeoutMs);
  let scanned = 0;
  let deleted = 0;
  let failed = 0;
  let complete = false;
  scan: for (let page = 0; page < pages && !shouldStop(); page += 1) {
    const list = await bounded(() => store.list("tmp/", after, batch), timeoutMs);
    let previous = after;
    for (const key of list.keys) {
      if (!key.startsWith("tmp/") || key <= previous || key.length > 512)
        throw new StorageUnavailableError("purge: unexpected list");
      previous = key;
    }
    if (list.truncated && list.keys.length === 0) throw new StorageUnavailableError("purge: empty partial list");
    for (const key of list.keys) {
      if (shouldStop()) break scan;
      const parts = key.split("/");
      const upload = parts.length === 3 && isUuid(parts[1]) ? parseUploadId(parts[2]) : null;
      if (upload !== null && upload.createdAt <= now.getTime() - UPLOAD_TTL_MS) {
        try {
          await bounded(() => store.delete(key), timeoutMs);
          deleted += 1;
        } catch {
          failed += 1;
        }
      }
      scanned += 1;
      after = key;
    }
    if (!list.truncated) {
      complete = true;
      after = "";
      break;
    }
  }
  await bounded(
    () => store.put(CURSOR, new TextEncoder().encode(JSON.stringify({ version: 1, after })), "application/json"),
    timeoutMs,
  );
  return { scanned, deleted, failed, complete };
}
