import { defineConfig } from "vitest/config";

// 서버 시험은 Node에서 Hono 앱을 직접 부른다(app.request). Workers 실행 환경에서 도는 시험은
// 바인딩(Hyperdrive·Queues)을 붙이는 TASK-171·173에서 더한다.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
