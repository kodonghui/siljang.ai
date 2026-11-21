import { beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { RequestDb, Rows } from "../src/db";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { contract, expectProblem, expectSchema } from "./support/contract";
import { TEST_HASH_KEY } from "./support/db";

const OPERATIONS = [
  { id: "API-070", kind: "message" },
  { id: "API-071", kind: "card" },
  { id: "API-072", kind: "review" },
  { id: "API-073", kind: "event" },
] as const;
const RESPONSES = ["200", "401", "422", "default"] as const;
const SHOP = "10000000-0000-4000-8000-000000000071";
const CHANNEL = "20000000-0000-4000-8000-000000000071";
const BOT = "d".repeat(24);
const PRIVATE_DETAIL = "synthetic-private-database-details";
let key: string;

beforeAll(async () => {
  key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), CHANNEL, 1);
});

function harness(failure?: "authorization" | "contact") {
  const logs: string[] = [];
  const writes = vi.fn();
  const reads = vi.fn();
  const query: RequestDb["query"] = async <R>(sql: string): Promise<Rows<R>> => {
    reads();
    if (failure === "authorization") throw new Error(PRIVATE_DETAIL);
    if (/FROM kakao_channels/i.test(sql)) {
      return {
        rows: [{ id: CHANNEL, shop_id: SHOP, status: "pending", skill_key_version: 1, previous_key_until: null } as R],
        rowCount: 1,
      };
    }
    if (/FROM shops/i.test(sql)) {
      if (failure === "contact") throw new Error(PRIVATE_DETAIL);
      return { rows: [{ contact_phone: "02-000-0000" } as R], rowCount: 1 };
    }
    throw new Error("예상하지 않은 시험 질의");
  };
  const transaction: RequestDb["transaction"] = async () => {
    writes();
    throw new Error("인증/연결 전 응답에서 쓰기 금지");
  };
  const connect = vi.fn(() => ({ query, transaction, abort: async () => {}, close: async () => {} }));
  const app = createApp({ connect, logSink: (line) => logs.push(line) });
  const call = (kind: string, response: (typeof RESPONSES)[number]) => {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (response !== "401") headers.set("Siljang-Skill-Key", key);
    return app.request(
      `/api/kakao/skills/${kind}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(
          response === "422"
            ? { bot: { id: BOT } }
            : {
                bot: { id: BOT },
                userRequest: {
                  utterance: "합성 계약 시험",
                  block: { id: "contract" },
                  user: { id: "synthetic-contract-user", type: "botUserKey" },
                },
                action: { id: "contract", params: {} },
              },
        ),
      },
      { REQUEST_HASH_KEY: TEST_HASH_KEY },
    );
  };
  return { call, reads, writes, logs };
}

describe("카카오 네 스킬의 선언된 HTTP 응답(TASK-028)", () => {
  it.each(OPERATIONS)("$id의 응답 선언마다 시험 사례가 있음", ({ kind }) => {
    const operation = contract.paths[`/kakao/skills/${kind}`]?.post as { responses?: Record<string, unknown> };
    expect(Object.keys(operation.responses ?? {}).sort()).toEqual([...RESPONSES].sort());
  });

  describe.each(OPERATIONS)("$id /$kind", ({ kind }) => {
    it.each(RESPONSES)("HTTP %s가 계약의 본문/헤더를 지키고 쓰지 않음", async (response) => {
      const h = harness(response === "default" ? "authorization" : undefined);
      const result = await h.call(kind, response);
      if (response === "200") {
        expect(result.status).toBe(200);
        expect(result.headers.get("Cache-Control")).toBe("no-store");
        expect(result.headers.get("Siljang-Outcome")).toBe(kind === "event" ? "notice_gone" : "not_accepting");
        expectSchema("SkillTemplateResponse", await result.json());
      } else {
        const body = await expectProblem(
          result,
          response === "401" ? "skill_key_invalid" : response === "422" ? "validation_failed" : "internal",
        );
        expect(JSON.stringify(body)).not.toContain(PRIVATE_DETAIL);
        if (response !== "default") expect(h.reads).not.toHaveBeenCalled();
      }
      expect(h.writes).not.toHaveBeenCalled();
      expect(h.logs.join("\n")).not.toContain(PRIVATE_DETAIL);
      expect(h.logs.join("\n")).not.toContain("합성 계약 시험");
    });
  });

  it.each(OPERATIONS.filter(({ kind }) => kind !== "event"))(
    "$id의 처리 중 실패는 200/server_error로 안내함",
    async ({ kind }) => {
      const h = harness("contact");
      const result = await h.call(kind, "200");
      expect(result.status).toBe(200);
      expect(result.headers.get("Siljang-Outcome")).toBe("server_error");
      const body = await result.json();
      expectSchema("SkillTemplateResponse", body);
      expect(JSON.stringify(body)).not.toContain(PRIVATE_DETAIL);
      expect(h.logs.join("\n")).not.toContain(PRIVATE_DETAIL);
      expect(h.writes).not.toHaveBeenCalled();
    },
  );
});
