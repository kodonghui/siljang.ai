import type { Queryable, RequestDb } from "../../src/db";
import { SHOP_TABLES } from "../../src/sql-scope";
import { newUuid } from "./db";

/**
 * 교차 가게 시험의 준비 자료(TASK-019): 사장님 하나와 가게 하나, 그 가게의 채널·손님·상담·메시지·가격표·도안·가게 규칙·
 * 계좌·주문서 초안·견적·주문(첫 버전)·결제 안내. 05 규칙 테스트(research/cake-erd-2026-11/rule_tests.sql)의 정상 플로우를
 * 줄인 것이고, 시험마다 새 ID와 고유 값을 써서 여러 시험이 같은 데이터베이스를 함께 써도 겹치지 않는다.
 * 손님 이름·연락처는 지어낸 값이다.
 */
export interface ShopFixture {
  readonly ownerId: string;
  readonly shopId: string;
  readonly channelId: string;
  readonly botId: string;
  readonly customerId: string;
  readonly userKey: string;
  readonly consultationId: string;
  readonly messageId: string;
  readonly priceListId: string;
  readonly designOptionId: string;
  readonly designId: string;
  readonly operatingRulesId: string;
  readonly paymentAccountId: string;
  readonly draftId: string;
  readonly quoteId: string;
  readonly orderId: string;
  readonly paymentRequestId: string;
}

/** 경로·본문에 넣는 기록 ID(가게 하나의 것, 없는 것, 형식이 틀린 것으로 바꿔 부른다). */
export type RecordIds = Pick<
  ShopFixture,
  "orderId" | "consultationId" | "paymentRequestId" | "designId" | "customerId" | "messageId"
>;

export function recordIds(f: ShopFixture): RecordIds {
  return {
    orderId: f.orderId,
    consultationId: f.consultationId,
    paymentRequestId: f.paymentRequestId,
    designId: f.designId,
    customerId: f.customerId,
    messageId: f.messageId,
  };
}

/** 어느 가게에도 없는 ID들. */
export function missingIds(): RecordIds {
  return {
    orderId: newUuid(),
    consultationId: newUuid(),
    paymentRequestId: newUuid(),
    designId: newUuid(),
    customerId: newUuid(),
    messageId: newUuid(),
  };
}

/** 형식이 틀린 ID들(uuid가 아님). */
export function malformedIds(value: string): RecordIds {
  return {
    orderId: value,
    consultationId: value,
    paymentRequestId: value,
    designId: value,
    customerId: value,
    messageId: value,
  };
}

const ORDER_NO_CHARS = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function randomOrderNo(): string {
  return Array.from({ length: 8 }, () => ORDER_NO_CHARS[Math.floor(Math.random() * ORDER_NO_CHARS.length)]).join("");
}

function randomTag(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 12);
}

/** 오늘(UTC)부터 days날 뒤의 날짜(YYYY-MM-DD). 찾는 날짜가 늘 앞날이게. */
function dayAfter(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

export async function linkTestChannel(db: Queryable, channelId: string): Promise<void> {
  await db.query(
    `UPDATE kakao_channels SET status = 'linked', claim_expires_at = NULL, linked_at = now(),
       orderer_block_id = 'orderer', allergy_block_id = 'allergy', depositor_block_id = 'depositor',
       review_block_id = 'review', verified_blocks = ARRAY['card', 'orderer_info', 'allergy_answer', 'depositor_name', 'review']
       WHERE id = $1`,
    [channelId],
  );
}

/** 상담 수신 시험의 준비. 채널 연결과 예약 링크 발급은 서로 다른 조건이다(SPEC-017). */
export async function issueTestBookingLink(db: RequestDb, shop: ShopFixture): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO business_calendars (shop_id, daily_capacity, order_cutoff_days, order_cutoff_time)
        VALUES ($1, 10, 2, '18:00') ON CONFLICT (shop_id) DO NOTHING`,
      [shop.shopId],
    );
    const reviewer = await tx.query<{ id: string }>(
      "INSERT INTO operators (email, display_name) VALUES ($1, '시험 운영자') RETURNING id",
      [`${newUuid()}@operator.example`],
    );
    const operator = reviewer.rows[0]?.id;
    await tx.query("UPDATE payment_accounts SET holder_checked_by = $2, holder_checked_at = now() WHERE shop_id = $1", [
      shop.shopId,
      operator,
    ]);
    await tx.query(
      `UPDATE shops SET license_status = 'verified', license_reviewed_by = $2, license_reviewed_at = now(),
        booking_slug = $3, booking_issued_at = now() WHERE id = $1`,
      [shop.shopId, operator, `test-${newUuid().replaceAll("-", "")}`],
    );
  });
}

/** 가게 하나와 그 기록을 한 트랜잭션으로 만든다. */
export async function createShop(db: RequestDb, name: string): Promise<ShopFixture> {
  const tag = randomTag();
  const f: ShopFixture = {
    ownerId: newUuid(),
    shopId: newUuid(),
    channelId: newUuid(),
    botId: newUuid().replaceAll("-", "").slice(0, 24),
    customerId: newUuid(),
    userKey: `user-${tag}`,
    consultationId: newUuid(),
    messageId: newUuid(),
    priceListId: newUuid(),
    designOptionId: newUuid(),
    designId: newUuid(),
    operatingRulesId: newUuid(),
    paymentAccountId: newUuid(),
    draftId: newUuid(),
    quoteId: newUuid(),
    orderId: newUuid(),
    paymentRequestId: newUuid(),
  };
  const sizeOptionId = newUuid();
  const flavorOptionId = newUuid();
  const day = dayAfter(40);
  const pickupAt = `${day}T06:00:00Z`;
  const kakaoAccountId = 9_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
  await db.transaction(async (tx) => {
    await tx.query("INSERT INTO owners (id, kakao_account_id) VALUES ($1, $2)", [f.ownerId, kakaoAccountId]);
    await tx.query(
      `INSERT INTO shops (id, owner_id, name, contact_phone, contact_email, business_address, business_name, representative_name,
                          business_reg_no, mail_order_exemption, food_license_no, food_business_type, license_photo_key,
                          entrustment_terms_version, entrustment_consented_at)
       VALUES ($1, $2, $3, '010-1234-5678', 'shop@example.com', '서울 시험로 1', $3, '시험사장', '1234567890', '간이과세자 면제',
               '2026-0456', 'bakery', 'license/test.jpg', 'entrust-v1', now())`,
      [f.shopId, f.ownerId, name],
    );
    await tx.query(
      `INSERT INTO kakao_channels (id, shop_id, bot_id, channel_public_id, status, check_started_at, card_block_id, verified_blocks,
                                   test_user_key, event_status, claim_expires_at)
       VALUES ($1, $2, $3, $4, 'pending', now(), 'blk-card', ARRAY['card'], 'owner-test', 'unchecked', now() + interval '30 minutes')`,
      [f.channelId, f.shopId, f.botId, `_${tag}`],
    );
    await tx.query(
      `INSERT INTO privacy_policies (id, shop_id, version, body, overseas_transfers)
       VALUES ($1, $2, 1, '처리방침 글', '[{"items":"대화","country":"미국","recipient":"모델 회사","purpose":"답 만들기","refuse":"상담 대신 전화"}]')`,
      [newUuid(), f.shopId],
    );
    await tx.query(
      `INSERT INTO customers (id, shop_id, kakao_channel_id, kakao_user_key, channel_friend, friend_checked_at)
       VALUES ($1, $2, $3, $4, true, now())`,
      [f.customerId, f.shopId, f.channelId, f.userKey],
    );
    await tx.query(
      `INSERT INTO consultations (id, shop_id, customer_id, status, ai_disclosed_at, ai_disclosed_policy_version, last_customer_message_at)
       VALUES ($1, $2, $3, 'ordered', now(), 1, now())`,
      [f.consultationId, f.shopId, f.customerId],
    );
    await tx.query(
      `INSERT INTO messages (id, shop_id, consultation_id, direction, author, kind, kakao_message_id, body_masked, trace_id)
       VALUES ($1, $2, $3, 'inbound', 'customer', 'text', $4, '케이크 주문할게요', 'trace-test')`,
      [f.messageId, f.shopId, f.consultationId, `km-${tag}`],
    );
    await tx.query("INSERT INTO price_lists (id, shop_id, version) VALUES ($1, $2, 1)", [f.priceListId, f.shopId]);
    await tx.query(
      `INSERT INTO price_options (id, shop_id, price_list_id, option_group, name, price_kind, amount, amount_max, in_standard, position)
       VALUES ($1, $4, $5, 'size', '1호', 'fixed', 35000, NULL, true, 1),
              ($2, $4, $5, 'flavor', '생크림', 'fixed', 0, NULL, true, 2),
              ($3, $4, $5, 'design', '레터링', 'fixed', 5000, NULL, true, 3)`,
      [sizeOptionId, flavorOptionId, f.designOptionId, f.shopId, f.priceListId],
    );
    await tx.query(
      `INSERT INTO designs (id, shop_id, price_list_id, price_option_id, name, image_key)
       VALUES ($1, $2, $3, $4, '꽃 도안', 'designs/flower.png')`,
      [f.designId, f.shopId, f.priceListId, f.designOptionId],
    );
    await tx.query(
      `INSERT INTO operating_rules (id, shop_id, version, change_deadline_hours, date_change_refund_basis)
       VALUES ($1, $2, 1, 48, 'original_pickup')`,
      [f.operatingRulesId, f.shopId],
    );
    await tx.query(
      `INSERT INTO payment_accounts (id, shop_id, bank_name, account_number_enc, account_last4, holder_name)
       VALUES ($1, $2, '시험은행', 'v1:TESTnonce000000000000ciphertext0001tag16', '9012', '시험사장')`,
      [f.paymentAccountId, f.shopId],
    );
    await tx.query(
      `INSERT INTO order_drafts (id, shop_id, consultation_id, status, revision, price_list_id, pickup_day, pickup_time,
                                 size_option_id, flavor_option_id, allergy_consent, allergy_consent_version, allergy_consent_at,
                                 customer_name, customer_phone, order_kind)
       VALUES ($1, $2, $3, 'submitted', 1, $4, $5, '15:00', $6, $7, 'declined', 'allergy-v1', now(), '시험손님', '010-0000-0000', 'standard')`,
      [f.draftId, f.shopId, f.consultationId, f.priceListId, day, sizeOptionId, flavorOptionId],
    );
    await tx.query(
      `INSERT INTO quotes (id, shop_id, draft_id, draft_revision, price_list_id, operating_rules_id, order_kind, display_kind,
                           amount, basis, valid_until)
       VALUES ($1, $2, $3, 1, $4, $5, 'standard', 'fixed', 35000, '{"lines":["1호","생크림"]}', now() + interval '72 hours')`,
      [f.quoteId, f.shopId, f.draftId, f.priceListId, f.operatingRulesId],
    );
    await tx.query(
      `INSERT INTO orders (id, shop_id, order_no, customer_id, consultation_id, draft_id, kind, status, version, price_list_id,
                           operating_rules_id, details_confirmed_at, terms_consented_at, pickup_at, pickup_day, amount)
       VALUES ($1, $2, $3, $4, $5, $6, 'standard', 'awaiting_payment', 1, $7, $8, now(), now(), $9, $10, 35000)`,
      [
        f.orderId,
        f.shopId,
        randomOrderNo(),
        f.customerId,
        f.consultationId,
        f.draftId,
        f.priceListId,
        f.operatingRulesId,
        pickupAt,
        day,
      ],
    );
    await tx.query(
      `INSERT INTO order_details (id, shop_id, order_id, version, source, quote_id, price_list_id, pickup_at, size_option_id,
                                  flavor_option_id, allergy_consent, allergy_consent_version, allergy_consent_at,
                                  customer_name, customer_phone, amount)
       VALUES ($1, $2, $3, 1, 'request', $4, $5, $6, $7, $8, 'declined', 'allergy-v1', now(), '시험손님', '010-0000-0000', 35000)`,
      [newUuid(), f.shopId, f.orderId, f.quoteId, f.priceListId, pickupAt, sizeOptionId, flavorOptionId],
    );
    await tx.query(
      `INSERT INTO payment_requests (id, shop_id, order_id, kind, event_key, status, amount, payment_account_id, delivered_at,
                                     due_at, due_cap_at)
       VALUES ($1, $2, $3, 'first', $4, 'open', 35000, $5, now(), now() + interval '12 hours', now() + interval '2 days')`,
      [f.paymentRequestId, f.shopId, f.orderId, `pay:${f.orderId}:first`, f.paymentAccountId],
    );
  });
  return f;
}

/** 가게 둘(A·B). A 사장님이 B의 ID로 부르는 시험에 쓴다. */
export async function createShopPair(db: RequestDb): Promise<{ readonly a: ShopFixture; readonly b: ShopFixture }> {
  return { a: await createShop(db, "가게A"), b: await createShop(db, "가게B") };
}

/**
 * 가게 하나의 기록 모습: 가게 테이블 54개와 가게 행마다 행 수와 내용의 md5, 그 가게 사장님의 요청 키 수.
 * 같으면 그 사이에 이 가게의 기록이 하나도 생기거나 바뀌거나 지워지지 않았다.
 */
export async function snapshotShop(q: Queryable, f: ShopFixture): Promise<Record<string, string>> {
  const parts = SHOP_TABLES.map(
    (t) =>
      `SELECT '${t}' AS t, count(*)::int AS n, coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '-') AS h FROM ${t} x WHERE x.shop_id = $1`,
  );
  parts.push(
    `SELECT 'shops', count(*)::int, coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '-') FROM shops x WHERE x.id = $1`,
    `SELECT 'request_keys', count(*)::int, '-' FROM request_keys x WHERE x.actor_kind = 'owner' AND x.actor_id = $2`,
  );
  const r = await q.query<{ t: string; n: number; h: string }>(parts.join(" UNION ALL "), [f.shopId, f.ownerId]);
  return Object.fromEntries(r.rows.map((row) => [row.t, `${row.n}:${row.h}`]));
}
