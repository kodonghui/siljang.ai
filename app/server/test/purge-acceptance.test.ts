import { afterAll, expect, it } from "vitest";
import type { AuthorizedKakaoSkill } from "../src/kakao-skill-auth";
import { receiveKakaoMessage } from "../src/kakao-skill-store";
import { purgeConsultation } from "../src/purge-consultation";
import { purgeCustomerKey } from "../src/purge-customer";
import { purgeKeptContract, purgeKeptIssue } from "../src/purge-kept";
import { purgeOrder } from "../src/purge-order";
import { Secret } from "../src/settings";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { describeDb, newUuid, TEST_HASH_KEY, testDb } from "./support/db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture, snapshotShop } from "./support/shops";

const NOW = new Date("2026-11-21T18:00:00Z");
const DAY = 86_400_000;
const ENDED = new Date(NOW.getTime() - 31 * DAY);

describeDb("지난 기록 지우기의 보존 수락 사례(TASK-158, A16·A22)", () => {
  const db = testDb();
  afterAll(() => db.close());
  const scoped = (f: ShopFixture) => shopRequestDb(createShopScope(f.shopId, { kind: "job", job: "purge" }), db);
  const purge = (f: ShopFixture) => scoped(f).transaction((tx) => purgeOrder(tx, f.orderId, NOW));
  async function received() {
    const f = await createShop(db, "인도 뒤 보관 시험");
    const payment = newUuid(),
      details = newUuid(),
      report = newUuid(),
      refund = newUuid(),
      card = newUuid(),
      change = newUuid(),
      production = newUuid();
    const completion = newUuid(),
      review = newUuid(),
      consent = newUuid();
    const referenceKey = `shops/${f.shopId}/reference/${newUuid()}.webp`;
    const issueKey = `shops/${f.shopId}/issues/${newUuid()}.webp`;
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE payment_requests SET status = 'paid', arrived_amount = amount, arrived_at = $2, paid_at = $2, depositor_name = '합성입금자' WHERE id = $1",
        [f.paymentRequestId, ENDED],
      );
      await tx.query(
        "INSERT INTO payments (id, shop_id, order_id, payment_request_id, amount, confirmed_at) VALUES ($1, $2, $3, $4, 35000, $5)",
        [payment, f.shopId, f.orderId, f.paymentRequestId, ENDED],
      );
      await tx.query(
        "UPDATE orders SET status = 'received', confirmed_at = $2, confirmed_payment_id = $3, finished_at = $2 WHERE id = $1",
        [f.orderId, ENDED, payment],
      );
      for (const table of ["order_details", "order_drafts"]) {
        const where = table === "order_details" ? "order_id" : "id";
        await tx.query(
          `UPDATE ${table} SET allergy_consent = 'agreed', allergy_consent_version = 'allergy-v1', allergy_consent_at = $2, allergy_answer = '합성 알레르기 답', excluded_ingredients = '합성 제외 재료', lettering = '합성 문구', design_notes = '합성 디자인 설명' WHERE ${where} = $1`,
          [table === "order_details" ? f.orderId : f.draftId, ENDED],
        );
      }
      await tx.query(
        "INSERT INTO reference_photos (shop_id, draft_id, message_id, storage_key, content_type, byte_size) VALUES ($1, $2, $3, $4, 'image/webp', 10)",
        [f.shopId, f.draftId, f.messageId, referenceKey],
      );
      await tx.query(
        "INSERT INTO confirm_cards (id, shop_id, consultation_id, customer_id, card_key, kind, order_id, order_version, payload, expires_at) VALUES ($1, $2, $3, $4, $5, 'change_request', $6, 1, '{\"customerName\":\"synthetic\"}', now() + interval '20 minutes')",
        [card, f.shopId, f.consultationId, f.customerId, newUuid(), f.orderId],
      );
      await tx.query(
        "INSERT INTO change_requests (id, shop_id, order_id, card_id, base_version, changes, status, closed_at) VALUES ($1, $2, $3, $4, 1, '{\"lettering\":\"synthetic\"}', 'closed_no_difference', $5)",
        [change, f.shopId, f.orderId, card, ENDED],
      );
      await tx.query(
        "INSERT INTO issue_details (id, shop_id, consultation_id, order_id, description, status) VALUES ($1, $2, $3, $4, '합성 신고 설명', 'reported')",
        [details, f.shopId, f.consultationId, f.orderId],
      );
      await tx.query(
        "INSERT INTO issue_reports (id, shop_id, order_id, issue_details_id, late, reported_by, status, compensation, decided_at, closed_at, problem_kind) VALUES ($1, $2, $3, $4, false, 'owner_from_handoff', 'closed', 'partial_refund', $5, $5, 'other')",
        [report, f.shopId, f.orderId, details, ENDED],
      );
      await tx.query(
        "INSERT INTO issue_photos (shop_id, issue_details_id, message_id, position, storage_key, content_type, byte_size) VALUES ($1, $2, $3, 1, $4, 'image/webp', 10)",
        [f.shopId, details, f.messageId, issueKey],
      );
      await tx.query(
        "INSERT INTO refunds (id, shop_id, order_id, cause, issue_report_id, event_key, decision, amount, calculated_amount, calc_basis, method, sent_at, refund_bank_name, refund_account_enc, refund_account_last4, refund_holder_name) VALUES ($1, $2, $3, 'compensation', $4, $5, 'partial', 500, 500, '{}', 'bank_transfer', $6, '합성은행', $7, '0000', '합성예금주')",
        [refund, f.shopId, f.orderId, report, newUuid(), ENDED, `v1:${"A".repeat(48)}`],
      );
      await tx.query(
        "INSERT INTO owner_tasks (shop_id, kind, event_key, refund_id, closed_at, detail, order_id) VALUES ($1, 'refund_send', $2, $3, $4, '{\"name\":\"synthetic\"}', $5)",
        [f.shopId, newUuid(), refund, ENDED, f.orderId],
      );
      await tx.query(
        "INSERT INTO notifications (shop_id, customer_id, consultation_id, order_id, kind, event_key, template_key, body, status) VALUES ($1, $2, $3, $4, 'owner_reply', $5, 'synthetic', '합성 안내 내용', 'deferred')",
        [f.shopId, f.customerId, f.consultationId, f.orderId, newUuid()],
      );
      await tx.query(
        "INSERT INTO productions (id, shop_id, order_id, completed_at, handed_over_at, handover_kind) VALUES ($1, $2, $3, $4, $4, 'pickup')",
        [production, f.shopId, f.orderId, ENDED],
      );
      await tx.query(
        "INSERT INTO completion_photos (id, shop_id, production_id, position, storage_key, content_type, byte_size) VALUES ($1, $2, $3, 1, $4, 'image/webp', 10)",
        [completion, f.shopId, production, `shops/${f.shopId}/completion/${newUuid()}.webp`],
      );
      await tx.query("INSERT INTO reviews (id, shop_id, order_id, version, body) VALUES ($1, $2, $3, 1, '합성 후기')", [
        review,
        f.shopId,
        f.orderId,
      ]);
      await tx.query(
        "INSERT INTO review_photos (shop_id, review_id, position, storage_key, content_type, byte_size) VALUES ($1, $2, 1, $3, 'image/webp', 10)",
        [f.shopId, review, `shops/${f.shopId}/reviews/${newUuid()}.webp`],
      );
      await tx.query(
        "INSERT INTO photo_consents (id, shop_id, order_id, scope, completion_photo_id, consented, publishable) VALUES ($1, $2, $3, 'completion_photo', $4, true, true)",
        [consent, f.shopId, f.orderId, completion],
      );
      await tx.query(
        "INSERT INTO portfolio_items (shop_id, photo_consent_id, completion_photo_id) VALUES ($1, $2, $3)",
        [f.shopId, consent, completion],
      );
      await tx.query(
        "INSERT INTO ledger_rows (shop_id, order_id, first_written_at, last_written_at) VALUES ($1, $2, $3, $3)",
        [f.shopId, f.orderId, ENDED],
      );
    });
    return { f, payment, details, report, refund, card, change, referenceKey, issueKey };
  }
  async function preserved(f: ShopFixture) {
    const rows: Record<string, unknown> = {};
    for (const table of [
      "payments",
      "productions",
      "completion_photos",
      "reviews",
      "review_photos",
      "photo_consents",
      "portfolio_items",
      "ledger_rows",
    ])
      rows[table] = (await db.query(`SELECT * FROM ${table} WHERE shop_id = $1 ORDER BY id`, [f.shopId])).rows;
    rows.refunds = (
      await db.query(
        "SELECT id, order_id, amount, decision, sent_at, calc_basis FROM refunds WHERE shop_id = $1 ORDER BY id",
        [f.shopId],
      )
    ).rows;
    return rows;
  }
  it("받음 뒤 31일: 개인정보를 모두 비우고 이름만 분리하며 결제·환불·장부·완성 사진·후기·동의·게시를 보존", async () => {
    const x = await received(),
      before = await preserved(x.f);
    expect(await purge(x.f)).toBe(1);
    for (const [table, where, id] of [
      ["order_details", "order_id", x.f.orderId],
      ["order_drafts", "id", x.f.draftId],
    ]) {
      expect(
        (
          await db.query(
            `SELECT customer_name, customer_phone, allergy_answer, excluded_ingredients, lettering, design_notes FROM ${table} WHERE ${where} = $1`,
            [id],
          )
        ).rows,
      ).toEqual([
        {
          customer_name: null,
          customer_phone: null,
          allergy_answer: null,
          excluded_ingredients: null,
          lettering: null,
          design_notes: null,
        },
      ]);
    }
    expect(
      (
        await db.query(
          "SELECT allergy_consent, allergy_consent_version, allergy_consent_at FROM order_details WHERE order_id = $1",
          [x.f.orderId],
        )
      ).rows,
    ).toEqual([{ allergy_consent: "agreed", allergy_consent_version: "allergy-v1", allergy_consent_at: ENDED }]);
    expect(
      (
        await db.query(
          "SELECT refund_bank_name, refund_account_enc, refund_account_last4, refund_holder_name FROM refunds WHERE id = $1",
          [x.refund],
        )
      ).rows,
    ).toEqual([
      { refund_bank_name: null, refund_account_enc: null, refund_account_last4: null, refund_holder_name: null },
    ]);
    expect((await db.query("SELECT payload FROM confirm_cards WHERE id = $1", [x.card])).rows).toEqual([
      { payload: {} },
    ]);
    expect((await db.query("SELECT changes FROM change_requests WHERE id = $1", [x.change])).rows).toEqual([
      { changes: {} },
    ]);
    expect((await db.query("SELECT detail FROM owner_tasks WHERE shop_id = $1", [x.f.shopId])).rows).toEqual([
      { detail: null },
    ]);
    expect((await db.query("SELECT id FROM notifications WHERE order_id = $1", [x.f.orderId])).rows).toEqual([]);
    expect((await db.query("SELECT customer_name FROM kept_records WHERE order_id = $1", [x.f.orderId])).rows).toEqual([
      { customer_name: "시험손님" },
    ]);
    expect((await db.query("SELECT storage_key FROM file_deletions WHERE shop_id = $1", [x.f.shopId])).rows).toEqual([
      { storage_key: x.referenceKey },
    ]);
    expect((await db.query("SELECT description FROM issue_details WHERE id = $1", [x.details])).rows).toEqual([
      { description: "합성 신고 설명" },
    ]);
    expect(await preserved(x.f)).toEqual(before);
  });
  it("취소된 지 31일이어도 보내지 않은 환불이 있으면 끝나지 않은 주문이라 지우지 않음", async () => {
    const x = await received();
    await db.transaction(async (tx) => {
      await tx.query("UPDATE refunds SET sent_at = NULL WHERE id = $1", [x.refund]);
      await tx.query("UPDATE productions SET handed_over_at = NULL, handover_kind = NULL WHERE order_id = $1", [
        x.f.orderId,
      ]);
      await tx.query(
        "UPDATE orders SET status = 'cancelled', cancelled_at = $2, cancel_kind = 'customer', finished_at = NULL WHERE id = $1",
        [x.f.orderId, ENDED],
      );
    });
    const before = await snapshotShop(db, x.f);
    expect(await purge(x.f)).toBe(0);
    expect(await snapshotShop(db, x.f)).toEqual(before);
  });
  it("보상 재제작의 픽업이 14일 뒤이면 원래 주문은 아직 끝나지 않아 지우지 않음", async () => {
    const x = await received(),
      remake = newUuid(),
      pickup = new Date(NOW.getTime() + 14 * DAY);
    await db.transaction(async (tx) => {
      await tx.query("UPDATE orders SET finished_at = NULL WHERE id = $1", [x.f.orderId]);
      await tx.query(
        "INSERT INTO orders (id, shop_id, order_no, customer_id, consultation_id, kind, status, version, price_list_id, operating_rules_id, pickup_at, pickup_day, amount, confirmed_at, remake_of_order_id) SELECT $1, shop_id, $2, customer_id, consultation_id, 'standard', 'confirmed', 1, price_list_id, operating_rules_id, $3, $3::timestamptz::date, 0, $4, id FROM orders WHERE id = $5",
        [remake, newUuid().replaceAll("-", "").slice(0, 8).toUpperCase(), pickup, ENDED, x.f.orderId],
      );
      await tx.query(
        "INSERT INTO order_details (shop_id, order_id, version, source, price_list_id, pickup_at, size_option_id, flavor_option_id, allergy_consent, allergy_consent_at, amount) SELECT shop_id, $1, 1, 'remake', price_list_id, $2, size_option_id, flavor_option_id, 'not_required', $3, 0 FROM order_details WHERE order_id = $4 AND version = 1",
        [remake, pickup, ENDED, x.f.orderId],
      );
      const issue = newUuid();
      await tx.query(
        "INSERT INTO issue_details (id, shop_id, consultation_id, order_id, description, status) VALUES ($1, $2, $3, $4, '합성 재제작 신고', 'reported')",
        [issue, x.f.shopId, x.f.consultationId, x.f.orderId],
      );
      await tx.query(
        "INSERT INTO issue_reports (shop_id, order_id, issue_details_id, late, reported_by, status, compensation, decided_at, problem_kind, remake_order_id) VALUES ($1, $2, $3, false, 'owner_from_handoff', 'decided', 'remake', $4, 'other', $5)",
        [x.f.shopId, x.f.orderId, issue, ENDED, remake],
      );
    });
    const before = await snapshotShop(db, x.f);
    expect(await purge(x.f)).toBe(0);
    expect(await snapshotShop(db, x.f)).toEqual(before);
    // 끝나지 않은 재제작이 있는 원래 주문에 끝난 시각을 넣는 오류는 DB도 거절한다.
    await expect(
      db.query("UPDATE orders SET finished_at = $2 WHERE id = $1", [x.f.orderId, ENDED]),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("상담을 지워도 신고 내용·사진·보상은 남기고 에스컬레이션과 메시지 연결만 끊음", async () => {
    const x = await received(),
      handoff = newUuid();
    await db.transaction(async (tx) => {
      await tx.query("UPDATE consultations SET status = 'ended', ended_at = $2 WHERE id = $1", [
        x.f.consultationId,
        ENDED,
      ]);
      await tx.query(
        "INSERT INTO handoffs (id, shop_id, consultation_id, source_message_id, order_id, reason, status, closed_at) VALUES ($1, $2, $3, $4, $5, 'cannot_answer', 'closed_no_answer', $6)",
        [handoff, x.f.shopId, x.f.consultationId, x.f.messageId, x.f.orderId, ENDED],
      );
      await tx.query("UPDATE issue_reports SET handoff_id = $2 WHERE id = $1", [x.report, handoff]);
    });
    expect(await purge(x.f)).toBe(1);
    expect(await scoped(x.f).transaction((tx) => purgeConsultation(tx, x.f.consultationId, NOW))).toBe(1);
    expect(
      (await db.query("SELECT handoff_id, compensation FROM issue_reports WHERE id = $1", [x.report])).rows,
    ).toEqual([{ handoff_id: null, compensation: "partial_refund" }]);
    expect((await db.query("SELECT description FROM issue_details WHERE id = $1", [x.details])).rows).toEqual([
      { description: "합성 신고 설명" },
    ]);
    expect(
      (await db.query("SELECT message_id, storage_key FROM issue_photos WHERE issue_details_id = $1", [x.details]))
        .rows,
    ).toEqual([{ message_id: null, storage_key: x.issueKey }]);
    expect((await db.query("SELECT id FROM messages WHERE consultation_id = $1", [x.f.consultationId])).rows).toEqual(
      [],
    );
  });
  it("보관 주문은 완료 표시를 비워 다시 열 수 없음", async () => {
    const x = await received();
    expect(await purge(x.f)).toBe(1);
    await expect(db.query("UPDATE orders SET finished_at = NULL WHERE id = $1", [x.f.orderId])).rejects.toMatchObject({
      code: "23514",
    });
  });
  it("예전 상담을 지우는 트랜잭션 중에 온 손님 말은 새 상담으로 받고 손님 키를 보존", async () => {
    const x = await received();
    await linkTestChannel(db, x.f.channelId);
    await issueTestBookingLink(db, x.f);
    await db.query("UPDATE consultations SET status = 'ended', ended_at = $2 WHERE id = $1", [
      x.f.consultationId,
      ENDED,
    ]);
    expect(await purge(x.f)).toBe(1);
    const connection = testDb();
    const incomingDb = shopRequestDb(
      createShopScope(x.f.shopId, { kind: "customer", channelId: x.f.channelId }),
      connection,
    );
    const request: AuthorizedKakaoSkill = {
      scope: incomingDb.scope,
      channelId: x.f.channelId,
      status: "linked",
      receivedAt: NOW,
      requestKeySecret: new Secret(TEST_HASH_KEY),
      payload: {
        botId: x.f.botId,
        blockId: "test",
        userId: x.f.userKey,
        utterance: "합성 재방문",
        callbackUrl: undefined,
        isFriend: true,
        params: {},
        action: { params: {}, clientExtra: {} },
      },
    };
    try {
      await scoped(x.f).transaction(async (tx) => {
        await tx.run("SELECT id FROM consultations WHERE shop_id = $1 AND id = $2 FOR UPDATE", [x.f.consultationId]);
        const receipt = await receiveKakaoMessage(incomingDb, request, "text");
        expect(receipt.kind).toBe("received");
        if (receipt.kind !== "received") throw new Error("new consultation missing");
        expect(receipt.customerId).toBe(x.f.customerId);
        expect(receipt.consultationId).not.toBe(x.f.consultationId);
        expect(await purgeConsultation(tx, x.f.consultationId, NOW)).toBe(1);
      });
      expect(await scoped(x.f).transaction((tx) => purgeCustomerKey(tx, x.f.customerId, NOW))).toBe(0);
      expect(
        (await db.query("SELECT status FROM consultations WHERE customer_id = $1 ORDER BY status", [x.f.customerId]))
          .rows,
      ).toEqual([{ status: "deleted" }, { status: "open" }]);
      expect((await db.query("SELECT kakao_user_key FROM customers WHERE id = $1", [x.f.customerId])).rows).toEqual([
        { kakao_user_key: x.f.userKey },
      ]);
    } finally {
      await connection.close();
    }
  });
  it("5년 뒤에는 보관 이름도 없애고 주문·결제·환불·장부와 게시 근거는 유지", async () => {
    const x = await received();
    expect(await purge(x.f)).toBe(1);
    const before = await preserved(x.f);
    const kept = (await db.query<{ id: string }>("SELECT id FROM kept_records WHERE order_id = $1", [x.f.orderId]))
      .rows[0];
    if (kept === undefined) throw new Error("kept record missing");
    const future = new Date(NOW);
    future.setUTCFullYear(future.getUTCFullYear() + 5);
    expect(await scoped(x.f).transaction((tx) => purgeKeptIssue(tx, kept.id, future))).toBe(1);
    expect(await scoped(x.f).transaction((tx) => purgeKeptContract(tx, kept.id, future))).toBe(1);
    expect((await db.query("SELECT customer_name FROM kept_records WHERE order_id = $1", [x.f.orderId])).rows).toEqual(
      [],
    );
    expect((await db.query("SELECT id, amount, status FROM orders WHERE id = $1", [x.f.orderId])).rows).toEqual([
      { id: x.f.orderId, amount: 35000, status: "received" },
    ]);
    expect(await preserved(x.f)).toEqual(before);
  });
  it("키까지 지운 손님의 같은 채널 메시지는 예전 기록을 되살리지 않고 새 손님·상담으로 받음", async () => {
    const x = await received();
    await linkTestChannel(db, x.f.channelId);
    await issueTestBookingLink(db, x.f);
    await db.query("UPDATE consultations SET status = 'ended', ended_at = $2 WHERE id = $1", [
      x.f.consultationId,
      ENDED,
    ]);
    expect(await purge(x.f)).toBe(1);
    expect(await scoped(x.f).transaction((tx) => purgeConsultation(tx, x.f.consultationId, NOW))).toBe(1);
    expect(await scoped(x.f).transaction((tx) => purgeCustomerKey(tx, x.f.customerId, NOW))).toBe(1);
    const incomingDb = shopRequestDb(createShopScope(x.f.shopId, { kind: "customer", channelId: x.f.channelId }), db);
    const receipt = await receiveKakaoMessage(
      incomingDb,
      {
        scope: incomingDb.scope,
        channelId: x.f.channelId,
        status: "linked",
        receivedAt: NOW,
        requestKeySecret: new Secret(TEST_HASH_KEY),
        payload: {
          botId: x.f.botId,
          blockId: "test",
          userId: x.f.userKey,
          utterance: "합성 새 방문",
          callbackUrl: undefined,
          isFriend: true,
          params: {},
          action: { params: {}, clientExtra: {} },
        },
      },
      "text",
    );
    expect(receipt.kind).toBe("received");
    if (receipt.kind !== "received") throw new Error("new customer missing");
    expect(receipt.customerId).not.toBe(x.f.customerId);
    expect(receipt.consultationId).not.toBe(x.f.consultationId);
    expect(
      (await db.query("SELECT kakao_user_key, purged_at FROM customers WHERE id = $1", [x.f.customerId])).rows,
    ).toEqual([{ kakao_user_key: null, purged_at: NOW }]);
    expect(
      (await db.query("SELECT status, ai_disclosed_at FROM consultations WHERE id = $1", [receipt.consultationId]))
        .rows,
    ).toEqual([{ status: "open", ai_disclosed_at: null }]);
  });
});
