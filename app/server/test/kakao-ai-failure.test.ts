import { afterAll, expect, it, vi } from "vitest";
import type { AiModel } from "../src/ai-model";
import { createApp } from "../src/app";
import { type DbConnector, pgConnector } from "../src/db";
import { replyWithKakaoHandoff } from "../src/kakao-handoff";
import { KAKAO_HANDOFF_TEXT } from "../src/kakao-reply";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import type { ServiceOverrides } from "../src/services";
import { Secret } from "../src/settings";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { expectSchema } from "./support/contract";
import { collectLogs, describeDb, newUuid, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { createShop, issueTestBookingLink, linkTestChannel } from "./support/shops";

const NOW = new Date("2026-11-22T10:00:00+09:00");

describeDb("콜백 없는 카카오 요청의 실제 AI 미준비 처리(TASK-028)", () => {
  const db = testDb();
  afterAll(async () => {
    await db.close();
  });

  async function setup(services: ServiceOverrides = {}, extraEnv: Record<string, string> = {}, connect?: DbConnector) {
    const shop = await createShop(db, "AI 실패 안내 시험 가게");
    await issueTestBookingLink(db, shop);
    await linkTestChannel(db, shop.channelId);
    await db.query(
      `INSERT INTO business_calendars (shop_id, daily_capacity, order_cutoff_days, order_cutoff_time)
      VALUES ($1, 10, 2, '18:00') ON CONFLICT (shop_id) DO NOTHING`,
      [shop.shopId],
    );
    const key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
    const logs = collectLogs();
    const app = createApp({
      ...(connect === undefined ? {} : { connect }),
      services: { now: () => NOW, ...services },
      logSink: logs.sink,
    });
    const user = newUuid();
    const send = (skillKey = key, callbackUrl?: string) =>
      app.request(
        "/api/kakao/skills/message",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Siljang-Skill-Key": skillKey },
          body: JSON.stringify({
            bot: { id: shop.botId },
            userRequest: {
              utterance: "합성 AI 실패 질문",
              ...(callbackUrl === undefined ? {} : { callbackUrl }),
              block: { id: "failure" },
              user: { id: user, type: "botUserKey" },
            },
            action: { id: "failure", params: {} },
          }),
        },
        testEnv(extraEnv),
      );
    const records = () =>
      db.query(
        `SELECT h.reason, c.status, t.wait_status, a.status AS alert_status, a.sent_at AS alerted_at,
        m.delivery, m.body_masked FROM handoffs h
       JOIN consultations c ON c.id = h.consultation_id JOIN customers u ON u.id = c.customer_id
       JOIN owner_tasks t ON t.handoff_id = h.id JOIN owner_alerts a ON a.owner_task_id = t.id
       JOIN messages m ON m.consultation_id = c.id AND m.direction = 'outbound'
       WHERE h.shop_id = $1 AND u.kakao_user_key = $2`,
        [shop.shopId, user],
      );
    return { shop, user, send, records, logs, key };
  }

  async function seed(h: Awaited<ReturnType<typeof setup>>) {
    const customerId = newUuid();
    const consultationId = newUuid();
    const messageId = newUuid();
    await db.query("INSERT INTO customers (id, shop_id, kakao_channel_id, kakao_user_key) VALUES ($1, $2, $3, $4)", [
      customerId,
      h.shop.shopId,
      h.shop.channelId,
      h.user,
    ]);
    await db.query("INSERT INTO consultations (id, shop_id, customer_id) VALUES ($1, $2, $3)", [
      consultationId,
      h.shop.shopId,
      customerId,
    ]);
    await db.query(
      `INSERT INTO messages (id, shop_id, consultation_id, direction, author, kind, kakao_message_id)
      VALUES ($1, $2, $3, 'inbound', 'customer', 'text', $4)`,
      [messageId, h.shop.shopId, consultationId, `synthetic-${newUuid()}`],
    );
    return { kind: "received", customerId, consultationId, messageId, limit: "ok" } as const;
  }

  it("AI 설정/키가 없으면 ai_key_missing과 사장님 확인 안내/할 일을 남김", async () => {
    const h = await setup();
    const response = await h.send();
    expect(response.status).toBe(200);
    expect(response.headers.get("Siljang-Outcome")).toBe("ai_key_missing");
    const body = await response.json();
    expectSchema("SkillTemplateResponse", body);
    expect(body).toEqual({ version: "2.0", template: { outputs: [{ simpleText: { text: KAKAO_HANDOFF_TEXT } }] } });
    expect((await h.records()).rows).toEqual([
      {
        reason: "ai_failure",
        status: "awaiting_owner",
        wait_status: "waiting",
        alert_status: "pending",
        alerted_at: null,
        delivery: "skill_response",
        body_masked: KAKAO_HANDOFF_TEXT,
      },
    ]);
    expect(h.logs.lines.join("\n")).not.toContain("합성 AI 실패 질문");
  });

  it("모델이 있어도 업무 처리기가 미준비면 호출 없이 ai_unavailable로 질문을 넘김", async () => {
    const call = vi.fn<AiModel["call"]>();
    const h = await setup({ aiModel: { provider: "anthropic", model: "synthetic-model", call } });
    const response = await h.send();
    expect(response.status).toBe(200);
    expect(response.headers.get("Siljang-Outcome")).toBe("ai_unavailable");
    expectSchema("SkillTemplateResponse", await response.json());
    expect((await h.records()).rows).toHaveLength(1);
    expect(call).not.toHaveBeenCalled();
  });

  it.each([
    { provider: "anthropic", model: "claude-sonnet-5-5", otherKey: "OPENAI_API_KEY" },
    { provider: "openai", model: "gpt-6.1-terra", otherKey: "ANTHROPIC_API_KEY" },
  ])("$provider의 모델 설정이 있어도 선택 회사 키가 없으면 ai_key_missing임", async ({ provider, model, otherKey }) => {
    const h = await setup(
      {},
      {
        AI_PROVIDER: provider,
        AI_MODEL: model,
        AI_USD_KRW: "1450.00",
        AI_USD_KRW_DATE: "2026-11-14",
        [otherKey]: ["synthetic", "unselected", "company"].join("-"),
      },
    );
    expect((await h.send()).headers.get("Siljang-Outcome")).toBe("ai_key_missing");
    expect((await h.records()).rows).toHaveLength(1);
    expect((await db.query("SELECT id FROM ai_calls WHERE shop_id = $1", [h.shop.shopId])).rowCount).toBe(0);
  });

  it("같은 요청이 동시에 세 번 와도 실패 안내·질문 참조·할 일은 한 번임", async () => {
    const h = await setup();
    const responses = await Promise.all([h.send(), h.send(), h.send()]);
    expect(responses.map((r) => r.headers.get("Siljang-Outcome")).sort()).toEqual([
      "ai_key_missing",
      "duplicate",
      "duplicate",
    ]);
    expect((await h.records()).rows).toHaveLength(1);
    for (const response of responses.filter((r) => r.headers.get("Siljang-Outcome") === "duplicate"))
      expect(await response.json()).toEqual({ version: "2.0", template: { outputs: [] } });
  });

  it("다른 가게 연결 키의 요청은 실패 질문/할 일을 만들기 전에 거절함", async () => {
    const a = await setup();
    const b = await setup();
    expect((await a.send(b.key)).status).toBe(401);
    expect((await a.records()).rows).toEqual([]);
    expect((await b.records()).rows).toEqual([]);
    expect(
      (await db.query("SELECT id FROM customers WHERE shop_id = $1 AND kakao_user_key = $2", [a.shop.shopId, a.user]))
        .rowCount,
    ).toBe(0);
  });

  it("이전 미전달 안내를 AI 실패 안내보다 먼저 보이고 한 번만 전달 표시함", async () => {
    const h = await setup();
    const receipt = await seed(h);
    const previousId = newUuid();
    await db.query(
      `INSERT INTO messages (id, shop_id, consultation_id, direction, author, kind, body_masked, delivery)
      VALUES ($1, $2, $3, 'outbound', 'system', 'text', '이전 합성 안내', 'deferred')`,
      [previousId, h.shop.shopId, receipt.consultationId],
    );
    const response = await h.send();
    expect(response.headers.get("Siljang-Outcome")).toBe("ai_key_missing");
    expect(await response.json()).toEqual({
      version: "2.0",
      template: { outputs: [{ simpleText: { text: "이전 합성 안내" } }, { simpleText: { text: KAKAO_HANDOFF_TEXT } }] },
    });
    expect((await db.query("SELECT delivery, sent_at FROM messages WHERE id = $1", [previousId])).rows).toEqual([
      { delivery: "delivered_later", sent_at: NOW },
    ]);
  });

  it("후속 기록 트랜잭션에서 응답 생성이 실패하면 할 일/안내/상태가 함께 롤백됨", async () => {
    const h = await setup();
    const receipt = await seed(h);
    const scoped = shopRequestDb(createShopScope(h.shop.shopId, { kind: "customer", channelId: h.shop.channelId }), db);
    await expect(
      replyWithKakaoHandoff(scoped, receipt, NOW, () => {
        throw new Error("합성 응답 생성 실패");
      }),
    ).rejects.toThrow("합성 응답 생성 실패");
    expect(
      (
        await db.query("SELECT id FROM handoffs WHERE shop_id = $1 AND consultation_id = $2", [
          h.shop.shopId,
          receipt.consultationId,
        ])
      ).rowCount,
    ).toBe(0);
    expect((await db.query("SELECT status FROM consultations WHERE id = $1", [receipt.consultationId])).rows).toEqual([
      { status: "open" },
    ]);
    expect(
      (
        await db.query("SELECT id FROM messages WHERE consultation_id = $1 AND direction = 'outbound'", [
          receipt.consultationId,
        ])
      ).rowCount,
    ).toBe(0);
    await replyWithKakaoHandoff(scoped, receipt, NOW, () =>
      Response.json({ version: "2.0", template: { outputs: [] } }),
    );
    expect((await h.records()).rows).toHaveLength(1);
  });

  it.each([
    { name: "큐 없음", queueEnabled: false, callbackUrl: undefined },
    { name: "큐는 있고 콜백 없음", queueEnabled: true, callbackUrl: undefined },
    { name: "허용하지 않은 콜백", queueEnabled: true, callbackUrl: "https://example.invalid/v1/callback/synthetic" },
    {
      name: "유효 콜백은 있고 큐 없음",
      queueEnabled: false,
      callbackUrl: "https://bot-api.kakao.com/v1/callback/synthetic_atomic",
    },
  ])("$name: 저장 실패 뒤 같은 요청으로 안내/할 일을 한 번만 복구함", async ({ queueEnabled, callbackUrl }) => {
    let failing = true;
    const connect: DbConnector = (secret) => {
      const conn = pgConnector(secret);
      return {
        query: conn.query.bind(conn),
        abort: conn.abort.bind(conn),
        close: conn.close.bind(conn),
        transaction: (work) =>
          conn.transaction((tx) =>
            work({
              query: (sql, params) => {
                if (failing && /INSERT INTO owner_alerts/.test(sql)) throw new Error("합성 첫 저장 실패");
                return tx.query(sql, params);
              },
            }),
          ),
      };
    };
    const publish = vi.fn(async () => {});
    const h = await setup(queueEnabled ? { kakaoCallbackQueue: { send: publish } } : {}, {}, connect);
    const failed = await h.send(h.key, callbackUrl);
    expect(failed.headers.get("Siljang-Outcome")).toBe("server_error");
    expect(
      (await db.query("SELECT id FROM customers WHERE shop_id = $1 AND kakao_user_key = $2", [h.shop.shopId, h.user]))
        .rowCount,
    ).toBe(0);
    expect((await h.records()).rows).toEqual([]);
    failing = false;
    expect((await h.send(h.key, callbackUrl)).headers.get("Siljang-Outcome")).toBe("ai_key_missing");
    expect((await h.records()).rows).toHaveLength(1);
    const duplicate = await h.send(h.key, callbackUrl);
    expect(duplicate.headers.get("Siljang-Outcome")).toBe("duplicate");
    expect(await duplicate.json()).toEqual({ version: "2.0", template: { outputs: [] } });
    expect((await h.records()).rows).toHaveLength(1);
    expect((await db.query("SELECT id FROM ai_calls WHERE shop_id = $1", [h.shop.shopId])).rowCount).toBe(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it("실패 안내의 저장 예외는 내부 내용 없는 200/server_error로 처리함", async () => {
    const detail = "synthetic-private-alert-storage-error";
    const connect: DbConnector = (secret) => {
      const conn = pgConnector(secret);
      return {
        query: conn.query.bind(conn),
        abort: conn.abort.bind(conn),
        close: conn.close.bind(conn),
        transaction: (work) =>
          conn.transaction((tx) =>
            work({
              query: (sql, params) => {
                if (/INSERT INTO owner_alerts/.test(sql)) throw new Error(detail);
                return tx.query(sql, params);
              },
            }),
          ),
      };
    };
    const h = await setup({}, {}, connect);
    const response = await h.send();
    expect(response.status).toBe(200);
    expect(response.headers.get("Siljang-Outcome")).toBe("server_error");
    const text = await response.text();
    expectSchema("SkillTemplateResponse", JSON.parse(text));
    expect(text).not.toContain(detail);
    expect(h.logs.lines.join("\n")).not.toContain(detail);
    expect(h.logs.lines.join("\n")).toContain("kakao_skill_failed");
    expect((await h.records()).rows).toEqual([]);
  });
});
