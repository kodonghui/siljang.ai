import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// 개발 때 /api는 wrangler dev(127.0.0.1:8787)로 넘긴다. 배포 뒤에는 같은 Worker가 /api/*를 받는다.
export default defineConfig({
  plugins: [react()],
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
