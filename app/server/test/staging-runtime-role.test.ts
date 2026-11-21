import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Queryable, RequestDb } from "../src/db";
import { consumeKakaoCallback } from "../src/kakao-callback-queue";
import { receiveKakaoMessage } from "../src/kakao-skill-store";
import { createOwnerSession, endOwnerSession, ownerProfile, renewOwnerSession } from "../src/owner-session";
import { Secret } from "../src/settings";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { describeDb, newUuid, TEST_HASH_KEY, testDb } from "./support/db";
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
