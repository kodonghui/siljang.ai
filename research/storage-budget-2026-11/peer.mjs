import { WorkerEntrypoint } from "cloudflare:workers";
import { measure } from "./measure.mjs";

export class StorageBudgetPeer extends WorkerEntrypoint {
  measure(count) {
    return measure(this.env.PROBE_URL, count);
  }
}

export default { fetch: () => new Response(null, { status: 404 }) };
