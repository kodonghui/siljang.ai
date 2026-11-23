/** 비공개 저장소 배치의 약속. 비밀 값은 호출 중 메모리에서만 쓰고 로그/응답/새 비밀 저장소에 남기지 않는다. */

import { validateStorageSettings } from "./settings";
import {
  assertStorageKey,
  type ObjectBatch,
  type ObjectStore,
  type S3Config,
  S3Store,
  STORAGE_BATCH_OBJECT_LIMIT,
  StorageUnavailableError,
  type StoredObjectInfo,
} from "./storage";

export type StorageBatchConfig = Omit<S3Config, "fetch">;
export type StorageBatchOperation =
  | { readonly kind: "head"; readonly key: string }
  | { readonly kind: "copy"; readonly from: string; readonly to: string }
  | { readonly kind: "delete"; readonly key: string };
export type StorageBatchOutcome =
  | { readonly ok: true; readonly value: StoredObjectInfo | boolean | null }
  | { readonly ok: false };
export interface StorageBatchBinding {
  run(
    config: StorageBatchConfig,
    operations: readonly StorageBatchOperation[],
  ): Promise<readonly StorageBatchOutcome[]>;
}

/** 50개 명령은 단계마다 최대5회, 정리를 포함해도 같은 요청의 Worker 호출32회 아래다. */
export const STORAGE_BATCH_SIZE = 10;

function unavailable(): StorageUnavailableError {
  return new StorageUnavailableError("batch: unavailable");
}

/** 개별 동작은 원래 S3 구현, 여러 사진은 서비스 호출에서 서명/실행한다. */
export function batchS3Store(config: StorageBatchConfig, binding: StorageBatchBinding): ObjectStore {
  return Object.assign(new S3Store(config), { batch: storageBatchClient(config, binding) });
}

export function storageBatchClient(config: StorageBatchConfig, binding: StorageBatchBinding): ObjectBatch {
  async function run(operations: readonly StorageBatchOperation[], bestEffort = false) {
    if (operations.length > STORAGE_BATCH_OBJECT_LIMIT) throw new TypeError("too many batch objects");
    for (const op of operations) {
      if (op.kind === "copy") {
        assertStorageKey(op.from);
        assertStorageKey(op.to);
      } else assertStorageKey(op.key);
    }
    const outcomes: StorageBatchOutcome[] = [];
    for (let start = 0; start < operations.length; start += STORAGE_BATCH_SIZE) {
      const chunk = operations.slice(start, start + STORAGE_BATCH_SIZE);
      try {
        const result = await binding.run(config, chunk);
        if (!Array.isArray(result) || result.length !== chunk.length) throw unavailable();
        for (const item of result)
          if (!item || typeof item !== "object" || (item.ok !== true && item.ok !== false)) throw unavailable();
        outcomes.push(...result);
      } catch {
        if (!bestEffort) throw unavailable();
        outcomes.push(...chunk.map(() => ({ ok: false as const })));
      }
    }
    return outcomes;
  }
  return {
    async head(keys) {
      const results = await run(keys.map((key) => ({ kind: "head", key })));
      return results.map((result, i) => {
        if (!result.ok) throw unavailable();
        const value = result.value;
        if (value === null) return null;
        if (
          typeof value !== "object" ||
          value.key !== keys[i] ||
          !Number.isSafeInteger(value.size) ||
          value.size < 0 ||
          typeof value.contentType !== "string"
        )
          throw unavailable();
        return value;
      });
    },
    async copy(pairs) {
      const results = await run(pairs.map(({ from, to }) => ({ kind: "copy", from, to })));
      return results.map((result) => {
        if (!result.ok) return { ok: false as const };
        if (typeof result.value !== "boolean") throw unavailable();
        return { ok: true as const, value: result.value };
      });
    },
    async delete(keys) {
      const results = await run(
        keys.map((key) => ({ kind: "delete", key })),
        true,
      );
      if (results.some((result) => !result.ok || result.value !== null)) throw unavailable();
    },
  };
}

/** 서비스가 받는 전체 입력을 외부 호출 전에 확인한다. HTTP 공개 진입점은 없다. */
export function validateStorageBatch(config: StorageBatchConfig, operations: readonly StorageBatchOperation[]): void {
  if (!config || typeof config !== "object") throw new TypeError("invalid batch config");
  const names = ["endpoint", "region", "bucket", "accessKeyId", "secretAccessKey"] as const;
  if (Object.keys(config).length !== names.length) throw new TypeError("invalid batch config");
  for (const name of names)
    if (typeof config[name] !== "string" || config[name].length < 1 || config[name].length > 2048)
      throw new TypeError("invalid batch config");
  try {
    validateStorageSettings(config, "production");
  } catch {
    throw new TypeError("invalid batch config");
  }
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > STORAGE_BATCH_SIZE)
    throw new TypeError("invalid batch size");
  for (const op of operations) {
    if (!op || typeof op !== "object") throw new TypeError("invalid batch operation");
    if (op.kind === "copy") {
      if (Object.keys(op).length !== 3) throw new TypeError("invalid batch operation");
      assertStorageKey(op.from);
      assertStorageKey(op.to);
    } else if (op.kind === "head" || op.kind === "delete") {
      if (Object.keys(op).length !== 2) throw new TypeError("invalid batch operation");
      assertStorageKey(op.key);
    } else throw new TypeError("invalid batch operation");
  }
}

/** 호출마다 S3 클라이언트를 만들며, 공유 연결6개 중 최대3개만 동시에 쓴다. 결과 순서는 입력과 같다. */
export async function executeStorageBatch(
  config: StorageBatchConfig,
  operations: readonly StorageBatchOperation[],
  createStore: (config: StorageBatchConfig) => ObjectStore = (value) => new S3Store(value),
): Promise<readonly StorageBatchOutcome[]> {
  validateStorageBatch(config, operations);
  const store = createStore(config);
  const results = new Array<StorageBatchOutcome>(operations.length);
  let next = 0;
  async function worker() {
    while (next < operations.length) {
      const i = next++;
      const op = operations[i];
      if (!op) throw new TypeError("missing batch operation");
      try {
        let value: StoredObjectInfo | boolean | null;
        if (op.kind === "head") value = await store.head(op.key);
        else if (op.kind === "copy") value = await store.copy(op.from, op.to);
        else {
          await store.delete(op.key);
          value = null;
        }
        results[i] = { ok: true, value };
      } catch {
        results[i] = { ok: false };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, operations.length) }, () => worker()));
  return results;
}
