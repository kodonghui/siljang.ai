import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { RequestDb, Rows } from "../src/db";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { expectProblem, expectSchema } from "./support/contract";
import { describeDb, newUuid, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const SHOP_A = "10000000-0000-4000-8000-000000000001";
const SHOP_B = "10000000-0000-4000-8000-000000000002";
const CHANNEL_A = "20000000-0000-4000-8000-000000000001";
const CHANNEL_B = "20000000-0000-4000-8000-000000000002";
const BOT_A = "a".repeat(24);
const BOT_B = "b".repeat(24);
const SECRET = new Secret(TEST_HASH_KEY);
const NOW = new Date("2026-11-19T10:00:00.000Z");
const EXPIRES = new Date("2026-11-19T10:01:00.000Z");

function payload(bot = BOT_A) {
  return {
    bot: { id: bot, name: "시험 봇" },
    userRequest: {
      utterance: "안녕하세요",
      block: { id: "conversation" },
      user: { id: "synthetic-user", type: "botUserKey" },
    },
    action: { id: "synthetic-action", params: {} },
  };
}

function harness(now = NOW) {
  const readShop = vi.fn((id: unknown) => ({ contact_phone: id === SHOP_B ? "02-000-0000" : "010-1234-5678" }));
  const choose = vi.fn((id: unknown) => {
    if (id === BOT_A) {
      return {
        id: CHANNEL_A,
        shop_id: SHOP_A,
        status: "pending",
        skill_key_version: 2,
        previous_key_until: EXPIRES,
      };
    }
    if (id === BOT_B) {
      return {
        id: CHANNEL_B,
        shop_id: SHOP_B,
        status: "pending",
        skill_key_version: 1,
        previous_key_until: null,
      };
    }
    return undefined;
  });
  const query: RequestDb["query"] = async <R>(sql: string, params?: readonly unknown[]): Promise<Rows<R>> => {
    if (/FROM shops/i.test(sql)) {
      expect(sql).toMatch(/WHERE id = \$1/i);
      return { rows: [readShop(params?.[0]) as R], rowCount: 1 };
    }
    expect(sql).toMatch(/FROM kakao_channels/i);
    const found = choose(params?.[0]);
    return found === undefined ? { rows: [], rowCount: 0 } : { rows: [found as R], rowCount: 1 };
  };
  const write = vi.fn();
  const transaction: RequestDb["transaction"] = async () => {
    write();
    throw new Error("미연결 시험 채널에서 쓰기를 시도함");
  };
  const app = createApp({
    connect: () => ({ query, transaction, abort: async () => {}, close: async () => {} }),
    services: { now: () => now },
  });
  function call(kind: string, request: unknown, key?: string) {
    const headers = new Headers({ "content-type": "application/json" });
    if (key !== undefined) headers.set("Siljang-Skill-Key", key);
    return app.request(
      `/api/kakao/skills/${kind}`,
      { method: "POST", headers, body: JSON.stringify(request) },
      { REQUEST_HASH_KEY: TEST_HASH_KEY },
    );
  }
  return { call, choose, readShop, transaction: write };
}

describe("카카오 스킬 연결별 인증(TASK-028, REQ-237·256)", () => {
  it.each(["message", "card", "review"])(
    "연결 확인 중인 %s는 상담을 만들지 않고 자기 가게 연락처로 안내함",
    async (kind) => {
      const { call, readShop, transaction } = harness();
      const key = await deriveKakaoSkillKey(SECRET, CHANNEL_A, 2);
      const response = await call(kind, payload(), key);
      expect(response.headers.get("Siljang-Outcome")).toBe("not_accepting");
      const body = await response.json();
      expectSchema("SkillTemplateResponse", body);
      expect(JSON.stringify(body)).toContain("010-1234-5678");
      expect(readShop).toHaveBeenCalledExactlyOnceWith(SHOP_A);
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it("연락처 조회가 실패하면 내부 내용 없는 서버 오류 응답으로 안내함", async () => {
    const { call, readShop, transaction } = harness();
    readShop.mockImplementationOnce(() => {
      throw new Error("synthetic database details");
    });
    const key = await deriveKakaoSkillKey(SECRET, CHANNEL_A, 2);
    const response = await call("message", payload(), key);
    expect(response.status).toBe(200);
    expect(response.headers.get("Siljang-Outcome")).toBe("server_error");
    expect(await response.text()).not.toContain("synthetic database details");
    expect(transaction).not.toHaveBeenCalled();
  });
  it.each(["message", "card", "review", "event"])("%s에서 헤더 없는 요청은 DB를 열기 전에 401", async (kind) => {
    const { call, choose } = harness();
    await expectProblem(await call(kind, payload()), "skill_key_invalid");
    expect(choose).not.toHaveBeenCalled();
  });

  it("다른 연결의 키를 네 스킬에서 거절하고 기록을 쓰지 않음", async () => {
    const { call, readShop, transaction } = harness();
    const key = await deriveKakaoSkillKey(SECRET, CHANNEL_B, 1);
    for (const kind of ["message", "card", "review", "event"]) {
      await expectProblem(await call(kind, payload(), key), "skill_key_invalid");
    }
    expect(transaction).not.toHaveBeenCalled();
    expect(readShop).not.toHaveBeenCalled();
  });

  it("가게 B의 유효한 요청에는 B 연락처만 보임", async () => {
    const { call, readShop, transaction } = harness();
    const key = await deriveKakaoSkillKey(SECRET, CHANNEL_B, 1);
    const response = await call("message", payload(BOT_B), key);
    const body = await response.text();
    expect(body).toContain("02-000-0000");
    expect(body).not.toContain("010-1234-5678");
    expect(readShop).toHaveBeenCalledExactlyOnceWith(SHOP_B);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("봇 ID 끝의 느낌표 하나를 정규화해 현재 키를 확인함", async () => {
    const { call, choose } = harness();
    const key = await deriveKakaoSkillKey(SECRET, CHANNEL_A, 2);
    const reply = await call("message", payload(`${BOT_A}!`), key);
    expect(choose).toHaveBeenCalledExactlyOnceWith(BOT_A);
    expect(reply.status).toBe(200);
    expect(reply.headers.get("Siljang-Outcome")).toBe("not_accepting");
    expectSchema("SkillTemplateResponse", await reply.json());
  });

  it("이전 키는 교체 유예 기간 안에서만 통과함", async () => {
    const key = await deriveKakaoSkillKey(SECRET, CHANNEL_A, 1);
    const open = harness();
    const closed = harness(EXPIRES);
    expect((await open.call("message", payload(), key)).status).toBe(200);
    await expectProblem(await closed.call("message", payload(), key), "skill_key_invalid");
  });
});

describeDb("카카오 메시지 수신 기록과 동시 처리(TASK-028, REQ-132)", () => {
  const clock = { now: NOW };
  const db = testDb();
  let shop: ShopFixture;
  let bot: string;
  let skillKey: string;
  const app = createApp({ services: { now: () => clock.now }, logSink: () => {} });

  beforeAll(async () => {
    shop = await createShop(db, "카카오 스킬 시험 가게");
    await issueTestBookingLink(db, shop);
    bot = shop.botId;
    await linkTestChannel(db, shop.channelId);
    skillKey = await deriveKakaoSkillKey(SECRET, shop.channelId, 1);
  });
  afterAll(async () => {
    await db.close();
  });

  function send(userId: string, utterance: string) {
    const request = payload(bot);
    request.userRequest.user.id = userId;
    request.userRequest.utterance = utterance;
    return app.request(
      "/api/kakao/skills/message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Siljang-Skill-Key": skillKey },
        body: JSON.stringify(request),
      },
      testEnv(),
    );
  }

  it("동시에 같은 요청을 세 번 넘기면 한 행만 쓰고 반복에는 빈 출력을 반환함", async () => {
    const user = newUuid();
    const replies = await Promise.all([send(user, "합성 상담"), send(user, "합성 상담"), send(user, "합성 상담")]);
    expect(replies.map((r) => r.headers.get("Siljang-Outcome")).sort()).toEqual([
      "ai_key_missing",
      "duplicate",
      "duplicate",
    ]);
    for (const response of replies.filter((r) => r.headers.get("Siljang-Outcome") === "duplicate")) {
      expect(await response.json()).toEqual({ version: "2.0", template: { outputs: [] } });
    }
    const { rows } = await db.query<{ body_masked: string | null }>(
      `SELECT m.body_masked FROM messages m JOIN consultations c ON c.id = m.consultation_id
       JOIN customers u ON u.id = c.customer_id WHERE m.shop_id = $1 AND u.kakao_user_key = $2 AND m.direction = 'inbound'`,
      [shop.shopId, user],
    );
    expect(rows).toEqual([{ body_masked: "합성 상담" }]);
    clock.now = new Date(NOW.getTime() + 2_000);
    expect((await send(user, "합성 상담")).headers.get("Siljang-Outcome")).toBe("ai_key_missing");
  });

  it("분당 초과 첫 요청에만 안내하고 다음 요청도 기록하되 출력은 비움", async () => {
    const user = newUuid();
    for (let i = 0; i < 20; i += 1) {
      const response = await send(user, `합성 상담 ${i}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("Siljang-Outcome")).toBe("ai_key_missing");
    }
    const first = await send(user, "첫 초과");
    expect(first.headers.get("Siljang-Outcome")).toBe("rate_limited");
    expectSchema("SkillTemplateResponse", await first.json());
    const subsequent = await send(user, "둘째 초과");
    expect(subsequent.headers.get("Siljang-Outcome")).toBe("rate_limited");
    expect(await subsequent.json()).toEqual({ version: "2.0", template: { outputs: [] } });
    clock.now = new Date(NOW.getTime() + 60_000);
    const nextMinute = await send(user, "");
    expect(nextMinute.headers.get("Siljang-Outcome")).toBe("unsupported_message");
    expectSchema("SkillTemplateResponse", await nextMinute.json());
  });
});
