/** 합성 운영자 세션과 실제 로컬 DB로 개인정보 표시·접속기록 계약을 검사한다. */
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createApp } from "../src/app";
import { purgeConsultation } from "../src/purge-consultation";
import { purgeKeptContract } from "../src/purge-kept";
import { purgeOrder } from "../src/purge-order";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import {
  accessLogRows,
  CLIENT_IP_HEADER,
  expectFailClosed,
  expectOneAccessRow,
  failingAccessInsert,
  TEST_IPV4,
} from "./support/access-log";
import { createConsentWithdrawalFixture } from "./support/consent-withdrawal-fixture";
import { expectProblem, expectSchema } from "./support/contract";
import { describeDb, newRequestKey, newUuid, testEnv } from "./support/db";
import { singleKeyCrypto } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { seedOperatorSession } from "./support/operator";
import { createShop, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-21T06:00:00Z"),
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
  const open = (
    targetKind: string,
    targetId: string,
    reason = "손님 문의: 픽업 연락 확인",
    key = newRequestKey(),
    cursor?: string,
  ) =>
    call("/originals", {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ targetKind, targetId, reason, ...(cursor === undefined ? {} : { cursor }) }),
    });
  const textPageCursor = async (id = shop.consultationId) => {
    const response = await call(`/consultations/${id}`);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as { textCursor: string };
    return body.textCursor;
  };
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
      const cursor = targetKind === "consultation_text" ? await textPageCursor() : undefined;
      const { text } = await expectOneAccessRow(
        isolated.db,
        shop.shopId,
        () => open(targetKind, targetId, "손님 문의: 픽업 연락 확인", newRequestKey(), cursor),
        {
          action: "open_original",
          api_id: "API-077",
          target_kind: targetKind,
          target_id: targetId,
          subject_ids: [shop.customerId],
        },
      );
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
    await isolated.db.query("UPDATE refunds SET refund_holder_name='*별' WHERE id=$1", [refundId]);
    const masked = await call(`/orders/${shop.orderId}`),
      maskedText = await masked.text();
    expect(masked.status, maskedText).toBe(200);
    const maskedBody = JSON.parse(maskedText);
    expectSchema("OperatorOrder", maskedBody);
    expect(maskedBody.refunds[0].refundAccount).toMatchObject({
      accountMasked: "***-****-6789",
      holderNameMasked: null,
    });
    expect(maskedText).not.toContain(account);
    expect(maskedText).not.toContain("*별");
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
  it.each(["/records", "/consultations/current", "/orders/current"])(
    "읽음 기록 저장 실패 %s는 응답에 개인정보를 내보내지 않는다",
    async (path) => {
      app = createApp({
        connect: failingAccessInsert(() => isolated.connect()),
        services: { now: () => NOW, fieldCrypto: fc },
        logSink: (line) => logs.push(line),
      });
      const suffix = path
        .replace("consultations/current", `consultations/${shop.consultationId}`)
        .replace("orders/current", `orders/${shop.orderId}`);
      await expectFailClosed(isolated.db, shop.shopId, () => call(suffix), [NAME, PHONE, DIGITS, PRIVATE_TEXT]);
      expect(logs.join("\n")).not.toContain(NAME);
      expect(logs.join("\n")).not.toContain(PRIVATE_TEXT);
    },
  );
  it.each(["masked_value", "order_contact", "consultation_text"])(
    "%s 열기 기록 저장 실패는 본문과 요청 키 완료를 되돌린다",
    async (kind) => {
      const cursor = kind === "consultation_text" ? await textPageCursor() : undefined;
      app = createApp({
        connect: failingAccessInsert(() => isolated.connect()),
        services: { now: () => NOW, fieldCrypto: fc },
        logSink: (line) => logs.push(line),
      });
      const id = kind === "masked_value" ? maskedId : kind === "order_contact" ? shop.orderId : shop.consultationId;
      await expectFailClosed(
        isolated.db,
        shop.shopId,
        () => open(kind, id, "손님 문의: 픽업 연락 확인", newRequestKey(), cursor),
        [NAME, PHONE, DIGITS, PRIVATE_TEXT],
      );
      expect(
        (await isolated.db.query("SELECT 1 FROM request_keys WHERE actor_id=$1", [session.operatorId])).rowCount,
      ).toBe(0);
      for (const value of [NAME, PHONE, DIGITS, PRIVATE_TEXT]) expect(logs.join("\n")).not.toContain(value);
    },
  );
  it("같은 키 재열기도 기록 저장이 실패하면 앞 원문을 반환하지 않는다", async () => {
    const key = newRequestKey();
    expect((await open("masked_value", maskedId, "손님 문의: 픽업 연락 확인", key)).status).toBe(200);
    app = createApp({
      connect: failingAccessInsert(() => isolated.connect()),
      services: { now: () => NOW, fieldCrypto: fc },
      logSink: (line) => logs.push(line),
    });
    await expectFailClosed(
      isolated.db,
      shop.shopId,
      () => open("masked_value", maskedId, "손님 문의: 픽업 연락 확인", key),
      [DIGITS],
    );
    expect(await accessLogRows(isolated.db, shop.shopId)).toHaveLength(1);
  });
  it.each(["/records", "/consultations/current", "/orders/current", "/originals"])(
    "%s는 쿠키가 없으면401이고 값을 보이지 않는다",
    async (path) => {
      const suffix = path
        .replace("consultations/current", `consultations/${shop.consultationId}`)
        .replace("orders/current", `orders/${shop.orderId}`);
      const response =
        path === "/originals"
          ? await call(suffix, {
              method: "POST",
              headers: {
                cookie: "",
                origin: ORIGIN,
                "content-type": "application/json",
                "Idempotency-Key": newRequestKey(),
              },
              body: JSON.stringify({ targetKind: "order_contact", targetId: shop.orderId, reason: "손님 문의 확인" }),
            })
          : await call(suffix, { headers: { cookie: "" } });
      await expectProblem(response, "unauthenticated");
      expect(await accessLogRows(isolated.db, shop.shopId)).toHaveLength(0);
    },
  );
  it.each(["", "짧음", "x".repeat(201)])("유효하지 않은 사유는422이고 열기·접속기록이 없다(%s)", async (reason) => {
    await expectProblem(await open("order_contact", shop.orderId, reason), "validation_failed");
    expect(await accessLogRows(isolated.db, shop.shopId)).toHaveLength(0);
  });
  it("처음 연 뒤 개인정보를 지우면 같은 키도 현재 지워짐409로 닫힌다", async () => {
    const key = newRequestKey();
    expect((await open("order_contact", shop.orderId, "손님 문의: 픽업 연락 확인", key)).status).toBe(200);
    await finish(31);
    const scoped = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "purge" }), isolated.db);
    expect(await scoped.transaction((tx) => purgeOrder(tx, shop.orderId, NOW))).toBe(1);
    await expectProblem(await open("order_contact", shop.orderId, "손님 문의: 픽업 연락 확인", key), "original_erased");
    expect(await accessLogRows(isolated.db, shop.shopId)).toHaveLength(1);
  });
  it("지운 상담의 글과 번호는 남은 행이 있어도409이고 복호화하지 않는다", async () => {
    await isolated.db.query("UPDATE consultations SET status='deleted',deleted_at=$2 WHERE id=$1", [
      shop.consultationId,
      NOW,
    ]);
    for (const [kind, id] of [
      ["consultation_text", shop.consultationId],
      ["masked_value", maskedId],
    ] as const)
      await expectProblem(
        await open(
          kind,
          id,
          "손님 문의: 픽업 연락 확인",
          newRequestKey(),
          kind === "consultation_text" ? "example_text_page_cursor" : undefined,
        ),
        "original_erased",
      );
    expect(await accessLogRows(isolated.db, shop.shopId)).toHaveLength(0);
  });
  it("봉투가 같은 가게의 다른 값으로 바뀌면 HMAC과 끝4자리 불일치로500·열기0이다", async () => {
    await isolated.db.query("UPDATE masked_values SET original_enc=$2 WHERE id=$1", [
      maskedId,
      await fc.seal("01011115678", { purpose: "masked_values.original", shopId: shop.shopId }),
    ]);
    await expectFailClosed(isolated.db, shop.shopId, () => open("masked_value", maskedId), ["01011115678", DIGITS]);
  });
  it("같은 키에 다른 사유·대상은422이고 원문을 다시 열지 않는다", async () => {
    const key = newRequestKey();
    expect((await open("order_contact", shop.orderId, "손님 문의: 픽업 연락 확인", key)).status).toBe(200);
    await expectProblem(
      await open("order_contact", shop.orderId, "분쟁 문의: 계약 사실 확인", key),
      "idempotency_key_reused",
    );
    await expectProblem(
      await open(
        "consultation_text",
        shop.consultationId,
        "손님 문의: 픽업 연락 확인",
        key,
        "example_text_page_cursor",
      ),
      "idempotency_key_reused",
    );
    expect(await accessLogRows(isolated.db, shop.shopId)).toHaveLength(1);
  });
  it.each([
    "/records?limit=0",
    "/records?kind=private",
    "/records?cursor=wrong",
    "/consultations/current?limit=101",
    "/consultations/current?cursor=wrong",
  ])("목록/상담의 잘못된 페이지는422이고 읽음0이다(%s)", async (path) => {
    await expectProblem(
      await call(path.replace("consultations/current", `consultations/${shop.consultationId}`)),
      "validation_failed",
    );
    expect(await accessLogRows(isolated.db, shop.shopId)).toHaveLength(0);
  });
  it("메시지 페이지는 마이크로초·2^53 밖 순번을 잃지 않고 같은 커서로 글20개까지만 연다", async () => {
    const base = "9007199254740993";
    await isolated.db.query(
      "UPDATE messages SET timeline_seq=$2,created_at='2026-11-28T06:00:00.000001Z' WHERE id=$1",
      [shop.messageId, base],
    );
    await isolated.db.query(
      "INSERT INTO messages(shop_id,consultation_id,direction,author,kind,body_masked,created_at,timeline_seq,kakao_message_id) SELECT $1,$2,'inbound','customer','text','페이지 합성 글 [전화번호1]','2026-11-28T06:00:00.000001Z'::timestamptz+CASE WHEN i>20 THEN interval '1 microsecond' ELSE interval '0' END,$3::bigint+i,repeat(md5(gen_random_uuid()::text),2) FROM generate_series(1,22) i",
      [shop.shopId, shop.consultationId, base],
    );
    const expected = (
      await isolated.db.query<{ id: string }>(
        "SELECT id FROM messages WHERE shop_id=$1 AND consultation_id=$2 ORDER BY created_at,timeline_seq",
        [shop.shopId, shop.consultationId],
      )
    ).rows.map((x) => x.id);
    const page = async (cursor?: string) => {
      const res = await call(`/consultations/${shop.consultationId}?limit=10${cursor ? `&cursor=${cursor}` : ""}`),
        text = await res.text();
      expect(res.status, text).toBe(200);
      const body = JSON.parse(text);
      expectSchema("OperatorConsultation", body);
      return body as { items: { messageId: string }[]; nextCursor: string | null; textCursor: string };
    };
    const first = await page();
    expect(first.items.map((x) => x.messageId)).toEqual(expected.slice(0, 10));
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]{179,181}$/);
    const firstOpen = await open(
      "consultation_text",
      shop.consultationId,
      "손님 문의: 픽업 연락 확인",
      newRequestKey(),
      first.textCursor,
    );
    const firstBody = (await firstOpen.json()) as { consultationText: { items: unknown[] } };
    expect(firstBody.consultationText.items).toHaveLength(10);
    if (!first.nextCursor) throw new Error("페이지 커서 없음");
    const secondForOpen = await page(first.nextCursor);
    const opened = await call("/originals", {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json", "Idempotency-Key": newRequestKey() },
      body: JSON.stringify({
        targetKind: "consultation_text",
        targetId: shop.consultationId,
        reason: "손님 문의: 대화 글 확인",
        cursor: secondForOpen.textCursor,
      }),
    });
    const openedBody = (await opened.json()) as {
      consultationText: { items: { messageId: string; textMasked: string }[] };
    };
    expect(opened.status).toBe(200);
    expectSchema("OriginalValue", openedBody);
    expect(openedBody.consultationText.items.map((x) => x.messageId)).toEqual(expected.slice(10, 20));
    expect(JSON.stringify(openedBody)).toContain("[전화번호1]");
    expect(JSON.stringify(openedBody)).not.toContain(DIGITS);
    // 이미 지나간 위치에 새 행을 넣어도 뒤 페이지는 중복/누락 없이 이어진다.
    await isolated.db.query(
      "INSERT INTO messages(shop_id,consultation_id,direction,author,kind,body_masked,created_at,kakao_message_id) VALUES($1,$2,'inbound','customer','text','뒤늦게 저장한 합성 글','2026-11-28T06:00:00.000000Z',repeat(md5(gen_random_uuid()::text),2))",
      [shop.shopId, shop.consultationId],
    );
    const second = await page(first.nextCursor);
    if (!second.nextCursor) throw new Error("셋째 페이지 커서 없음");
    const third = await page(second.nextCursor);
    expect(third.nextCursor).toBeNull();
    expect([...first.items, ...second.items, ...third.items].map((x) => x.messageId)).toEqual(expected);
    const before = (await accessLogRows(isolated.db, shop.shopId)).length;
    const other = await createShop(isolated.db, "다른 페이지 상담");
    await expectProblem(
      await call(`/consultations/${other.consultationId}?cursor=${first.nextCursor}`),
      "validation_failed",
    );
    await expectProblem(await call(`/records?cursor=${first.nextCursor}`), "validation_failed");
    await expectProblem(
      await call("/originals", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json", "Idempotency-Key": newRequestKey() },
        body: JSON.stringify({
          targetKind: "consultation_text",
          targetId: other.consultationId,
          reason: "손님 문의: 대화 글 확인",
          cursor: first.nextCursor,
        }),
      }),
      "not_found",
    );
    expect(await accessLogRows(isolated.db, shop.shopId)).toHaveLength(before);
  });
  it("상담 목록은 마이크로초 동률을 ID로 이어 읽고 주문 목록 커서와 섞지 않는다", async () => {
    await isolated.db.query("UPDATE consultations SET opened_at='2026-11-28T05:00:00.000001Z' WHERE id=$1", [
      shop.consultationId,
    ]);
    await isolated.db.query(
      "INSERT INTO consultations(shop_id,customer_id,status,opened_at,ended_at) SELECT $1,$2,'ended','2026-11-28T05:00:00.000001Z'::timestamptz+CASE WHEN i>2 THEN interval '1 microsecond' ELSE interval '0' END,'2026-11-28T05:00:00Z' FROM generate_series(1,4) i",
      [shop.shopId, shop.customerId],
    );
    const expected = (
      await isolated.db.query<{ id: string }>(
        "SELECT id FROM consultations WHERE shop_id=$1 ORDER BY opened_at DESC,id DESC",
        [shop.shopId],
      )
    ).rows.map((x) => x.id);
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await call(`/records?kind=consultations&limit=2${cursor ? `&cursor=${cursor}` : ""}`),
        body = (await response.json()) as { consultations: { consultationId: string }[]; nextCursor: string | null };
      expect(response.status).toBe(200);
      expectSchema("OperatorRecordList", body);
      ids.push(...body.consultations.map((x) => x.consultationId));
      cursor = body.nextCursor;
      if (cursor) await expectProblem(await call(`/records?kind=orders&cursor=${cursor}`), "validation_failed");
    } while (cursor);
    expect(ids).toEqual(expected);
    expect(new Set(ids).size).toBe(5);
  });
  it("연락처 원문을 읽는 동안 실제 주문 지우기는 건너뛰고 잠금 해제 뒤 지운다", async () => {
    await finish(31);
    const reader = isolated.connect(),
      purger = isolated.connect();
    const scoped = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "purge" }), purger);
    try {
      await reader.transaction(async (tx) => {
        const opened = await tx.query<{ source: { state: string } }>(
          "SELECT source FROM read_operator_original($1,$2,'order_contact',$3,'{}',$4)",
          [shop.shopId, session.operatorId, shop.orderId, NOW],
        );
        expect(opened.rows[0]?.source.state).toBe("ready");
        expect(await scoped.transaction((tx) => purgeOrder(tx, shop.orderId, NOW))).toBe(0);
      });
      expect(await scoped.transaction((tx) => purgeOrder(tx, shop.orderId, NOW))).toBe(1);
      await expectProblem(await open("order_contact", shop.orderId), "original_erased");
    } finally {
      await Promise.allSettled([reader.close(), purger.close()]);
    }
  });
  it("상담 글을 읽는 동안 실제 상담 지우기는 건너뛰고 해제 뒤 글·번호를 지운다", async () => {
    await finish(31);
    const job = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "purge" }), isolated.db);
    expect(await job.transaction((tx) => purgeOrder(tx, shop.orderId, NOW))).toBe(1);
    await isolated.db.query("UPDATE consultations SET status='ended',ended_at=$2 WHERE id=$1", [
      shop.consultationId,
      new Date(NOW.getTime() - 31 * 86400000),
    ]);
    const reader = isolated.connect(),
      purger = isolated.connect(),
      scoped = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "purge" }), purger);
    try {
      await reader.transaction(async (tx) => {
        expect(
          (
            await tx.query("SELECT * FROM read_operator_original($1,$2,'consultation_text',$3,'{}',$4)", [
              shop.shopId,
              session.operatorId,
              shop.consultationId,
              NOW,
            ])
          ).rowCount,
        ).toBe(1);
        expect(await scoped.transaction((tx) => purgeConsultation(tx, shop.consultationId, NOW))).toBe(0);
      });
      expect(await scoped.transaction((tx) => purgeConsultation(tx, shop.consultationId, NOW))).toBe(1);
      await expectProblem(
        await open(
          "consultation_text",
          shop.consultationId,
          "손님 문의: 픽업 연락 확인",
          newRequestKey(),
          "example_text_page_cursor",
        ),
        "original_erased",
      );
      expect(
        (await isolated.db.query("SELECT 1 FROM masked_values WHERE consultation_id=$1", [shop.consultationId]))
          .rowCount,
      ).toBe(0);
    } finally {
      await Promise.allSettled([reader.close(), purger.close()]);
    }
  });
  it("보관 이름 열기는 실제 기간 만료 지우기와 같은 행 잠금을 쓰고 만료 뒤0행이다", async () => {
    await finish(31);
    const job = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "purge" }), isolated.db);
    expect(await job.transaction((tx) => purgeOrder(tx, shop.orderId, NOW))).toBe(1);
    const kept = (
      await isolated.db.query<{ id: string }>("SELECT id FROM kept_records WHERE order_id=$1", [shop.orderId])
    ).rows[0];
    if (!kept) throw new Error("보관 자료 없음");
    const future = new Date("2033-11-28T06:00:00Z"),
      reader = isolated.connect(),
      purger = isolated.connect(),
      scoped = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "purge" }), purger);
    try {
      await reader.transaction(async (tx) => {
        expect(
          (
            await tx.query("SELECT * FROM read_operator_original($1,$2,'kept_record',$3,'{}',$4)", [
              shop.shopId,
              session.operatorId,
              kept.id,
              NOW,
            ])
          ).rowCount,
        ).toBe(1);
        expect(await scoped.transaction((tx) => purgeKeptContract(tx, kept.id, future))).toBe(0);
      });
      expect(
        (
          await reader.query("SELECT * FROM read_operator_original($1,$2,'kept_record',$3,'{}',$4)", [
            shop.shopId,
            session.operatorId,
            kept.id,
            future,
          ])
        ).rowCount,
      ).toBe(0);
      expect(await scoped.transaction((tx) => purgeKeptContract(tx, kept.id, future))).toBe(1);
      await expectProblem(await open("kept_record", kept.id), "not_found");
    } finally {
      await Promise.allSettled([reader.close(), purger.close()]);
    }
  });
  it.each([false, true])(
    "리뷰P2: 사유를 받은 실제10개 페이지 밖의 글은 첫/다음 페이지에서 열지 않는다(%s)",
    async (next) => {
      await isolated.db.query(
        "INSERT INTO messages(shop_id,consultation_id,direction,author,kind,body_masked,created_at,kakao_message_id) SELECT $1,$2,'inbound','customer','text','합성 페이지 글',$3::timestamptz+make_interval(secs=>i),repeat(md5(gen_random_uuid()::text),2) FROM generate_series(1,24) i",
        [shop.shopId, shop.consultationId, NOW],
      );
      const first = (await (await call(`/consultations/${shop.consultationId}?limit=10`)).json()) as {
        items: { messageId: string }[];
        nextCursor: string;
        textCursor?: string;
      };
      const page = next
        ? ((await (
            await call(`/consultations/${shop.consultationId}?limit=10&cursor=${first.nextCursor}`)
          ).json()) as typeof first)
        : first;
      const cursor = page.textCursor;
      expect(typeof cursor).toBe("string");
      const response = await call("/originals", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json", "Idempotency-Key": newRequestKey() },
        body: JSON.stringify({
          targetKind: "consultation_text",
          targetId: shop.consultationId,
          reason: "손님 문의: 현재 페이지 확인",
          ...(cursor ? { cursor } : {}),
        }),
      });
      expect(response.status, await response.clone().text()).toBe(200);
      const opened = (await response.json()) as { consultationText: { items: { messageId: string }[] } };
      expect(opened.consultationText.items.map((x) => x.messageId)).toEqual(page.items.map((x) => x.messageId));
    },
  );
  it.each([
    ["한", 4000],
    ["한", 4001],
    ["🍰", 4001],
    ["한", 100000],
  ] as const)("리뷰P3: 저장된 긴 글 %s·%s자도 메타데이터·열기 응답 상한을 지킨다", async (letter, n) => {
    await isolated.db.query("UPDATE messages SET body_masked=$2 WHERE id=$1", [shop.messageId, letter.repeat(n)]);
    const response = await call(`/consultations/${shop.consultationId}`),
      meta = (await response.json()) as { items: { textLength: number }[]; textCursor?: string };
    expectSchema("OperatorConsultation", meta);
    expect(meta.items[0]?.textLength).toBe(4000);
    const opened = await call("/originals", {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json", "Idempotency-Key": newRequestKey() },
      body: JSON.stringify({
        targetKind: "consultation_text",
        targetId: shop.consultationId,
        reason: "손님 문의: 긴 글 확인",
        ...(meta.textCursor ? { cursor: meta.textCursor } : {}),
      }),
    });
    const body = (await opened.json()) as { consultationText: { items: { textMasked: string }[] } };
    expect(opened.status).toBe(200);
    expectSchema("OriginalValue", body);
    const firstText = body.consultationText.items[0];
    if (!firstText) throw new Error("글이 없어요");
    expect([...firstText.textMasked]).toHaveLength(4000);
  });
  it("리뷰P3: 실제 상담 지우기 전후 같은 번호ID는 원본 열림에서 지워짐409로 바뀐다", async () => {
    expect((await open("masked_value", maskedId)).status).toBe(200);
    await finish(31);
    const job = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "purge" }), isolated.db);
    expect(await job.transaction((tx) => purgeOrder(tx, shop.orderId, NOW))).toBe(1);
    await isolated.db.query("UPDATE consultations SET status='ended',ended_at=$2 WHERE id=$1", [
      shop.consultationId,
      new Date(NOW.getTime() - 31 * 86400000),
    ]);
    expect(await job.transaction((tx) => purgeConsultation(tx, shop.consultationId, NOW))).toBe(1);
    expect((await isolated.db.query("SELECT 1 FROM masked_values WHERE id=$1", [maskedId])).rowCount).toBe(0);
    await expectProblem(await open("masked_value", maskedId), "original_erased");
    const marker = (
      await isolated.db.query<{ body: Record<string, unknown> }>(
        "SELECT to_jsonb(e) AS body FROM masked_value_erasures e WHERE e.shop_id=$1 AND e.id=$2",
        [shop.shopId, maskedId],
      )
    ).rows[0]?.body;
    expect(Object.keys(marker ?? {}).sort()).toEqual(["consultation_id", "erased_at", "id", "shop_id"]);
    for (const value of [NAME, PHONE, DIGITS, PRIVATE_TEXT]) expect(JSON.stringify(marker)).not.toContain(value);
  });
  it("리뷰P2: 현재 범위 중간에 메시지가 끼면 원문0·접속기록0으로 닫고 다시 본 증표만 연다", async () => {
    await isolated.db.query(
      "INSERT INTO messages(shop_id,consultation_id,direction,author,kind,body_masked,created_at,kakao_message_id) VALUES($1,$2,'inbound','customer','text','합성 끝 글',$3::timestamptz+interval '2 seconds',repeat(md5(gen_random_uuid()::text),2))",
      [shop.shopId, shop.consultationId, NOW],
    );
    const cursor = await textPageCursor();
    const count = (await accessLogRows(isolated.db, shop.shopId)).length;
    await isolated.db.query(
      "INSERT INTO messages(shop_id,consultation_id,direction,author,kind,body_masked,created_at,kakao_message_id) VALUES($1,$2,'inbound','customer','text','아직 보지 않은 합성 글',$3::timestamptz+interval '1 second',repeat(md5(gen_random_uuid()::text),2))",
      [shop.shopId, shop.consultationId, NOW],
    );
    await expectProblem(
      await open("consultation_text", shop.consultationId, "손님 문의: 페이지 확인", newRequestKey(), cursor),
      "validation_failed",
    );
    expect(await accessLogRows(isolated.db, shop.shopId)).toHaveLength(count);
    const fresh = await textPageCursor(),
      response = await open("consultation_text", shop.consultationId, "손님 문의: 페이지 확인", newRequestKey(), fresh),
      body = (await response.json()) as { consultationText: { items: { textMasked: string }[] } };
    expect(response.status).toBe(200);
    expect(body.consultationText.items).toHaveLength(3);
    expect(body.consultationText.items[1]?.textMasked).toBe("아직 보지 않은 합성 글");
  });
  it("리뷰P2: 증표 없이/다음 페이지 커서로/다른 운영자로는 현재 글도 열지 않는다", async () => {
    const proof = await textPageCursor(),
      count = (await accessLogRows(isolated.db, shop.shopId)).length;
    await expectProblem(await open("consultation_text", shop.consultationId), "validation_failed");
    await expectProblem(
      await open(
        "consultation_text",
        shop.consultationId,
        "손님 문의: 페이지 확인",
        newRequestKey(),
        "example_pagination_cursor",
      ),
      "validation_failed",
    );
    const other = await seedOperatorSession(isolated.db, NOW);
    await expectProblem(
      await call("/originals", {
        method: "POST",
        headers: {
          cookie: other.cookie,
          origin: ORIGIN,
          "content-type": "application/json",
          "Idempotency-Key": newRequestKey(),
        },
        body: JSON.stringify({
          targetKind: "consultation_text",
          targetId: shop.consultationId,
          reason: "손님 문의: 페이지 확인",
          cursor: proof,
        }),
      }),
      "validation_failed",
    );
    expect(await accessLogRows(isolated.db, shop.shopId)).toHaveLength(count);
  });
  it("리뷰P2: 만료된 증표는 원문0이고 다시 본 페이지로 회복한다", async () => {
    let clock = NOW;
    app = createApp({
      connect: () => isolated.connect(),
      services: { now: () => clock, fieldCrypto: fc },
      logSink: (line) => logs.push(line),
    });
    const proof = await textPageCursor(),
      key = newRequestKey();
    for (let i = 0; i < 2; i++) {
      const opened = await expectOneAccessRow(
        isolated.db,
        shop.shopId,
        () => open("consultation_text", shop.consultationId, "손님 문의: 페이지 확인", key, proof),
        { action: "open_original", api_id: "API-077", target_kind: "consultation_text" },
      );
      if (i === 1) expect(opened.res.headers.get("Idempotency-Replayed")).toBe("true");
    }
    const count = (await accessLogRows(isolated.db, shop.shopId)).length;
    clock = new Date(NOW.getTime() + 600000);
    await expectProblem(
      await open("consultation_text", shop.consultationId, "손님 문의: 페이지 확인", key, proof),
      "validation_failed",
    );
    expect(await accessLogRows(isolated.db, shop.shopId)).toHaveLength(count);
    const fresh = await textPageCursor();
    expect(
      (await open("consultation_text", shop.consultationId, "손님 문의: 페이지 확인", newRequestKey(), fresh)).status,
    ).toBe(200);
  });
});
