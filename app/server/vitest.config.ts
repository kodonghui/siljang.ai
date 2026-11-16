import { defineConfig } from "vitest/config";

// 서버 시험은 Node에서 Hono 앱을 직접 부른다(app.request). Workers 실행 환경에서 도는 시험은
// 바인딩(Hyperdrive·Queues)을 붙이는 TASK-171·173에서 더한다.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // 실행기 시험(TASK-023)은 여러 가게에 걸쳐 때가 된 행을 찾는다. 다른 시험 파일이 같은 시험 데이터베이스에 동시에 넣은 행을
    // 잡거나 그 행이 한 번에 찾는 수를 채우지 않게 파일은 차례로 돌린다(한 파일 안의 시험은 원래 차례로 돎).
    fileParallelism: false,
  },
});
