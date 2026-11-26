/** 합성 운영자 세션과 실제 로컬 DB로 개인정보 표시·접속기록 계약을 검사한다. */
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createApp } from "../src/app";
import { purgeOrder } from "../src/purge-order";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { accessLogRows, CLIENT_IP_HEADER, expectOneAccessRow, TEST_IPV4 } from "./support/access-log";
import { createConsentWithdrawalFixture } from "./support/consent-withdrawal-fixture";
import { expectProblem, expectSchema } from "./support/contract";
import { describeDb, newRequestKey, newUuid, testEnv } from "./support/db";
import { singleKeyCrypto } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { seedOperatorSession } from "./support/operator";
import { createShop, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-28T06:00:00Z"),
  ORIGIN = "https://siljang.example";
const PRIVATE_TEXT = "이지우인데 땅콩 알레르기가 있어요. 연락은 [전화번호1]";
const NAME = "이지우",
  PHONE = "010-2468-5678";
const DIGITS = PHONE.replaceAll("-", "");
describeDb("운영자 가게 기록과 사유 있는 열기(TASK-159)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture;
  let app: ReturnType<typeof createApp>, session: Awaited<ReturnType<typeof seedOperatorSession>>, maskedId: string;
  const { fc } = singleKeyCrypto();
  const logs: string[] = [];
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  afterAll(async () => {
    await isolated?.close();
  });
  beforeEach(async () => {
    logs.length = 0;
    shop = await createShop(isolated.db, "합성 운영자 기록 가게");
    session = await seedOperatorSession(isolated.db, NOW);
    maskedId = newUuid();
    await isolated.db.query(
      "UPDATE order_details SET customer_name=$2,customer_phone=$3,allergy_consent='agreed',allergy_consent_version='v1',allergy_consent_at=$4,allergy_answer='땅콩',excluded_ingredients='호두' WHERE order_id=$1",
      [shop.orderId, NAME, PHONE, NOW],
    );
    await isolated.db.query("UPDATE messages SET body_masked=$2,created_at=$3 WHERE id=$1", [
      shop.messageId,
      PRIVATE_TEXT,
      NOW,
    ]);
    await isolated.db.query(
      "INSERT INTO masked_values(id,shop_id,consultation_id,kind,placeholder,original_enc,value_hmac,last4) VALUES($1,$2,$3,'phone','[전화번호1]',$4,$5,'5678')",
      [
        maskedId,
        shop.shopId,
        shop.consultationId,
        await fc.seal(DIGITS, { purpose: "masked_values.original", shopId: shop.shopId }),
        await fc.valueHash(["masked_values", shop.shopId, shop.consultationId, "phone", DIGITS]),
      ],
    );
    app = createApp({
      connect: () => isolated.connect(),
      services: { now: () => NOW, fieldCrypto: fc },
      logSink: (line) => logs.push(line),
    });
  });
  const call = async (suffix: string, init: RequestInit = {}) =>
    app.request(
      `${ORIGIN}/api/operator/shops/${shop.shopId}${suffix}`,
      { ...init, headers: { cookie: session.cookie, [CLIENT_IP_HEADER]: TEST_IPV4, ...init.headers } },
      testEnv(),
    );
  const open = (targetKind: string, targetId: string, reason = "손님 문의: 픽업 연락 확인", key = newRequestKey()) =>
    call("/originals", {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ targetKind, targetId, reason }),
    });
  it("API074 주문 목록은 가린 연락처만 보이고 읽음 접속기록 한 행을 남긴다", async () => {
    const { text } = await expectOneAccessRow(isolated.db, shop.shopId, () => call("/records"), {
      action: "read",
      api_id: "API-074",
      actor_kind: "operator",
      operator_id: session.operatorId,
      subject_ids: [shop.customerId],
    });
    const body = JSON.parse(text);
    expectSchema("OperatorRecordList", body);
    expect(body.orders).toHaveLength(1);
    expect(body.orders[0]).toMatchObject({ orderId: shop.orderId, customerNameMasked: "이**" });
    for (const value of [NAME, PHONE, "땅콩", "호두", PRIVATE_TEXT]) expect(text).not.toContain(value);
  });
  it("API075는 메시지 글/사진 없이 메타데이터와 플레이스홀더 끝 네 자리만 보인다", async () => {
    const { text } = await expectOneAccessRow(
      isolated.db,
      shop.shopId,
      () => call(`/consultations/${shop.consultationId}`),
      { action: "read", api_id: "API-075" },
    );
    const body = JSON.parse(text);
    expectSchema("OperatorConsultation", body);
    expect(body.maskedValues).toEqual([
      { maskedValueId: maskedId, kind: "phone", placeholder: "[전화번호1]", last4: "5678", originalKept: true },
    ]);
    expect(body.items[0]).toMatchObject({
      messageId: shop.messageId,
      author: "customer",
      textLength: [...PRIVATE_TEXT].length,
    });
    for (const value of [PRIVATE_TEXT, PHONE, NAME, "땅콩", "body_masked", "storage_key"])
      expect(text).not.toContain(value);
  });
  it("API076는 건강 답의 있음과 가린 이름·전화만 보인다", async () => {
    const { text } = await expectOneAccessRow(isolated.db, shop.shopId, () => call(`/orders/${shop.orderId}`), {
      action: "read",
      api_id: "API-076",
    });
    const body = JSON.parse(text);
    expectSchema("OperatorOrder", body);
    expect(body).toMatchObject({
      orderId: shop.orderId,
      customerNameMasked: "이**",
      allergyAnswered: true,
      excludedIngredientsAnswered: true,
    });
    for (const value of [NAME, PHONE, "땅콩", "호두", "storage_key"]) expect(text).not.toContain(value);
  });
  it("API075는 참고·후기 사진 장수만 읽고 저장 경로는 보이지 않는다", async () => {
    const fixture = await createConsentWithdrawalFixture(isolated.db, NOW);
    shop = fixture.shop;
    const messageId = newUuid();
    await isolated.db.query("UPDATE messages SET kind='photo',body_masked='[사진]' WHERE id=$1", [shop.messageId]);
    await isolated.db.query(
      "INSERT INTO reference_photos(shop_id,draft_id,message_id,position,storage_key,content_type,byte_size) VALUES($1,$2,$3,1,$4,'image/jpeg',1)",
      [shop.shopId, shop.draftId, shop.messageId, `shops/${shop.shopId}/reference/${shop.messageId}/1`],
    );
    await isolated.db.query(
      "INSERT INTO messages(id,shop_id,consultation_id,direction,author,kind,kakao_message_id,body_masked,created_at) VALUES($1,$2,$3,'inbound','customer','photo',$4,'[사진]',$5)",
      [messageId, shop.shopId, shop.consultationId, await fc.valueHash(["fixture", messageId]), NOW],
    );
    await isolated.db.query("UPDATE review_photos SET storage_key=$2 WHERE review_id=$1", [
      fixture.review,
      `shops/${shop.shopId}/review/${messageId}/1`,
    ]);
    await isolated.db.query(
      "INSERT INTO review_photos(shop_id,review_id,position,storage_key,content_type,byte_size) VALUES($1,$2,2,$3,'image/jpeg',1)",
      [shop.shopId, fixture.review, `shops/${shop.shopId}/review/${messageId}/2`],
    );
    const response = await call(`/consultations/${shop.consultationId}`),
      text = await response.text();
    expect(response.status, text).toBe(200);
    const body = JSON.parse(text);
    expectSchema("OperatorConsultation", body);
    expect(body.items.find((item: { messageId: string }) => item.messageId === shop.messageId)).toMatchObject({
      photoCount: 1,
      textLength: 0,
    });
    expect(body.items.find((item: { messageId: string }) => item.messageId === messageId)).toMatchObject({
      photoCount: 2,
      textLength: 0,
    });
    expect(text).not.toContain("storage_key");
    expect(text).not.toContain(`shops/${shop.shopId}`);
  });
  it("API075의 지운 상담은 남은 원문/마스킹 행이 있어도 빈 목록만 보인다", async () => {
    await isolated.db.query("UPDATE consultations SET status='deleted',deleted_at=$2 WHERE id=$1", [
      shop.consultationId,
      NOW,
    ]);
    const response = await call(`/consultations/${shop.consultationId}`),
      text = await response.text();
    expect(response.status, text).toBe(200);
    const body = JSON.parse(text);
    expectSchema("OperatorConsultation", body);
    expect(body).toMatchObject({ status: "deleted", maskedValues: [], items: [], nextCursor: null });
    for (const value of [NAME, PHONE, PRIVATE_TEXT, maskedId]) expect(text).not.toContain(value);
  });
  it("API077는 사유 있는 전화 원본 하나만 열고 같은 요청 키 재열기도 매번 기록한다", async () => {
    const key = newRequestKey();
    for (let i = 0; i < 2; i++) {
      const { text, res } = await expectOneAccessRow(
        isolated.db,
        shop.shopId,
        () => open("masked_value", maskedId, "손님 문의: 픽업 연락 확인", key),
        {
          action: "open_original",
          api_id: "API-077",
          operator_id: session.operatorId,
          target_kind: "masked_value",
          target_id: maskedId,
          reason: "손님 문의: 픽업 연락 확인",
        },
      );
      const body = JSON.parse(text);
      expectSchema("OriginalValue", body);
      expect(body.maskedValue).toEqual({ placeholder: "[전화번호1]", kind: "phone", value: DIGITS });
      expect(body.orderContact).toBeNull();
      expect(body.consultationText).toBeNull();
      if (i === 1) expect(res.headers.get("Idempotency-Replayed")).toBe("true");
    }
    const stored = (
      await isolated.db.query(
        "SELECT response_ref::text FROM request_keys WHERE actor_kind='operator' AND actor_id=$1",
        [session.operatorId],
      )
    ).rows;
    const access = await accessLogRows(isolated.db, shop.shopId);
    for (const value of [NAME, PHONE, DIGITS, PRIVATE_TEXT]) {
      expect(JSON.stringify(stored)).not.toContain(value);
      expect(JSON.stringify(access)).not.toContain(value);
      expect(logs.join("\n")).not.toContain(value);
    }
  });
  it.each(["order_contact", "consultation_text"] as const)(
    "API077의 %s는 사유를 적어 대상 하나만 열고 기록한다",
    async (targetKind) => {
      const targetId = targetKind === "order_contact" ? shop.orderId : shop.consultationId;
      const { text } = await expectOneAccessRow(isolated.db, shop.shopId, () => open(targetKind, targetId), {
        action: "open_original",
        api_id: "API-077",
        target_kind: targetKind,
        target_id: targetId,
        subject_ids: [shop.customerId],
      });
      const body = JSON.parse(text);
      expectSchema("OriginalValue", body);
      expect(body.maskedValue).toBeNull();
      expect(body.refundAccount).toBeNull();
      expect(body.keptRecord).toBeNull();
      if (targetKind === "order_contact") {
        expect(body.orderContact).toEqual({ customerName: NAME, customerPhone: PHONE });
        expect(body.consultationText).toBeNull();
      } else {
        expect(body.consultationText.items[0]).toMatchObject({ messageId: shop.messageId, textMasked: PRIVATE_TEXT });
        expect(body.orderContact).toBeNull();
        expect(text).not.toContain(PHONE);
        expect(text).not.toContain(DIGITS);
      }
    },
  );
  it.each(["card", "long_number"] as const)("API077의 %s 원본은 두지 않고 열기 기록도 남기지 않는다", async (kind) => {
    const id = newUuid();
    await isolated.db.query(
      "INSERT INTO masked_values(id,shop_id,consultation_id,kind,placeholder,last4) VALUES($1,$2,$3,$4,$5,$6)",
      [
        id,
        shop.shopId,
        shop.consultationId,
        kind,
        kind === "card" ? "[카드번호1]" : "[긴숫자1]",
        kind === "card" ? "1111" : null,
      ],
    );
    await expectProblem(await open("masked_value", id), "original_not_kept");
    expect(await accessLogRows(isolated.db, shop.shopId)).toHaveLength(0);
  });
  async function finish(ageDays = 0) {
    const at = new Date(NOW.getTime() - ageDays * 86400000);
    await isolated.db.transaction(async (tx) => {
      await tx.query(
        "UPDATE payment_requests SET status='closed',closed_at=$2,close_reason='order_cancelled' WHERE order_id=$1",
        [shop.orderId, at],
      );
      await tx.query(
        "UPDATE orders SET status='cancelled',cancelled_at=$2,cancel_kind='no_payment',finished_at=$2,lock_version=lock_version+1 WHERE id=$1",
        [shop.orderId, at],
      );
    });
  }
  it("API077의 환불 계좌는 실제 암호화 도구로 둔 값 하나만 연다", async () => {
    await finish();
    const refundId = newUuid(),
      account = "110-123-456789";
    await isolated.db.query(
      "INSERT INTO refunds(id,shop_id,order_id,cause,cancelled_order_id,decision,amount,calculated_amount,calc_basis,refund_bank_name,refund_account_enc,refund_account_last4,refund_holder_name,decided_at,event_key) VALUES($1,$2,$3,'customer_cancel',$3,'none',0,0,'{}','합성은행',$4,'6789',$5,$6,'refund:'||$3::uuid::text||':customer_cancel')",
      [
        refundId,
        shop.shopId,
        shop.orderId,
        await fc.seal(account, { purpose: "refunds.refund_account", shopId: shop.shopId }),
        NAME,
        NOW,
      ],
    );
    const { text } = await expectOneAccessRow(isolated.db, shop.shopId, () => open("refund_account", refundId), {
      action: "open_original",
      api_id: "API-077",
      target_kind: "refund_account",
      target_id: refundId,
    });
    const body = JSON.parse(text);
    expectSchema("OriginalValue", body);
    expect(body.refundAccount).toEqual({ bankName: "합성은행", accountNumber: account, holderName: NAME });
    expect(body.orderContact).toBeNull();
    expect(body.maskedValue).toBeNull();
    expect(JSON.stringify(await accessLogRows(isolated.db, shop.shopId))).not.toContain(account);
    expect(logs.join("\n")).not.toContain(account);
  });
  it("실제 지우기 뒤 목록은 보관 기간만 보이고 사유로 연 계약 기록만 이름을 보인다", async () => {
    await finish(31);
    const scoped = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "purge" }), isolated.db);
    expect(await scoped.transaction((tx) => purgeOrder(tx, shop.orderId, NOW))).toBe(1);
    const kept = (
      await isolated.db.query<{ id: string }>("SELECT id FROM kept_records WHERE shop_id=$1 AND order_id=$2", [
        shop.shopId,
        shop.orderId,
      ])
    ).rows[0];
    if (!kept) throw new Error("보관 기록이 없어요");
    const list = await call("/records"),
      listText = await list.text();
    expect(list.status, listText).toBe(200);
    const listBody = JSON.parse(listText);
    expectSchema("OperatorRecordList", listBody);
    expect(listBody.orders[0]).toMatchObject({
      kept: true,
      keptRecordId: kept.id,
      customerNameMasked: null,
      customerPhoneMasked: null,
      status: null,
      pickupAt: null,
      amount: null,
    });
    expect(listText).not.toContain(NAME);
    const { text } = await expectOneAccessRow(
      isolated.db,
      shop.shopId,
      () => open("kept_record", kept.id, "사장님 요청: 보관 계약 확인"),
      { action: "open_kept", api_id: "API-077", target_kind: "kept_record", target_id: kept.id },
    );
    const body = JSON.parse(text);
    expectSchema("OriginalValue", body);
    expect(body.keptRecord).toMatchObject({ keptRecordId: kept.id, customerName: NAME });
    expect(body.keptRecord.details).toHaveLength(1);
    for (const value of [PHONE, DIGITS, "땅콩", "호두", PRIVATE_TEXT]) expect(text).not.toContain(value);
    const before = (await accessLogRows(isolated.db, shop.shopId)).length;
    await expectProblem(await call(`/orders/${shop.orderId}`), "not_found");
    await expectProblem(await open("order_contact", shop.orderId), "original_erased");
    expect(await accessLogRows(isolated.db, shop.shopId)).toHaveLength(before);
  });
});
