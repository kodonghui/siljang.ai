import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createApp } from "../src/app";
import { READABLE_CUSTOMER_NOTICE_KINDS } from "../src/customer-notice-content";
import { KAKAO_HANDOFF_TEXT } from "../src/kakao-reply";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { expectSchema } from "./support/contract";
import { describeDb, newUuid, TEST_HASH_KEY, testEnv } from "./support/db";
import { newFieldKey } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const schema = readFileSync(new URL("../../../db/schema.sql", import.meta.url), "utf8");
const table = schema.slice(schema.indexOf("CREATE TABLE notifications ("));
const values = /kind\s+text NOT NULL CHECK \(kind IN \(([^)]+)\)\)/.exec(table)?.[1] ?? "";
const kinds = [...values.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] ?? "");
const plain = kinds.filter((k) => !["payment_request", "order_confirmed", "day_before", "review_request"].includes(k));
const NOW = new Date("2026-11-25T00:00:00Z"),
  BODY = "합성 사건 안내의 저장된 본문";

it("TBL044의18종류는 공통 전달 목록에서 빠지지 않는다", () => {
  expect(kinds).toHaveLength(18);
  expect([...READABLE_CUSTOMER_NOTICE_KINDS].sort()).toEqual([...kinds].sort());
});

describeDb("업무가 남긴 안내 본문의 공통 전달", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture, key: string;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    shop = await createShop(isolated.db, "합성 안내 종류 가게");
    await issueTestBookingLink(isolated.db, shop);
    await linkTestChannel(isolated.db, shop.channelId);
    key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
  });
  afterAll(async () => {
    await isolated?.close();
  });
  it.each(["   ", "\t\n\r", "\u00a0\u3000\ufeff"])(
    "공백만 든 안내 두 건 %j 뒤의 정상 안내는 막히지 않음",
    async (blank) => {
      const ids = [newUuid(), newUuid(), newUuid()];
      for (let index = 0; index < ids.length; index++)
        await isolated.db.query(
          "INSERT INTO notifications(id,shop_id,customer_id,consultation_id,order_id,kind,event_key,template_key,body,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$6,$8,'deferred',$9)",
          [
            ids[index],
            shop.shopId,
            shop.customerId,
            shop.consultationId,
            shop.orderId,
            index === 2 ? "refund" : "cancelled",
            `notice:blank:${ids[index]}`,
            index === 2 ? BODY : blank,
            new Date(NOW.getTime() - 3000 + index * 1000),
          ],
        );
      const app = createApp({ connect: () => isolated.connect(), services: { now: () => NOW }, logSink: () => {} });
      const response = await app.request(
        "/api/kakao/skills/message",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
          body: JSON.stringify({
            bot: { id: shop.botId },
            userRequest: {
              utterance: "합성 공백 안내 뒤 질문",
              block: { id: "conversation" },
              user: { id: shop.userKey, type: "botUserKey" },
            },
            action: { id: "synthetic-blank-notice", params: {} },
          }),
        },
        testEnv({ FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: newFieldKey() }),
      );
      expect(JSON.stringify(await response.json())).toContain(BODY);
      const rows = (
        await isolated.db.query("SELECT id,status,body,sent_at FROM notifications WHERE id=ANY($1::uuid[])", [ids])
      ).rows;
      for (let index = 0; index < ids.length; index++)
        expect(rows.find((row) => row.id === ids[index])).toEqual({
          id: ids[index],
          status: index === 2 ? "delivered_on_reply" : "dropped",
          body: index === 2 ? BODY : blank,
          sent_at: index === 2 ? NOW : null,
        });
    },
  );
  for (const mode of ["event", "message"] as const)
    it.each(plain)(`${mode}: 업무가 저장한 %s 안내를 정의된 표시로 자기 손님에게 전한다`, async (kind) => {
      const id = newUuid(),
        stored = kind === "payment_mismatch" ? `${BODY} 12,345원` : BODY,
        shown = kind === "payment_mismatch" ? "보내신 금액이 안내와 달라 사장님이 연락드릴게요" : BODY;
      await isolated.db.query(
        "INSERT INTO notifications(id,shop_id,customer_id,consultation_id,order_id,kind,event_key,template_key,body,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$6,$8,'deferred',$9)",
        [
          id,
          shop.shopId,
          shop.customerId,
          shop.consultationId,
          shop.orderId,
          kind,
          `notice:${shop.orderId}:${kind}`,
          stored,
          new Date(NOW.getTime() - 1000),
        ],
      );
      const app = createApp({ connect: () => isolated.connect(), services: { now: () => NOW }, logSink: () => {} }),
        env = testEnv({ FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: newFieldKey() });
      const call = (utterance: string) =>
        app.request(
          `/api/kakao/skills/${mode}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
            body: JSON.stringify({
              bot: { id: shop.botId },
              userRequest: {
                utterance,
                params: mode === "event" ? { noticeKey: id } : {},
                block: { id: "conversation" },
                user: { id: shop.userKey, type: "botUserKey" },
              },
              action: { id: "synthetic-notice-kind", params: {} },
            }),
          },
          env,
        );
      const response = await call("합성 안내 종류 첫 질문"),
        body = await response.json();
      expectSchema("SkillTemplateResponse", body);
      expect(JSON.stringify(body)).toContain(shown);
      if (kind === "payment_mismatch") {
        expect(JSON.stringify(body)).not.toContain(BODY);
        expect(JSON.stringify(body)).not.toContain("12,345");
      }
      if (mode === "event") expect(response.headers.get("Siljang-Outcome")).toBe("notice_shown");
      else {
        const text = JSON.stringify(body);
        expect(text.indexOf(shown)).toBeLessThan(text.indexOf(KAKAO_HANDOFF_TEXT));
        expect(JSON.stringify(await (await call("합성 안내 종류 둘째 질문")).json())).not.toContain(shown);
      }
      expect((await isolated.db.query("SELECT status,sent_at,body FROM notifications WHERE id=$1", [id])).rows).toEqual(
        [
          {
            status: mode === "message" ? "delivered_on_reply" : "deferred",
            sent_at: mode === "message" ? NOW : null,
            body: stored,
          },
        ],
      );
    });
});
