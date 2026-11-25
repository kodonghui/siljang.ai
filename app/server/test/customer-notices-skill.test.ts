import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { sealAccountNumber } from "../src/account-number";
import { createApp } from "../src/app";
import { createPaymentRequestNotice } from "../src/customer-notice-store";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { expectSchema } from "./support/contract";
import { describeDb, newUuid, TEST_HASH_KEY, testEnv } from "./support/db";
import { singleKeyCrypto } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-25T00:00:00Z");
const { fc } = singleKeyCrypto();
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
  const call = (id: string, userId = shop.userKey, fields = true) =>
    createApp({
      connect: () => isolated.connect(),
      services: { now: () => NOW, ...(fields ? { fieldCrypto: fc } : {}) },
      logSink: () => {},
    }).request(
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
  it.each(["dropped", "deleted", "blank", "future"])("읽을 수 없는 안내(%s)는 표시하지 않는다", async (kind) => {
    const id = await notice(kind === "blank" ? "   " : "더는 보여주지 않을 합성 답");
    if (kind === "dropped") await isolated.db.query("UPDATE notifications SET status='dropped' WHERE id=$1", [id]);
    if (kind === "future")
      await isolated.db.query("UPDATE notifications SET scheduled_for=$2 WHERE id=$1", [
        id,
        new Date(NOW.getTime() + 3600000),
      ]);
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
  it.each(["expired", "closed", "amount_card_missing"] as const)(
    "사용하지 못하는 결제 안내(%s)는 암호화 키 없이 계좌를 숨긴다",
    async (reason) => {
      const cap = new Date(NOW.getTime() + 24 * 3600000);
      await isolated.db.query(
        "UPDATE payment_requests SET delivered_at=NULL,issued_at=$2,due_at=$3,due_cap_at=$3 WHERE id=$1",
        [shop.paymentRequestId, new Date(NOW.getTime() - 3600000), cap],
      );
      const source = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "customer_notice" }), isolated.db);
      const notice = await source.transaction((db) => createPaymentRequestNotice(db, shop.paymentRequestId, NOW));
      expect(notice?.created).toBe(true);
      if (reason === "expired")
        await isolated.db.query("UPDATE payment_requests SET due_at=$2,due_cap_at=$2 WHERE id=$1", [
          shop.paymentRequestId,
          new Date(NOW.getTime() - 1),
        ]);
      if (reason === "closed")
        await isolated.db.query(
          "UPDATE payment_requests SET status='closed',closed_at=$2,close_reason='superseded' WHERE id=$1",
          [shop.paymentRequestId, NOW],
        );
      if (reason === "amount_card_missing")
        await isolated.db.query(
          "UPDATE payment_requests SET needs_amount_confirm=true,requested_amount=30000 WHERE id=$1",
          [shop.paymentRequestId],
        );
      const response = await call(notice?.id ?? "", shop.userKey, false);
      expect(response.status).toBe(200);
      const body = await response.json();
      expectSchema("SkillTemplateResponse", body);
      const text = JSON.stringify(body);
      expect(text).not.toContain("계좌번호");
      expect(text).not.toContain("예금주");
      expect(text).toContain(
        reason === "expired" ? "결제 기한이 지나 사장님이 확인하고 있어요" : "지금은 이 결제 안내를 사용할 수 없어요",
      );
      expect(
        (await isolated.db.query("SELECT delivered_at FROM payment_requests WHERE id=$1", [shop.paymentRequestId]))
          .rows,
      ).toEqual([{ delivered_at: null }]);
    },
  );
  it.each([12, 6])(
    "자기 결제 안내의 옛 계좌와 운영규정%s시간을 보이며 스킬 읽기만으로 결제 시계를 시작하지 않는다",
    async (hours) => {
      await isolated.db.query("UPDATE operating_rules SET payment_due_hours=$2 WHERE id=$1", [
        shop.operatingRulesId,
        hours,
      ]);
      const id = newUuid(),
        account = "123456789012",
        sealed = await sealAccountNumber(fc, account, "payment_accounts.account_number", shop.shopId),
        cap = new Date(NOW.getTime() + 24 * 3600000);
      await isolated.db.query("UPDATE payment_accounts SET account_number_enc=$2,account_last4=$3 WHERE id=$1", [
        shop.paymentAccountId,
        sealed.enc,
        sealed.last4,
      ]);
      await isolated.db.query(
        "UPDATE payment_requests SET delivered_at=NULL,issued_at=$2,due_at=$3,due_cap_at=$3 WHERE id=$1",
        [shop.paymentRequestId, new Date(NOW.getTime() - 3600000), cap],
      );
      await isolated.db.query(
        "INSERT INTO notifications(id,shop_id,customer_id,consultation_id,order_id,kind,event_key,template_key,body,status) VALUES($1,$2,$3,$4,$5,'payment_request',$6,'payment_request:v1','결제 안내를 확인해 주세요','deferred')",
        [
          id,
          shop.shopId,
          shop.customerId,
          shop.consultationId,
          shop.orderId,
          `notice:${shop.paymentRequestId}:payment_request`,
        ],
      );
      const response = await call(id);
      expect(response.headers.get("Siljang-Outcome")).toBe("notice_shown");
      const value = await response.json();
      expectSchema("SkillTemplateResponse", value);
      expect(JSON.stringify(value)).toContain(account);
      expect(JSON.stringify(value)).toContain("35,000원");
      expect(JSON.stringify(value)).toContain(`전달된 때부터 ${hours}시간`);
      expect(
        (
          await isolated.db.query("SELECT delivered_at,due_at FROM payment_requests WHERE id=$1", [
            shop.paymentRequestId,
          ])
        ).rows,
      ).toEqual([{ delivered_at: null, due_at: cap }]);
      expect((await isolated.db.query("SELECT body,status,sent_at FROM notifications WHERE id=$1", [id])).rows).toEqual(
        [{ body: "결제 안내를 확인해 주세요", status: "deferred", sent_at: null }],
      );
    },
  );
  it.each([
    ["fixed", null, "25,000원"],
    ["from", null, "25,000원부터"],
    ["range", 30000, "25,000~30,000원"],
  ] as const)(
    "새 금액 안내는 요청 견적(%s)과 사유를 보이고 확인 전 계좌를 풀지 않는다",
    async (display, max, requested) => {
      const id = newUuid(),
        cardId = newUuid(),
        cardKey = newUuid().replaceAll("-", ""),
        cap = new Date(NOW.getTime() + 24 * 3600000);
      await isolated.db.transaction(async (db) => {
        await db.query("UPDATE kakao_channels SET card_block_id='synthetic.amount:card' WHERE id=$1", [shop.channelId]);
        await db.query("UPDATE quotes SET amount=25000,amount_max=$2,display_kind=$3,order_kind='custom' WHERE id=$1", [
          shop.quoteId,
          max,
          display,
        ]);
        await db.query("UPDATE order_details SET amount=25000 WHERE order_id=$1 AND version=1", [shop.orderId]);
        await db.query(
          `INSERT INTO order_details(shop_id,order_id,version,source,quote_id,price_list_id,pickup_at,allergy_consent,allergy_consent_version,allergy_consent_at,amount,amount_change_reason)
        SELECT shop_id,order_id,2,'owner_amount_change',quote_id,price_list_id,pickup_at,allergy_consent,allergy_consent_version,allergy_consent_at,35000,'합성 추가 장식' FROM order_details WHERE order_id=$1 AND version=1`,
          [shop.orderId],
        );
        await db.query("UPDATE orders SET version=2,kind='custom',accepted_at=$2,accepted_version=2 WHERE id=$1", [
          shop.orderId,
          new Date(NOW.getTime() - 3600000),
        ]);
        await db.query(
          "INSERT INTO confirm_cards(id,shop_id,consultation_id,customer_id,card_key,kind,order_id,order_version,payload,created_at,expires_at) VALUES($1,$2,$3,$4,$5,'amount_confirm',$6,2,$7::jsonb,$8,$9)",
          [
            cardId,
            shop.shopId,
            shop.consultationId,
            shop.customerId,
            cardKey,
            shop.orderId,
            JSON.stringify({ paymentRequestId: shop.paymentRequestId }),
            new Date(NOW.getTime() - 60000),
            new Date(NOW.getTime() + 29 * 60000),
          ],
        );
        await db.query(
          "UPDATE payment_requests SET requested_amount=25000,needs_amount_confirm=true,amount_card_id=$2,delivered_at=NULL,issued_at=$3,due_at=$4,due_cap_at=$4 WHERE id=$1",
          [shop.paymentRequestId, cardId, new Date(NOW.getTime() - 3600000), cap],
        );
        await db.query(
          "INSERT INTO notifications(id,shop_id,customer_id,consultation_id,order_id,kind,event_key,template_key,body,status) VALUES($1,$2,$3,$4,$5,'payment_request',$6,'payment_request:v1','결제 안내를 확인해 주세요','deferred')",
          [
            id,
            shop.shopId,
            shop.customerId,
            shop.consultationId,
            shop.orderId,
            `notice:${shop.paymentRequestId}:payment_request`,
          ],
        );
      });
      const decrypt = vi.spyOn(fc, "open");
      try {
        const response = await call(id);
        expect(response.status).toBe(200);
        const body = await response.json();
        expectSchema("SkillTemplateResponse", body);
        const text = JSON.stringify(body);
        expect(text).toContain(requested);
        expect(text).toContain("35,000원");
        expect(text).toContain("합성 추가 장식");
        expect(text).toContain(cardKey);
        expect(text).toContain("synthetic.amount:card");
        expect(text).not.toContain("계좌번호");
        expect(decrypt).not.toHaveBeenCalled();
        expect(
          (
            await isolated.db.query("SELECT delivered_at,amount_confirmed_at FROM payment_requests WHERE id=$1", [
              shop.paymentRequestId,
            ])
          ).rows,
        ).toEqual([{ delivered_at: null, amount_confirmed_at: null }]);
      } finally {
        decrypt.mockRestore();
      }
    },
  );
});
