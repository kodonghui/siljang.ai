import { expect, it } from "vitest";
import { TEST_DATABASE_URL } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";

it.skipIf(!TEST_DATABASE_URL)(
  "DB 연결이 끊기면 트랜잭션 중단 신호가 실행 중 요청을 취소한다",
  async () => {
    const isolated = await isolatedTestDb(),
      a = isolated.connect(),
      b = isolated.connect();
    try {
      let observed: AbortSignal | undefined;
      const work = a.transaction(async (tx) => {
        observed = tx.signal;
        expect(observed).toBeInstanceOf(AbortSignal);
        const pid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]?.pid;
        const stopped = new Promise<void>((resolve) =>
          observed?.addEventListener("abort", () => resolve(), { once: true }),
        );
        await b.query("SELECT pg_terminate_backend($1)", [pid]);
        await stopped;
      });
      await expect(work).rejects.toThrow();
      expect(observed?.aborted).toBe(true);
    } finally {
      await a.close();
      await b.close();
      await isolated.close();
    }
  },
  30000,
);
