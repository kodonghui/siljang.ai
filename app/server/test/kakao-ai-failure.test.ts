import { afterAll, expect, it, vi } from "vitest";
import type { AiModel } from "../src/ai-model";
import { createApp } from "../src/app";
import { KAKAO_HANDOFF_TEXT } from "../src/kakao-reply";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import type { ServiceOverrides } from "../src/services";
import { Secret } from "../src/settings";
import { expectSchema } from "./support/contract";
import { collectLogs, describeDb, newUuid, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { createShop, issueTestBookingLink, linkTestChannel } from "./support/shops";

const NOW = new Date("2026-11-22T10:00:00+09:00");

describeDb("콜백 없는 카카오 요청의 실제 AI 미준비 처리(TASK-028)", () => {
  const db = testDb();
  afterAll(async () => {
    await db.close();
  });

  async function setup(services: ServiceOverrides = {}) {
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
    const app = createApp({ services: { now: () => NOW, ...services }, logSink: logs.sink });
    const user = newUuid();
    const send = () =>
      app.request(
        "/api/kakao/skills/message",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
          body: JSON.stringify({
            bot: { id: shop.botId },
            userRequest: {
              utterance: "합성 AI 실패 질문",
              block: { id: "failure" },
              user: { id: user, type: "botUserKey" },
            },
            action: { id: "failure", params: {} },
          }),
        },
        testEnv(),
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
    return { shop, user, send, records, logs };
  }

  it("AI 설정/키가 없으면 ai_key_missing과 사장님 확인 안내/할 일을 남김", async () => {
    const h = await setup();
    const response = await h.send();
    expect(response.status).toBe(200);
    expect(response.headers.get("Siljang-Outcome")).toBe("ai_key_missing");
    const body = await response.json();
    expectSchema("SkillTemplateResponse", body);
    expect(body.template.outputs).toEqual([{ simpleText: { text: KAKAO_HANDOFF_TEXT } }]);
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
});
