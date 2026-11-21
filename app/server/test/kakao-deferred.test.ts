import { afterAll, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { consumeKakaoCallback } from "../src/kakao-callback-queue";
import type { KakaoCallbackJob } from "../src/kakao-callback-store";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { expectSchema } from "./support/contract";
import { collectLogs, describeDb, newUuid, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { newFieldKey } from "./support/field-keys";
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
    const clock = { now: NOW };
    const jobs: KakaoCallbackJob[] = [];
    const env = testEnv({ FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: newFieldKey() });
    const app = createApp({
      services: {
        now: () => clock.now,
        kakaoCallbackQueue: {
          send: async (job) => {
            jobs.push(job);
          },
        },
      },
      logSink: logs.sink,
    });
    const call = (utterance: string, callbackUrl?: string) =>
      app.request(
        "/api/kakao/skills/message",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
          body: JSON.stringify({
            bot: { id: shop.botId },
            userRequest: {
              utterance,
              ...(callbackUrl === undefined ? {} : { callbackUrl }),
              block: { id: "conversation" },
              user: { id: shop.userKey, type: "botUserKey" },
            },
            action: { id: "synthetic-action", params: {} },
          }),
        },
        env,
      );
    return { shop, call, logs, clock, jobs, env };
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

  it("다음 답이 콜백이면 이전 미전달 답부터 보내고 성공 뒤에만 전달 표시함", async () => {
    const h = await setup();
    const id = await defer(h.shop);
    const ack = await h.call("콜백으로 다음 질문", "https://bot-api.kakao.com/v1/callback/synthetic_next");
    expect(ack.headers.get("Siljang-Outcome")).toBe("callback_pending");
    expectSchema("SkillCallbackAck", await ack.json());
    const send = vi.fn<typeof fetch>(async () => Response.json({ status: "SUCCESS" }));
    const now = new Date(NOW.getTime() + 5000);
    expect(await consumeKakaoCallback(h.jobs[0], h.env, { now: () => now, fetch: send })).toBe("done");
    const request = send.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body));
    expectSchema("SkillTemplateResponse", body);
    expect(body.template.outputs[0]).toEqual({ simpleText: { text: OLD_TEXT } });
    const saved = await db.query<{ delivery: string; sent_at: Date | null }>(
      "SELECT delivery, sent_at FROM messages WHERE id=$1",
      [id],
    );
    expect(saved.rows).toEqual([{ delivery: "delivered_later", sent_at: now }]);
  });

  it("같은 손님의 다른 콜백도 진행 중인 전달을 기다려 이전 답을 중복 발신하지 않음", async () => {
    const h = await setup();
    await defer(h.shop);
    await h.call("첫 콜백 질문", "https://bot-api.kakao.com/v1/callback/synthetic_first");
    await h.call("다음 콜백 질문", "https://bot-api.kakao.com/v1/callback/synthetic_second");
    let entered: () => void = () => {};
    let release: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith("synthetic_first")) {
        entered();
        await blocked;
      }
      return Response.json({ status: "SUCCESS" });
    });
    const options = { now: () => new Date(NOW.getTime() + 5000), fetch: send };
    const first = consumeKakaoCallback(h.jobs[0], h.env, options);
    try {
      await Promise.race([started, first]);
      expect(send).toHaveBeenCalledTimes(1);
      expect(await consumeKakaoCallback(h.jobs[1], h.env, options)).toBe("retry");
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await first;
    }
    expect(await consumeKakaoCallback(h.jobs[1], h.env, options)).toBe("done");
    const texts = send.mock.calls.flatMap(([, init]) => {
      const body = JSON.parse(String(init?.body));
      return body.template.outputs.map((o: { simpleText: { text: string } }) => o.simpleText.text);
    });
    expect(texts.filter((text) => text === OLD_TEXT)).toHaveLength(1);
  });

  it("같은 손님의 서로 다른 동시 요청에서도 이전 답은 한 번만 전함", async () => {
    const h = await setup();
    await defer(h.shop);
    const responses = await Promise.all([h.call("다음 질문 가"), h.call("다음 질문 나")]);
    const bodies = await Promise.all(responses.map(template));
    expect(bodies.flatMap((b) => b.template.outputs).filter((o) => o.simpleText?.text === OLD_TEXT)).toHaveLength(1);
  });
});
