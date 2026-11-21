import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { RequestDb, Rows } from "../src/db";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { shopRoute } from "../src/routes";
import { Secret } from "../src/settings";
import { expectProblem, expectSchema } from "./support/contract";
import { collectLogs, describeDb, newUuid, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { createShop, linkTestChannel } from "./support/shops";

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

  it("인증 뒤 안내 스킬이 멈추면 카카오 전송을 막는500을 반환하고 늦은 응답을 노출하지 않음", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const entered = gate();
    const finish = gate();
    const abort = vi.fn(async () => {});
    const logs = collectLogs();
    const query: RequestDb["query"] = async <R>(): Promise<Rows<R>> => ({
      rows: [{ id: CHANNEL, shop_id: SHOP, status: "linked", skill_key_version: 1, previous_key_until: null } as R],
      rowCount: 1,
    });
    const app = createApp({
      kakaoSkillTimeoutMs: 20,
      logSink: logs.sink,
      connect: () => ({ query, abort, transaction: async () => undefined as never, close: async () => {} }),
      routes: [
        shopRoute("POST", "/kakao/skills/event", "customer", async (r) => {
          entered.release();
          await finish.promise;
          return r.json(
            { version: "2.0", template: { outputs: [{ simpleText: { text: "synthetic-private-late-notice" } }] } },
            200,
            { "Siljang-Outcome": "notice_shown" },
          );
        }),
      ],
    });
    const pending = request(app, "event");
    try {
      await entered.promise;
      await vi.advanceTimersByTimeAsync(20);
      const response = await pending;
      expect(response.status).toBe(500);
      expect(response.headers.get("Siljang-Outcome")).toBeNull();
      await expectProblem(response, "internal");
      expect(abort).toHaveBeenCalledOnce();
      finish.release();
      await vi.runAllTimersAsync();
      expect(response.status).toBe(500);
      expect(logs.lines.join("\n")).not.toContain("synthetic-private-late-notice");
    } finally {
      finish.release();
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

describeDb("인증 뒤 시간 초과의 실제 PostgreSQL 중단과 롤백(TASK-028)", () => {
  const db = testDb();
  afterAll(async () => {
    await db.close();
  });

  it.each(["message", "event"])("%s의 느린 질의를 기다리지 않고 응답하며 미완료 쓰기는 남기지 않음", async (kind) => {
    const shop = await createShop(db, "응답 기한 롤백 가게");
    await linkTestChannel(db, shop.channelId);
    const key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
    const entered = gate();
    const finished = gate();
    const marker = `synthetic-timeout-${newUuid()}`;
    const app = createApp({
      kakaoSkillTimeoutMs: 500,
      logSink: () => {},
      routes: [
        shopRoute("POST", `/kakao/skills/${kind}`, "customer", async (r) => {
          try {
            await r.db.transaction(async (tx) => {
              await tx.run(
                `INSERT INTO messages (shop_id, consultation_id, direction, author, kind, body_masked, delivery)
               VALUES ($1, $2, 'outbound', 'system', 'text', $3, 'deferred')`,
                [shop.consultationId, marker],
              );
              entered.release();
              await tx.run("SELECT pg_sleep(2) FROM shops WHERE id = $1");
            });
            return r.json({ version: "2.0", template: { outputs: [] } });
          } finally {
            finished.release();
          }
        }),
      ],
    });
    const started = performance.now();
    const pending = app.request(
      `/api/kakao/skills/${kind}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
        body: JSON.stringify({ ...body(), bot: { id: shop.botId } }),
      },
      testEnv(),
    );
    await Promise.race([
      entered.promise,
      pending.then(() => {
        throw new Error("timeout before test transaction entered");
      }),
    ]);
    const response = await pending;
    expect(performance.now() - started).toBeLessThan(1500);
    expect(response.status).toBe(kind === "event" ? 500 : 200);
    expect(response.headers.get("Siljang-Outcome")).toBe(kind === "event" ? null : "server_error");
    if (kind === "event") await expectProblem(response, "internal");
    else expectSchema("SkillResponse", await response.json());
    await finished.promise;
    expect(
      (await db.query("SELECT id FROM messages WHERE shop_id = $1 AND body_masked = $2", [shop.shopId, marker]))
        .rowCount,
    ).toBe(0);
  });
});
