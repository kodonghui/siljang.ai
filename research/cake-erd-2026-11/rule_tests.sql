-- 05단계 규칙 테스트: db/schema.sql의 테이블이 정상 플로우를 수락하고, 테이블로 지키기로 한 규칙을 어기는 쓰기는 막는지 봄.
-- check_erd.py가 마이그레이션으로 만든 빈 DB에서 돌림. 모든 쓰기는 마지막에 되돌림(ROLLBACK).
-- 1부: 정상 플로우(기본 디자인 주문 → 입금 알리기 → 확정 → 인도 → 신고 → 재제작 → 후기·포트폴리오,
--      맞춤 주문 → 금액 변경 수락 → 확정 → 차액 결제(더 들어온 금액은 환불) 변경 반영, 확정 뒤 손님 취소 → 환불,
--      잘못 누른 결제 확인 취소 → 입금했다고 알린 뒤 손님 취소 → 들어온 입금 남기기 → 환불 → 환불 보내기).
-- 2부: 규칙마다 어기는 쓰기 하나. 기대한 제약으로 막히면 ok, 들어가거나 다른 제약에 걸리면 테스트 실패.
\set ON_ERROR_STOP 1
BEGIN;

CREATE TEMP TABLE rule_results (name text PRIMARY KEY, ok boolean NOT NULL, detail text);

-- 문장들을 차례로 돌려 기대한 규칙(expected: 제약 이름이나 컬럼 이름)으로 막히는지 봄. 막히면 그 문장들은 되돌아감.
CREATE FUNCTION pg_temp.expect_fail(test_name text, expected text, stmts text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  stmt text;
BEGIN
  BEGIN
    FOREACH stmt IN ARRAY stmts LOOP
      EXECUTE stmt;
    END LOOP;
    SET CONSTRAINTS ALL IMMEDIATE;  -- 트랜잭션 끝에 보는 규칙도 지금 봄
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not blocked';
  EXCEPTION
    WHEN integrity_constraint_violation THEN
      -- 막혔어도 기대한 규칙(제약 이름)이 아닌 다른 규칙에 걸렸으면 실패로 셈
      INSERT INTO rule_results VALUES (test_name, position(expected IN SQLERRM) > 0, SQLSTATE || ' ' || SQLERRM);
    WHEN raise_exception THEN
      INSERT INTO rule_results VALUES (test_name, false, '막히지 않음');
  END;
  SET CONSTRAINTS ALL DEFERRED;
END
$fn$;

-- ───────────── 1부: 정상 플로우 ─────────────

-- 가게 등록·연결 (CTX-007)
INSERT INTO owners (id, kakao_account_id, alert_user_key, alert_channel_friend) VALUES
  ('a0000000-0000-0000-0000-000000000001', 1001, 'owner-key-1', true),
  ('a0000000-0000-0000-0000-000000000002', 1002, 'owner-key-2', false);
INSERT INTO operators (id, email, display_name, mfa_enrolled_at) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'ops@example.com', '운영자', now());
INSERT INTO shops (id, owner_id, name, contact_phone, business_name, representative_name, business_reg_no,
                   mail_order_reg_no, food_license_no, food_business_type, license_photo_key, license_status,
                   license_reviewed_by, license_reviewed_at, entrustment_terms_version, entrustment_consented_at,
                   booking_slug, booking_issued_at) VALUES
  ('a2000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '달콤케이크', '010-1234-5678',
   '달콤케이크', '김사장', '1234567890', '2026-서울강남-0001', '2026-0123', 'instant_sale_manufacturing',
   'license/a.jpg', 'verified', 'a1000000-0000-0000-0000-000000000001', now(), 'entrust-v1', now(), 'dalkom', now());
INSERT INTO shops (id, owner_id, name, contact_phone, business_name, representative_name, business_reg_no,
                   mail_order_exemption, food_license_no, food_business_type, license_photo_key,
                   entrustment_terms_version, entrustment_consented_at) VALUES
  ('a2000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', '다른가게', '02-123-4567',
   '다른가게', '박사장', '1234567890', '간이과세자 면제', '2026-0456', 'bakery', 'license/b.jpg', 'entrust-v1', now());
INSERT INTO kakao_channels (id, shop_id, bot_id, channel_public_id, status, check_started_at, linked_at) VALUES
  ('a3000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'bot-a', '_abcde', 'linked', now(), now()),
  ('a3000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000002', 'bot-b', '_fghij', 'pending', now(), NULL);
INSERT INTO privacy_policies (id, shop_id, version, body, overseas_transfers) VALUES
  ('a4000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 1, '처리방침 글',
   '[{"items":"대화","country":"미국","recipient":"모델 회사","purpose":"답 만들기","refuse":"상담 대신 전화"}]');

-- 가게 규칙 (CTX-002)
INSERT INTO price_lists (id, shop_id, version) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 1);
INSERT INTO price_options (id, shop_id, price_list_id, option_group, name, price_kind, amount, amount_max, in_standard, position) VALUES
  ('b1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'size', '1호', 'fixed', 35000, NULL, true, 1),
  ('b1000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'flavor', '생크림', 'fixed', 0, NULL, true, 2),
  ('b1000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'design', '레터링', 'fixed', 5000, NULL, true, 3),
  ('b1000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'extra', '2단', 'range', 20000, 40000, false, 4);
INSERT INTO price_option_rules (id, shop_id, price_list_id, rule_kind, option_a_id, option_b_id, amount) VALUES
  ('b2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'surcharge',
   'b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000004', 2000);
INSERT INTO designs (id, shop_id, price_list_id, price_option_id, name, image_key) VALUES
  ('b3000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000003', '꽃 도안', 'designs/flower.png');
INSERT INTO operating_rules (id, shop_id, version, change_deadline_hours, date_change_refund_basis) VALUES
  ('b4000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 1, 48, 'original_pickup');
INSERT INTO rule_clauses (id, shop_id, operating_rules_id, clause_key, position, title, condition_text, effect_text) VALUES
  ('b5000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'b4000000-0000-0000-0000-000000000001',
   'pre_production_cancel', 1, '제작 전 취소', '맞춤 재료 주문 전이고 제작 시작 전', '취소 수수료만 빼고 전액 환불'),
  ('b5000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'b4000000-0000-0000-0000-000000000001',
   'other_shop_design', 2, '다른 가게 디자인', '다른 가게의 시그니처·캐릭터·로고', '만들지 않음');
INSERT INTO refund_tiers (id, shop_id, operating_rules_id, hours_before_min, hours_before_max, refund_pct) VALUES
  ('b6000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'b4000000-0000-0000-0000-000000000001', 0, 24, 0),
  ('b6000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'b4000000-0000-0000-0000-000000000001', 24, 72, 50),
  ('b6000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001', 'b4000000-0000-0000-0000-000000000001', 72, NULL, 100);
INSERT INTO business_calendars (shop_id, closed_weekdays, daily_capacity, order_cutoff_days, order_cutoff_time) VALUES
  ('a2000000-0000-0000-0000-000000000001', '{1}', 3, 2, '18:00');
INSERT INTO calendar_days (shop_id, day) VALUES
  ('a2000000-0000-0000-0000-000000000001', '2026-12-24'),
  ('a2000000-0000-0000-0000-000000000001', '2026-12-26'),
  ('a2000000-0000-0000-0000-000000000001', '2026-12-28');
INSERT INTO payment_accounts (id, shop_id, bank_name, account_number, holder_name) VALUES
  ('b7000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', '국민은행', '123-456-789012', '김사장');

-- 상담 (CTX-001)
INSERT INTO customers (id, shop_id, kakao_channel_id, kakao_user_key, channel_friend, friend_checked_at) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'user-key-1', true, now()),
  ('c0000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'user-key-2', false, now());
INSERT INTO consultations (id, shop_id, customer_id, status, ai_disclosed_at, last_customer_message_at) VALUES
  ('c1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'ordered', now(), now()),
  ('c1000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'ordered', now(), now());
INSERT INTO messages (id, shop_id, consultation_id, direction, author, kind, kakao_message_id, body_masked, trace_id, delivery, sent_at) VALUES
  ('c2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'inbound', 'customer', 'text', 'km-1', '24일 1호 생크림요, 연락처 [전화번호1]', 'trace-1', NULL, NULL),
  ('c2000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'outbound', 'ai', 'text', NULL, '1호 생크림은 40,000원이에요', 'trace-1', 'skill_response', now()),
  ('c2000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'inbound', 'customer', 'photo', 'km-2', NULL, 'trace-2', NULL, NULL),
  ('c2000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'inbound', 'customer', 'photo', 'km-3', NULL, 'trace-3', NULL, NULL);
INSERT INTO masked_values (id, shop_id, consultation_id, kind, placeholder, original_value) VALUES
  ('c3000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'phone', '[전화번호1]', '010-9999-8888');
INSERT INTO order_drafts (id, shop_id, consultation_id, status, revision, price_list_id, pickup_at, size_option_id, flavor_option_id,
                          design_option_id, design_id, lettering, allergy_answer, customer_name, customer_phone, order_kind) VALUES
  ('c4000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'submitted', 2,
   'b0000000-0000-0000-0000-000000000001', '2026-12-24 06:00:00+00', 'b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002',
   'b1000000-0000-0000-0000-000000000003', 'b3000000-0000-0000-0000-000000000001', '생일 축하해', '없음', '이손님', '010-9999-8888', 'standard'),
  ('c4000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'submitted', 1,
   'b0000000-0000-0000-0000-000000000001', '2026-12-28 06:00:00+00', 'b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002',
   NULL, NULL, '사랑해', '땅콩', '최손님', '010-7777-6666', 'custom'),
  ('c4000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'submitted', 1,
   'b0000000-0000-0000-0000-000000000001', '2026-12-24 07:00:00+00', 'b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002',
   NULL, NULL, NULL, '없음', '이손님', '010-9999-8888', 'standard');
UPDATE order_drafts SET extra_option_ids = '{b1000000-0000-0000-0000-000000000004}' WHERE id = 'c4000000-0000-0000-0000-000000000002';
INSERT INTO reference_photos (id, shop_id, draft_id, message_id, position, storage_key, content_type, byte_size) VALUES
  ('c5000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000002',
   'c2000000-0000-0000-0000-000000000003', 1, 'ref/2-1.jpg', 'image/jpeg', 2048000);
INSERT INTO quotes (id, shop_id, draft_id, draft_revision, price_list_id, operating_rules_id, order_kind, display_kind, amount, amount_max, basis, valid_until) VALUES
  ('c6000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000001', 2,
   'b0000000-0000-0000-0000-000000000001', 'b4000000-0000-0000-0000-000000000001', 'standard', 'fixed', 40000, NULL, '{"lines":["1호","생크림","레터링"]}', now() + interval '72 hours'),
  ('c6000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000002', 1,
   'b0000000-0000-0000-0000-000000000001', 'b4000000-0000-0000-0000-000000000001', 'custom', 'range', 50000, 70000, '{"lines":["1호","2단"]}', now() + interval '72 hours'),
  ('c6000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000003', 1,
   'b0000000-0000-0000-0000-000000000001', 'b4000000-0000-0000-0000-000000000001', 'standard', 'fixed', 35000, NULL, '{"lines":["1호","생크림"]}', now() + interval '72 hours');
INSERT INTO confirm_cards (id, shop_id, consultation_id, customer_id, card_key, kind, draft_id, draft_revision, payload, expires_at, used_at, outcome) VALUES
  ('c7000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   'card-order-request-0001', 'order_request', 'c4000000-0000-0000-0000-000000000001', 2, '{"amount":40000}', now() + interval '30 minutes', now(), 'done'),
  ('c7000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002',
   'card-order-request-0002', 'order_request', 'c4000000-0000-0000-0000-000000000002', 1, '{"amount":50000}', now() + interval '30 minutes', now(), 'done'),
  ('c7000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   'card-order-request-0003', 'order_request', 'c4000000-0000-0000-0000-000000000003', 1, '{"amount":35000}', now() + interval '30 minutes', now(), 'done');

-- 주문 1: 기본 디자인 주문 요청(한 트랜잭션: 주문·첫 버전·사진 게시 동의·결제 안내·자리)
INSERT INTO orders (id, shop_id, order_no, customer_id, consultation_id, draft_id, kind, status, version, price_list_id, operating_rules_id,
                    details_confirmed_at, terms_consented_at, pickup_at, pickup_day, amount) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'K7Q2M9', 'c0000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000001', 'standard', 'awaiting_payment', 1,
   'b0000000-0000-0000-0000-000000000001', 'b4000000-0000-0000-0000-000000000001', now(), now(), '2026-12-24 06:00:00+00', '2026-12-24', 40000);
INSERT INTO order_details (id, shop_id, order_id, version, source, quote_id, price_list_id, pickup_at, size_option_id, flavor_option_id,
                           design_option_id, design_id, lettering, allergy_answer, customer_name, customer_phone, amount) VALUES
  ('d1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 1, 'request',
   'c6000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '2026-12-24 06:00:00+00', 'b1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000003', 'b3000000-0000-0000-0000-000000000001', '생일 축하해', '없음',
   '이손님', '010-9999-8888', 40000);
UPDATE confirm_cards SET order_id = 'd0000000-0000-0000-0000-000000000001' WHERE id = 'c7000000-0000-0000-0000-000000000001';
INSERT INTO photo_consents (id, shop_id, order_id, scope, consented) VALUES
  ('d3000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'order', false);
INSERT INTO payment_requests (id, shop_id, order_id, kind, event_key, status, amount, payment_account_id, due_at) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'first',
   'pay:d0..01:first', 'open', 40000, 'b7000000-0000-0000-0000-000000000001', now() + interval '12 hours');
INSERT INTO slot_holds (id, shop_id, day, order_id, payment_request_id, hold_key, status) VALUES
  ('e3000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', '2026-12-24', 'd0000000-0000-0000-0000-000000000001',
   'e0000000-0000-0000-0000-000000000001', 'hold:d0..01:e0..01', 'held');
SET CONSTRAINTS ALL IMMEDIATE;  -- 주문 행과 첫 버전 행이 맞는지 여기서 봄
SET CONSTRAINTS ALL DEFERRED;

-- 입금 알리기 → 입금됨 → 확정 → 인도
INSERT INTO confirm_cards (id, shop_id, consultation_id, customer_id, card_key, kind, order_id, order_version, payload, expires_at, used_at, outcome) VALUES
  ('c7000000-0000-0000-0000-000000000011', 'a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   'card-payment-claim-0001', 'payment_claim', 'd0000000-0000-0000-0000-000000000001', 1, '{}', now() + interval '30 minutes', now(), 'done');
UPDATE payment_requests SET status = 'claimed', claimed_at = now(), claim_card_id = 'c7000000-0000-0000-0000-000000000011', version = version + 1
 WHERE id = 'e0000000-0000-0000-0000-000000000001';
INSERT INTO owner_tasks (id, shop_id, kind, event_key, order_id, payment_request_id) VALUES
  ('f7000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'payment_claim', 'task:claim:e0..01',
   'd0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001');
INSERT INTO owner_alerts (id, shop_id, owner_task_id, kind, event_key, status, attempts, sent_at) VALUES
  ('f8000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000001', 'new_task',
   'alert:task:f7..01', 'sent', 1, now());
UPDATE payment_requests SET status = 'paid', paid_at = now(), arrived_amount = 40000, arrived_at = now(), version = version + 1
 WHERE id = 'e0000000-0000-0000-0000-000000000001';
INSERT INTO payments (id, shop_id, order_id, payment_request_id, amount) VALUES
  ('e1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',
   'e0000000-0000-0000-0000-000000000001', 40000);
UPDATE owner_tasks SET closed_at = now() WHERE id = 'f7000000-0000-0000-0000-000000000001';
UPDATE orders SET status = 'confirmed', confirmed_at = now() WHERE id = 'd0000000-0000-0000-0000-000000000001';
UPDATE slot_holds SET status = 'fixed', fixed_at = now() WHERE id = 'e3000000-0000-0000-0000-000000000001';
INSERT INTO productions (id, shop_id, order_id) VALUES
  ('f0000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001');
INSERT INTO notifications (id, shop_id, customer_id, consultation_id, order_id, kind, event_key, template_key, body, status, attempts, sent_at) VALUES
  ('f9000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'order_confirmed', 'notice:d0..01:confirmed',
   'order_confirmed_v1', '주문이 확정됐어요. 12월 24일 15:00에 뵐게요.', 'sent', 1, now());
INSERT INTO ledger_links (id, shop_id, spreadsheet_id, sheet_name, our_columns, credential_ref) VALUES
  ('fa000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'sheet-file-1', '주문', '{"주문번호":"A"}', 'secret-store/ledger/shop-a');
INSERT INTO ledger_rows (id, shop_id, order_id, first_written_at, last_written_at) VALUES
  ('fb000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', now(), now());
INSERT INTO ledger_writes (id, shop_id, ledger_row_id, event_key, event_kind, status, attempts, written_at) VALUES
  ('fc000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000001',
   'ledger:d0..01:confirmed', 'confirmed', 'written', 1, now());
UPDATE productions SET production_started_at = now(), completed_at = now(), handed_over_at = now(), handover_kind = 'pickup'
 WHERE id = 'f0000000-0000-0000-0000-000000000001';
UPDATE orders SET status = 'received' WHERE id = 'd0000000-0000-0000-0000-000000000001';
UPDATE slot_holds SET status = 'done', done_at = now() WHERE id = 'e3000000-0000-0000-0000-000000000001';

-- 신고 → 재제작 주문(결제 없음, 확정으로 시작, 확정 자리)
INSERT INTO issue_details (id, shop_id, consultation_id, order_id, description, status) VALUES
  ('f1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000001', '케이크 옆면이 무너졌어요', 'reported');
INSERT INTO issue_photos (id, shop_id, issue_details_id, message_id, position, storage_key, content_type, byte_size) VALUES
  ('f1100000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001',
   'c2000000-0000-0000-0000-000000000004', 1, 'issue/1-1.jpg', 'image/jpeg', 1024000);
INSERT INTO confirm_cards (id, shop_id, consultation_id, customer_id, card_key, kind, order_id, order_version, payload, expires_at, used_at, outcome) VALUES
  ('c7000000-0000-0000-0000-000000000012', 'a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   'card-issue-report-0001', 'issue_report', 'd0000000-0000-0000-0000-000000000001', 1, '{}', now() + interval '30 minutes', now(), 'done');
INSERT INTO issue_reports (id, shop_id, order_id, issue_details_id, card_id, late) VALUES
  ('f2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',
   'f1000000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-000000000012', false);
INSERT INTO orders (id, shop_id, order_no, customer_id, consultation_id, kind, status, version, price_list_id, operating_rules_id,
                    pickup_at, pickup_day, amount, confirmed_at, remake_of_order_id) VALUES
  ('d0000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'R4T8W2', 'c0000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-000000000001', 'standard', 'confirmed', 1, 'b0000000-0000-0000-0000-000000000001', 'b4000000-0000-0000-0000-000000000001',
   '2026-12-26 06:00:00+00', '2026-12-26', 0, now(), 'd0000000-0000-0000-0000-000000000001');
INSERT INTO order_details (id, shop_id, order_id, version, source, price_list_id, pickup_at, size_option_id, flavor_option_id, lettering, allergy_answer, amount) VALUES
  ('d1000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 1, 'remake',
   'b0000000-0000-0000-0000-000000000001', '2026-12-26 06:00:00+00', 'b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002',
   '생일 축하해', '없음', 0);
UPDATE issue_reports SET status = 'decided', compensation = 'remake', decided_at = now(), remake_order_id = 'd0000000-0000-0000-0000-000000000002'
 WHERE id = 'f2000000-0000-0000-0000-000000000001';
INSERT INTO slot_holds (id, shop_id, day, order_id, hold_key, status, overbooked, fixed_at) VALUES
  ('e3000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', '2026-12-26', 'd0000000-0000-0000-0000-000000000002',
   'hold:d0..02:remake', 'fixed', true, now());
INSERT INTO productions (id, shop_id, order_id) VALUES
  ('f0000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002');
INSERT INTO ledger_writes (id, shop_id, ledger_row_id, event_key, event_kind) VALUES
  ('fc000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000001',
   'ledger:d0..01:remake', 'remake');
UPDATE issue_reports SET status = 'closed', closed_at = now() WHERE id = 'f2000000-0000-0000-0000-000000000001';
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

-- 후기 → 사진 게시 동의 → 포트폴리오
INSERT INTO reviews (id, shop_id, order_id, version, body) VALUES
  ('f3000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 1, '다시 만들어 주셔서 감사해요');
INSERT INTO review_photos (id, shop_id, review_id, position, storage_key, content_type, byte_size) VALUES
  ('f4000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001', 1, 'review/1.jpg', 'image/png', 3000000);
INSERT INTO photo_consents (id, shop_id, order_id, scope, review_photo_id, consented) VALUES
  ('d3000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'review_photo',
   'f4000000-0000-0000-0000-000000000001', true);
INSERT INTO portfolio_items (id, shop_id, photo_consent_id, review_photo_id) VALUES
  ('f5000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000002', 'f4000000-0000-0000-0000-000000000001');

-- 에스컬레이션 건(먹어도 되는지) → 사장님 답 기다림
INSERT INTO handoffs (id, shop_id, consultation_id, source_message_id, reason) VALUES
  ('f6000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001',
   'c2000000-0000-0000-0000-000000000001', 'edibility');
INSERT INTO owner_tasks (id, shop_id, kind, event_key, handoff_id, wait_status, wait_due_at) VALUES
  ('f7000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'handoff', 'task:handoff:f6..01',
   'f6000000-0000-0000-0000-000000000001', 'waiting', now() + interval '2 hours');

-- AI 호출 기록
INSERT INTO ai_calls (id, shop_id, consultation_id, trace_id, attempt, provider, model, prompt_version, reasoning, sent_at, first_token_ms, total_ms,
                      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, cost_krw, cost_basis, result, stop_reason) VALUES
  ('fd000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'trace-1', 1,
   'provider-x', 'model-x', 'consult-v1', '{"effort":"low"}', now(), 800, 2400, 1800, 120, 1500, 0, 0.004100, 5.60, 'price-2026-11, 1366원/달러', 'success', 'end_turn');
INSERT INTO ai_tool_calls (id, shop_id, ai_call_id, consultation_id, tool_name, target_id, args_masked, result, duration_ms) VALUES
  ('fe000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'fd000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-000000000001', 'quote', 'c4000000-0000-0000-0000-000000000001', '{"size":"1호","flavor":"생크림"}', 'ok', 35);
INSERT INTO request_keys (actor_kind, actor_id, request_key, command, response_status, response_body) VALUES
  ('owner', 'a0000000-0000-0000-0000-000000000001', 'screen-key-000000001', 'confirm_payment', 200, '{"payment_request":"e0..01","status":"paid"}');
INSERT INTO ops_events (shop_id, kind, count, detail) VALUES
  (NULL, 'purge_run', 0, '{"consultations":0,"orders":0}');

-- 주문 3: 맞춤 주문 → 금액 변경 수락(버전 2) → 결제 → 확정 → 차액 결제 변경(버전 3)
INSERT INTO orders (id, shop_id, order_no, customer_id, consultation_id, draft_id, kind, status, version, price_list_id, operating_rules_id,
                    details_confirmed_at, terms_consented_at, pickup_at, pickup_day, amount) VALUES
  ('d0000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001', 'P2N6X3', 'c0000000-0000-0000-0000-000000000002',
   'c1000000-0000-0000-0000-000000000002', 'c4000000-0000-0000-0000-000000000002', 'custom', 'requested', 1,
   'b0000000-0000-0000-0000-000000000001', 'b4000000-0000-0000-0000-000000000001', now(), now(), '2026-12-28 06:00:00+00', '2026-12-28', 50000);
INSERT INTO order_details (id, shop_id, order_id, version, source, quote_id, price_list_id, pickup_at, size_option_id, flavor_option_id,
                           extra_option_ids, lettering, allergy_answer, customer_name, customer_phone, amount) VALUES
  ('d1000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', 1, 'request',
   'c6000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', '2026-12-28 06:00:00+00', 'b1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000002', '{b1000000-0000-0000-0000-000000000004}', '사랑해', '땅콩', '최손님', '010-7777-6666', 50000);
INSERT INTO owner_tasks (id, shop_id, kind, event_key, order_id, wait_status, wait_due_at) VALUES
  ('f7000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001', 'custom_order', 'task:custom:d0..03',
   'd0000000-0000-0000-0000-000000000003', 'waiting', now() + interval '2 hours');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO order_details (id, shop_id, order_id, version, source, price_list_id, pickup_at, size_option_id, flavor_option_id,
                           extra_option_ids, lettering, allergy_answer, customer_name, customer_phone, amount, amount_change_reason) VALUES
  ('d1000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', 2, 'owner_amount_change',
   'b0000000-0000-0000-0000-000000000001', '2026-12-28 06:00:00+00', 'b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002',
   '{b1000000-0000-0000-0000-000000000004}', '사랑해', '땅콩', '최손님', '010-7777-6666', 55000, '2단 받침 재료를 더함');
UPDATE orders SET version = 2, amount = 55000, accepted_at = now(), accepted_version = 2, status = 'awaiting_payment'
 WHERE id = 'd0000000-0000-0000-0000-000000000003';
UPDATE owner_tasks SET wait_status = 'answered', closed_at = now() WHERE id = 'f7000000-0000-0000-0000-000000000003';
INSERT INTO payment_requests (id, shop_id, order_id, kind, event_key, status, amount, requested_amount, payment_account_id, due_at) VALUES
  ('e0000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', 'first',
   'pay:d0..03:first', 'open', 55000, 50000, 'b7000000-0000-0000-0000-000000000001', now() + interval '12 hours');
INSERT INTO slot_holds (id, shop_id, day, order_id, payment_request_id, hold_key, status) VALUES
  ('e3000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001', '2026-12-28', 'd0000000-0000-0000-0000-000000000003',
   'e0000000-0000-0000-0000-000000000003', 'hold:d0..03:e0..03', 'held');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
UPDATE payment_requests SET status = 'paid', paid_at = now(), arrived_amount = 55000, arrived_at = now() WHERE id = 'e0000000-0000-0000-0000-000000000003';
INSERT INTO payments (id, shop_id, order_id, payment_request_id, amount) VALUES
  ('e1000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
   'e0000000-0000-0000-0000-000000000003', 55000);
UPDATE orders SET status = 'confirmed', confirmed_at = now() WHERE id = 'd0000000-0000-0000-0000-000000000003';
UPDATE slot_holds SET status = 'fixed', fixed_at = now() WHERE id = 'e3000000-0000-0000-0000-000000000003';
INSERT INTO productions (id, shop_id, order_id, needs_custom_material) VALUES
  ('f0000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', true);
INSERT INTO confirm_cards (id, shop_id, consultation_id, customer_id, card_key, kind, order_id, order_version, payload, expires_at, used_at, outcome) VALUES
  ('c7000000-0000-0000-0000-000000000013', 'a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002',
   'card-change-request-0001', 'change_request', 'd0000000-0000-0000-0000-000000000003', 2, '{"lettering":"사랑해 엄마"}', now() + interval '30 minutes', now(), 'done');
INSERT INTO change_requests (id, shop_id, order_id, card_id, base_version, changes) VALUES
  ('d2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
   'c7000000-0000-0000-0000-000000000013', 2, '{"lettering":"사랑해 엄마","topper":"추가"}');
UPDATE change_requests SET status = 'awaiting_difference', amount_delta = 5000, decided_at = now() WHERE id = 'd2000000-0000-0000-0000-000000000001';
INSERT INTO payment_requests (id, shop_id, order_id, kind, change_request_id, event_key, status, amount, payment_account_id, due_at) VALUES
  ('e0000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', 'difference',
   'd2000000-0000-0000-0000-000000000001', 'pay:d2..01:difference', 'open', 5000, 'b7000000-0000-0000-0000-000000000001', now() + interval '12 hours');
-- 차액 6,000원이 들어옴 → 금액 불일치(맞추는 중) → 대조 완료(더 들어옴) → 더 들어온 1,000원은 환불(SPEC-035, SPEC-071)
UPDATE payment_requests SET status = 'mismatch', mismatch_amount = 6000, mismatch_at = now(), arrived_amount = 6000, arrived_at = now()
 WHERE id = 'e0000000-0000-0000-0000-000000000004';
UPDATE payment_requests SET status = 'paid', paid_at = now() WHERE id = 'e0000000-0000-0000-0000-000000000004';
INSERT INTO payments (id, shop_id, order_id, payment_request_id, amount, resolution) VALUES
  ('e1000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
   'e0000000-0000-0000-0000-000000000004', 5000, 'excess_returned');
INSERT INTO refunds (id, shop_id, order_id, cause, payment_request_id, event_key, decision, amount, calculated_amount, calc_basis) VALUES
  ('e2000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', 'over_received',
   'e0000000-0000-0000-0000-000000000004', 'refund:e0..04:over_received', 'full', 1000, 1000, '{"arrived":6000,"amount":5000}');
INSERT INTO order_details (id, shop_id, order_id, version, source, change_request_id, price_list_id, pickup_at, size_option_id, flavor_option_id,
                           extra_option_ids, lettering, allergy_answer, customer_name, customer_phone, amount) VALUES
  ('d1000000-0000-0000-0000-000000000005', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', 3, 'change_request',
   'd2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '2026-12-28 06:00:00+00', 'b1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000002', '{b1000000-0000-0000-0000-000000000004}', '사랑해 엄마', '땅콩', '최손님', '010-7777-6666', 60000);
UPDATE orders SET version = 3, amount = 60000 WHERE id = 'd0000000-0000-0000-0000-000000000003';
UPDATE change_requests SET status = 'applied', applied_version = 3, applied_at = now() WHERE id = 'd2000000-0000-0000-0000-000000000001';
UPDATE productions SET changed_after_start = true WHERE id = 'f0000000-0000-0000-0000-000000000003';
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

-- 주문 4: 기본 디자인 주문 → 확정 → 손님 취소 → 가예약 해제 → 일부 환불
INSERT INTO orders (id, shop_id, order_no, customer_id, consultation_id, draft_id, kind, status, version, price_list_id, operating_rules_id,
                    details_confirmed_at, terms_consented_at, pickup_at, pickup_day, amount) VALUES
  ('d0000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000001', 'H5J9L4', 'c0000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000003', 'standard', 'awaiting_payment', 1,
   'b0000000-0000-0000-0000-000000000001', 'b4000000-0000-0000-0000-000000000001', now(), now(), '2026-12-24 07:00:00+00', '2026-12-24', 35000);
INSERT INTO order_details (id, shop_id, order_id, version, source, quote_id, price_list_id, pickup_at, size_option_id, flavor_option_id,
                           allergy_answer, customer_name, customer_phone, amount) VALUES
  ('d1000000-0000-0000-0000-000000000006', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000004', 1, 'request',
   'c6000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', '2026-12-24 07:00:00+00', 'b1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000002', '없음', '이손님', '010-9999-8888', 35000);
INSERT INTO payment_requests (id, shop_id, order_id, kind, event_key, status, amount, payment_account_id, due_at, paid_at, arrived_amount, arrived_at) VALUES
  ('e0000000-0000-0000-0000-000000000005', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000004', 'first',
   'pay:d0..04:first', 'paid', 35000, 'b7000000-0000-0000-0000-000000000001', now() + interval '12 hours', now(), 35000, now());
INSERT INTO payments (id, shop_id, order_id, payment_request_id, amount) VALUES
  ('e1000000-0000-0000-0000-000000000005', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000004',
   'e0000000-0000-0000-0000-000000000005', 35000);
INSERT INTO slot_holds (id, shop_id, day, order_id, payment_request_id, hold_key, status, fixed_at) VALUES
  ('e3000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000001', '2026-12-24', 'd0000000-0000-0000-0000-000000000004',
   'e0000000-0000-0000-0000-000000000005', 'hold:d0..04:e0..05', 'fixed', now());
INSERT INTO confirm_cards (id, shop_id, consultation_id, customer_id, card_key, kind, order_id, order_version, payload, expires_at, used_at, outcome) VALUES
  ('c7000000-0000-0000-0000-000000000014', 'a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   'card-cancel-000000001', 'cancel', 'd0000000-0000-0000-0000-000000000004', 1, '{"refund":17500}', now() + interval '30 minutes', now(), 'done');
UPDATE orders SET status = 'cancelled', confirmed_at = now(), cancelled_at = now(), cancel_kind = 'customer' WHERE id = 'd0000000-0000-0000-0000-000000000004';
UPDATE slot_holds SET status = 'released', released_at = now(), release_reason = 'order_cancelled' WHERE id = 'e3000000-0000-0000-0000-000000000004';
INSERT INTO refunds (id, shop_id, order_id, cause, event_key, decision, amount, calculated_amount, calc_basis, method,
                     refund_bank_name, refund_account_number, refund_holder_name, sent_at) VALUES
  ('e2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000004', 'customer_cancel',
   'refund:d0..04:cancel', 'partial', 17500, 17500, '{"rules":"b4..01","tier":"24~72시간 50%","received":35000}', 'bank_transfer',
   '신한은행', '110-123-456789', '이손님', now());
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

-- 주문 5: 입금됨 → 확정 → 잘못 누른 결제 확인 취소(SPEC-070) → 입금했다고 알린 뒤 손님 취소 → 들어온 입금 대조 할 일 →
--         들어온 입금 남기기(SPEC-071) → 손님 취소의 환불 → 환불 보내기 할 일 → 24시간 뒤 다시 알림 → 보냄(REQ-172, REQ-173)
INSERT INTO order_drafts (id, shop_id, consultation_id, status, revision, price_list_id, pickup_at, size_option_id, flavor_option_id,
                          design_option_id, design_id, lettering, allergy_answer, customer_name, customer_phone, order_kind) VALUES
  ('c4000000-0000-0000-0000-000000000005', 'a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'submitted', 1,
   'b0000000-0000-0000-0000-000000000001', '2026-12-28 07:00:00+00', 'b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002',
   NULL, NULL, NULL, '없음', '최손님', '010-7777-6666', 'standard');
INSERT INTO orders (id, shop_id, order_no, customer_id, consultation_id, draft_id, kind, status, version, price_list_id, operating_rules_id,
                    details_confirmed_at, terms_consented_at, pickup_at, pickup_day, amount) VALUES
  ('d0000000-0000-0000-0000-000000000005', 'a2000000-0000-0000-0000-000000000001', 'M3V7B5', 'c0000000-0000-0000-0000-000000000002',
   'c1000000-0000-0000-0000-000000000002', 'c4000000-0000-0000-0000-000000000005', 'standard', 'awaiting_payment', 1,
   'b0000000-0000-0000-0000-000000000001', 'b4000000-0000-0000-0000-000000000001', now(), now(), '2026-12-28 07:00:00+00', '2026-12-28', 35000);
INSERT INTO order_details (id, shop_id, order_id, version, source, price_list_id, pickup_at, size_option_id, flavor_option_id,
                           allergy_answer, customer_name, customer_phone, amount) VALUES
  ('d1000000-0000-0000-0000-000000000007', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000005', 1, 'request',
   'b0000000-0000-0000-0000-000000000001', '2026-12-28 07:00:00+00', 'b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002',
   '없음', '최손님', '010-7777-6666', 35000);
INSERT INTO payment_requests (id, shop_id, order_id, kind, event_key, status, amount, payment_account_id, due_at) VALUES
  ('e0000000-0000-0000-0000-000000000006', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000005', 'first',
   'pay:d0..05:first', 'open', 35000, 'b7000000-0000-0000-0000-000000000001', now() + interval '12 hours');
INSERT INTO slot_holds (id, shop_id, day, order_id, payment_request_id, hold_key, status) VALUES
  ('e3000000-0000-0000-0000-000000000005', 'a2000000-0000-0000-0000-000000000001', '2026-12-28', 'd0000000-0000-0000-0000-000000000005',
   'e0000000-0000-0000-0000-000000000006', 'hold:d0..05:e0..06', 'held');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
UPDATE payment_requests SET status = 'paid', paid_at = now(), arrived_amount = 35000, arrived_at = now(), version = version + 1
 WHERE id = 'e0000000-0000-0000-0000-000000000006';
INSERT INTO payments (id, shop_id, order_id, payment_request_id, amount) VALUES
  ('e1000000-0000-0000-0000-000000000006', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000005',
   'e0000000-0000-0000-0000-000000000006', 35000);
UPDATE orders SET status = 'confirmed', confirmed_at = now() WHERE id = 'd0000000-0000-0000-0000-000000000005';
UPDATE slot_holds SET status = 'fixed', fixed_at = now() WHERE id = 'e3000000-0000-0000-0000-000000000005';
INSERT INTO productions (id, shop_id, order_id) VALUES
  ('f0000000-0000-0000-0000-000000000005', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000005');
INSERT INTO ledger_rows (id, shop_id, order_id, first_written_at, last_written_at) VALUES
  ('fb000000-0000-0000-0000-000000000005', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000005', now(), now());
INSERT INTO ledger_writes (id, shop_id, ledger_row_id, event_key, event_kind) VALUES
  ('fc000000-0000-0000-0000-000000000005', 'a2000000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000005',
   'ledger:d0..05:confirmed', 'confirmed');
-- 잘못 누른 결제 확인 취소: 확인된 결제에 취소 시각·사유, 결제 안내는 나감, 주문은 결제 기다림, 확정 자리는 잡힌 자리, 제작 목록에서 뺌
UPDATE payments SET voided_at = now(), void_reason = '다른 손님 입금을 이 주문으로 잘못 봄' WHERE id = 'e1000000-0000-0000-0000-000000000006';
UPDATE payment_requests SET status = 'open', paid_at = NULL, arrived_amount = NULL, arrived_at = NULL, version = version + 1
 WHERE id = 'e0000000-0000-0000-0000-000000000006';
UPDATE orders SET status = 'awaiting_payment', confirmed_at = NULL WHERE id = 'd0000000-0000-0000-0000-000000000005';
UPDATE slot_holds SET status = 'held', fixed_at = NULL WHERE id = 'e3000000-0000-0000-0000-000000000005';
DELETE FROM productions WHERE id = 'f0000000-0000-0000-0000-000000000005';
INSERT INTO notifications (id, shop_id, customer_id, consultation_id, order_id, kind, event_key, template_key, body, status) VALUES
  ('f9000000-0000-0000-0000-000000000005', 'a2000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002',
   'c1000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000005', 'payment_corrected', 'notice:e1..06:payment_corrected',
   'payment_corrected_v1', '결제 확인을 잘못 남겨 바로잡았어요. 입금하셨다면 알려 주세요.', 'deferred');
INSERT INTO ledger_writes (id, shop_id, ledger_row_id, event_key, event_kind) VALUES
  ('fc000000-0000-0000-0000-000000000006', 'a2000000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000005',
   'ledger:e1..06:payment_voided', 'payment_voided');
-- 입금 알리기 → 손님 취소(결제 확인 요청 중) → 결제 안내 닫힘 → 들어온 입금 대조 할 일(REQ-167)
INSERT INTO confirm_cards (id, shop_id, consultation_id, customer_id, card_key, kind, order_id, order_version, payload, expires_at, used_at, outcome) VALUES
  ('c7000000-0000-0000-0000-000000000015', 'a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002',
   'card-payment-claim-0002', 'payment_claim', 'd0000000-0000-0000-0000-000000000005', 1, '{}', now() + interval '30 minutes', now(), 'done'),
  ('c7000000-0000-0000-0000-000000000016', 'a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002',
   'card-cancel-000000002', 'cancel', 'd0000000-0000-0000-0000-000000000005', 1, '{"refund":35000,"when_arrived":true}', now() + interval '30 minutes', now(), 'done');
UPDATE payment_requests SET status = 'claimed', claimed_at = now(), claim_card_id = 'c7000000-0000-0000-0000-000000000015', version = version + 1
 WHERE id = 'e0000000-0000-0000-0000-000000000006';
UPDATE orders SET status = 'cancelled', cancelled_at = now(), cancel_kind = 'customer' WHERE id = 'd0000000-0000-0000-0000-000000000005';
UPDATE payment_requests SET status = 'closed', closed_at = now(), close_reason = 'order_cancelled', version = version + 1
 WHERE id = 'e0000000-0000-0000-0000-000000000006';
UPDATE slot_holds SET status = 'released', released_at = now(), release_reason = 'order_cancelled' WHERE id = 'e3000000-0000-0000-0000-000000000005';
INSERT INTO owner_tasks (id, shop_id, kind, event_key, order_id, payment_request_id) VALUES
  ('f7000000-0000-0000-0000-000000000005', 'a2000000-0000-0000-0000-000000000001', 'arrival_check', 'task:arrival:e0..06',
   'd0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000006');
-- 들어온 입금 남기기(닫힌 결제 안내에 35,000원) → 손님 취소의 환불 정할 일 → 환불(받은 금액 35,000원)
UPDATE payment_requests SET arrived_amount = 35000, arrived_at = now(), version = version + 1 WHERE id = 'e0000000-0000-0000-0000-000000000006';
UPDATE owner_tasks SET closed_at = now() WHERE id = 'f7000000-0000-0000-0000-000000000005';
INSERT INTO owner_tasks (id, shop_id, kind, event_key, order_id) VALUES
  ('f7000000-0000-0000-0000-000000000006', 'a2000000-0000-0000-0000-000000000001', 'refund_decision', 'task:refund_decision:d0..05',
   'd0000000-0000-0000-0000-000000000005');
INSERT INTO refunds (id, shop_id, order_id, cause, event_key, decision, amount, calculated_amount, calc_basis) VALUES
  ('e2000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000005', 'customer_cancel',
   'refund:d0..05:cancel', 'full', 35000, 35000, '{"rules":"b4..01","clause":"pre_production_cancel","received":35000,"confirmed":0,"arrived_unconfirmed":35000}');
UPDATE owner_tasks SET closed_at = now() WHERE id = 'f7000000-0000-0000-0000-000000000006';
INSERT INTO ledger_writes (id, shop_id, ledger_row_id, event_key, event_kind) VALUES
  ('fc000000-0000-0000-0000-000000000007', 'a2000000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000005',
   'ledger:e2..02:refund', 'refund');
-- 환불 보내기 할 일과 알림, 24시간 뒤 다시 알림 한 번(REQ-173)
INSERT INTO owner_tasks (id, shop_id, kind, event_key, order_id, refund_id) VALUES
  ('f7000000-0000-0000-0000-000000000007', 'a2000000-0000-0000-0000-000000000001', 'refund_send', 'task:refund_send:e2..02',
   'd0000000-0000-0000-0000-000000000005', 'e2000000-0000-0000-0000-000000000002');
INSERT INTO owner_alerts (id, shop_id, owner_task_id, kind, event_key, status, attempts, sent_at) VALUES
  ('f8000000-0000-0000-0000-000000000005', 'a2000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000007', 'new_task',
   'alert:task:f7..07', 'sent', 1, now()),
  ('f8000000-0000-0000-0000-000000000006', 'a2000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000007', 'task_realert',
   'alert:realert:f7..07', 'sent', 1, now());
UPDATE owner_tasks SET realerted_at = now() WHERE id = 'f7000000-0000-0000-0000-000000000007';
-- 손님이 상담에서 알려 준 계좌로 보냄(SPEC-049) → 보냄 표시: 손님 안내·장부 쓰기·할 일 닫힘(REQ-172)
UPDATE refunds SET method = 'bank_transfer', refund_bank_name = '우리은행', refund_account_number = '1002-987-654321', refund_holder_name = '최손님',
                   sent_at = now()
 WHERE id = 'e2000000-0000-0000-0000-000000000002';
UPDATE owner_tasks SET closed_at = now() WHERE id = 'f7000000-0000-0000-0000-000000000007';
INSERT INTO notifications (id, shop_id, customer_id, consultation_id, order_id, kind, event_key, template_key, body, status) VALUES
  ('f9000000-0000-0000-0000-000000000006', 'a2000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002',
   'c1000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000005', 'refund_sent', 'notice:e2..02:refund_sent',
   'refund_sent_v1', '환불 35,000원을 보냈어요.', 'deferred');
INSERT INTO ledger_writes (id, shop_id, ledger_row_id, event_key, event_kind) VALUES
  ('fc000000-0000-0000-0000-000000000008', 'a2000000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000005',
   'ledger:e2..02:refund_sent', 'refund_sent');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

-- ───────────── 2부: 규칙을 어기는 쓰기 ─────────────

-- 가게 나누기(G1, SPEC-068)
SELECT pg_temp.expect_fail('G1 다른 가게의 주문을 참조하는 결제 안내', 'payment_requests_order_fk', ARRAY[$$
  INSERT INTO payment_requests (shop_id, order_id, kind, event_key, amount, payment_account_id, due_at)
  VALUES ('a2000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'first', 'x-1', 40000,
          'b7000000-0000-0000-0000-000000000001', now() + interval '1 hour')$$]);
SELECT pg_temp.expect_fail('G1 다른 가게 채널에 손님 붙이기', 'customers_channel_fk', ARRAY[$$
  INSERT INTO customers (shop_id, kakao_channel_id, kakao_user_key)
  VALUES ('a2000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000001', 'user-key-9')$$]);

-- 가게 등록·연결 (CTX-007)
SELECT pg_temp.expect_fail('SPEC-002 카카오 계정 하나에 가게 둘', 'shops_one_per_owner', ARRAY[$$
  INSERT INTO shops (owner_id, name, contact_phone, business_name, representative_name, business_reg_no, mail_order_reg_no, food_license_no,
                     food_business_type, license_photo_key, entrustment_terms_version, entrustment_consented_at)
  VALUES ('a0000000-0000-0000-0000-000000000001', '두번째', '010-1111-2222', '두번째', '김사장', '1112223334', '2026-0002', '1', 'bakery', 'x', 'v1', now())$$]);
SELECT pg_temp.expect_fail('REQ-107 처리 위탁 동의 없는 가게', 'entrustment_consented_at', ARRAY[$$
  INSERT INTO owners (id, kakao_account_id) VALUES ('a0000000-0000-0000-0000-000000000009', 1009)$$, $$
  INSERT INTO shops (owner_id, name, contact_phone, business_name, representative_name, business_reg_no, mail_order_reg_no, food_license_no,
                     food_business_type, license_photo_key, entrustment_terms_version)
  VALUES ('a0000000-0000-0000-0000-000000000009', '동의없음', '010-1111-2222', '동의없음', '정사장', '1112223334', '2026-0003', '1', 'bakery', 'x', 'v1')$$]);
SELECT pg_temp.expect_fail('SPEC-002 영업 종류가 둘 밖', 'shops_food_business_type_check', ARRAY[$$
  UPDATE shops SET food_business_type = 'none' WHERE id = 'a2000000-0000-0000-0000-000000000002'$$]);
SELECT pg_temp.expect_fail('REQ-106 통신판매업 신고번호도 면제 사유도 없음', 'shops_mail_order_chk', ARRAY[$$
  UPDATE shops SET mail_order_exemption = NULL WHERE id = 'a2000000-0000-0000-0000-000000000002'$$]);
SELECT pg_temp.expect_fail('SPEC-003 이유 없는 보류', 'shops_hold_reason_chk', ARRAY[$$
  UPDATE shops SET license_status = 'on_hold', license_reviewed_by = 'a1000000-0000-0000-0000-000000000001', license_reviewed_at = now()
   WHERE id = 'a2000000-0000-0000-0000-000000000002'$$]);
SELECT pg_temp.expect_fail('REQ-103 영업 신고 확인 전 예약 링크', 'shops_booking_needs_license', ARRAY[$$
  UPDATE shops SET booking_slug = 'other-shop', booking_issued_at = now() WHERE id = 'a2000000-0000-0000-0000-000000000002'$$]);
SELECT pg_temp.expect_fail('SPEC-008 채널 하나를 두 가게에', 'kakao_channels_bot_active_uq', ARRAY[$$
  INSERT INTO kakao_channels (shop_id, bot_id, status) VALUES ('a2000000-0000-0000-0000-000000000002', 'bot-a', 'pending')$$]);
SELECT pg_temp.expect_fail('REQ-141 국외 이전 항목 빈 처리방침', 'privacy_policies_transfers_chk', ARRAY[$$
  INSERT INTO privacy_policies (shop_id, version, body, overseas_transfers) VALUES ('a2000000-0000-0000-0000-000000000001', 2, '글', '[]')$$]);
SELECT pg_temp.expect_fail('R2 대소문자만 다른 운영자 이메일', 'operators_email_uq', ARRAY[$$
  INSERT INTO operators (email, display_name) VALUES ('OPS@example.com', '다른 운영자')$$]);

-- 가게 규칙 (CTX-002)
SELECT pg_temp.expect_fail('SPEC-004 가게마다 지금 가격표 둘', 'price_lists_one_current', ARRAY[$$
  INSERT INTO price_lists (shop_id, version) VALUES ('a2000000-0000-0000-0000-000000000001', 2)$$]);
SELECT pg_temp.expect_fail('SPEC-004 같은 조합의 옵션 규칙 둘(허용이자 금지)', 'price_option_rules_pair_uq', ARRAY[$$
  INSERT INTO price_option_rules (shop_id, price_list_id, rule_kind, option_a_id, option_b_id)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'exclude',
          'b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000004')$$]);
SELECT pg_temp.expect_fail('SPEC-004 값이 1,000만 원을 넘음', 'price_options_amount_check', ARRAY[$$
  UPDATE price_options SET amount = 10000001 WHERE id = 'b1000000-0000-0000-0000-000000000001'$$]);
SELECT pg_temp.expect_fail('SPEC-013 다른 버전의 옵션으로 초안 채우기', 'order_drafts_size_fk', ARRAY[$$
  UPDATE price_lists SET superseded_at = now() WHERE id = 'b0000000-0000-0000-0000-000000000001'$$, $$
  INSERT INTO price_lists (id, shop_id, version) VALUES ('b0000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 2)$$, $$
  INSERT INTO price_options (id, shop_id, price_list_id, option_group, name, amount)
  VALUES ('b1000000-0000-0000-0000-000000000009', 'a2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'size', '2호', 45000)$$, $$
  INSERT INTO order_drafts (shop_id, consultation_id, price_list_id, size_option_id)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
          'b1000000-0000-0000-0000-000000000009')$$]);
SELECT pg_temp.expect_fail('REQ-032 제작 전 취소 환불을 낮추고 확인 없음', 'operating_rules_lowered_chk', ARRAY[$$
  INSERT INTO operating_rules (shop_id, version, change_deadline_hours, date_change_refund_basis, pre_production_refund_pct, superseded_at)
  VALUES ('a2000000-0000-0000-0000-000000000001', 2, 48, 'new_pickup', 80, now())$$]);
SELECT pg_temp.expect_fail('SPEC-005 단계별 환불 기간 중복됨', 'refund_tiers_no_overlap', ARRAY[$$
  INSERT INTO refund_tiers (shop_id, operating_rules_id, hours_before_min, hours_before_max, refund_pct)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'b4000000-0000-0000-0000-000000000001', 48, 96, 70)$$]);
SELECT pg_temp.expect_fail('SPEC-005 기한이 720시간을 넘음', 'operating_rules_payment_due_hours_check', ARRAY[$$
  UPDATE operating_rules SET payment_due_hours = 721 WHERE id = 'b4000000-0000-0000-0000-000000000001'$$]);
SELECT pg_temp.expect_fail('SPEC-007 답하는 시간이 거꾸로', 'business_calendars_reply_chk', ARRAY[$$
  UPDATE business_calendars SET reply_start = '22:00' WHERE shop_id = 'a2000000-0000-0000-0000-000000000001'$$]);
SELECT pg_temp.expect_fail('SPEC-052 전날 안내가 20:50 뒤', 'business_calendars_day_before_notice_time_check', ARRAY[$$
  UPDATE business_calendars SET day_before_notice_time = '21:00' WHERE shop_id = 'a2000000-0000-0000-0000-000000000001'$$]);
SELECT pg_temp.expect_fail('SPEC-007 하루 최대 개수 100 넘음', 'business_calendars_daily_capacity_check', ARRAY[$$
  UPDATE business_calendars SET daily_capacity = 101 WHERE shop_id = 'a2000000-0000-0000-0000-000000000001'$$]);
SELECT pg_temp.expect_fail('G3 날짜 행 없는 날의 자리', 'slot_holds_day_fk', ARRAY[$$
  INSERT INTO slot_holds (shop_id, day, order_id, hold_key, status, fixed_at)
  VALUES ('a2000000-0000-0000-0000-000000000001', '2027-01-05', 'd0000000-0000-0000-0000-000000000004', 'hold:x', 'fixed', now())$$]);
SELECT pg_temp.expect_fail('1-4 주문 하나에 유효한 자리 둘', 'slot_holds_one_live_per_order', ARRAY[$$
  INSERT INTO slot_holds (shop_id, day, order_id, hold_key, status, fixed_at)
  VALUES ('a2000000-0000-0000-0000-000000000001', '2026-12-28', 'd0000000-0000-0000-0000-000000000003', 'hold:y', 'fixed', now())$$]);
SELECT pg_temp.expect_fail('R13 결제 안내 없이 잡힘', 'slot_holds_held_chk', ARRAY[$$
  INSERT INTO slot_holds (shop_id, day, order_id, hold_key, status)
  VALUES ('a2000000-0000-0000-0000-000000000001', '2026-12-24', 'd0000000-0000-0000-0000-000000000004', 'hold:z', 'held')$$]);
SELECT pg_temp.expect_fail('1-4 사유 없이 풀림', 'slot_holds_released_chk', ARRAY[$$
  UPDATE slot_holds SET status = 'released', released_at = now() WHERE id = 'e3000000-0000-0000-0000-000000000003'$$]);

-- 상담 (CTX-001)
SELECT pg_temp.expect_fail('REQ-132 같은 카카오 메시지 두 번', 'messages_kakao_id_uq', ARRAY[$$
  INSERT INTO messages (shop_id, consultation_id, direction, author, kakao_message_id)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'inbound', 'customer', 'km-1')$$]);
SELECT pg_temp.expect_fail('SPEC-017 손님 하나에 상담 둘', 'consultations_one_live_per_customer', ARRAY[$$
  INSERT INTO consultations (shop_id, customer_id) VALUES ('a2000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001')$$]);
SELECT pg_temp.expect_fail('SPEC-021 카드번호 전체를 남김', 'masked_values_card_last4_chk', ARRAY[$$
  INSERT INTO masked_values (shop_id, consultation_id, kind, placeholder, original_value)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'card', '[카드번호1]', '1234567812345678')$$]);
SELECT pg_temp.expect_fail('SPEC-021 플레이스홀더 형식이 아님', 'masked_values_placeholder_check', ARRAY[$$
  INSERT INTO masked_values (shop_id, consultation_id, kind, placeholder, original_value)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'phone', '전화번호', '010-1111-2222')$$]);
SELECT pg_temp.expect_fail('상담마다 채우는 초안 둘', 'order_drafts_one_active', ARRAY[$$
  INSERT INTO order_drafts (shop_id, consultation_id) VALUES ('a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001')$$, $$
  INSERT INTO order_drafts (shop_id, consultation_id) VALUES ('a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001')$$]);
SELECT pg_temp.expect_fail('AI-1 문구 50자 넘음', 'order_drafts_lettering_check', ARRAY[$$
  UPDATE order_drafts SET lettering = repeat('가', 51) WHERE id = 'c4000000-0000-0000-0000-000000000003'$$]);
SELECT pg_temp.expect_fail('SPEC-019 20MB 넘는 참고 사진', 'reference_photos_byte_size_check', ARRAY[$$
  UPDATE reference_photos SET byte_size = 20971521 WHERE id = 'c5000000-0000-0000-0000-000000000001'$$]);
SELECT pg_temp.expect_fail('G9 30분 넘는 카드 기한', 'confirm_cards_expiry_chk', ARRAY[$$
  INSERT INTO confirm_cards (shop_id, consultation_id, customer_id, card_key, kind, order_id, order_version, payload, expires_at)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
          'card-too-long-00001', 'cancel', 'd0000000-0000-0000-0000-000000000001', 1, '{}', now() + interval '31 minutes')$$]);
SELECT pg_temp.expect_fail('G9 버전 없는 취소 카드', 'confirm_cards_order_chk', ARRAY[$$
  INSERT INTO confirm_cards (shop_id, consultation_id, customer_id, card_key, kind, order_id, payload, expires_at)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
          'card-no-version-0001', 'cancel', 'd0000000-0000-0000-0000-000000000001', '{}', now() + interval '10 minutes')$$]);
SELECT pg_temp.expect_fail('G2 같은 카드 키 두 번', 'confirm_cards_key_uq', ARRAY[$$
  INSERT INTO confirm_cards (shop_id, consultation_id, customer_id, card_key, kind, order_id, order_version, payload, expires_at)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
          'card-cancel-000000001', 'cancel', 'd0000000-0000-0000-0000-000000000001', 1, '{}', now() + interval '10 minutes')$$]);
SELECT pg_temp.expect_fail('SPEC-022 상담마다 열린 에스컬레이션 건 둘', 'handoffs_one_open_per_consultation', ARRAY[$$
  INSERT INTO handoffs (shop_id, consultation_id, source_message_id, reason)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000004', 'cannot_answer')$$]);
SELECT pg_temp.expect_fail('SPEC-023 답 없이 답함', 'handoffs_answer_chk', ARRAY[$$
  UPDATE handoffs SET status = 'answered', answered_at = now() WHERE id = 'f6000000-0000-0000-0000-000000000001'$$]);
SELECT pg_temp.expect_fail('SPEC-057 주문번호 없는 신고 내용으로 신고', 'issue_details_order_chk', ARRAY[$$
  INSERT INTO issue_details (shop_id, consultation_id, status) VALUES ('a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'reported')$$]);
SELECT pg_temp.expect_fail('SPEC-057 신고 사진 6장째', 'issue_photos_position_check', ARRAY[$$
  INSERT INTO issue_photos (shop_id, issue_details_id, message_id, position, storage_key, content_type, byte_size)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000004', 6, 'k', 'image/png', 10)$$]);
SELECT pg_temp.expect_fail('AI-1 성공한 AI 호출에 토큰·비용 없음', 'ai_calls_success_chk', ARRAY[$$
  INSERT INTO ai_calls (shop_id, consultation_id, trace_id, attempt, provider, model, prompt_version, sent_at, result)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'trace-9', 1, 'p', 'm', 'v1', now(), 'success')$$]);
SELECT pg_temp.expect_fail('AI-1 쓰기 도구 기록', 'ai_tool_calls_tool_name_check', ARRAY[$$
  INSERT INTO ai_tool_calls (shop_id, ai_call_id, consultation_id, tool_name, args_masked, result)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'fd000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'save_draft', '{}', 'ok')$$]);
SELECT pg_temp.expect_fail('AI-1 같은 차례 같은 시도 두 번', 'ai_calls_attempt_uq', ARRAY[$$
  INSERT INTO ai_calls (shop_id, consultation_id, trace_id, attempt, provider, model, prompt_version, sent_at, result)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'trace-1', 1, 'p', 'm', 'v1', now(), 'failure')$$]);

-- 주문 (CTX-003)
SELECT pg_temp.expect_fail('REQ-054 규정 동의 없는 주문 요청', 'orders_consent_chk', ARRAY[$$
  INSERT INTO orders (shop_id, order_no, customer_id, consultation_id, draft_id, kind, status, price_list_id, operating_rules_id,
                      details_confirmed_at, pickup_at, pickup_day, amount)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'ZZ1111', 'c0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001',
          'c4000000-0000-0000-0000-000000000003', 'standard', 'awaiting_payment', 'b0000000-0000-0000-0000-000000000001',
          'b4000000-0000-0000-0000-000000000001', now(), now() + interval '3 days', current_date + 3, 35000)$$]);
SELECT pg_temp.expect_fail('1-2 기본 디자인 주문이 사장님 답 기다림', 'orders_requested_custom_chk', ARRAY[$$
  UPDATE orders SET status = 'requested', confirmed_at = NULL WHERE id = 'd0000000-0000-0000-0000-000000000002'$$]);
SELECT pg_temp.expect_fail('REQ-058 수락 없이 결제로 간 맞춤 주문', 'orders_accepted_before_payment_chk', ARRAY[$$
  UPDATE orders SET accepted_at = NULL, accepted_version = NULL WHERE id = 'd0000000-0000-0000-0000-000000000003'$$]);
SELECT pg_temp.expect_fail('REQ-060 확정 시각 없는 확정', 'orders_confirmed_chk', ARRAY[$$
  UPDATE orders SET confirmed_at = NULL WHERE id = 'd0000000-0000-0000-0000-000000000003'$$]);
SELECT pg_temp.expect_fail('1-2 없는 주문 상태', 'orders_status_check', ARRAY[$$
  UPDATE orders SET status = 'done' WHERE id = 'd0000000-0000-0000-0000-000000000003'$$]);
SELECT pg_temp.expect_fail('R21 결제 있는 재제작 주문', 'orders_remake_chk', ARRAY[$$
  UPDATE orders SET amount = 1000 WHERE id = 'd0000000-0000-0000-0000-000000000002'$$]);
SELECT pg_temp.expect_fail('E2 주문 행 금액이 현재 버전과 다름', 'orders_current_details_fk', ARRAY[$$
  UPDATE orders SET amount = 61000 WHERE id = 'd0000000-0000-0000-0000-000000000003'$$]);
SELECT pg_temp.expect_fail('E2 없는 버전을 현재 버전으로', 'orders_current_details_fk', ARRAY[$$
  UPDATE orders SET version = 4 WHERE id = 'd0000000-0000-0000-0000-000000000003'$$]);
SELECT pg_temp.expect_fail('SPEC-048 사유 없는 가게 사정 취소', 'orders_shop_cancel_reason_chk', ARRAY[$$
  UPDATE orders SET cancel_kind = 'shop' WHERE id = 'd0000000-0000-0000-0000-000000000004'$$]);
SELECT pg_temp.expect_fail('SPEC-045 같은 버전의 주문 내용 둘', 'order_details_version_uq', ARRAY[$$
  INSERT INTO order_details (shop_id, order_id, version, source, price_list_id, pickup_at, amount, amount_change_reason)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', 3, 'owner_amount_change',
          'b0000000-0000-0000-0000-000000000001', '2026-12-28 06:00:00+00', 60000, '같은 버전')$$]);
SELECT pg_temp.expect_fail('SPEC-045 같은 변경을 두 번 반영', 'order_details_change_uq', ARRAY[$$
  INSERT INTO order_details (shop_id, order_id, version, source, change_request_id, price_list_id, pickup_at, amount)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', 4, 'change_request',
          'd2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '2026-12-28 06:00:00+00', 60000)$$]);
SELECT pg_temp.expect_fail('1-5 한 주문에 열린 변경 요청 둘', 'change_requests_one_open_per_order', ARRAY[$$
  INSERT INTO confirm_cards (id, shop_id, consultation_id, customer_id, card_key, kind, order_id, order_version, payload, expires_at)
  VALUES ('c7000000-0000-0000-0000-000000000021', 'a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002',
          'c0000000-0000-0000-0000-000000000002', 'card-change-0000000021', 'change_request', 'd0000000-0000-0000-0000-000000000003', 3, '{}',
          now() + interval '10 minutes')$$, $$
  INSERT INTO confirm_cards (id, shop_id, consultation_id, customer_id, card_key, kind, order_id, order_version, payload, expires_at)
  VALUES ('c7000000-0000-0000-0000-000000000022', 'a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002',
          'c0000000-0000-0000-0000-000000000002', 'card-change-0000000022', 'change_request', 'd0000000-0000-0000-0000-000000000003', 3, '{}',
          now() + interval '10 minutes')$$, $$
  INSERT INTO change_requests (shop_id, order_id, card_id, base_version, changes)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', 'c7000000-0000-0000-0000-000000000021', 3, '{}')$$, $$
  INSERT INTO change_requests (shop_id, order_id, card_id, base_version, changes)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', 'c7000000-0000-0000-0000-000000000022', 3, '{}')$$]);
SELECT pg_temp.expect_fail('REQ-067 금액이 오르지 않는 차액 결제 기다림', 'change_requests_difference_chk', ARRAY[$$
  UPDATE change_requests SET status = 'awaiting_difference', amount_delta = NULL, applied_version = NULL, applied_at = NULL
   WHERE id = 'd2000000-0000-0000-0000-000000000001'$$]);
SELECT pg_temp.expect_fail('SPEC-045 버전을 건너뛴 반영', 'change_requests_applied_version_chk', ARRAY[$$
  UPDATE change_requests SET applied_version = 4 WHERE id = 'd2000000-0000-0000-0000-000000000001'$$]);
SELECT pg_temp.expect_fail('SPEC-060 재제작이 아닌 보상에 재제작 주문', 'issue_reports_remake_chk', ARRAY[$$
  UPDATE issue_reports SET compensation = 'none' WHERE id = 'f2000000-0000-0000-0000-000000000001'$$]);
SELECT pg_temp.expect_fail('G2 신고 카드 하나에 신고 둘', 'issue_reports_card_uq', ARRAY[$$
  INSERT INTO issue_details (id, shop_id, consultation_id, order_id, status)
  VALUES ('f1000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001',
          'd0000000-0000-0000-0000-000000000001', 'reported')$$, $$
  INSERT INTO issue_reports (shop_id, order_id, issue_details_id, card_id, late, follows_report_id)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002',
          'c7000000-0000-0000-0000-000000000012', true, 'f2000000-0000-0000-0000-000000000001')$$]);

-- 결제·환불 (CTX-004)
SELECT pg_temp.expect_fail('1-3 한 주문에 열린 결제 안내 둘', 'payment_requests_one_open_per_order', ARRAY[$$
  INSERT INTO payment_requests (shop_id, order_id, kind, event_key, amount, payment_account_id, due_at)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'reissue', 'x-2', 40000,
          'b7000000-0000-0000-0000-000000000001', now() + interval '1 hour')$$, $$
  INSERT INTO payment_requests (shop_id, order_id, kind, event_key, amount, payment_account_id, due_at)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'reissue', 'x-3', 40000,
          'b7000000-0000-0000-0000-000000000001', now() + interval '1 hour')$$]);
SELECT pg_temp.expect_fail('REQ-153 결제 안내 하나에 확인된 결제 둘', 'payments_one_live_per_request', ARRAY[$$
  INSERT INTO payments (shop_id, order_id, payment_request_id, amount)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 40000)$$]);
SELECT pg_temp.expect_fail('REQ-081 안내 금액과 다른 확인된 결제', 'payments_match_fk', ARRAY[$$
  INSERT INTO payment_requests (id, shop_id, order_id, kind, event_key, amount, payment_account_id, due_at)
  VALUES ('e0000000-0000-0000-0000-000000000009', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'reissue',
          'x-4', 40000, 'b7000000-0000-0000-0000-000000000001', now() + interval '1 hour')$$, $$
  INSERT INTO payments (shop_id, order_id, payment_request_id, amount)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000009', 39000)$$]);
SELECT pg_temp.expect_fail('REQ-081 다른 주문의 결제 안내로 확인', 'payments_match_fk', ARRAY[$$
  INSERT INTO payment_requests (id, shop_id, order_id, kind, event_key, amount, payment_account_id, due_at)
  VALUES ('e0000000-0000-0000-0000-000000000009', 'a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'reissue',
          'x-5', 40000, 'b7000000-0000-0000-0000-000000000001', now() + interval '1 hour')$$, $$
  INSERT INTO payments (shop_id, order_id, payment_request_id, amount)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000009', 40000)$$]);
SELECT pg_temp.expect_fail('R13 변경 요청 없는 차액 결제', 'payment_requests_difference_chk', ARRAY[$$
  INSERT INTO payment_requests (shop_id, order_id, kind, event_key, amount, payment_account_id, due_at)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', 'difference', 'x-6', 1000,
          'b7000000-0000-0000-0000-000000000001', now() + interval '1 hour')$$]);
SELECT pg_temp.expect_fail('R12 결제 기한이 낸 시각보다 앞', 'payment_requests_due_chk', ARRAY[$$
  INSERT INTO payment_requests (shop_id, order_id, kind, event_key, amount, payment_account_id, due_at)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'reissue', 'x-7', 40000,
          'b7000000-0000-0000-0000-000000000001', now() - interval '1 hour')$$]);
SELECT pg_temp.expect_fail('G2 같은 이벤트의 결제 안내 둘', 'payment_requests_event_uq', ARRAY[$$
  INSERT INTO payment_requests (shop_id, order_id, kind, event_key, amount, payment_account_id, due_at)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'reissue', 'pay:d0..01:first', 40000,
          'b7000000-0000-0000-0000-000000000001', now() + interval '1 hour')$$]);
SELECT pg_temp.expect_fail('SPEC-035 다르게 들어온 금액이 10배를 넘음', 'payment_requests_arrived_amount_chk', ARRAY[$$
  INSERT INTO payment_requests (shop_id, order_id, kind, event_key, status, amount, payment_account_id, due_at, mismatch_amount, mismatch_at,
                                arrived_amount, arrived_at)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'reissue', 'x-8', 'mismatch', 40000,
          'b7000000-0000-0000-0000-000000000001', now() + interval '1 hour', 400001, now(), 400001, now())$$]);
SELECT pg_temp.expect_fail('SPEC-033 미입금 뒤 다시 확인 요청됨', 'payment_requests_claimed_chk', ARRAY[$$
  INSERT INTO payment_requests (shop_id, order_id, kind, event_key, status, amount, payment_account_id, due_at, claimed_at, claim_rejected_at)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'reissue', 'x-9', 'claimed', 40000,
          'b7000000-0000-0000-0000-000000000001', now() + interval '1 hour', now(), now())$$]);
SELECT pg_temp.expect_fail('REQ-165 확인됨인데 들어온 금액 없음', 'payment_requests_arrived_paid_chk', ARRAY[$$
  UPDATE payment_requests SET arrived_amount = NULL, arrived_at = NULL WHERE id = 'e0000000-0000-0000-0000-000000000001'$$]);
SELECT pg_temp.expect_fail('REQ-165 들어온 금액에 남긴 시각 없음', 'payment_requests_arrived_chk', ARRAY[$$
  UPDATE payment_requests SET arrived_at = NULL WHERE id = 'e0000000-0000-0000-0000-000000000001'$$]);
SELECT pg_temp.expect_fail('REQ-165 나간 결제 안내에 들어온 금액', 'payment_requests_arrived_status_chk', ARRAY[$$
  INSERT INTO payment_requests (shop_id, order_id, kind, event_key, amount, payment_account_id, due_at, arrived_amount, arrived_at)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'reissue', 'x-10', 40000,
          'b7000000-0000-0000-0000-000000000001', now() + interval '1 hour', 40000, now())$$]);
SELECT pg_temp.expect_fail('SPEC-035 맞추는 중의 들어온 금액이 다르게 들어온 금액과 다름', 'payment_requests_arrived_mismatch_chk', ARRAY[$$
  INSERT INTO payment_requests (shop_id, order_id, kind, event_key, status, amount, payment_account_id, due_at, mismatch_amount, mismatch_at,
                                arrived_amount, arrived_at)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'reissue', 'x-11', 'mismatch', 40000,
          'b7000000-0000-0000-0000-000000000001', now() + interval '1 hour', 45000, now(), 40000, now())$$]);
SELECT pg_temp.expect_fail('REQ-169 사유 없는 결제 확인 취소', 'payments_void_chk', ARRAY[$$
  UPDATE payments SET voided_at = now() WHERE id = 'e1000000-0000-0000-0000-000000000001'$$]);
SELECT pg_temp.expect_fail('REQ-169 결제 확인 취소 뒤 다시 확인한 결제 둘', 'payments_one_live_per_request', ARRAY[$$
  UPDATE payments SET voided_at = now(), void_reason = '잘못 누름' WHERE id = 'e1000000-0000-0000-0000-000000000001'$$, $$
  INSERT INTO payments (shop_id, order_id, payment_request_id, amount)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 40000)$$, $$
  INSERT INTO payments (shop_id, order_id, payment_request_id, amount)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 40000)$$]);
SELECT pg_temp.expect_fail('REQ-085 환불 없음인데 금액', 'refunds_decision_chk', ARRAY[$$
  UPDATE refunds SET decision = 'none' WHERE id = 'e2000000-0000-0000-0000-000000000001'$$]);
SELECT pg_temp.expect_fail('SPEC-047 계산값보다 높은 금액에 사유 없음', 'refunds_override_chk', ARRAY[$$
  UPDATE refunds SET amount = 20000 WHERE id = 'e2000000-0000-0000-0000-000000000001'$$]);
SELECT pg_temp.expect_fail('REQ-170 계산값보다 낮은 환불', 'refunds_floor_chk', ARRAY[$$
  UPDATE refunds SET amount = 15000, override_reason = '손님과 따로 이야기함' WHERE id = 'e2000000-0000-0000-0000-000000000001'$$]);
SELECT pg_temp.expect_fail('REQ-170 계산값이 있는데 환불 없이 취소', 'refunds_floor_chk', ARRAY[$$
  UPDATE refunds SET decision = 'none', amount = 0, override_reason = '손님과 따로 이야기함', method = NULL, sent_at = NULL
   WHERE id = 'e2000000-0000-0000-0000-000000000001'$$]);
SELECT pg_temp.expect_fail('SPEC-071 결제 안내 없는 취소 뒤 들어온 입금 환불', 'refunds_request_chk', ARRAY[$$
  INSERT INTO refunds (shop_id, order_id, cause, event_key, decision, amount, calculated_amount, calc_basis)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000004', 'paid_after_cancel', 'refund:x-2', 'full', 1000, 1000, '{}')$$]);
SELECT pg_temp.expect_fail('SPEC-071 없는 결제 안내의 들어온 입금 환불', 'refunds_request_fk', ARRAY[$$
  INSERT INTO refunds (shop_id, order_id, cause, payment_request_id, event_key, decision, amount, calculated_amount, calc_basis)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000004', 'paid_after_cancel', 'e0000000-0000-0000-0000-0000000000ff',
          'refund:x-3', 'full', 1000, 1000, '{}')$$]);
SELECT pg_temp.expect_fail('G2 같은 환불을 두 번 정함', 'refunds_event_uq', ARRAY[$$
  INSERT INTO refunds (shop_id, order_id, cause, event_key, decision, amount, calculated_amount, calc_basis)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000004', 'customer_cancel', 'refund:d0..04:cancel',
          'partial', 17500, 17500, '{}')$$]);
SELECT pg_temp.expect_fail('SPEC-059 신고 없는 보상 환불', 'refunds_issue_chk', ARRAY[$$
  INSERT INTO refunds (shop_id, order_id, cause, event_key, decision, amount, calculated_amount, calc_basis)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'compensation', 'refund:x', 'full', 40000, 40000, '{}')$$]);
SELECT pg_temp.expect_fail('SPEC-006 https가 아닌 카드 결제 링크', 'payment_accounts_card_payment_url_check', ARRAY[$$
  UPDATE payment_accounts SET card_payment_url = 'http://pay.example.com' WHERE id = 'b7000000-0000-0000-0000-000000000001'$$]);
SELECT pg_temp.expect_fail('SPEC-006 가게마다 지금 계좌 둘', 'payment_accounts_one_current', ARRAY[$$
  INSERT INTO payment_accounts (shop_id, bank_name, account_number, holder_name)
  VALUES ('a2000000-0000-0000-0000-000000000001', '우리은행', '1002-123-456789', '김사장')$$]);

-- 제작·전달, 후기·포트폴리오 (CTX-005, CTX-006)
SELECT pg_temp.expect_fail('SPEC-055 폐기한 케이크를 인도함', 'productions_discard_chk', ARRAY[$$
  UPDATE productions SET no_pickup_at = now(), discarded_at = now() WHERE id = 'f0000000-0000-0000-0000-000000000001'$$]);
SELECT pg_temp.expect_fail('SPEC-051 5분 지나 되돌림', 'production_undos_window_chk', ARRAY[$$
  INSERT INTO production_undos (shop_id, production_id, mark, marked_at, undone_at)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000003', 'production_started', now() - interval '6 minutes', now())$$]);
SELECT pg_temp.expect_fail('SPEC-062 주문마다 지금 후기 둘', 'reviews_one_current_per_order', ARRAY[$$
  INSERT INTO reviews (shop_id, order_id, version, body) VALUES ('a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 2, '또 씀')$$]);
SELECT pg_temp.expect_fail('REQ-097 사진 없는 포트폴리오 항목', 'portfolio_items_one_photo_chk', ARRAY[$$
  INSERT INTO portfolio_items (shop_id, photo_consent_id) VALUES ('a2000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000002')$$]);
SELECT pg_temp.expect_fail('REQ-098 동의하지 않은 것을 철회함', 'photo_consents_withdraw_chk', ARRAY[$$
  UPDATE photo_consents SET withdrawn_at = now() WHERE id = 'd3000000-0000-0000-0000-000000000001'$$]);

-- 알림·장부 (CTX-008, CTX-009)
SELECT pg_temp.expect_fail('REQ-154 같은 이벤트의 안내 둘', 'notifications_event_uq', ARRAY[$$
  INSERT INTO notifications (shop_id, customer_id, consultation_id, kind, event_key, template_key, body)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001',
          'order_confirmed', 'notice:d0..01:confirmed', 't', '다시')$$]);
SELECT pg_temp.expect_fail('G4 다섯 번째 보내기', 'notifications_attempts_check', ARRAY[$$
  UPDATE notifications SET attempts = 5 WHERE id = 'f9000000-0000-0000-0000-000000000001'$$]);
SELECT pg_temp.expect_fail('SPEC-067 대상 없는 신고 할 일', 'owner_tasks_subject_chk', ARRAY[$$
  INSERT INTO owner_tasks (shop_id, kind, event_key, wait_status, wait_due_at)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'issue_report', 'task:x', 'waiting', now())$$]);
SELECT pg_temp.expect_fail('REQ-173 보낼 환불 없는 환불 보내기 할 일', 'owner_tasks_subject_chk', ARRAY[$$
  INSERT INTO owner_tasks (shop_id, kind, event_key, order_id)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'refund_send', 'task:refund_send:x', 'd0000000-0000-0000-0000-000000000004')$$]);
SELECT pg_temp.expect_fail('REQ-167 결제 안내 없는 들어온 입금 대조 할 일', 'owner_tasks_subject_chk', ARRAY[$$
  INSERT INTO owner_tasks (shop_id, kind, event_key, order_id)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'arrival_check', 'task:arrival:x', 'd0000000-0000-0000-0000-000000000004')$$]);
SELECT pg_temp.expect_fail('1-7 기다림이 없는 할 일에 기다림 상태', 'owner_tasks_wait_kind_chk', ARRAY[$$
  INSERT INTO owner_tasks (shop_id, kind, event_key, order_id, wait_status, wait_due_at)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'payment_overdue', 'task:overdue:x', 'd0000000-0000-0000-0000-000000000001', 'waiting', now())$$]);
SELECT pg_temp.expect_fail('1-7 지연 안내 없이 지연', 'owner_tasks_late_chk', ARRAY[$$
  UPDATE owner_tasks SET wait_status = 'late' WHERE id = 'f7000000-0000-0000-0000-000000000002'$$]);
SELECT pg_temp.expect_fail('REQ-126 주문 하나에 장부 행 둘', 'ledger_rows_order_uq', ARRAY[$$
  INSERT INTO ledger_rows (shop_id, order_id) VALUES ('a2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001')$$]);
SELECT pg_temp.expect_fail('REQ-132 같은 이벤트의 장부 쓰기 둘', 'ledger_writes_event_uq', ARRAY[$$
  INSERT INTO ledger_writes (shop_id, ledger_row_id, event_key, event_kind)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000001', 'ledger:d0..01:confirmed', 'confirmed')$$]);
SELECT pg_temp.expect_fail('SPEC-009 가게마다 유효한 장부 연결 둘', 'ledger_links_one_live_per_shop', ARRAY[$$
  INSERT INTO ledger_links (shop_id, spreadsheet_id, sheet_name, our_columns, credential_ref)
  VALUES ('a2000000-0000-0000-0000-000000000001', 'sheet-2', '주문', '{}', 'secret-store/ledger/shop-a-2')$$]);
SELECT pg_temp.expect_fail('G2 같은 화면 요청 키 두 번', 'request_keys_pkey', ARRAY[$$
  INSERT INTO request_keys (actor_kind, actor_id, request_key, command, response_status)
  VALUES ('owner', 'a0000000-0000-0000-0000-000000000001', 'screen-key-000000001', 'confirm_payment', 200)$$]);

-- 결과
SELECT count(*) FILTER (WHERE ok) AS blocked, count(*) FILTER (WHERE NOT ok) AS not_blocked FROM rule_results \gset
SELECT name, detail FROM rule_results WHERE NOT ok ORDER BY name;
SELECT 'rule_tests: ' || :blocked || ' blocked, ' || :not_blocked || ' not blocked' AS summary;
SELECT (SELECT count(*) FROM orders) AS orders, (SELECT count(*) FROM order_details) AS order_details,
       (SELECT count(*) FROM payments) AS payments, (SELECT count(*) FROM slot_holds) AS slot_holds,
       (SELECT count(*) FROM refunds) AS refunds, (SELECT count(*) FROM portfolio_items) AS portfolio;
ROLLBACK;
