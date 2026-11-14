-- 0012_request_keys_questions_extras: 같은 요청 거르기와 05 스키마 구조(설계 재검토 M7·M17, 2026-11-14,
-- 2026-11-13 20:59 결정 카드 '모두 지금 고침 (추천)', 검토자의 고치는 방향대로)
-- M7(RC-16, RD-05): 화면 요청 키(request_keys)에 요청 지문(request_hash)·처리 상태(state, processing_expires_at)·처음 결과의 상태 코드와
--     종류·가리킨 기록(response_status, response_code, response_ref)·끝난 시각(done_at)을 두고 처음 결과 본문(response_body)을 뺌. 같은 키에
--     지문이 다르면 422, 처리 중이면 409, 끝났으면 같은 상태 코드와 그 기록의 지금 상태를 다시 읽은 본문(06 DEC-04). 24시간 뒤 지우기가 지움.
-- M7(RC-06): 환불은 취소한 주문(cancelled_order_id)·변경 요청·문제 신고·결제 안내마다 하나(UNIQUE 넷, 트리거 refunds_cancelled). 주문은
--     그 주문을 확정한 결제(confirmed_payment_id)를 가리키고 주문 확정 뒤 상태면 꼭 있음(orders_confirmed_payment_chk·_fk, 지연 트리거
--     orders_confirmed_payment_live·payments_confirmed_void). event_key·hold_key의 형식은 docs/05-erd/README.md 4절 A33(컬럼 설명을 고침).
-- M17(RC-08): 열린 에스컬레이션 건에 덧붙은 질문을 행으로(handoff_questions, TBL-055). 마감된 날 질문은 날짜마다 따로 건
--     (handoffs_one_open_day_per_consultation, handoffs_day_chk)이고, 추가 수락을 쓴 주문 요청을 하나만 남김(handoffs.day_used_order_id).
-- M17(RC-13): 초안의 픽업 일시(pickup_at)를 날짜(pickup_day)와 비울 수 있는 시각(pickup_time)으로 나눔.
-- M17(RC-12): 더하는 옵션 uuid[]를 연결 테이블(order_draft_extras TBL-056, order_detail_extras TBL-057)로 옮겨 같은 가격표 버전의
--     '더하는 옵션'만 외래 키로 받음. 주문·확인 카드·손님 안내는 (상담, 손님) 쌍으로 상담을 참조(consultations_customer_key).
-- 0011_amount_confirm_standard_quote.sql 뒤에 한 트랜잭션으로 적용: psql -1 -v ON_ERROR_STOP=1 -f db/migrations/0012_request_keys_questions_extras.sql
-- 적용한 결과는 db/schema.sql과 같음(check_erd.py D2). 아직 운영 데이터가 없어(10단계 전) 옮길 행이 없음. 있으면 아래 UPDATE·INSERT가 옛 값을
-- 옮김: 초안의 픽업 일시는 가게 시간대의 날짜와 시각으로, 더하는 옵션 배열은 연결 테이블의 행으로(같은 버전의 더하는 옵션이 아닌 값이 있으면
-- 외래 키가 막아 적용이 멈추므로 고쳐서 다시 적용), 확정된 뒤의 주문은 취소하지 않은 첫 결제·다시 낸 결제를 주문을 확정한 결제로, 취소 환불은 취소한
-- 주문(그 주문이 취소되지 않았으면 취소된 재제작 주문)으로. 요청 키는 하루만 쓰는 값이라 지우고 새 꼴로 다시 받음.

-- TBL-050 request_keys: 요청 지문·처리 상태·처음 결과(06 DEC-04, 5절 E27)
DELETE FROM request_keys;
ALTER TABLE request_keys
  DROP COLUMN response_body,
  ALTER COLUMN response_status DROP NOT NULL,
  ADD COLUMN request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN state text NOT NULL DEFAULT 'processing' CHECK (state IN ('processing', 'done')),
  ADD COLUMN processing_expires_at timestamptz,
  ADD COLUMN response_code text CHECK (char_length(response_code) BETWEEN 1 AND 60),
  ADD COLUMN response_ref jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(response_ref) = 'object'),
  ADD COLUMN done_at timestamptz;
ALTER TABLE request_keys
  ADD CONSTRAINT request_keys_response_status_check CHECK (response_status BETWEEN 200 AND 499),
  ADD CONSTRAINT request_keys_state_chk CHECK ((state = 'processing') = (processing_expires_at IS NOT NULL) AND (state = 'done') = (done_at IS NOT NULL) AND (state = 'done') = (response_status IS NOT NULL) AND (response_status IS NULL) = (response_code IS NULL));

-- 참조 키: 더하는 옵션(가격표 버전·무리), 초안·주문 내용의 가격표 버전, (상담, 손님) 쌍, 주문의 확인된 결제
ALTER TABLE price_options ADD CONSTRAINT price_options_group_key UNIQUE (price_list_id, id, option_group);
ALTER TABLE order_drafts ADD CONSTRAINT order_drafts_list_key UNIQUE (shop_id, id, price_list_id);
ALTER TABLE order_details ADD CONSTRAINT order_details_list_key UNIQUE (shop_id, id, price_list_id);
ALTER TABLE consultations ADD CONSTRAINT consultations_customer_key UNIQUE (shop_id, id, customer_id);
ALTER TABLE payments ADD CONSTRAINT payments_order_key UNIQUE (shop_id, order_id, id);

-- TBL-020 order_drafts: 픽업 날짜와 시각을 나눔(RC-13), 더하는 옵션은 연결 테이블로(RC-12)
ALTER TABLE order_drafts ADD COLUMN pickup_day date, ADD COLUMN pickup_time time;
UPDATE order_drafts d
   SET pickup_day = (d.pickup_at AT TIME ZONE s.time_zone)::date,
       pickup_time = (d.pickup_at AT TIME ZONE s.time_zone)::time
  FROM shops s
 WHERE s.id = d.shop_id AND d.pickup_at IS NOT NULL;
CREATE TABLE order_draft_extras (
  shop_id        uuid NOT NULL,                           -- 가게
  draft_id       uuid NOT NULL,                           -- 주문서 초안
  price_list_id  uuid NOT NULL,                           -- 초안의 가격표 버전. 초안과 같음(order_draft_extras_draft_fk)
  option_id      uuid NOT NULL,                           -- 더한 옵션: 같은 가격표 버전의 '더하는 옵션'만(order_draft_extras_option_fk)
  option_group   text NOT NULL DEFAULT 'extra' CHECK (option_group = 'extra'), -- 늘 '더하는 옵션'. 옵션의 무리를 외래 키로 맞추려고 둔 값
  PRIMARY KEY (draft_id, option_id),
  CONSTRAINT order_draft_extras_draft_fk FOREIGN KEY (shop_id, draft_id, price_list_id) REFERENCES order_drafts (shop_id, id, price_list_id) ON DELETE RESTRICT,
  CONSTRAINT order_draft_extras_option_fk FOREIGN KEY (price_list_id, option_id, option_group) REFERENCES price_options (price_list_id, id, option_group) ON DELETE RESTRICT
);
COMMENT ON TABLE order_draft_extras IS 'TBL-056 초안의 더하는 옵션: 주문서 초안에 더한 옵션마다 한 행. 초안과 같은 가격표 버전의 더하는 옵션만(설계 재검토 M17)';
INSERT INTO order_draft_extras (shop_id, draft_id, price_list_id, option_id)
SELECT DISTINCT d.shop_id, d.id, d.price_list_id, x.option_id
  FROM order_drafts d CROSS JOIN LATERAL unnest(d.extra_option_ids) AS x(option_id)
 WHERE d.price_list_id IS NOT NULL;
ALTER TABLE order_drafts DROP CONSTRAINT order_drafts_options_need_list_chk;
ALTER TABLE order_drafts DROP COLUMN pickup_at, DROP COLUMN extra_option_ids;
ALTER TABLE order_drafts
  ADD CONSTRAINT order_drafts_options_need_list_chk CHECK (price_list_id IS NOT NULL OR (size_option_id IS NULL AND flavor_option_id IS NULL AND design_option_id IS NULL AND design_id IS NULL)),
  ADD CONSTRAINT order_drafts_pickup_time_chk CHECK (pickup_time IS NULL OR pickup_day IS NOT NULL);

-- TBL-026 order_details: 더하는 옵션은 연결 테이블로(RC-12)
CREATE TABLE order_detail_extras (
  shop_id          uuid NOT NULL,                         -- 가게
  order_detail_id  uuid NOT NULL,                         -- 주문 내용 버전
  price_list_id    uuid NOT NULL,                         -- 그 버전의 가격표 버전. 주문 내용과 같음(order_detail_extras_detail_fk)
  option_id        uuid NOT NULL,                         -- 더한 옵션: 같은 가격표 버전의 '더하는 옵션'만(order_detail_extras_option_fk). 이전 버전의 행도 지우지 않음(REQ-027)
  option_group     text NOT NULL DEFAULT 'extra' CHECK (option_group = 'extra'), -- 늘 '더하는 옵션'. 옵션의 무리를 외래 키로 맞추려고 둔 값
  PRIMARY KEY (order_detail_id, option_id),
  CONSTRAINT order_detail_extras_detail_fk FOREIGN KEY (shop_id, order_detail_id, price_list_id) REFERENCES order_details (shop_id, id, price_list_id) ON DELETE RESTRICT,
  CONSTRAINT order_detail_extras_option_fk FOREIGN KEY (price_list_id, option_id, option_group) REFERENCES price_options (price_list_id, id, option_group) ON DELETE RESTRICT
);
COMMENT ON TABLE order_detail_extras IS 'TBL-057 주문 내용의 더하는 옵션: 주문 내용 버전마다 더한 옵션마다 한 행. 그 버전과 같은 가격표 버전의 더하는 옵션만(설계 재검토 M17)';
INSERT INTO order_detail_extras (shop_id, order_detail_id, price_list_id, option_id)
SELECT DISTINCT d.shop_id, d.id, d.price_list_id, x.option_id
  FROM order_details d CROSS JOIN LATERAL unnest(d.extra_option_ids) AS x(option_id);
ALTER TABLE order_details DROP COLUMN extra_option_ids;

-- TBL-023 orders, TBL-024 confirm_cards, TBL-045 notifications: (상담, 손님) 쌍으로 상담을 참조(RC-12)
ALTER TABLE orders DROP CONSTRAINT orders_consultation_fk;
ALTER TABLE orders ADD CONSTRAINT orders_consultation_fk FOREIGN KEY (shop_id, consultation_id, customer_id) REFERENCES consultations (shop_id, id, customer_id) ON DELETE RESTRICT;
ALTER TABLE confirm_cards DROP CONSTRAINT confirm_cards_consultation_fk;
ALTER TABLE confirm_cards ADD CONSTRAINT confirm_cards_consultation_fk FOREIGN KEY (shop_id, consultation_id, customer_id) REFERENCES consultations (shop_id, id, customer_id) ON DELETE RESTRICT;
ALTER TABLE notifications DROP CONSTRAINT notifications_consultation_fk;
ALTER TABLE notifications ADD CONSTRAINT notifications_consultation_fk FOREIGN KEY (shop_id, consultation_id, customer_id) REFERENCES consultations (shop_id, id, customer_id) ON DELETE RESTRICT;

-- TBL-027 handoffs: 마감된 날 질문은 날짜마다 따로 건, 추가 수락을 쓴 주문 요청(RC-08)
ALTER TABLE handoffs ADD COLUMN day_used_order_id uuid;
ALTER TABLE handoffs DROP CONSTRAINT handoffs_day_chk;
ALTER TABLE handoffs
  ADD CONSTRAINT handoffs_day_used_fk FOREIGN KEY (shop_id, day_used_order_id) REFERENCES orders (shop_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT handoffs_day_used_uq UNIQUE (day_used_order_id),
  ADD CONSTRAINT handoffs_day_chk CHECK ((reason = 'closed_day') = (requested_day IS NOT NULL) AND (day_decision IS NULL OR requested_day IS NOT NULL)),
  ADD CONSTRAINT handoffs_day_used_chk CHECK (day_used_order_id IS NULL OR day_decision IS NOT DISTINCT FROM 'accepted');
DROP INDEX handoffs_one_open_per_consultation;
CREATE UNIQUE INDEX handoffs_one_open_per_consultation ON handoffs (consultation_id) WHERE status = 'open' AND reason <> 'closed_day'; -- 열린 에스컬레이션 건이 있으면 새 질문은 그 건의 덧붙은 질문(SPEC-022). 마감된 날 질문 건은 빼고 셈
CREATE UNIQUE INDEX handoffs_one_open_day_per_consultation ON handoffs (consultation_id, requested_day) WHERE status = 'open' AND reason = 'closed_day'; -- 마감된 날 질문은 상담과 날짜마다 열린 건 하나(SPEC-014, 설계 재검토 M17)

-- TBL-055 handoff_questions: 덧붙은 질문(RC-08)
CREATE TABLE handoff_questions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 덧붙은 질문 ID
  shop_id     uuid NOT NULL,                              -- 가게
  handoff_id  uuid NOT NULL,                              -- 덧붙은 열린 에스컬레이션 건(마감된 날 질문 건은 아님)
  message_id  uuid NOT NULL,                              -- 덧붙은 손님 말: 그 건과 같은 상담의 메시지(앱이 지킴, 4절 A34). 같은 메시지는 한 번만
  reason      text NOT NULL CHECK (reason IN ('edibility', 'cannot_answer', 'legal_medical', 'customer_request', 'other_user', 'pre_receipt_issue', 'ai_failure', 'ai_cost_limit', 'callback_timeout', 'masking_failed', 'empty_answer', 'clause_missing')), -- 덧붙은 사유(에스컬레이션 건의 사유와 같은 값). 마감된 날 질문은 덧붙이지 않고 날짜마다 따로 건을 둠(SPEC-014)
  order_id    uuid,                                       -- 관련 주문(있으면)
  created_at  timestamptz NOT NULL DEFAULT now(),         -- 덧붙은 시각. 상담을 지울 때 함께 지움(SPEC-065)
  CONSTRAINT handoff_questions_handoff_fk FOREIGN KEY (shop_id, handoff_id) REFERENCES handoffs (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT handoff_questions_message_fk FOREIGN KEY (shop_id, message_id) REFERENCES messages (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT handoff_questions_order_fk FOREIGN KEY (shop_id, order_id) REFERENCES orders (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT handoff_questions_message_uq UNIQUE (message_id) -- 같은 손님 말은 한 번만 덧붙음(SPEC-022)
);
COMMENT ON TABLE handoff_questions IS 'TBL-055 덧붙은 질문(TERM-008): 열린 에스컬레이션 건에 덧붙은 손님 질문마다 한 행(사유·관련 주문). 마감된 날 질문은 날짜마다 따로 건을 둠(설계 재검토 M17)';
CREATE INDEX handoff_questions_handoff_idx ON handoff_questions (handoff_id, created_at); -- 건마다 덧붙은 질문(SPEC-023)

-- TBL-023 orders: 주문을 확정한 결제(RC-06)
ALTER TABLE orders ADD COLUMN confirmed_payment_id uuid;
UPDATE orders o
   SET confirmed_payment_id = (SELECT p.id FROM payments p JOIN payment_requests r ON r.id = p.payment_request_id
                                WHERE p.order_id = o.id AND p.voided_at IS NULL AND r.kind IN ('first', 'reissue')
                                ORDER BY p.confirmed_at DESC LIMIT 1),
       lock_version = o.lock_version + 1
 WHERE o.confirmed_at IS NOT NULL AND o.remake_of_order_id IS NULL;
ALTER TABLE orders
  ADD CONSTRAINT orders_confirmed_payment_chk CHECK ((status NOT IN ('confirmed', 'received', 'no_pickup') OR confirmed_payment_id IS NOT NULL OR remake_of_order_id IS NOT NULL) AND (confirmed_payment_id IS NULL OR confirmed_at IS NOT NULL)),
  ADD CONSTRAINT orders_confirmed_payment_fk FOREIGN KEY (shop_id, id, confirmed_payment_id) REFERENCES payments (shop_id, order_id, id) ON DELETE RESTRICT;

-- TBL-033 refunds: 취소한 주문·변경 요청·문제 신고·결제 안내마다 환불 하나(RC-06)
ALTER TABLE refunds ADD COLUMN cancelled_order_id uuid;
UPDATE refunds f
   SET cancelled_order_id = CASE WHEN o.status = 'cancelled' THEN o.id
                                 ELSE (SELECT m.id FROM orders m WHERE m.remake_of_order_id = o.id AND m.status = 'cancelled'
                                        ORDER BY m.cancelled_at LIMIT 1) END
  FROM orders o
 WHERE o.id = f.order_id AND f.cause IN ('customer_cancel', 'shop_cancel');
ALTER TABLE refunds
  ADD CONSTRAINT refunds_cancelled_fk FOREIGN KEY (shop_id, cancelled_order_id) REFERENCES orders (shop_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT refunds_cancelled_uq UNIQUE (cancelled_order_id),
  ADD CONSTRAINT refunds_change_uq UNIQUE (change_request_id),
  ADD CONSTRAINT refunds_issue_uq UNIQUE (issue_report_id),
  ADD CONSTRAINT refunds_request_uq UNIQUE (payment_request_id),
  ADD CONSTRAINT refunds_cancelled_chk CHECK ((cause IN ('customer_cancel', 'shop_cancel')) = (cancelled_order_id IS NOT NULL));

-- 트리거 함수와 트리거. 아래 주석은 db/schema.sql과 같음
-- 취소 환불(손님 취소·가게 사정 취소)은 취소한 주문마다 하나(refunds_cancelled_uq)이고, 그 취소한 주문은 환불을 남기는 주문이나 그 재제작
-- 주문뿐(재제작 주문의 취소 환불은 원래 주문에 남김, 트리거 refunds_remake, 4절 A31·A33, 설계 재검토 M7). 취소한 주문이 없거나 다른 가게의
-- 것이면 외래 키(refunds_cancelled_fk)가 막으므로 넘김
CREATE FUNCTION refunds_cancelled_check() RETURNS trigger
LANGUAGE plpgsql AS $cancelled$
BEGIN
  IF NEW.cancelled_order_id IS NOT NULL AND NEW.cancelled_order_id <> NEW.order_id AND EXISTS (
       SELECT 1 FROM orders o WHERE o.id = NEW.cancelled_order_id AND o.shop_id = NEW.shop_id
          AND o.remake_of_order_id IS DISTINCT FROM NEW.order_id) THEN
    RAISE EXCEPTION 'refunds_cancelled: 취소 환불의 취소한 주문(%)은 환불을 남기는 주문(%)이나 그 재제작 주문이어야 함', NEW.cancelled_order_id, NEW.order_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$cancelled$;
CREATE TRIGGER refunds_cancelled BEFORE INSERT OR UPDATE OF order_id, cancelled_order_id ON refunds FOR EACH ROW EXECUTE FUNCTION refunds_cancelled_check();

-- 주문 확정 뒤 상태(확정·받음·미수령)인 주문을 확정한 결제는 결제 확인을 취소한 것이 아님(REQ-060, SPEC-070, 설계 재검토 M7). 결제 확인을
-- 취소하는 트랜잭션이 주문을 결제 기다림으로 돌리고 주문을 확정한 결제를 비우므로 트랜잭션 끝에 지금 행을 다시 읽어 봄(지연 제약 트리거)
CREATE FUNCTION confirmed_payment_live_check() RETURNS trigger
LANGUAGE plpgsql AS $confirmed_live$
BEGIN
  IF EXISTS (SELECT 1 FROM orders o JOIN payments p ON p.id = o.confirmed_payment_id
              WHERE CASE TG_TABLE_NAME WHEN 'orders' THEN o.id = NEW.id ELSE p.id = NEW.id END
                AND o.status IN ('confirmed', 'received', 'no_pickup') AND p.voided_at IS NOT NULL) THEN
    RAISE EXCEPTION '%: 주문 확정 뒤 상태인 주문을 확정한 결제는 결제 확인을 취소하지 않은 것이어야 함(결제 확인을 취소하면 주문을 결제 기다림으로 돌림)', TG_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$confirmed_live$;
CREATE CONSTRAINT TRIGGER orders_confirmed_payment_live AFTER INSERT OR UPDATE OF status, confirmed_payment_id ON orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION confirmed_payment_live_check();
CREATE CONSTRAINT TRIGGER payments_confirmed_void AFTER UPDATE OF voided_at ON payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION confirmed_payment_live_check();

-- 테이블 설명(db/schema.sql과 같은 줄)
COMMENT ON TABLE request_keys IS 'TBL-050 요청 키: 사장님·운영자 화면 명령의 요청 지문·처리 상태·처음 결과(같은 키는 한 번만, G2, 06 DEC-04)';

-- 컬럼 설명(db/schema.sql과 같은 줄)
COMMENT ON COLUMN order_drafts.pickup_day IS '원하는 픽업 날짜(가게 시간대). 날짜만 알아도 남김(SPEC-014, SPEC-020, 설계 재검토 M17)';
COMMENT ON COLUMN order_drafts.pickup_time IS '원하는 픽업 시각(가게 시간대). 비어 있으면 아직 모름. 주문 요청 때 날짜와 합쳐 가게 시간대로 픽업 일시(orders.pickup_at)를 만듦(SPEC-029)';
COMMENT ON COLUMN orders.confirmed_payment_id IS '주문을 확정한 확인된 결제(첫 결제나 다시 낸 결제, SPEC-034, SPEC-036). 주문 확정 뒤 상태면 꼭 있음(재제작 주문은 빼고). 그 결제 확인을 취소하면 비우고 결제 기다림으로 돌림(SPEC-070, 트리거 payments_confirmed_void, 설계 재검토 M7)';
COMMENT ON COLUMN handoffs.source_message_id IS '에스컬레이션한 손님 말. 같은 메시지는 한 번만 에스컬레이션함(SPEC-022). 열린 동안 온 새 질문은 덧붙은 질문(handoff_questions)으로 남음';
COMMENT ON COLUMN handoffs.requested_day IS '마감된 날에 추가로 받을지 묻는 질문의 날짜(SPEC-014). 마감된 날 질문에만 있고, 다른 열린 건이 있어도 날짜마다 따로 건(handoffs_one_open_day_per_consultation, 설계 재검토 M17)';
COMMENT ON COLUMN handoffs.day_used_order_id IS '추가 수락을 쓴 주문 요청: 그 날짜에 마감 후 추가 수락(slot_holds.overbooked)으로 자리를 잡은 주문. 추가 수락 하나는 주문 요청 하나에만(SPEC-023, SPEC-029, 4절 A34)';
COMMENT ON COLUMN refunds.cancelled_order_id IS '취소 환불(손님 취소·가게 사정 취소)이면 취소한 주문: 그 주문이나 그 재제작 주문(트리거 refunds_cancelled). 취소한 주문마다 환불 하나(refunds_cancelled_uq, 4절 A33, 설계 재검토 M7)';
COMMENT ON COLUMN refunds.event_key IS '같은 환불을 두 번 정하지 않음(G2). 형식 refund:{대상 ID}:{사유}. 대상은 취소한 주문·변경 요청·문제 신고·결제 안내이고 대상마다 하나는 UNIQUE로도 막음(4절 A33)';
COMMENT ON COLUMN payment_requests.event_key IS '같은 이벤트의 결제 안내는 한 번(REQ-154). 형식 pay:{대상 ID}:{결제 종류}. 대상은 첫 결제면 주문, 다시 낸 결제면 기한이 지난 결제 안내, 차액 결제면 변경 요청(4절 A33)';
COMMENT ON COLUMN slot_holds.hold_key IS '같은 주문의 같은 가예약은 한 번(SPEC-015). 형식 hold:{주문 ID}:{결제 안내 ID}, 날짜 변경은 hold:{주문 ID}:{변경 요청 ID}, 재제작은 hold:{주문 ID}:remake(4절 A33)';
COMMENT ON COLUMN owner_tasks.event_key IS '할 일을 만든 이벤트 키. 할 일마다 한 번(G2). 형식 task:{만든 이벤트}:{대상 ID}(4절 A33)';
COMMENT ON COLUMN owner_alerts.event_key IS '알림마다 한 번(SPEC-067). 형식 alert:{알린 일}:{할 일 ID나 대상 ID}, 하루 한 번까지인 다시 알림은 뒤에 :{가게 날짜}(4절 A33)';
COMMENT ON COLUMN notifications.event_key IS '같은 주문의 같은 이벤트는 한 번(REQ-154). 형식 notice:{대상 ID}:{안내 종류}(4절 A33)';
COMMENT ON COLUMN ledger_writes.event_key IS '이벤트마다 한 번(REQ-132). 형식 ledger:{대상 ID}:{이벤트 종류}(4절 A33)';
COMMENT ON COLUMN request_keys.request_hash IS '요청 지문: 명령·경로의 ID·본문을 정한 차례로 이어 시크릿 저장소의 키로 만든 HMAC-SHA256(16진수 64자). 같은 키에 지문이 다르면 422 idempotency_key_reused(06 DEC-04). 본문의 값은 지문으로만 남음';
COMMENT ON COLUMN request_keys.state IS '처리 중·끝남. 처리 중에 같은 키가 오면 409 request_in_progress(06 DEC-04)';
COMMENT ON COLUMN request_keys.processing_expires_at IS '처리 중의 기한(받은 시각 + 60초). 끝나지 않고 지나면(서버가 멈춤) 같은 키·같은 지문의 다음 요청이 이 행을 이어받아 처음부터 처리함(5절 E27)';
COMMENT ON COLUMN request_keys.response_status IS '끝남: 처음 결과의 HTTP 상태 코드. 같은 키가 다시 오면 같은 코드로 돌려줌. 입력 검사 실패(422)·서버 오류(5xx)는 남기지 않고 처리 중 행을 지워 다시 보낼 수 있게 함(06 DEC-04)';
COMMENT ON COLUMN request_keys.response_code IS '끝남: 처음 결과의 종류(G7의 결과나 오류 코드)';
COMMENT ON COLUMN request_keys.response_ref IS '처음 결과가 가리킨 기록의 ID(예: 결제 안내·주문). 같은 키가 다시 오면 그 기록의 지금 상태를 다시 읽어 본문을 만듦(06 DEC-04). ID만 두고 개인정보·시크릿은 두지 않음';
COMMENT ON COLUMN request_keys.created_at IS '처음 받은 시각. 24시간이 지나면 지우기(SPEC-065)가 지움(06 DEC-04)';
COMMENT ON COLUMN request_keys.done_at IS '끝난 시각';
COMMENT ON COLUMN handoff_questions.id IS '덧붙은 질문 ID';
COMMENT ON COLUMN handoff_questions.shop_id IS '가게';
COMMENT ON COLUMN handoff_questions.handoff_id IS '덧붙은 열린 에스컬레이션 건(마감된 날 질문 건은 아님)';
COMMENT ON COLUMN handoff_questions.message_id IS '덧붙은 손님 말: 그 건과 같은 상담의 메시지(앱이 지킴, 4절 A34). 같은 메시지는 한 번만';
COMMENT ON COLUMN handoff_questions.reason IS '덧붙은 사유(에스컬레이션 건의 사유와 같은 값). 마감된 날 질문은 덧붙이지 않고 날짜마다 따로 건을 둠(SPEC-014)';
COMMENT ON COLUMN handoff_questions.order_id IS '관련 주문(있으면)';
COMMENT ON COLUMN handoff_questions.created_at IS '덧붙은 시각. 상담을 지울 때 함께 지움(SPEC-065)';
COMMENT ON COLUMN order_draft_extras.shop_id IS '가게';
COMMENT ON COLUMN order_draft_extras.draft_id IS '주문서 초안';
COMMENT ON COLUMN order_draft_extras.price_list_id IS '초안의 가격표 버전. 초안과 같음(order_draft_extras_draft_fk)';
COMMENT ON COLUMN order_draft_extras.option_id IS '더한 옵션: 같은 가격표 버전의 ''더하는 옵션''만(order_draft_extras_option_fk)';
COMMENT ON COLUMN order_draft_extras.option_group IS '늘 ''더하는 옵션''. 옵션의 무리를 외래 키로 맞추려고 둔 값';
COMMENT ON COLUMN order_detail_extras.shop_id IS '가게';
COMMENT ON COLUMN order_detail_extras.order_detail_id IS '주문 내용 버전';
COMMENT ON COLUMN order_detail_extras.price_list_id IS '그 버전의 가격표 버전. 주문 내용과 같음(order_detail_extras_detail_fk)';
COMMENT ON COLUMN order_detail_extras.option_id IS '더한 옵션: 같은 가격표 버전의 ''더하는 옵션''만(order_detail_extras_option_fk). 이전 버전의 행도 지우지 않음(REQ-027)';
COMMENT ON COLUMN order_detail_extras.option_group IS '늘 ''더하는 옵션''. 옵션의 무리를 외래 키로 맞추려고 둔 값';
