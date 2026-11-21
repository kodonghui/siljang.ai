import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Queryable, RequestDb } from "../src/db";
import { fieldCrypto } from "../src/field-crypto";
import { kakaoCallback } from "../src/kakao-callback";
import { consumeKakaoCallback } from "../src/kakao-callback-queue";
import { publishStoredKakaoCallback, storeKakaoCallback } from "../src/kakao-callback-store";
import { receiveKakaoMessage } from "../src/kakao-skill-store";
import { createOwnerSession, endOwnerSession, ownerProfile, renewOwnerSession } from "../src/owner-session";
import { runScheduled } from "../src/scheduled";
import { readSettings, Secret } from "../src/settings";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { collectLogs, describeDb, newUuid, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { newFieldKey } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

describeDb("실제 서버 역할의 로그인·콜백 권한(TASK-173)", () => {
  const role = `runtime_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = testDb();
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>> | undefined;
  let created = false;
  let shop: ShopFixture;
  const now = new Date("2026-11-21T00:00:00Z");

  function roleDb(): RequestDb {
    if (isolated === undefined) throw new Error("시험 DB 없음");
    const base = isolated.connect();
    async function transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      return base.transaction(async (tx) => {
        await tx.query(`SET LOCAL ROLE "${role}"`);
        return fn(tx);
      });
    }
    return {
      query: (sql, params) => transaction((tx) => tx.query(sql, params)),
      transaction,
      abort: () => base.abort(),
      close: () => base.close(),
    };
  }

  beforeAll(async () => {
    isolated = await isolatedTestDb();
    await admin.query(`CREATE ROLE "${role}" NOLOGIN NOINHERIT`);
    created = true;
    await isolated.db.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    // 기존 접속기록의 제한을 먼저 만들고 새 권한 파일이 넓히지 않는지 확인한다.
    await isolated.db.query(`GRANT INSERT, DELETE ON access_logs TO "${role}"`);
    await isolated.db.query(`GRANT SELECT (accessed_at) ON access_logs TO "${role}"`);
    // 실제 기존 서버 역할이 가진 운영 기록 조회·추가만 재현한다. 수정·삭제는 허용하지 않는다.
    await isolated.db.query(`GRANT SELECT, INSERT ON ops_events TO "${role}"`);
    const grants = readFileSync(new URL("../../../tools/staging-login-callback-grants.sql", import.meta.url), "utf8");
    await isolated.db.query(grants.replaceAll(':"runtime_role"', `"${role}"`));
    shop = await createShop(isolated.db, "서버 역할 시험 가게");
    await issueTestBookingLink(isolated.db, shop);
    await linkTestChannel(isolated.db, shop.channelId);
  }, 30_000);

  afterAll(async () => {
    try {
      await isolated?.close();
    } finally {
      try {
        if (created) await admin.query(`DROP ROLE "${role}"`);
      } finally {
        await admin.close();
      }
    }
  });

  it("사장님 생성·만료 세션 정리·30일 연장·내 정보·로그아웃을 같은 제한 역할로 실행", async () => {
    const db = roleDb();
    try {
      const accountId = BigInt(`0x${newUuid().replaceAll("-", "").slice(0, 14)}`).toString();
      const session = await createOwnerSession(db, { accountId, friend: false }, now);
      const later = new Date(now.getTime() + 1_000);
      expect(await renewOwnerSession(db, session.token, later)).toBe(session.ownerId);
      expect((await ownerProfile(db, session.ownerId)).profile.owner.ownerId).toBe(session.ownerId);
      await endOwnerSession(db, session.token, later);
      expect(await renewOwnerSession(db, session.token, later)).toBeNull();
    } finally {
      await db.close();
    }
  });

  it("가게·채널 공유 잠금과 손님·상담·수신 메시지 쓰기를 실제 역할로 실행", async () => {
    const conn = roleDb();
    const scope = createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" });
    try {
      const result = await receiveKakaoMessage(
        shopRequestDb(scope, conn),
        {
          scope,
          channelId: shop.channelId,
          status: "linked",
          receivedAt: now,
          requestKeySecret: new Secret(TEST_HASH_KEY),
          payload: {
            botId: shop.botId,
            blockId: "conversation",
            userId: newUuid(),
            utterance: "합성 권한 시험",
            callbackUrl: undefined,
            isFriend: true,
            params: {},
            action: { params: {}, clientExtra: {} },
          },
        },
        "text",
      );
      expect(result.kind).toBe("received");
    } finally {
      await conn.close();
    }
  });

  it("내용 없는 ID 메시지도 콜백의 UPDATE·SELECT·만료 정리 경로를 실행", async () => {
    expect(
      await consumeKakaoCallback(
        { shopId: shop.shopId, messageId: newUuid() },
        { APP_ENV: "development" },
        { connect: () => roleDb(), now: () => now },
      ),
    ).toBe("done");
  });

  it("제한 역할의 기본 Cron이 실행 시각 밖에도 시작 기록을 읽고 쓰기 없이 완료", async () => {
    if (isolated === undefined) throw new Error("시험 DB 없음");
    const before = await isolated.db.query("SELECT count(*)::int AS n FROM ops_events");
    const logs = collectLogs();
    const result = await runScheduled({ scheduledTime: now.getTime(), cron: "* * * * *" }, testEnv(), {
      connect: () => roleDb(),
      logSink: logs.sink,
    });
    expect(result?.dailyStarted).toEqual([]);
    expect(result?.jobs.purge).toEqual({ found: 0, done: 0, skipped: 0, failed: 0 });
    expect(logs.lines.map((line) => JSON.parse(line))).toEqual([
      { level: "info", event: "job_polled", job: "purge" },
      { level: "info", event: "kakao_callback_recovery_polled", count: 0 },
    ]);
    expect((await isolated.db.query("SELECT count(*)::int AS n FROM ops_events")).rows).toEqual(before.rows);
  });

  it("제한 역할로 손님별 선점·이전 답 조회·콜백 성공 뒤 전달 표시까지 실행", async () => {
    const conn = roleDb();
    const scope = createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" });
    const scoped = shopRequestDb(scope, conn);
    const env = { APP_ENV: "development", FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: newFieldKey() };
    const keys = readSettings(env).fieldKeys;
    const callback = kakaoCallback("https://bot-api.kakao.com/v1/callback/synthetic_role", now);
    if (keys === null || callback === null) throw new Error("시험 설정 없음");
    try {
      const received = await receiveKakaoMessage(
        scoped,
        {
          scope,
          channelId: shop.channelId,
          status: "linked",
          receivedAt: now,
          requestKeySecret: new Secret(TEST_HASH_KEY),
          payload: {
            botId: shop.botId,
            blockId: "conversation",
            userId: shop.userKey,
            utterance: "제한 역할 콜백 시험",
            callbackUrl: callback.url.href,
            isFriend: false,
            params: {},
            action: { params: {}, clientExtra: {} },
          },
        },
        "text",
      );
      if (received.kind !== "received") throw new Error("시험 수신 실패");
      const previous = await scoped.run<{ id: string }>(
        `INSERT INTO messages (shop_id, consultation_id, direction, author, kind, body_masked, delivery, created_at)
          VALUES ($1, $2, 'outbound', 'system', 'text', '제한 역할 이전 안내', 'deferred', $3) RETURNING id`,
        [received.consultationId, new Date(now.getTime() - 1000)],
      );
      const envelope = await scoped.transaction((tx) =>
        storeKakaoCallback(tx, fieldCrypto(keys), received.messageId, callback, () => 3000),
      );
      if (envelope === null) throw new Error("시험 콜백 저장 실패");
      expect(
        await publishStoredKakaoCallback(
          scoped,
          { send: async () => {} },
          received,
          envelope,
          () => 3000,
          async () => {
            throw new Error("성공한 큐에서 거절 처리 금지");
          },
        ),
      ).toEqual({ kind: "callback" });
      let text: unknown;
      expect(
        await consumeKakaoCallback({ shopId: shop.shopId, messageId: received.messageId }, env, {
          connect: () => roleDb(),
          now: () => new Date(now.getTime() + 5000),
          fetch: async (_url, init) => {
            text = JSON.parse(String(init?.body));
            return Response.json({ status: "SUCCESS" });
          },
        }),
      ).toBe("done");
      expect(JSON.stringify(text)).toContain("제한 역할 이전 안내");
      expect(
        (
          await scoped.run<{ delivery: string }>("SELECT delivery FROM messages WHERE shop_id=$1 AND id=$2", [
            previous.rows[0]?.id,
          ])
        ).rows,
      ).toEqual([{ delivery: "delivered_later" }]);
    } finally {
      await conn.close();
    }
  });

  it("접속기록 시각 조회만 유지하고 전체 조회·수정·비우기·DDL·사장님 삭제는 거절", async () => {
    const db = roleDb();
    try {
      expect((await db.query("SELECT accessed_at FROM access_logs WHERE false")).rowCount).toBe(0);
      for (const sql of [
        "SELECT * FROM access_logs WHERE false",
        "UPDATE access_logs SET accessed_at = accessed_at WHERE false",
        "TRUNCATE access_logs",
        "CREATE TABLE public.role_should_not_create (id int)",
        "DELETE FROM owners WHERE false",
      ]) {
        await expect(db.query(sql)).rejects.toMatchObject({ code: "42501" });
      }
    } finally {
      await db.close();
    }
  });
});
