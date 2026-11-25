/**
 * 사진 저장소 모듈(TASK-022; tech-stack.md 4-3의 3 '사진은 저장소 모듈 하나(올리기·읽기·지우기)를 거침').
 * - 업무 코드는 ObjectStore만 쓴다. 진짜 구현은 S3 프로토콜의 S3Store(Supabase Storage의 S3 호환 주소, 서울 리전)이고,
 *   시험은 test/support/storage.ts의 메모리 저장소를 쓴다.
 * - S3를 고른 까닭: Supabase의 publishable·secret 키는 서버·웹 어디에도 쓰지 않으므로(TASK-174) 그 키가 필요한 Storage
 *   REST API 대신 저장소만 다루는 S3 접근 키를 쓴다. 같은 모듈이 S3·R2 같은 다른 저장소에도 맞는다(tech-stack.md 4-2).
 * - 저장소가 답하지 않거나 오류면 StorageUnavailableError(응답은 503 storage_unavailable). 응답 머리 뒤에 몸체를 읽다
 *   끊겨도(목록·복사처럼 몸체를 읽어야 결과를 아는 동작) 같다. 상태 코드로 끝난 동작(넣기·지우기, 없는 객체)은 버리는 몸체의
 *   오류를 무시한다. 없는 객체는 null이나 false(오류 아님).
 * - 키는 우리 코드가 만든 것만 받는다(STORAGE_KEY). 저장 위치는 응답·로그에 싣지 않는다(06 DEC-09, 04 G6).
 */
import { AwsClient } from "aws4fetch";

export interface StoredObjectInfo {
  readonly key: string;
  readonly size: number;
  readonly contentType: string;
}

export interface StoredObject extends StoredObjectInfo {
  readonly body: ReadableStream<Uint8Array>;
}

export interface ObjectList {
  /** 키 순서(UTF-8 바이트 순). */
  readonly keys: readonly string[];
  /** max보다 많아 잘림. */
  readonly truncated: boolean;
}

export type StorageCopyResult = { readonly ok: true; readonly value: boolean } | { readonly ok: false };

/** 여러 사진의 메타데이터·복사·정리를 비공개 서비스 호출로 나눈다. 읽기/업로드 본문은 받지 않는다. */
export interface ObjectBatch {
  head(keys: readonly string[]): Promise<readonly (StoredObjectInfo | null)[]>;
  copy(pairs: readonly { readonly from: string; readonly to: string }[]): Promise<readonly StorageCopyResult[]>;
  delete(keys: readonly string[]): Promise<void>;
}

export const STORAGE_BATCH_OBJECT_LIMIT = 50;

export interface ObjectStore {
  /** 배포 환경의 무료 호출 한도 분리. 개발/메모리 구현은 단일 동작으로 대체할 수 있다. */
  readonly batch?: ObjectBatch;
  /** 객체 하나를 넣는다(같은 키면 바꿈). */
  put(key: string, body: Uint8Array, contentType: string, options?: { readonly signal?: AbortSignal }): Promise<void>;
  /** 크기와 종류. 없으면 null. */
  head(key: string): Promise<StoredObjectInfo | null>;
  /** 내용. 없으면 null. */
  get(key: string): Promise<StoredObject | null>;
  /** 같은 저장소 안에서 복사한다. 원본이 없으면 false. */
  copy(from: string, to: string): Promise<boolean>;
  /** 지운다. 없어도 오류가 아니다. */
  delete(key: string): Promise<void>;
  /** prefix로 시작하고 startAfter보다 뒤인 키를 max개까지. */
  list(prefix: string, startAfter: string, max: number): Promise<ObjectList>;
}

/** 저장소가 답하지 않거나 오류(응답은 503 storage_unavailable). 메시지에는 동작 이름과 상태 코드만 싣는다. */
export class StorageUnavailableError extends Error {
  override readonly name = "StorageUnavailableError";
}

/** 정리는 일부 실패해도 나머지 키를 시도하며, 마지막에 첫 오류를 알린다. 다시 시도는 하지 않는다. */
export async function deleteObjects(store: ObjectStore, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  let failed = false;
  let firstError: unknown;
  const step = store.batch ? STORAGE_BATCH_OBJECT_LIMIT : 1;
  for (let start = 0; start < keys.length; start += step)
    try {
      if (store.batch) await store.batch.delete(keys.slice(start, start + step));
      else await store.delete(keys[start] as string);
    } catch (error) {
      if (!failed) firstError = error;
      failed = true;
    }
  if (failed) throw firstError;
}

/** 우리 코드가 만드는 키의 꼴: 영문·숫자·`_`·`-`·`.`과 `/`로 나눈 마디(빈 마디·`.`·`..` 없음). */
export const STORAGE_KEY = /^(?!.*\/\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;

export function assertStorageKey(key: string): string {
  if (typeof key !== "string" || key.length > 512 || !STORAGE_KEY.test(key))
    throw new TypeError("storage key has an unexpected shape");
  return key;
}

export interface S3Config {
  /** S3 호환 주소(예: Supabase는 https://<프로젝트>.storage.supabase.co/storage/v1/s3). 경로 꼴(path-style)로 부른다. */
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** 시험만 바꾼다. 기본은 전역 fetch. */
  readonly fetch?: (req: Request) => Promise<Response>;
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function xmlText(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos);/g, (_m, name: string) => XML_ENTITIES[name] ?? "");
}

/**
 * 상태 코드로 끝난 응답의 몸체를 버린다. 머리 뒤에 연결이 끊겨 버리기가 거절돼도 동작의 결과는 상태 코드로 이미 왔으므로
 * 무시한다(그대로 두면 끊긴 연결의 TypeError가 StorageUnavailableError가 아닌 채로 새어 500이 됨).
 */
async function discardBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // 끊긴 연결: 버릴 몸체가 없는 것과 같다
  }
}

/** ListObjectsV2 응답에서 키와 잘림 여부만 읽는다(Contents/Key, IsTruncated). */
export function parseListObjectsV2(xml: string): ObjectList {
  const keys: string[] = [];
  for (const m of xml.matchAll(/<Contents>[\s\S]*?<Key>([\s\S]*?)<\/Key>[\s\S]*?<\/Contents>/g)) {
    keys.push(xmlText(m[1] as string));
  }
  const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/.test(xml);
  return { keys, truncated };
}

/**
 * S3 프로토콜 저장소(SigV4 서명은 aws4fetch). 요청마다 한 번만 보낸다(다시 시도는 부르는 쪽, 사장님이 다시 올림).
 * 몸체 해시는 UNSIGNED-PAYLOAD(aws4fetch의 s3 기본)라 20MB 사진도 CPU를 해시에 쓰지 않는다.
 */
export class S3Store implements ObjectStore {
  readonly #client: AwsClient;
  readonly #base: string;
  readonly #bucket: string;
  readonly #fetch: (req: Request) => Promise<Response>;

  constructor(config: S3Config) {
    this.#client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      service: "s3",
      region: config.region,
      retries: 0,
    });
    this.#base = config.endpoint.replace(/\/+$/, "");
    this.#bucket = config.bucket;
    this.#fetch = config.fetch ?? ((req) => fetch(req));
  }

  #url(key?: string): string {
    const bucket = `${this.#base}/${encodeURIComponent(this.#bucket)}`;
    if (key === undefined) return bucket;
    return `${bucket}/${assertStorageKey(key).split("/").map(encodeURIComponent).join("/")}`;
  }

  async #send(op: string, url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await this.#fetch(await this.#client.sign(url, init));
    } catch {
      throw new StorageUnavailableError(`${op}: no response`);
    }
    return res;
  }

  /** 몸체를 읽어야 결과를 아는 동작(목록·복사)의 몸체. 머리 뒤에 연결이 끊기면 저장소가 답하지 않은 것과 같다. */
  async #text(op: string, res: Response): Promise<string> {
    try {
      return await res.text();
    } catch {
      throw new StorageUnavailableError(`${op}: body not read`);
    }
  }

  #fail(op: string, res: Response): never {
    // 몸체(오류 XML)는 읽지 않고 버린다. 상태 코드만 남긴다.
    void discardBody(res);
    throw new StorageUnavailableError(`${op}: status ${res.status}`);
  }

  async put(
    key: string,
    body: Uint8Array,
    contentType: string,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<void> {
    if (options.signal?.aborted) throw new StorageUnavailableError("put: cancelled");
    const res = await this.#send("put", this.#url(key), {
      method: "PUT",
      // Content-Length는 fetch가 몸체(바이트 배열)로 채운다.
      headers: { "content-type": contentType },
      body,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (res.status !== 200) this.#fail("put", res);
    await discardBody(res);
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    const res = await this.#send("head", this.#url(key), { method: "HEAD" });
    if (res.status === 404) return null;
    if (res.status !== 200) this.#fail("head", res);
    return {
      key,
      size: Number(res.headers.get("content-length") ?? "0"),
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
    };
  }

  async get(key: string): Promise<StoredObject | null> {
    const res = await this.#send("get", this.#url(key), { method: "GET" });
    if (res.status === 404) {
      await discardBody(res);
      return null;
    }
    if (res.status !== 200 || res.body === null) this.#fail("get", res);
    // 몸체는 읽지 않고 흘려보낸다. 도중에 끊기면 받는 쪽(사진을 내는 응답)도 끊긴다(상태 코드는 이미 나감).
    return {
      key,
      size: Number(res.headers.get("content-length") ?? "0"),
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
      body: res.body,
    };
  }

  async copy(from: string, to: string): Promise<boolean> {
    const source = `/${encodeURIComponent(this.#bucket)}/${assertStorageKey(from).split("/").map(encodeURIComponent).join("/")}`;
    const res = await this.#send("copy", this.#url(to), { method: "PUT", headers: { "x-amz-copy-source": source } });
    if (res.status === 404) {
      await discardBody(res);
      return false;
    }
    if (res.status !== 200) this.#fail("copy", res);
    // S3는 복사 도중 실패해도 200과 Error 본문을 줄 수 있다(AWS CopyObject 문서). 그래서 몸체를 끝까지 읽는다.
    const text = await this.#text("copy", res);
    if (!/<CopyObjectResult[\s>]/.test(text) || /<Error>/.test(text)) {
      throw new StorageUnavailableError("copy: error body");
    }
    return true;
  }

  async delete(key: string): Promise<void> {
    const res = await this.#send("delete", this.#url(key), { method: "DELETE" });
    if (res.status !== 204 && res.status !== 200 && res.status !== 404) this.#fail("delete", res);
    await discardBody(res);
  }

  async list(prefix: string, startAfter: string, max: number): Promise<ObjectList> {
    const q = new URLSearchParams({ "list-type": "2", prefix, "max-keys": String(max) });
    if (startAfter !== "") q.set("start-after", startAfter);
    const res = await this.#send("list", `${this.#url()}?${q.toString()}`, { method: "GET" });
    if (res.status !== 200) this.#fail("list", res);
    return parseListObjectsV2(await this.#text("list", res));
  }
}
