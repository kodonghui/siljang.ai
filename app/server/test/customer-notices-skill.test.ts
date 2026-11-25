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
  const call = (id: string, userId = shop.userKey) =>
    createApp({ connect: () => isolated.connect(), services: { now: () => NOW }, logSink: () => {} }).request(
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
            user: { id: userId, type: "botUserKey" },
          },
          action: { id: "synthetic-notice", params: {} },
        }),
      },
      testEnv(),
    );
  async function notice(body: string, target = shop) {
    const id = newUuid();
    await isolated.db.query(
      "INSERT INTO notifications(id,shop_id,customer_id,consultation_id,kind,event_key,template_key,body,status) VALUES($1,$2,$3,$4,'owner_reply',$5,'owner_reply',$6,'deferred')",
      [id, target.shopId, target.customerId, target.consultationId, `notice:${id}:owner_reply`, body],
    );
    return id;
  }
  it("자기 안내 키는 같은 글을 반복해서 주되 스킬 접수만으로 전달됨을 기록하지 않는다", async () => {
    const body = "합성 사장님 답을 전해요",
      id = await notice(body);
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("합성 시험에서 실제 발신 금지"));
    try {
      const first = await call(id),
        again = await call(id);
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
  it("다른 가게·다른 손님·없는 안내는 같은 notice_gone이고 손님을 만들지 않는다", async () => {
    const other = await createShop(isolated.db, "합성 다른 안내 가게"),
      foreignId = await notice("다른 손님에게만 전할 합성 답", other),
      ownId = await notice("자기 손님에게만 전할 합성 답"),
      before = (await isolated.db.query("SELECT count(*)::int AS n FROM customers")).rows;
    const responses = [await call(foreignId), await call(ownId, "synthetic-unknown-user"), await call(newUuid())];
    const bodies: unknown[] = [];
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.headers.get("Siljang-Outcome")).toBe("notice_gone");
      const value = await response.json();
      expectSchema("SkillTemplateResponse", value);
      bodies.push(value);
    }
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[1]).toEqual(bodies[2]);
    expect((await isolated.db.query("SELECT count(*)::int AS n FROM customers")).rows).toEqual(before);
  });
  it.each(["dropped", "deleted", "blank"])("읽을 수 없는 안내(%s)는 표시하지 않는다", async (kind) => {
    const id = await notice(kind === "blank" ? "   " : "더는 보여주지 않을 합성 답");
    if (kind === "dropped") await isolated.db.query("UPDATE notifications SET status='dropped' WHERE id=$1", [id]);
    if (kind === "deleted")
      await isolated.db.query("UPDATE consultations SET status='deleted',deleted_at=$2 WHERE id=$1", [
        shop.consultationId,
        NOW,
      ]);
    const response = await call(id);
    expect(response.headers.get("Siljang-Outcome")).toBe("notice_gone");
    expect(JSON.stringify(await response.json())).not.toContain("더는 보여주지 않을 합성 답");
  });
  it("2000글자 Unicode 안내를 두 출력으로 온전히 읽고 전달 상태를 바꾸지 않는다", async () => {
    const body = "🍰".repeat(2000),
      id = await notice(body),
      response = await call(id);
    expect(response.headers.get("Siljang-Outcome")).toBe("notice_shown");
    const value = (await response.json()) as { template: { outputs: { simpleText: { text: string } }[] } };
    expectSchema("SkillTemplateResponse", value);
    expect(value.template.outputs).toHaveLength(2);
    expect(value.template.outputs.map((output) => output.simpleText.text).join("")).toBe(body);
    expect((await isolated.db.query("SELECT status,sent_at FROM notifications WHERE id=$1", [id])).rows).toEqual([
      { status: "deferred", sent_at: null },
    ]);
  });
});
