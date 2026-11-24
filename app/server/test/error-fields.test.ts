import { DatabaseError } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RequestDb } from "../src/db";
import * as callbackQueue from "../src/kakao-callback-queue";
import { runScheduled } from "../src/scheduled";
import { collectLogs, newUuid, TEST_DATABASE_URL, testEnv } from "./support/db";

const NOW = new Date("2026-11-24T00:00:00Z");
function failing() {
  const error = Object.assign(new DatabaseError("합성 비밀 오류 내용"), { name: "error", code: "40001" });
  const db: RequestDb = {
    query: async () => {
      throw error;
    },
    transaction: async () => {
      throw error;
    },
    abort: async () => {},
    close: async () => {},
  };
  return db;
}
describe("콜백·예약 실행 오류의 공통 분류(TASK-064)", () => {
  afterEach(() => vi.restoreAllMocks());
  it("큐의 PostgreSQL 실패를 분류하고 오류 내용 없이 다시 시도한다", async () => {
    const logs = collectLogs(),
      ack = vi.fn(),
      retry = vi.fn();
    await callbackQueue.createKakaoCallbackHandler({ connect: () => failing(), now: () => NOW, logSink: logs.sink })(
      { messages: [{ body: { shopId: newUuid(), messageId: newUuid() }, ack, retry }] },
      testEnv({ DATABASE_URL: TEST_DATABASE_URL }),
    );
    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledOnce();
    expect(logs.lines.map((line) => JSON.parse(line))).toContainEqual(
      expect.objectContaining({ event: "kakao_callback_failed", errorName: "DatabaseError", dbCode: "40001" }),
    );
    expect(logs.lines.join("\n")).not.toContain("합성 비밀 오류 내용");
  });
  it("예약 실행의 콜백 복구 실패도 같은 이름과 SQLSTATE만 기록한다", async () => {
    const logs = collectLogs();
    vi.spyOn(callbackQueue, "recoverExpiredKakaoCallbacks").mockRejectedValueOnce(
      Object.assign(new DatabaseError("합성 비밀 오류 내용"), { name: "error", code: "40001" }),
    );
    await runScheduled(
      { scheduledTime: NOW.getTime(), cron: "* * * * *" },
      testEnv({ DATABASE_URL: TEST_DATABASE_URL }),
      { connect: () => failing(), jobs: [], logSink: logs.sink },
    );
    expect(logs.lines.map((line) => JSON.parse(line))).toContainEqual(
      expect.objectContaining({
        event: "job_run_failed",
        job: "kakao_callback_recovery",
        errorName: "DatabaseError",
        dbCode: "40001",
      }),
    );
    expect(logs.lines.join("\n")).not.toContain("합성 비밀 오류 내용");
  });
});
