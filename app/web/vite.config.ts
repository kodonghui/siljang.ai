import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

function staticWorker(): Plugin {
  return {
    name: "siljang-static-worker",
    apply: "build",
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const worker = readFileSync(new URL("./src/pwa-worker.js", import.meta.url), "utf8");
        const paths = JSON.stringify(
          Object.keys(bundle)
            .filter((path) => path.startsWith("assets/"))
            .sort()
            .map((path) => `/${path}`),
        );
        const version = createHash("sha256").update(worker).update(paths).digest("hex").slice(0, 16);
        const source = worker
          .replace("/* build-assets */ []", paths)
          .replace("siljang-assets-build", `siljang-assets-${version}`);
        this.emitFile({ type: "asset", fileName: "service-worker.js", source });
      },
    },
  };
}

// 개발 때 /api는 wrangler dev(127.0.0.1:8787)로 넘긴다. 배포 뒤에는 같은 Worker가 /api/*를 받는다.
export default defineConfig({
  plugins: [react(), staticWorker()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
