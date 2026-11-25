import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { sealAccountNumber } from "../src/account-number";
import { createPaymentRequestNotice } from "../src/customer-notice-store";
import { pgConnector } from "../src/db";
import { kakaoConsultationMessage } from "../src/kakao-consultation-message";
import { deferredKakaoBatch, deferredKakaoTexts, markDeferredKakaoMessages } from "../src/kakao-deferred";
import { Secret } from "../src/settings";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { expectSchema } from "./support/contract";
import { describeDb, newUuid, TEST_DATABASE_URL, testDb } from "./support/db";
import { singleKeyCrypto } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-26T03:00:00Z");
const AT = new Date(NOW.getTime() + 1000);
const { fc } = singleKeyCrypto();
const grants = readFileSync(new URL("../../../tools/staging-login-callback-grants.sql", import.meta.url), "utf8");

describeDb("권한이 없는 차액 뒤의 다른 주문 안내(TASK-106)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture, roleUrl: string;
  const role = `task106_queue_${newUuid().replaceAll("-", "")}`;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
    await isolated.db.query(`CREATE ROLE "${role}" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await isolated.db.query(grants.replaceAll(':"runtime_role"', `"${role}"`));
    const database = (await isolated.db.query<{ name: string }>("SELECT current_database() AS name")).rows[0];
    if (!database) throw new Error("합성 데이터베이스 없음");
    const url = new URL(TEST_DATABASE_URL);
    url.pathname = `/${database.name}`;
    url.username = role;
    url.password = "";
    roleUrl = url.toString();
  }, 30000);
  beforeEach(async () => {
    await isolated.db.query(`REVOKE SELECT (changes,base_version,amount_delta) ON change_requests FROM "${role}"`);
    shop = await createShop(isolated.db, "합성 안내 격리 가게");
    await issueTestBookingLink(isolated.db, shop);
    await linkTestChannel(isolated.db, shop.channelId);
    await isolated.db.query("UPDATE consultations SET ai_disclosed_at=$2 WHERE id=$1", [shop.consultationId, NOW]);
    const sealed = await sealAccountNumber(fc, "123456789012", "payment_accounts.account_number", shop.shopId);
    await isolated.db.query("UPDATE payment_accounts SET account_number_enc=$2,account_last4=$3 WHERE id=$1", [
      shop.paymentAccountId,
      sealed.enc,
      sealed.last4,
    ]);
    const paid = newUuid();
    await isolated.db.query(
      "UPDATE payment_requests SET status='paid',paid_at=$2,arrived_at=$2,arrived_amount=amount WHERE id=$1",
      [shop.paymentRequestId, NOW],
    );
    await isolated.db.query(
      "INSERT INTO payments(id,shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES($1,$2,$3,$4,35000,$5)",
      [paid, shop.shopId, shop.orderId, shop.paymentRequestId, NOW],
    );
    await isolated.db.query(
      "UPDATE orders SET status='confirmed',confirmed_at=$2,confirmed_payment_id=$3 WHERE id=$1",
      [shop.orderId, NOW, paid],
    );
  });
  afterAll(async () => {
    await isolated?.close();
    const admin = testDb();
    try {
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
    } finally {
      await admin.close();
    }
  });
  const scope = () => createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" });
  async function addOrder(confirmed: boolean, cancelled = false) {
    const orderId = newUuid(),
      draftId = newUuid(),
      quoteId = newUuid(),
      orderNo = newUuid().replaceAll("-", "").slice(0, 8).toUpperCase();
    await isolated.db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO order_drafts SELECT(jsonb_populate_record(NULL::order_drafts,to_jsonb(d)||$2::jsonb)).* FROM order_drafts d WHERE d.id=$1",
        [shop.draftId, JSON.stringify({ id: draftId })],
      );
      await tx.query(
        "INSERT INTO quotes SELECT(jsonb_populate_record(NULL::quotes,to_jsonb(q)||$2::jsonb)).* FROM quotes q WHERE q.id=$1",
        [shop.quoteId, JSON.stringify({ id: quoteId, draft_id: draftId })],
      );
      await tx.query(
        "INSERT INTO orders SELECT(jsonb_populate_record(NULL::orders,to_jsonb(o)||$2::jsonb)).* FROM orders o WHERE o.id=$1",
        [
          shop.orderId,
          JSON.stringify({
            id: orderId,
            order_no: orderNo,
            draft_id: draftId,
            remake_of_order_id: null,
            amount: 35000,
            status: cancelled ? "cancelled" : "awaiting_payment",
            confirmed_at: null,
            confirmed_payment_id: null,
            cancelled_at: cancelled ? NOW.toISOString() : null,
            cancel_kind: cancelled ? "customer" : null,
            cancel_reason: null,
          }),
        ],
      );
      await tx.query(
        "INSERT INTO order_details SELECT(jsonb_populate_record(NULL::order_details,to_jsonb(d)||$2::jsonb)).* FROM order_details d WHERE d.order_id=$1 AND d.version=1",
        [
          shop.orderId,
          JSON.stringify({
            id: newUuid(),
            order_id: orderId,
            amount: 35000,
            source: "request",
            quote_id: quoteId,
          }),
        ],
      );
    });
    if (confirmed) {
      const request = newUuid(),
        payment = newUuid();
      await isolated.db.query(
        "INSERT INTO payment_requests SELECT(jsonb_populate_record(NULL::payment_requests,to_jsonb(p)||$2::jsonb)).* FROM payment_requests p WHERE p.id=$1",
        [shop.paymentRequestId, JSON.stringify({ id: request, order_id: orderId, event_key: `pay:${orderId}:first` })],
      );
      await isolated.db.query(
        "INSERT INTO payments(id,shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES($1,$2,$3,$4,35000,$5)",
        [payment, shop.shopId, orderId, request, NOW],
      );
      await isolated.db.query(
        "UPDATE orders SET status='confirmed',confirmed_at=$2,confirmed_payment_id=$3 WHERE id=$1",
        [orderId, NOW, payment],
      );
    }
    return { orderId, orderNo };
  }
  async function addPayment(orderId: string, kind: "first" | "reissue" | "difference", position: number) {
    const id = newUuid(),
      change = newUuid(),
      amountCard = newUuid(),
      changeCard = newUuid();
    if (kind === "difference") {
      for (const [cardId, cardKind] of [
        [amountCard, "amount_confirm"],
        [changeCard, "change_request"],
      ]) {
        await isolated.db.query(
          "INSERT INTO confirm_cards(id,shop_id,consultation_id,customer_id,card_key,kind,order_id,order_version,payload,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,1,'{}',$8,$9)",
          [
            cardId,
            shop.shopId,
            shop.consultationId,
            shop.customerId,
            `ck_${cardId}`,
            cardKind,
            orderId,
            NOW,
            new Date(NOW.getTime() + 1800000),
          ],
        );
      }
      await isolated.db.query(
        "INSERT INTO change_requests(id,shop_id,order_id,card_id,base_version,changes,status,amount_delta,decided_at) VALUES($1,$2,$3,$4,1,$5::jsonb,'awaiting_difference',20000,$6)",
        [change, shop.shopId, orderId, changeCard, JSON.stringify({ lettering: `합성 차액 ${position}` }), NOW],
      );
    }
    await isolated.db.query(
      "INSERT INTO payment_requests SELECT(jsonb_populate_record(NULL::payment_requests,to_jsonb(p)||$2::jsonb)).* FROM payment_requests p WHERE p.id=$1",
      [
        shop.paymentRequestId,
        JSON.stringify({
          id,
          order_id: orderId,
          kind,
          change_request_id: kind === "difference" ? change : null,
          event_key: `pay:${id}:${kind}`,
          status: "open",
          amount: kind === "difference" ? 20000 : 35000,
          requested_amount: null,
          needs_amount_confirm: kind === "difference",
          amount_confirmed_at: null,
          amount_card_id: kind === "difference" ? amountCard : null,
          delivered_at: null,
          issued_at: NOW.toISOString(),
          due_at: new Date(NOW.getTime() + 86400000).toISOString(),
          due_cap_at: new Date(NOW.getTime() + 86400000).toISOString(),
          paid_at: null,
          arrived_at: null,
          arrived_amount: null,
        }),
      ],
    );
    const scoped = shopRequestDb(scope(), isolated.db);
    const notice = await scoped.transaction((tx) => createPaymentRequestNotice(tx, id, NOW));
    if (!notice) throw new Error("합성 결제 안내 없음");
    await isolated.db.query("UPDATE notifications SET status='deferred',created_at=$2 WHERE id=$1", [
      notice.id,
      new Date(NOW.getTime() + position),
    ]);
    return { noticeId: notice.id, paymentId: id };
  }
  it.each(
    ([1, 3] as const).flatMap((blocked) =>
      (["cancelled", "first", "reissue"] as const).map((normal) => [blocked, normal] as const),
    ),
  )("권한 부족 %s건을 보존하고 뒤의 %s 세 건과 현재 답의 순서를 지킨다", async (blockedCount, normalKind) => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("합성 대기열 시험에서 실제 발신 금지"));
    const blocked: { noticeId: string; paymentId: string }[] = [],
      normal: { noticeId: string; orderNo: string }[] = [];
    const runtime = pgConnector(new Secret(roleUrl));
    try {
      for (let i = 0; i < blockedCount; i++) {
        const order = await addOrder(true);
        blocked.push(await addPayment(order.orderId, "difference", i));
      }
      for (let i = 0; i < 3; i++) {
        const order = await addOrder(false, normalKind === "cancelled");
        if (normalKind !== "cancelled")
          normal.push({ ...(await addPayment(order.orderId, normalKind, 100 + i)), orderNo: order.orderNo });
        else {
          const noticeId = newUuid();
          await isolated.db.query(
            "INSERT INTO notifications(id,shop_id,customer_id,consultation_id,order_id,kind,event_key,template_key,body,status,created_at) VALUES($1,$2,$3,$4,$5,'cancelled',$6,'cancelled:v1',$7,'deferred',$8)",
            [
              noticeId,
              shop.shopId,
              shop.customerId,
              shop.consultationId,
              order.orderId,
              `synthetic-cancel:${noticeId}`,
              `합성 다른 주문 취소 ${i}`,
              new Date(NOW.getTime() + 100 + i),
            ],
          );
          normal.push({ noticeId, orderNo: order.orderNo });
        }
      }
      const scoped = shopRequestDb(scope(), runtime);
      const batch = await scoped.transaction((tx) =>
        deferredKakaoBatch(tx, shop.customerId, { now: AT, fields: () => fc }),
      );
      expect(batch.messages.map((m) => m.id)).toEqual(normal.slice(0, 2).map((n) => n.noticeId));
      expect(batch.currentBlocked).toBe(true);
      const body = kakaoConsultationMessage({ state: "normal", contents: deferredKakaoTexts(batch.messages) });
      expectSchema("SkillTemplateResponse", body);
      const shown = JSON.stringify(body);
      if (normalKind === "cancelled") {
        expect(shown).toContain("합성 다른 주문 취소 0");
        expect(shown).toContain("합성 다른 주문 취소 1");
        expect(shown).not.toContain("합성 다른 주문 취소 2");
      } else {
        expect(shown).toContain("123456789012");
        for (const n of normal.slice(0, 2)) expect(shown).toContain(n.orderNo);
        expect(shown).not.toContain(normal[2]?.orderNo);
      }
      await scoped.transaction((tx) => markDeferredKakaoMessages(tx, shop.customerId, batch.messages, AT));
      const tail = await scoped.transaction((tx) =>
        deferredKakaoBatch(tx, shop.customerId, { now: AT, fields: () => fc }),
      );
      expect(tail.messages.map((m) => m.id)).toEqual(normal.slice(2).map((n) => n.noticeId));
      expect(tail.currentBlocked).toBe(false);
      await scoped.transaction((tx) => markDeferredKakaoMessages(tx, shop.customerId, tail.messages, AT));
      expect(
        (
          await isolated.db.query("SELECT id,status,sent_at FROM notifications WHERE id=ANY($1::uuid[]) ORDER BY id", [
            blocked.map((n) => n.noticeId),
          ])
        ).rows,
      ).toEqual(
        blocked
          .map((n) => ({ id: n.noticeId, status: "deferred", sent_at: null }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      );
      await isolated.db.query(`GRANT SELECT (changes,base_version,amount_delta) ON change_requests TO "${role}"`);
      const recovered = await scoped.transaction((tx) =>
        deferredKakaoBatch(tx, shop.customerId, { now: AT, fields: () => fc }),
      );
      expect(recovered.messages.map((m) => m.id)).toEqual(blocked.slice(0, 2).map((n) => n.noticeId));
      expect(recovered.currentBlocked).toBe(blockedCount > 2);
      await scoped.transaction((tx) => markDeferredKakaoMessages(tx, shop.customerId, recovered.messages, AT));
      expect(
        (
          await isolated.db.query(
            "SELECT delivered_at,amount_confirmed_at FROM payment_requests WHERE id=ANY($1::uuid[])",
            [blocked.map((n) => n.paymentId)],
          )
        ).rows.every((p) => p.delivered_at === null && p.amount_confirmed_at === null),
      ).toBe(true);
      expect(network).not.toHaveBeenCalled();
    } finally {
      await runtime.close();
      network.mockRestore();
    }
  });
});
