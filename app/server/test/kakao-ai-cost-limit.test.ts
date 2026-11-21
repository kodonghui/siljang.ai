import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { describeDb, newUuid, TEST_HASH_KEY, testEnv } from "./support/db";
import { newFieldKey } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-22T10:00:00+09:00");

describeDb("카카오 수신의 상담/가게 AI 비용 한도(TASK-028)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>;
  let shop: ShopFixture;
  let key: string;
  const env = testEnv({ FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: newFieldKey() });
  const sendJob = vi.fn(async () => {});

  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30_000);
  beforeEach(async () => {
    shop = await createShop(isolated.db, "AI 비용 한도 시험 가게");
    await issueTestBookingLink(isolated.db, shop);
    await linkTestChannel(isolated.db, shop.channelId);
    key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
    sendJob.mockClear();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("합성 비용 시험의 외부 호출 금지"));
  });
  afterEach(() => {
    expect(globalThis.fetch).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await isolated?.close();
  });

  async function cost(target: ShopFixture, consultationId: string, amount: string, at = NOW) {
    await isolated.db.query(
      `INSERT INTO ai_calls (shop_id, consultation_id, trace_id, provider, model, prompt_version,
        sent_at, cost_krw, result) VALUES ($1, $2, $3, 'synthetic', 'synthetic', 'synthetic', $4, $5, 'failure')`,
      [target.shopId, consultationId, newUuid(), at, amount],
    );
  }

  async function otherConsultation(target = shop) {
    const customerId = newUuid();
    const consultationId = newUuid();
    await isolated.db.query(
      "INSERT INTO customers (id, shop_id, kakao_channel_id, kakao_user_key) VALUES ($1, $2, $3, $4)",
      [customerId, target.shopId, target.channelId, newUuid()],
    );
    await isolated.db.query(
      "INSERT INTO consultations (id, shop_id, customer_id, status) VALUES ($1, $2, $3, 'open')",
      [consultationId, target.shopId, customerId],
    );
    return consultationId;
  }

  async function send(utterance = "합성 비용 한도 질문", now = NOW) {
    return createApp({
      connect: () => isolated.connect(),
      logSink: () => {},
      services: {
        now: () => now,
        kakaoCallbackQueue: { send: sendJob },
      },
    }).request(
      "/api/kakao/skills/message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
        body: JSON.stringify({
          bot: { id: shop.botId },
          userRequest: {
            utterance,
            callbackUrl: "https://bot-api.kakao.com/v1/callback/synthetic_cost_limit",
            block: { id: "cost" },
            user: { id: shop.userKey, type: "botUserKey" },
          },
          action: { id: "cost", params: {} },
        }),
      },
      env,
    );
  }

  async function handedOff() {
    return (
      await isolated.db.query(
        `SELECT h.reason, c.status, t.wait_status, a.status AS alert_status, a.sent_at
       FROM handoffs h JOIN consultations c ON c.id = h.consultation_id
       JOIN owner_tasks t ON t.handoff_id = h.id JOIN owner_alerts a ON a.owner_task_id = t.id
       WHERE h.shop_id = $1`,
        [shop.shopId],
      )
    ).rows;
  }

  async function expectBlocked() {
    const before = (
      await isolated.db.query("SELECT count(*)::int AS n FROM ai_calls WHERE shop_id = $1", [shop.shopId])
    ).rows;
    const response = await send();
    expect(response.status).toBe(200);
    expect(response.headers.get("Siljang-Outcome")).toBe("ai_cost_limit_reached");
    expect(sendJob).not.toHaveBeenCalled();
    expect(await handedOff()).toEqual([
      {
        reason: "ai_cost_limit",
        status: "awaiting_owner",
        wait_status: "waiting",
        alert_status: "pending",
        sent_at: null,
      },
    ]);
    expect(
      (await isolated.db.query("SELECT count(*)::int AS n FROM ai_calls WHERE shop_id = $1", [shop.shopId])).rows,
    ).toEqual(before);
  }

  it("날짜가 달라도 상담 합계999.99원+0.01원부터 AI/큐 없이 사장님께 넘김", async () => {
    await cost(shop, shop.consultationId, "999.99", new Date("2026-11-10T00:00:00Z"));
    await cost(shop, shop.consultationId, "0.01");
    await expectBlocked();
  });

  it("상담999.99원까지는 기존 콜백 처리로 넘김", async () => {
    await cost(shop, shop.consultationId, "999.99");
    expect((await send()).headers.get("Siljang-Outcome")).toBe("callback_pending");
    expect(sendJob).toHaveBeenCalledOnce();
    expect(await handedOff()).toEqual([]);
  });

  it("다른 상담의 비용도 가게 하루 합계5,000원에 포함함", async () => {
    await cost(shop, await otherConsultation(), "5000.00");
    await expectBlocked();
  });

  it.each([
    ["2026-11-21T14:59:59.999Z", "callback_pending"],
    ["2026-11-21T15:00:00.000Z", "ai_cost_limit_reached"],
  ])("가게 날짜의 자정 경계 %s → %s", async (at, expected) => {
    await cost(shop, await otherConsultation(), "5000.00", new Date(at));
    expect((await send()).headers.get("Siljang-Outcome")).toBe(expected);
    expect(sendJob).toHaveBeenCalledTimes(expected === "callback_pending" ? 1 : 0);
  });

  it("서머타임이 끝나는25시간 날짜도 가게의 같은 날 비용을 합함", async () => {
    await isolated.db.query("UPDATE shops SET time_zone = 'America/New_York' WHERE id = $1", [shop.shopId]);
    await cost(shop, await otherConsultation(), "5000.00", new Date("2026-11-01T04:30:00Z"));
    const response = await send("합성 서머타임 질문", new Date("2026-11-02T04:30:00Z"));
    expect(response.headers.get("Siljang-Outcome")).toBe("ai_cost_limit_reached");
    expect(sendJob).not.toHaveBeenCalled();
  });

  it("다른 가게의 비용과 다른 상담의 지난 날짜 비용은 현재 상담을 막지 않음", async () => {
    const other = await createShop(isolated.db, "다른 가게 비용");
    await cost(other, other.consultationId, "10000.00");
    await cost(shop, await otherConsultation(), "1000.00", new Date("2026-11-10T00:00:00Z"));
    expect((await send()).headers.get("Siljang-Outcome")).toBe("callback_pending");
    expect(sendJob).toHaveBeenCalledOnce();
  });

  it("가게 한도0원이면 비용0원부터 막음", async () => {
    await isolated.db.query("UPDATE shops SET daily_ai_cost_limit_krw = 0 WHERE id = $1", [shop.shopId]);
    await expectBlocked();
  });

  it("한도 뒤의 같은 요청3번은 질문/할 일/대기 알림과 답을 한 번만 남김", async () => {
    await cost(shop, shop.consultationId, "1000.00");
    await expectBlocked();
    for (let i = 0; i < 2; i++) {
      const duplicate = await send();
      expect(duplicate.headers.get("Siljang-Outcome")).toBe("duplicate");
      expect(await duplicate.json()).toEqual({ version: "2.0", template: { outputs: [] } });
    }
    expect(await handedOff()).toHaveLength(1);
    expect(
      (await isolated.db.query("SELECT id FROM messages WHERE shop_id = $1 AND direction = 'outbound'", [shop.shopId]))
        .rowCount,
    ).toBe(1);
    expect(sendJob).not.toHaveBeenCalled();
  });
});
