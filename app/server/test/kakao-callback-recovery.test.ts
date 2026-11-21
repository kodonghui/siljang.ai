import { afterAll, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { type DbConnector, pgConnector, type Queryable } from "../src/db";
import { fieldCrypto } from "../src/field-crypto";
import type { KakaoCallbackJob, KakaoCallbackQueue } from "../src/kakao-callback-store";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { readSettings, Secret } from "../src/settings";
import { expectSchema } from "./support/contract";
import { describeDb, newUuid, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { newFieldKey } from "./support/field-keys";
import { createShop, issueTestBookingLink, linkTestChannel } from "./support/shops";

const NOW = new Date("2026-11-22T12:00:00+09:00");
const CALLBACK = "https://bot-api.kakao.com/v1/callback/synthetic_recovery";

describeDb("카카오 수신과 콜백 봉투 저장 실패의 재개(TASK-028)", () => {
  const db = testDb();
  afterAll(async () => {
    await db.close();
  });

  it.each(["seal", "store"] as const)("%s 실패는 수신도 롤백하고 같은 요청으로 한 번 복구함", async (failure) => {
    const shop = await createShop(db, "콜백 저장 재개 시험 가게");
    await issueTestBookingLink(db, shop);
    await linkTestChannel(db, shop.channelId);
    const key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
    const env = testEnv({ FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: newFieldKey() });
    const fieldKeys = readSettings(env).fieldKeys;
    if (fieldKeys === null) throw new Error("시험 암호화 키 없음");
    const fields = fieldCrypto(fieldKeys);
    let fail = true;
    const wrap =
      (query: Queryable["query"]): Queryable["query"] =>
      async (sql, params) => {
        if (fail && failure === "store" && /UPDATE messages SET kakao_callback_enc = \$3/.test(sql))
          throw new Error("합성 콜백 봉투 저장 실패");
        return query(sql, params);
      };
    const connect: DbConnector = (dsn) => {
      const conn = pgConnector(dsn);
      return {
        query: wrap(conn.query.bind(conn)),
        abort: conn.abort.bind(conn),
        close: conn.close.bind(conn),
        transaction: (work) => conn.transaction((tx) => work({ query: wrap(tx.query.bind(tx)) })),
      };
    };
    const jobs: KakaoCallbackJob[] = [];
    const committed: number[] = [];
    const send = vi.fn<KakaoCallbackQueue["send"]>(async (job) => {
      jobs.push(job);
      committed.push(
        (
          await db.query("SELECT id FROM messages WHERE shop_id = $1 AND id = $2 AND kakao_callback_enc IS NOT NULL", [
            job.shopId,
            job.messageId,
          ])
        ).rowCount,
      );
    });
    const app = createApp({
      connect,
      logSink: () => {},
      services: {
        now: () => NOW,
        kakaoCallbackQueue: { send },
        fieldCrypto: {
          ...fields,
          seal: async (text, context) => {
            if (fail && failure === "seal") throw new Error("합성 콜백 봉투 암호화 실패");
            return fields.seal(text, context);
          },
        },
      },
    });
    const user = newUuid();
    const call = () =>
      app.request(
        "/api/kakao/skills/message",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
          body: JSON.stringify({
            bot: { id: shop.botId },
            userRequest: {
              utterance: "합성 재개 질문",
              callbackUrl: CALLBACK,
              block: { id: "recovery" },
              user: { id: user, type: "botUserKey" },
            },
            action: { id: "recovery", params: {} },
          }),
        },
        env,
      );
    const first = await call();
    expect(first.status).toBe(200);
    expect(first.headers.get("Siljang-Outcome")).toBe("server_error");
    expectSchema("SkillTemplateResponse", await first.json());
    expect(send).not.toHaveBeenCalled();
    expect(
      (await db.query("SELECT id FROM customers WHERE shop_id = $1 AND kakao_user_key = $2", [shop.shopId, user]))
        .rowCount,
    ).toBe(0);
    expect(
      (
        await db.query(
          `SELECT c.id FROM consultations c JOIN customers u ON u.id = c.customer_id
      WHERE c.shop_id = $1 AND u.kakao_user_key = $2`,
          [shop.shopId, user],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await db.query(
          `SELECT m.id FROM messages m JOIN consultations c ON c.id = m.consultation_id
      JOIN customers u ON u.id = c.customer_id WHERE m.shop_id = $1 AND u.kakao_user_key = $2`,
          [shop.shopId, user],
        )
      ).rowCount,
    ).toBe(0);

    fail = false;
    const recovered = await call();
    expect(recovered.headers.get("Siljang-Outcome")).toBe("callback_pending");
    expectSchema("SkillCallbackAck", await recovered.json());
    expect(send).toHaveBeenCalledTimes(1);
    expect(committed).toEqual([1]);
    const job = jobs[0] as KakaoCallbackJob;
    const rows = (
      await db.query(
        `SELECT m.id, m.kakao_callback_enc FROM messages m
      JOIN consultations c ON c.id = m.consultation_id JOIN customers u ON u.id = c.customer_id
      WHERE m.shop_id = $1 AND u.kakao_user_key = $2`,
        [shop.shopId, user],
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(job.messageId);
    expect(rows[0]?.kakao_callback_enc).toMatch(/^v1:/);
    const duplicate = await call();
    expect(duplicate.headers.get("Siljang-Outcome")).toBe("duplicate");
    expect(await duplicate.json()).toEqual({ version: "2.0", template: { outputs: [] } });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
