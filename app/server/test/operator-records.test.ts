/** 합성 운영자 세션과 실제 로컬 DB로 개인정보 표시·접속기록 계약을 검사한다. */
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createApp } from "../src/app";
import { accessLogRows, CLIENT_IP_HEADER, expectOneAccessRow, TEST_IPV4 } from "./support/access-log";
import { expectSchema } from "./support/contract";
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
        await fc.seal(PHONE, { purpose: "masked_values.original", shopId: shop.shopId }),
        await fc.valueHash(["operator-fixture", shop.shopId, PHONE]),
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
      expect(body.maskedValue).toEqual({ placeholder: "[전화번호1]", kind: "phone", value: PHONE });
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
    for (const value of [NAME, PHONE, PRIVATE_TEXT]) {
      expect(JSON.stringify(stored)).not.toContain(value);
      expect(JSON.stringify(access)).not.toContain(value);
      expect(logs.join("\n")).not.toContain(value);
    }
  });
});
