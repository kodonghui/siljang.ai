import { WorkerEntrypoint } from "cloudflare:workers";
import { executeStorageBatch, type StorageBatchConfig, type StorageBatchOperation } from "./storage-batch";

/** 서비스 바인딩으로만 호출하며 외부 HTTP 경로는 열지 않는다. */
export class StorageBatches extends WorkerEntrypoint {
  run(config: StorageBatchConfig, operations: readonly StorageBatchOperation[]) {
    return executeStorageBatch(config, operations);
  }
}

export default { fetch: () => new Response(null, { status: 404 }) };
