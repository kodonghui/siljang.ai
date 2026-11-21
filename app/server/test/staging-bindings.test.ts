import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// TASK-173: 배포 환경은 상위 vars·queues를 물려받지 않으므로 staging 자체의 선언을 검사한다.
const config = JSON.parse(
  readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, ""),
);
const staging = config.env.staging;
const queue = "siljang-staging-kakao-callbacks";

describe("스테이징 Worker 바인딩(TASK-173)", () => {
  it("스테이징이 development 기본값으로 돌아가지 않게 환경 이름을 명시", () => {
    expect(staging.vars?.APP_ENV).toBe("staging");
  });
  it("앱의 콜백 발행기를 별도 스테이징 큐에 연결", () => {
    expect(staging.queues?.producers).toContainEqual({ binding: "KAKAO_CALLBACK_QUEUE", queue });
  });
  it("같은 큐의 소비자를 작은 배치와 삭제 대신 보존할 실패 큐로 연결", () => {
    expect(staging.queues?.consumers).toContainEqual(
      expect.objectContaining({
        queue,
        max_batch_size: 1,
        max_retries: 3,
        dead_letter_queue: `${queue}-dlq`,
      }),
    );
  });
  it("서울 배치 힌트·1분 Cron·Hyperdrive·같은 Worker의 정적 자산을 유지", () => {
    expect(staging.placement).toEqual({ region: "aws:ap-northeast-2" });
    expect(staging.triggers.crons).toEqual(["* * * * *"]);
    expect(staging.hyperdrive).toEqual([expect.objectContaining({ binding: "HYPERDRIVE", id: expect.any(String) })]);
    expect(config.assets.directory).toBe("../web/dist");
  });
});
