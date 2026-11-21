import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { RequestDb, Rows } from "../src/db";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { expectProblem, expectSchema } from "./support/contract";
import { collectLogs, TEST_HASH_KEY } from "./support/db";

const CHANNEL = "20000000-0000-4000-8000-000000000001";
const SHOP = "10000000-0000-4000-8000-000000000001";
const BOT = "a".repeat(24);

function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function body() {
  return {
    bot: { id: BOT },
    userRequest: { utterance: "합성 질문", user: { id: "synthetic-user", type: "botUserKey" } },
    action: { id: "synthetic-action" },
  };
}

async function request(app: ReturnType<typeof createApp>, kind: string) {
  const key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), CHANNEL, 1);
  return app.request(
    `/api/kakao/skills/${kind}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
      body: JSON.stringify(body()),
    },
    { REQUEST_HASH_KEY: TEST_HASH_KEY },
  );
}

afterEach(() => vi.useRealTimers());

describe("카카오 스킬 전체 응답 시간(TASK-028, REQ-130)", () => {
  it("인증 전 DB가 멈춰도 기본 3,750ms에서 내부 내용 없는 오류로 끝나고 닫기를 기다리지 않음", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const entered = gate();
    const finish = gate();
    const closing = gate();
    const abort = vi.fn(() => closing.promise);
    const logs = collectLogs();
    const query: RequestDb["query"] = async () => {
      entered.release();
      await finish.promise;
      throw new Error("synthetic private database details");
    };
    const app = createApp({
      logSink: logs.sink,
      connect: () => ({ query, abort, transaction: async () => undefined as never, close: () => closing.promise }),
    });
    let settled = false;
    const pending = request(app, "event").then((res) => {
      settled = true;
      return res;
    });
    try {
      await entered.promise;
      await vi.advanceTimersByTimeAsync(3_749);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
      const response = await pending;
      await expectProblem(response, "internal");
      expect(response.headers.get("Siljang-Outcome")).toBeNull();
      expect(abort).toHaveBeenCalledOnce();
      expect(logs.lines.join("\n")).not.toContain("synthetic private database details");
    } finally {
      finish.release();
      closing.release();
      await pending;
    }
  });

  it.each(["message", "card", "review"])(
    "인증 뒤 %s의 조회가 멈추면 200 server_error이고 늦은 결과가 응답을 바꾸지 않음",
    async (kind) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const entered = gate();
      const finish = gate();
      const abort = vi.fn(async () => {});
      const query: RequestDb["query"] = async <R>(sql: string): Promise<Rows<R>> => {
        if (/FROM shops/i.test(sql)) {
          entered.release();
          await finish.promise;
          return { rows: [{ contact_phone: "010-1234-5678" } as R], rowCount: 1 };
        }
        return {
          rows: [
            { id: CHANNEL, shop_id: SHOP, status: "pending", skill_key_version: 1, previous_key_until: null } as R,
          ],
          rowCount: 1,
        };
      };
      const timeoutOptions = { kakaoSkillTimeoutMs: 20 };
      const app = createApp({
        ...timeoutOptions,
        logSink: () => {},
        connect: () => ({ query, abort, transaction: async () => undefined as never, close: async () => {} }),
      });
      let settled = false;
      const pending = request(app, kind).then((res) => {
        settled = true;
        return res;
      });
      try {
        await entered.promise;
        await vi.advanceTimersByTimeAsync(20);
        expect(settled).toBe(true);
        const response = await pending;
        expect(response.status).toBe(200);
        expect(response.headers.get("Siljang-Outcome")).toBe("server_error");
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        const result = await response.json();
        expectSchema("SkillResponse", result);
        expect(JSON.stringify(result)).not.toContain("010-1234-5678");
        expect(abort).toHaveBeenCalledOnce();
        finish.release();
        await vi.runAllTimersAsync();
        expect(response.headers.get("Siljang-Outcome")).toBe("server_error");
      } finally {
        finish.release();
        await pending;
      }
    },
  );
});
