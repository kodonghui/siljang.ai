import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { expectSchema } from "./support/contract";
import { describeDb, newUuid, TEST_HASH_KEY, testEnv } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-25T00:00:00Z");
describeDb("손님 안내 스킬 API-073(TASK-104)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture, key: string;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    shop = await createShop(isolated.db, "합성 손님 안내 가게");
    await issueTestBookingLink(isolated.db, shop);
    await linkTestChannel(isolated.db, shop.channelId);
    key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
  });
  afterAll(async () => {
    await isolated?.close();
  });
  it("자기 안내 키는 같은 글을 반복해서 주되 스킬 접수만으로 전달됨을 기록하지 않는다", async () => {
    const id = newUuid(),
      body = "합성 사장님 답을 전해요";
    await isolated.db.query(
      "INSERT INTO notifications(id,shop_id,customer_id,consultation_id,kind,event_key,template_key,body,status) VALUES($1,$2,$3,$4,'owner_reply',$5,'owner_reply',$6,'deferred')",
      [id, shop.shopId, shop.customerId, shop.consultationId, `notice:${id}:owner_reply`, body],
    );
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("합성 시험에서 실제 발신 금지"));
    try {
      const app = createApp({ connect: () => isolated.connect(), services: { now: () => NOW }, logSink: () => {} });
      const call = () =>
        app.request(
          "/api/kakao/skills/event",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
            body: JSON.stringify({
              bot: { id: shop.botId },
              userRequest: {
                utterance: "",
                params: { noticeKey: id },
                block: { id: "notice" },
                user: { id: shop.userKey, type: "botUserKey" },
              },
              action: { id: "synthetic-notice", params: {} },
            }),
          },
          testEnv(),
        );
      const first = await call(),
        again = await call();
      expect(first.headers.get("Siljang-Outcome")).toBe("notice_shown");
      const value = await first.json();
      expectSchema("SkillTemplateResponse", value);
      expect(JSON.stringify(value)).toContain(body);
      expect(await again.json()).toEqual(value);
      expect((await isolated.db.query("SELECT status,sent_at FROM notifications WHERE id=$1", [id])).rows).toEqual([
        { status: "deferred", sent_at: null },
      ]);
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  });
});
