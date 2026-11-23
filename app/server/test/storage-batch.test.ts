import { afterEach, describe, expect, it, vi } from "vitest";
import { MissingSettingError } from "../src/request-key";
import { createServices } from "../src/services";
import { readSettings } from "../src/settings";
import { StorageUnavailableError } from "../src/storage";
import {
  executeStorageBatch,
  type StorageBatchBinding,
  type StorageBatchConfig,
  type StorageBatchOperation,
  type StorageBatchOutcome,
  storageBatchClient,
  validateStorageBatch,
} from "../src/storage-batch";
import { MemoryStore } from "./support/storage";

const config: StorageBatchConfig = {
  endpoint: "https://project.storage.example.test/storage/v1/s3",
  region: "ap-northeast-2",
  bucket: "photos",
  accessKeyId: ["test", "access", "id"].join("-"),
  secretAccessKey: ["test", "secret", "value"].join("-"),
};

afterEach(() => vi.unstubAllGlobals());

describe("무료 저장소 서비스 배치", () => {
  it("50개의 확인·복사·삭제는 호출마다10개,총15회로 처리하고 순서/내용을 지킴", async () => {
    const store = new MemoryStore();
    const keys = Array.from({ length: 50 }, (_, i) => `tmp/synthetic/photo${i}`);
    for (const key of keys) await store.put(key, new Uint8Array([1, 2, 3]), "image/png");
    const calls: (readonly StorageBatchOperation[])[] = [];
    const binding: StorageBatchBinding = {
      async run(value, operations) {
        expect(value).toEqual(config);
        calls.push(operations);
        return executeStorageBatch(value, operations, () => store);
      },
    };
    const batch = storageBatchClient(config, binding);
    expect((await batch.head(keys)).map((item) => item?.key)).toEqual(keys);
    const pairs = keys.map((from, i) => ({ from, to: `shops/synthetic/design_image/version/photo${i}` }));
    expect(await batch.copy(pairs)).toEqual(keys.map(() => ({ ok: true, value: true })));
    await batch.delete(keys);
    expect(store.keys("tmp/")).toEqual([]);
    expect(store.keys("shops/")).toHaveLength(50);
    expect(calls.map((ops) => ops.length)).toEqual(Array(15).fill(10));
    expect(calls.flat().filter((op) => op.kind === "copy")).toEqual(pairs.map((pair) => ({ kind: "copy", ...pair })));
  });

  it("공유 연결은3개 이하이고 일부 실패 뒤에도 모든 진행 중 동작이 끝난 결과만 반환함", async () => {
    const store = new MemoryStore();
    let active = 0,
      peak = 0,
      finished = 0;
    store.head = async (key) => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      finished++;
      if (key === "tmp/photo4") throw new Error(`${config.secretAccessKey} upstream detail`);
      return { key, size: 3, contentType: "image/png" };
    };
    const result = await executeStorageBatch(
      config,
      Array.from({ length: 10 }, (_, i) => ({ kind: "head", key: `tmp/photo${i}` })),
      () => store,
    );
    expect(peak).toBe(3);
    expect(active).toBe(0);
    expect(finished).toBe(10);
    expect(result[4]).toEqual({ ok: false });
    expect(result.filter((item) => item.ok)).toHaveLength(9);
    expect(JSON.stringify(result)).not.toContain(config.secretAccessKey);
    expect(JSON.stringify(result)).not.toContain("upstream detail");
  });

  it("실제 S3 구현은 서명한 요청만 외부로 보내며 응답에는 서명/비밀 값/복사 본문이 없음", async () => {
    const sent: Request[] = [];
    vi.stubGlobal("fetch", async (request: Request) => {
      sent.push(request);
      if (request.method === "HEAD")
        return new Response(null, { headers: { "content-type": "image/png", "content-length": "3" } });
      if (request.method === "PUT") return new Response("<CopyObjectResult><ETag>synthetic</ETag></CopyObjectResult>");
      return new Response(null, { status: 204 });
    });
    const result = await executeStorageBatch(config, [
      { kind: "head", key: "tmp/owner/photo" },
      { kind: "copy", from: "tmp/owner/photo", to: "shops/shop/photo" },
      { kind: "delete", key: "tmp/owner/photo" },
    ]);
    expect(result).toEqual([
      { ok: true, value: { key: "tmp/owner/photo", size: 3, contentType: "image/png" } },
      { ok: true, value: true },
      { ok: true, value: null },
    ]);
    expect(sent.map((request) => request.method)).toEqual(["HEAD", "PUT", "DELETE"]);
    for (const request of sent) {
      expect(new URL(request.url).origin).toBe("https://project.storage.example.test");
      expect(request.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 /);
      expect(JSON.stringify([...request.headers])).not.toContain(config.secretAccessKey);
    }
    expect(JSON.stringify(result)).not.toContain("synthetic");
    expect(JSON.stringify(result)).not.toContain("Signature");
  });

  it.each(
    [
      [],
      Array.from({ length: 11 }, () => ({ kind: "head", key: "tmp/photo" })),
      [{ kind: "put", key: "tmp/photo" }],
      [{ kind: "get", key: "tmp/photo" }],
      [{ kind: "head", key: "tmp/photo", body: "unexpected" }],
      [{ kind: "head", key: 3 }],
      [{ kind: "copy", from: "tmp/photo", to: "shops/../photo" }],
      [
        { kind: "head", key: "tmp/good" },
        { kind: "delete", key: "tmp//bad" },
      ],
    ].map((operations) => ({ operations })),
  )("잘못된 배치는 외부 호출 전에 모두 거절함 %j", async ({ operations }) => {
    const createStore = vi.fn(() => new MemoryStore());
    await expect(
      executeStorageBatch(config, operations as readonly StorageBatchOperation[], createStore),
    ).rejects.toThrow(TypeError);
    expect(createStore).not.toHaveBeenCalled();
  });

  it.each([
    { ...config, endpoint: "http://localhost/storage" },
    { ...config, endpoint: "https://user:pass@storage.example.test/s3" },
    { ...config, endpoint: "https://storage.example.test/s3?x=1" },
    { ...config, endpoint: "https://storage.example.test/s3#x" },
    { ...config, region: "unexpected/value" },
    { ...config, bucket: "../photos" },
    { ...config, fetch: "unexpected" },
  ])("잘못된 목적지와 설정 밖 필드를 거절함", (value) => {
    expect(() => validateStorageBatch(value, [{ kind: "head", key: "tmp/photo" }])).toThrow(TypeError);
  });

  it("빈 목록은 호출0이고51개 이상은 RPC 전에 거절함", async () => {
    const run = vi.fn<StorageBatchBinding["run"]>();
    const batch = storageBatchClient(config, { run });
    expect(await batch.head([])).toEqual([]);
    expect(await batch.copy([])).toEqual([]);
    await batch.delete([]);
    await expect(batch.head(Array(51).fill("tmp/photo"))).rejects.toThrow(TypeError);
    await expect(batch.delete(["tmp/good", "tmp/../bad"])).rejects.toThrow(TypeError);
    expect(run).not.toHaveBeenCalled();
  });

  it("삭제 RPC 응답을 잃어도 나머지 다른 키를 시도하고 재시도/오류 원문을 내지 않음", async () => {
    const calls: (readonly StorageBatchOperation[])[] = [];
    const batch = storageBatchClient(config, {
      async run(_value, operations) {
        calls.push(operations);
        if (calls.length === 1) throw new Error(config.secretAccessKey);
        return operations.map(() => ({ ok: true, value: null }));
      },
    });
    const error = await batch
      .delete(Array.from({ length: 25 }, (_, i) => `tmp/photo${i}`))
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(StorageUnavailableError);
    expect((error as Error).message).toBe("batch: unavailable");
    expect(calls.map((ops) => ops.length)).toEqual([10, 10, 5]);
    expect(new Set(calls.flat().map((op) => op.kind !== "copy" && op.key)).size).toBe(25);
  });

  it.each(
    [
      [],
      [{ ok: true, value: { key: "tmp/other", size: 3, contentType: "image/png" } }],
      [{ ok: true, value: { key: "tmp/photo", size: -1, contentType: "image/png" } }],
      [{ ok: true, value: true }],
      [{ ok: false }],
    ].map((result) => ({ result })),
  )("잘못된 head 결과는 저장하지 않고 저장소 오류로 처리함", async ({ result }) => {
    const batch = storageBatchClient(config, { run: async () => result as StorageBatchOutcome[] });
    await expect(batch.head(["tmp/photo"])).rejects.toThrow(StorageUnavailableError);
  });

  it("서비스 생성은 지연하고 배포 환경은 바인딩 없이 직접50회 경로로 돌아가지 않음", () => {
    const env = {
      APP_ENV: "staging",
      STORAGE_ENDPOINT: config.endpoint,
      STORAGE_REGION: config.region,
      STORAGE_BUCKET: config.bucket,
      STORAGE_ACCESS_KEY_ID: config.accessKeyId,
      STORAGE_SECRET_ACCESS_KEY: config.secretAccessKey,
    };
    const services = createServices(env, readSettings(env));
    expect(services.now()).toBeInstanceOf(Date);
    expect(() => services.storage()).toThrow(MissingSettingError);
    const run = vi.fn<StorageBatchBinding["run"]>();
    const ready = createServices({ ...env, STORAGE_BATCHES: { run } }, readSettings(env));
    expect(ready.storage().batch).toBeDefined();
    expect(ready.storage()).toBe(ready.storage());
    expect(run).not.toHaveBeenCalled();
  });

  it("개발에서 허용한 localhost HTTP 저장소는 로컬 구현을 유지함", () => {
    const env = {
      APP_ENV: "development",
      STORAGE_ENDPOINT: "http://localhost:9000/storage",
      STORAGE_REGION: config.region,
      STORAGE_BUCKET: config.bucket,
      STORAGE_ACCESS_KEY_ID: config.accessKeyId,
      STORAGE_SECRET_ACCESS_KEY: config.secretAccessKey,
    };
    const run = vi.fn<StorageBatchBinding["run"]>();
    const services = createServices({ ...env, STORAGE_BATCHES: { run } }, readSettings(env));
    expect(services.storage().batch).toBeUndefined();
    expect(run).not.toHaveBeenCalled();
  });
});
