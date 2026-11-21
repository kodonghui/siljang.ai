import { afterAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { expectSchema } from "./support/contract";
import { collectLogs, describeDb, newUuid, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-21T12:00:00Z");
const OLD_TEXT = "앞서 전하지 못한 합성 안내";

async function template(response: Response) {
  const body = await response.json();
  expectSchema("SkillTemplateResponse", body);
  return body as { template: { outputs: { simpleText?: { text: string } }[] } };
}

describeDb("카카오 콜백에서 전하지 못한 답의 다음 대화 전달(TASK-028, G4)", () => {
  const db = testDb();
  afterAll(async () => {
    await db.close();
  });

  async function setup() {
    const shop = await createShop(db, "미전달 답 시험 가게");
    await issueTestBookingLink(db, shop);
    await linkTestChannel(db, shop.channelId);
    const key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
    const logs = collectLogs();
    const app = createApp({ services: { now: () => NOW }, logSink: logs.sink });
    const call = (utterance: string) =>
      app.request(
        "/api/kakao/skills/message",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
          body: JSON.stringify({
            bot: { id: shop.botId },
            userRequest: { utterance, block: { id: "conversation" }, user: { id: shop.userKey, type: "botUserKey" } },
            action: { id: "synthetic-action", params: {} },
          }),
        },
        testEnv(),
      );
    return { shop, call, logs };
  }

  async function defer(shop: ShopFixture, text = OLD_TEXT) {
    const id = newUuid();
    await db.query(
      `INSERT INTO messages (id, shop_id, consultation_id, direction, author, kind, body_masked, delivery, created_at)
      VALUES ($1, $2, $3, 'outbound', 'system', 'text', $4, 'deferred', $5)`,
      [id, shop.shopId, shop.consultationId, text, new Date(NOW.getTime() - 60_000)],
    );
    return id;
  }

  it("전하지 못한 자기 답을 새 응답보다 먼저 보이고 전달 시각을 한 번 남김", async () => {
    const h = await setup();
    const other = await setup();
    const id = await defer(h.shop);
    const otherId = await defer(other.shop, "다른 가게의 합성 안내");
    const response = await h.call("다음 질문");
    expect(response.status).toBe(200);
    const body = await template(response);
    expect(body.template.outputs[0]).toEqual({ simpleText: { text: OLD_TEXT } });
    expect(JSON.stringify(body)).not.toContain("다른 가게의 합성 안내");
    const saved = await db.query<{ delivery: string; sent_at: Date | null }>(
      "SELECT delivery, sent_at FROM messages WHERE id=$1",
      [id],
    );
    expect(saved.rows).toEqual([{ delivery: "delivered_later", sent_at: NOW }]);
    const untouched = await db.query<{ delivery: string }>("SELECT delivery FROM messages WHERE id=$1", [otherId]);
    expect(untouched.rows).toEqual([{ delivery: "deferred" }]);
    expect(h.logs.lines.join("\n")).not.toContain(OLD_TEXT);
  });

  it("같은 손님의 서로 다른 동시 요청에서도 이전 답은 한 번만 전함", async () => {
    const h = await setup();
    await defer(h.shop);
    const responses = await Promise.all([h.call("다음 질문 가"), h.call("다음 질문 나")]);
    const bodies = await Promise.all(responses.map(template));
    expect(bodies.flatMap((b) => b.template.outputs).filter((o) => o.simpleText?.text === OLD_TEXT)).toHaveLength(1);
  });
});
