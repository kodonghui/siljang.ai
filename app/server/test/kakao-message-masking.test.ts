import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { type Bindings, createApp } from "../src/app";
import { type DbConnector, type RequestDb, TransactionMisuseError } from "../src/db";
import { type FieldCrypto, FieldCryptoError } from "../src/field-crypto";
import type { KakaoCallbackJob } from "../src/kakao-callback-store";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { createShopScope, shopRequestDb, withShopSavepoint } from "../src/shop-scope";
import { collectLogs, describeDb, newUuid, TEST_HASH_KEY, testEnv } from "./support/db";
import { newFieldKey, testFieldCrypto } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-22T10:00:00+09:00");
const FIELD = newFieldKey();
const ENV = testEnv({ FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: FIELD });
const FIELDS = testFieldCrypto(new Map([[1, FIELD]]), 1);

describeDb("실제 카카오 수신의 마스킹 본문과 실패 처리(TASK-028)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>;
  let shop: ShopFixture;
  let key: string;
  let jobs: KakaoCallbackJob[];
  let publishedBody: string | null | undefined;
  let logs: ReturnType<typeof collectLogs>;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30_000);
  beforeEach(async () => {
    shop = await createShop(isolated.db, "수신 본문 마스킹");
    await issueTestBookingLink(isolated.db, shop);
    await linkTestChannel(isolated.db, shop.channelId);
    key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
    jobs = [];
    publishedBody = undefined;
    logs = collectLogs();
  });
  afterAll(async () => {
    await isolated?.close();
  });

  async function send(
    utterance: string,
    options: {
      callback?: boolean;
      env?: Bindings;
      fieldCrypto?: FieldCrypto;
      connect?: DbConnector;
      userId?: string;
    } = {},
  ) {
    const app = createApp({
      connect: options.connect ?? (() => isolated.connect()),
      logSink: logs.sink,
      services: {
        now: () => NOW,
        ...(options.fieldCrypto === undefined ? {} : { fieldCrypto: options.fieldCrypto }),
        kakaoCallbackQueue: {
          send: async (job) => {
            jobs.push(job);
            publishedBody = (
              await isolated.db.query<{ body_masked: string | null }>(
                "SELECT body_masked FROM messages WHERE shop_id = $1 AND id = $2",
                [job.shopId, job.messageId],
              )
            ).rows[0]?.body_masked;
          },
        },
      },
    });
    return app.request(
      "/api/kakao/skills/message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
        body: JSON.stringify({
          bot: { id: shop.botId },
          userRequest: {
            utterance,
            ...(options.callback === false
              ? {}
              : { callbackUrl: "https://bot-api.kakao.com/v1/callback/synthetic_masking" }),
            block: { id: "masking" },
            user: { id: options.userId ?? shop.userKey, type: "botUserKey" },
          },
          action: { id: "masking", params: {} },
        }),
      },
      options.env ?? ENV,
    );
  }

  async function incoming() {
    return (
      await isolated.db.query<{ body_masked: string | null }>(
        "SELECT body_masked FROM messages WHERE shop_id = $1 AND direction = 'inbound' AND id <> $2",
        [shop.shopId, shop.messageId],
      )
    ).rows;
  }
  async function values() {
    return (
      await isolated.db.query("SELECT kind, original_enc, value_hmac, last4 FROM masked_values WHERE shop_id = $1", [
        shop.shopId,
      ])
    ).rows;
  }
  async function failures() {
    return (
      await isolated.db.query(
        `SELECT h.reason, t.wait_status, a.status, a.sent_at FROM handoffs h
      JOIN owner_tasks t ON t.handoff_id = h.id JOIN owner_alerts a ON a.owner_task_id = t.id WHERE h.shop_id = $1`,
        [shop.shopId],
      )
    ).rows;
  }

  it("전화/카드/긴 숫자를 가린 본문과 번호 정보가 큐 발행 전에 커밋됨", async () => {
    const response = await send("주문 K7Q3M9, 연락 공일공-1234-5678, 카드 4111 1111 1111 1111, 900101-1234567");
    expect(response.headers.get("Siljang-Outcome")).toBe("callback_pending");
    const body = "주문 K7Q3M9, 연락 [전화번호1], 카드 [카드번호1], [긴숫자1]";
    expect(await incoming()).toEqual([{ body_masked: body }]);
    expect(publishedBody).toBe(body);
    expect(jobs).toHaveLength(1);
    const saved = await values();
    expect(saved).toHaveLength(3);
    expect(saved.find((row) => row.kind === "phone")?.original_enc).toMatch(/^v1:/);
    expect(saved.find((row) => row.kind === "card")).toMatchObject({
      original_enc: null,
      value_hmac: null,
      last4: "1111",
    });
    expect(saved.find((row) => row.kind === "long_number")).toMatchObject({
      original_enc: null,
      value_hmac: null,
      last4: null,
    });
    expect(logs.lines.join("\n")).not.toMatch(/010-1234-5678|4111111111111111|9001011234567/);
  });

  it("같은 요청3번은 본문/전화/카드/큐를 한 번만 만듦", async () => {
    const text = "전화 010-1234-5678, 카드 4111-1111-1111-1111";
    expect((await send(text)).headers.get("Siljang-Outcome")).toBe("callback_pending");
    for (let i = 0; i < 2; i++) {
      const response = await send(text);
      expect(response.headers.get("Siljang-Outcome")).toBe("duplicate");
      expect(await response.json()).toEqual({ version: "2.0", template: { outputs: [] } });
    }
    expect(await incoming()).toHaveLength(1);
    expect(await values()).toHaveLength(2);
    expect(jobs).toHaveLength(1);
  });

  async function expectMaskingFailure(response: Response) {
    expect(response.status).toBe(200);
    expect(response.headers.get("Siljang-Outcome")).toBe("masking_failed");
    expect(await incoming()).toEqual([{ body_masked: "[보관하지 못한 메시지]" }]);
    expect(await values()).toEqual([]);
    expect(await failures()).toEqual([
      { reason: "masking_failed", wait_status: "waiting", status: "pending", sent_at: null },
    ]);
    expect(jobs).toHaveLength(0);
    expect((await isolated.db.query("SELECT id FROM ai_calls WHERE shop_id = $1", [shop.shopId])).rowCount).toBe(0);
    expect(logs.lines.join("\n")).not.toMatch(/010-1234-5678|010-8765-4321|division by zero/);
  }

  it("키가 없어 번호를 보관하지 못하면 원문 없이 사장님께 넘기고 AI/큐를 부르지 않음", async () => {
    const text = "전화 010-1234-5678";
    const userId = newUuid();
    await expectMaskingFailure(await send(text, { env: testEnv(), callback: false, userId }));
    expect((await send(text, { env: testEnv(), callback: false, userId })).headers.get("Siljang-Outcome")).toBe(
      "duplicate",
    );
    expect(await failures()).toHaveLength(1);
    expect(
      (
        await isolated.db.query("SELECT id FROM customers WHERE shop_id = $1 AND kakao_user_key = $2", [
          shop.shopId,
          userId,
        ])
      ).rowCount,
    ).toBe(1);
  });

  it("두 번째 암호화 실패는 첫 번호만 되돌리고 수신/실패 기록은 남김", async () => {
    let calls = 0;
    const broken = {
      ...FIELDS,
      seal: async (...args: Parameters<typeof FIELDS.seal>) => {
        calls += 1;
        if (calls === 2) throw new FieldCryptoError("synthetic masking failure");
        return FIELDS.seal(...args);
      },
    };
    await expectMaskingFailure(await send("010-1234-5678, 010-8765-4321", { fieldCrypto: broken }));
    expect(calls).toBe(2);
  });

  it("실제 PostgreSQL 오류도 저장점으로 되돌려 실패 기록을 커밋함", async () => {
    const connect = (): RequestDb => {
      const conn = isolated.connect();
      let inserts = 0;
      return {
        query: conn.query.bind(conn),
        close: conn.close.bind(conn),
        abort: conn.abort.bind(conn),
        transaction: (work) =>
          conn.transaction((tx) =>
            work({
              query: (sql, params) => {
                if (/INSERT INTO masked_values/.test(sql) && ++inserts === 2) return tx.query("SELECT 1/0");
                return tx.query(sql, params);
              },
            }),
          ),
      };
    };
    await expectMaskingFailure(await send("010-1234-5678, 010-8765-4321", { connect }));
    expect(logs.lines.map((line) => JSON.parse(line))).toEqual(
      expect.arrayContaining([expect.objectContaining({ event: "kakao_message_masking_failed", dbCode: "22012" })]),
    );
  });

  it("가릴 번호가 없는 본문은 키가 없어도 저장함", async () => {
    expect(
      (await send("주문번호 K7Q3M9 케이크2개", { callback: false, env: testEnv() })).headers.get("Siljang-Outcome"),
    ).toBe("ai_key_missing");
    expect(await incoming()).toEqual([{ body_masked: "주문번호 K7Q3M9 케이크2개" }]);
    expect(await values()).toEqual([]);
  });

  it("빈도 제한 뒤에도 본문은 가리고 저장하되 AI/큐 없이 한 번 안내 후 침묵함", async () => {
    await isolated.db.query(
      `INSERT INTO messages (shop_id, consultation_id, direction, author, kind, kakao_message_id, created_at)
      SELECT $1, $2, 'inbound', 'customer', 'text', $3 || n::text, $4 FROM generate_series(1,20) AS n`,
      [shop.shopId, shop.consultationId, newUuid(), NOW],
    );
    const first = await send("한도 뒤 연락010-1234-5678");
    expect(first.headers.get("Siljang-Outcome")).toBe("rate_limited");
    expect(((await first.json()) as { template: { outputs: unknown[] } }).template.outputs).toHaveLength(1);
    const next = await send("추가 연락010-1234-5678");
    expect(next.headers.get("Siljang-Outcome")).toBe("rate_limited");
    expect(await next.json()).toEqual({ version: "2.0", template: { outputs: [] } });
    expect((await incoming()).filter((row) => row.body_masked !== null).map((row) => row.body_masked)).toEqual(
      expect.arrayContaining(["한도 뒤 연락[전화번호1]", "추가 연락[전화번호1]"]),
    );
    expect(await values()).toHaveLength(1);
    expect(jobs).toHaveLength(0);
    expect(await failures()).toEqual([]);
  });

  it("요청 트랜잭션 밖에서는 저장점을 열거나 부분 작업을 실행하지 않음", async () => {
    const conn = isolated.connect();
    const db = shopRequestDb(createShopScope(shop.shopId, { kind: "customer", channelId: shop.channelId }), conn);
    let ran = false;
    try {
      await expect(
        withShopSavepoint(db, async () => {
          ran = true;
        }),
      ).rejects.toBeInstanceOf(TransactionMisuseError);
      expect(ran).toBe(false);
    } finally {
      await conn.close();
    }
  });
});
