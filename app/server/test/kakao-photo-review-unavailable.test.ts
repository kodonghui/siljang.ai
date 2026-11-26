import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { DbConnector } from "../src/db";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { expectSchema } from "./support/contract";
import { describeDb, newUuid, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, linkTestChannel } from "./support/shops";

const NOW = new Date("2026-11-26T00:00:00Z");
describeDb("사진 후기 접수 불가의 가게 연락처(TASK-148)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>;
  const role = `review148_${newUuid().replaceAll("-", "")}`;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
    await isolated.db.query(`CREATE ROLE "${role}" NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await isolated.db.query(
      readFileSync(new URL("../../../tools/staging-login-callback-grants.sql", import.meta.url), "utf8").replaceAll(
        ':"runtime_role"',
        `"${role}"`,
      ),
    );
  }, 30000);
  afterAll(async () => {
    await isolated?.close();
    const admin = testDb();
    try {
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
    } finally {
      await admin.close();
    }
  });
  it.each(["booking_not_issued", "channel_changed"] as const)(
    "%s에서도 인증한 가게 연락처만 보이고 후기·사진을 저장하지 않는다",
    async (reason) => {
      const shop = await createShop(isolated.db, "합성 후기 접수 가게");
      const other = await createShop(isolated.db, "다른 합성 가게");
      await isolated.db.query("UPDATE shops SET contact_phone=$2 WHERE id=$1", [shop.shopId, "02-000-0148"]);
      await isolated.db.query("UPDATE shops SET contact_phone=$2 WHERE id=$1", [other.shopId, "02-999-9999"]);
      if (reason === "channel_changed") await issueTestBookingLink(isolated.db, shop);
      await linkTestChannel(isolated.db, shop.channelId);
      const key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
      let changed = false;
      const connect: DbConnector = () => {
        const conn = isolated.connect();
        const ready = conn.query(`SET ROLE "${role}"`);
        return {
          query: async <R>(sql: string, params?: readonly unknown[]) => {
            await ready;
            const result = await conn.query<R>(sql, params);
            // 인증 때 읽은 linked 스냅샷 뒤, 사진 수신 트랜잭션이 현재 연결을 다시 확인하게 한다.
            if (reason === "channel_changed" && !changed && /FROM kakao_channels WHERE bot_id/.test(sql)) {
              await isolated.db.query(
                "UPDATE kakao_channels SET status='pending',linked_at=NULL,claim_expires_at=$2 WHERE id=$1",
                [shop.channelId, new Date(NOW.getTime() + 30 * 60_000)],
              );
              changed = true;
            }
            return result;
          },
          transaction: async (work) => {
            await ready;
            return conn.transaction(work);
          },
          close: () => conn.close(),
          abort: () => conn.abort(),
        };
      };
      const network = vi.fn<typeof fetch>();
      vi.stubGlobal("fetch", network);
      try {
        const response = await createApp({ connect, services: { now: () => NOW }, logSink: () => {} }).request(
          "/api/kakao/skills/review",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
            body: JSON.stringify({
              bot: { id: shop.botId },
              userRequest: {
                utterance: "사진 후기 남기기",
                block: { id: "review" },
                user: { id: shop.userKey, type: "botUserKey" },
              },
              action: {
                id: "review",
                params: {
                  review_text: "합성 후기",
                  review_photos: JSON.stringify({
                    privacyAgreement: "Y",
                    imageQuantity: "1",
                    secureUrls: "List(https://t1.daumcdn.net/synthetic/review.png)",
                    expire: new Date(NOW.getTime() + 300_000).toISOString(),
                  }),
                },
                clientExtra: {},
              },
            }),
          },
          testEnv(),
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("Siljang-Outcome")).toBe("not_accepting");
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        const body = await response.json();
        expectSchema("SkillTemplateResponse", body);
        expect(body).toEqual({
          version: "2.0",
          template: {
            outputs: [{ simpleText: { text: "아직 상담을 받지 않아요. 가게로 연락해 주세요: 02-000-0148" } }],
          },
        });
        expect(JSON.stringify(body)).not.toContain("02-999-9999");
        expect(changed).toBe(reason === "channel_changed");
        expect(network).not.toHaveBeenCalled();
        for (const table of ["reviews", "review_photos", "photo_consents"])
          expect((await isolated.db.query(`SELECT id FROM ${table} WHERE shop_id=$1`, [shop.shopId])).rowCount).toBe(0);
        expect(
          (
            await isolated.db.query("SELECT id FROM messages WHERE shop_id=$1 AND body_masked='후기 제출'", [
              shop.shopId,
            ])
          ).rowCount,
        ).toBe(0);
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );
});
