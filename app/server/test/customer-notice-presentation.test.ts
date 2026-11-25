import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { createOrderConfirmedNotice } from "../src/customer-notice-store";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { expectSchema } from "./support/contract";
import { describeDb, newUuid, TEST_HASH_KEY, testEnv } from "./support/db";
import { newFieldKey } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-26T00:00:00Z");
describeDb("저장된 손님 안내의 두 실제 수신 경로 표시", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture, key: string;
  let requestCount = 0;
  const env = testEnv({ FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: newFieldKey() });
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    requestCount = 0;
    shop = await createShop(isolated.db, "합성 저장 안내 가게");
    await issueTestBookingLink(isolated.db, shop);
    await linkTestChannel(isolated.db, shop.channelId);
    key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
  });
  afterAll(async () => {
    await isolated?.close();
  });
  async function call(mode: "event" | "message", id: string) {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("합성 안내에서 실제 발신 금지"));
    try {
      const response = await createApp({
        connect: () => isolated.connect(),
        services: { now: () => NOW },
        logSink: () => {},
      }).request(
        `/api/kakao/skills/${mode}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
          body: JSON.stringify({
            bot: { id: shop.botId },
            userRequest: {
              utterance: mode === "event" ? "" : `합성 안내 확인 ${++requestCount}`,
              params: mode === "event" ? { noticeKey: id } : {},
              block: { id: "conversation" },
              user: { id: shop.userKey, type: "botUserKey" },
            },
            action: { id: "synthetic-presentation", params: {} },
          }),
        },
        env,
      );
      expect(network).not.toHaveBeenCalled();
      return response;
    } finally {
      network.mockRestore();
    }
  }
  async function confirm() {
    const paid = newUuid();
    await isolated.db.transaction(async (db) => {
      await db.query(
        "UPDATE payment_requests SET status='paid',paid_at=$2,arrived_amount=amount,arrived_at=$2 WHERE id=$1",
        [shop.paymentRequestId, NOW],
      );
      await db.query(
        "INSERT INTO payments(id,shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES($1,$2,$3,$4,35000,$5)",
        [paid, shop.shopId, shop.orderId, shop.paymentRequestId, NOW],
      );
      await db.query("UPDATE orders SET status='confirmed',confirmed_at=$2,confirmed_payment_id=$3 WHERE id=$1", [
        shop.orderId,
        NOW,
        paid,
      ]);
    });
  }
  async function notice(kind: string, body: string, at = NOW) {
    const id = newUuid();
    await isolated.db.query(
      "INSERT INTO notifications(id,shop_id,customer_id,consultation_id,order_id,kind,event_key,template_key,body,status,scheduled_for,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$6,$8,'deferred',$9,$10)",
      [
        id,
        shop.shopId,
        shop.customerId,
        shop.consultationId,
        shop.orderId,
        kind,
        `notice:synthetic:${id}`,
        body,
        kind === "review_request" ? NOW : null,
        at,
      ],
    );
    return id;
  }
  for (const mode of ["event", "message"] as const) {
    it(`${mode}: 공백인 분할 조각 뒤의 안내도 막히지 않는다`, async () => {
      const original = `${"가".repeat(1000)}\n`;
      const first = await notice("owner_reply", original, new Date(NOW.getTime() - 2000));
      const next = await notice("custom_rejected", "합성 후속 안내", new Date(NOW.getTime() - 1000));
      const response = await call(mode, first);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { template: { outputs: { simpleText: { text: string } }[] } };
      expectSchema("SkillTemplateResponse", body);
      expect(
        body.template.outputs
          .slice(0, 2)
          .map((o) => o.simpleText.text)
          .join(""),
      ).toBe(original);
      const again = await call(mode, next);
      expect(again.status).toBe(200);
      expect(JSON.stringify(await again.json())).toContain("합성 후속 안내");
    });
    for (const legacy of [false, true])
      it(`${mode}: 확정 시점 내용·신원과 주문의 예전 규정을 전한다(이전 자료 ${legacy})`, async () => {
        await confirm();
        await isolated.db.query(
          "UPDATE order_details SET design_notes='합성 처음 디자인',lettering='합성 처음 문구',colors='합성 처음 색' WHERE shop_id=$1 AND order_id=$2 AND version=1",
          [shop.shopId, shop.orderId],
        );
        await isolated.db.query(
          "INSERT INTO rule_clauses(shop_id,operating_rules_id,clause_key,position,title,condition_text,effect_text) VALUES($1,$2,'custom',1,'합성 규정','합성 조건','합성 원래 주문 규정') ON CONFLICT(operating_rules_id,position) DO UPDATE SET clause_key='custom',effect_text='합성 원래 주문 규정'",
          [shop.shopId, shop.operatingRulesId],
        );
        if (!legacy) {
          await isolated.db.query(
            "UPDATE rule_clauses SET effect_text=$3 WHERE shop_id=$1 AND operating_rules_id=$2 AND position=1",
            [shop.shopId, shop.operatingRulesId, `합성 원래 주문 규정${"나".repeat(700)}`],
          );
          await isolated.db.query(
            "INSERT INTO rule_clauses(shop_id,operating_rules_id,clause_key,position,title,condition_text,effect_text) VALUES($1,$2,'custom',2,'합성 추가 규정','합성 조건',$3)",
            [shop.shopId, shop.operatingRulesId, `합성 두번째 규정${"다".repeat(700)}`],
          );
        }
        const db = shopRequestDb(createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId }), isolated.db);
        const created = await db.transaction((tx) => createOrderConfirmedNotice(tx, shop.orderId, NOW));
        expect(created?.created).toBe(true);
        const id = created?.id ?? "";
        if (legacy) {
          const saved = (await isolated.db.query<{ body: string }>("SELECT body FROM notifications WHERE id=$1", [id]))
            .rows[0];
          if (!saved) throw new Error("합성 안내 없음");
          await isolated.db.query("UPDATE notifications SET template_key='order_confirmed:v1',body=$2 WHERE id=$1", [
            id,
            saved.body.split("\n주문 내용\n")[0],
          ]);
        }
        const newerRules = newUuid();
        await isolated.db.transaction(async (tx) => {
          await tx.query(
            "UPDATE shops SET business_name='합성 바뀐 상호',business_address='합성 바뀐 주소' WHERE id=$1",
            [shop.shopId],
          );
          await tx.query("UPDATE operating_rules SET superseded_at=$2 WHERE id=$1", [shop.operatingRulesId, NOW]);
          await tx.query(
            "INSERT INTO operating_rules SELECT (jsonb_populate_record(NULL::operating_rules,to_jsonb(r)||jsonb_build_object('id',$2::uuid,'version',2,'superseded_at',NULL))).* FROM operating_rules r WHERE r.id=$1",
            [shop.operatingRulesId, newerRules],
          );
          await tx.query(
            "INSERT INTO rule_clauses(shop_id,operating_rules_id,clause_key,position,title,condition_text,effect_text) VALUES($1,$2,'custom',1,'합성 최신 규정','합성 조건','합성 최신 규정')",
            [shop.shopId, newerRules],
          );
          await tx.query(
            "INSERT INTO order_details SELECT (jsonb_populate_record(NULL::order_details,to_jsonb(d)||jsonb_build_object('id',$3::uuid,'version',2,'source','owner_amount_change','amount_change_reason','합성 변경','design_notes','합성 바뀐 디자인','lettering','합성 바뀐 문구'))).* FROM order_details d WHERE d.shop_id=$1 AND d.order_id=$2 AND d.version=1",
            [shop.shopId, shop.orderId, newUuid()],
          );
          await tx.query("UPDATE orders SET version=2 WHERE id=$1", [shop.orderId]);
        });
        const response = await call(mode, id);
        expect(response.status).toBe(200);
        const body = (await response.json()) as { template: { outputs: readonly unknown[] } };
        expectSchema("SkillTemplateResponse", body);
        const text = JSON.stringify(body);
        if (!legacy) {
          expect(body.template.outputs).toHaveLength(3);
          expect(text).toContain("합성 두번째 규정");
        }
        for (const word of ["합성 처음 디자인", "합성 처음 문구", "합성 원래 주문 규정", "35,000원"])
          expect(text).toContain(word);
        for (const word of ["합성 최신 규정", "합성 바뀐 상호", "합성 바뀐 주소", "합성 바뀐 디자인", "합성 바뀐 문구"])
          expect(text).not.toContain(word);
      });
    it(`${mode}: 저장된 후기 부탁도 주문번호와 연결 채널의 후기 버튼을 전한다`, async () => {
      await confirm();
      await isolated.db.transaction(async (tx) => {
        await tx.query("UPDATE orders SET status='received' WHERE id=$1", [shop.orderId]);
        await tx.query(
          "INSERT INTO productions(shop_id,order_id,handed_over_at,handover_kind) VALUES($1,$2,$3,'pickup')",
          [shop.shopId, shop.orderId, new Date(NOW.getTime() - 86400000)],
        );
      });
      const id = await notice("review_request", "합성 후기 부탁 저장 본문");
      const response = await call(mode, id);
      expect(response.status).toBe(200);
      const body = await response.json();
      expectSchema("SkillTemplateResponse", body);
      const text = JSON.stringify(body);
      const order = (
        await isolated.db.query<{ order_no: string }>("SELECT order_no FROM orders WHERE id=$1", [shop.orderId])
      ).rows[0];
      expect(text).toContain("후기 남기기");
      expect(text).toContain('"blockId":"review"');
      expect(text).toContain(order?.order_no);
      for (const value of [shop.orderId, shop.customerId, shop.shopId]) expect(text).not.toContain(value);
    });
  }
});
