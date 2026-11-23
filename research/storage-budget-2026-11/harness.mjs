import { WorkerEntrypoint } from "cloudflare:workers";
import { measure } from "./measure.mjs";

export class StorageBudgetHarness extends WorkerEntrypoint {
  async run(mode) {
    if (mode === "direct49") return measure(this.env.PROBE_URL, 49);
    if (mode === "direct51") return measure(this.env.PROBE_URL, 51);
    if (mode === "peer51") return this.env.PEER.measure(51);
    if (mode === "peer30twice") {
      const first = await this.env.PEER.measure(30);
      const second = await this.env.PEER.measure(30);
      return { first, second };
    }
    throw new TypeError("invalid_mode");
  }
}

export default { fetch: () => new Response(null, { status: 404 }) };
