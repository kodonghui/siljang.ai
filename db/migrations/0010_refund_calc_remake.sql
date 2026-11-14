-- 0010_refund_calc_remake: 환불 계산의 차례와 재제작 주문의 돈(설계 재검토 M4·M13, 2026-11-14,
-- 2026-11-13 20:59 결정 카드 '모두 지금 고침 (추천)', 검토자의 고치는 방향대로)
-- M4(RB-06, RC-18, RE-16, RC-14, RD-19): 환불 계산값의 차례(바탕 → 비율 → 수수료를 먼저 뺌 → 원 미만 버림 → 0원 이상 바탕 이하)와
--     기준 픽업 일시를 컬럼 설명에 적고(4절 A30), 금액이 내려간 변경에는 전액 환불을 두지 않음(refunds_change_decision_chk).
--     계산값과 다른 환불의 사유는 1~200자를 꼭 받음(refunds_override_chk는 그대로, 설명만 고침).
-- M13(RB-17): 재제작 주문은 돈을 낸 원래 주문을 가리키고(트리거 orders_remake_root), 재제작 주문에는 결제 안내·환불·장부 행을
--     두지 않음(트리거 payment_requests_remake, refunds_remake, ledger_rows_remake). 돈과 장부는 원래 주문에 남김(4절 A14·A31).
--     원래 주문은 그 재제작 주문이 모두 끝날 때까지 끝나지 않음(지연 제약 트리거 orders_remake_finish, 4절 A22, 이 PR의 Codex 자동 검토 의견).
-- 0009_refund_excess_file_queue.sql 뒤에 한 트랜잭션으로 적용: psql -1 -v ON_ERROR_STOP=1 -f db/migrations/0010_refund_calc_remake.sql
-- 적용한 결과는 db/schema.sql과 같음(check_erd.py D2). 아직 운영 데이터가 없어(10단계 전) 옮길 행이 없음. 있으면 새 CHECK는 적용할 때
-- 이미 있는 행을 보고(금액이 내려간 변경의 전액 환불이 있으면 일부 환불로 고친 뒤 적용), 트리거는 새로 쓰거나 주문을 바꾸는 행만 봄.
-- 이미 끝난 원래 주문에 끝나지 않은 재제작 주문이 있으면 적용 전에 그 원래 주문의 끝난 시각을 비움(개인정보를 지우기 전이면).

-- TBL-033 refunds: 금액이 내려간 변경은 차액 돌려주기(일부 환불, 계산값 0원이면 환불 없음)만(SPEC-047)
ALTER TABLE refunds
  ADD CONSTRAINT refunds_change_decision_chk CHECK (cause <> 'change_reduced' OR decision <> 'full');

-- TBL-023 orders, TBL-031 payment_requests, TBL-033 refunds, TBL-046 ledger_rows: 재제작 주문의 돈과 장부(트리거). 아래 주석은 db/schema.sql과 같음
-- 재제작 주문(TERM-034)은 결제 없는 주문이라 돈과 장부를 원래 주문에 남김(SPEC-060, SPEC-016, R21, 4절 A31, 설계 재검토 M13).
-- 재제작 주문은 돈을 낸 원래 주문을 가리키고(재제작의 재제작도 그 원래 주문), 재제작 주문에는 결제 안내·환불·장부 행을 두지 않음.
-- 가리킨 주문이 없거나 다른 가게의 것이면 외래 키(orders_remake_fk, 각 테이블의 주문 외래 키)가 막으므로 넘김
CREATE FUNCTION orders_remake_root_check() RETURNS trigger
LANGUAGE plpgsql AS $remake_root$
BEGIN
  IF NEW.remake_of_order_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM orders o WHERE o.id = NEW.remake_of_order_id AND o.shop_id = NEW.shop_id AND o.remake_of_order_id IS NOT NULL) THEN
    RAISE EXCEPTION 'orders_remake_root: 재제작 주문(%)을 가리키는 재제작은 돈을 낸 원래 주문에 이어야 함', NEW.remake_of_order_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$remake_root$;
CREATE TRIGGER orders_remake_root BEFORE INSERT OR UPDATE OF remake_of_order_id ON orders FOR EACH ROW EXECUTE FUNCTION orders_remake_root_check();
CREATE FUNCTION remake_money_check() RETURNS trigger
LANGUAGE plpgsql AS $remake_money$
BEGIN
  IF EXISTS (SELECT 1 FROM orders o WHERE o.id = NEW.order_id AND o.shop_id = NEW.shop_id AND o.remake_of_order_id IS NOT NULL) THEN
    RAISE EXCEPTION '%: 재제작 주문(%)에는 결제 안내·환불·장부 행을 두지 않고 원래 주문에 남김', TG_NAME, NEW.order_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$remake_money$;
CREATE TRIGGER payment_requests_remake BEFORE INSERT OR UPDATE OF order_id ON payment_requests FOR EACH ROW EXECUTE FUNCTION remake_money_check();
CREATE TRIGGER refunds_remake BEFORE INSERT OR UPDATE OF order_id ON refunds FOR EACH ROW EXECUTE FUNCTION remake_money_check();
CREATE TRIGGER ledger_rows_remake BEFORE INSERT OR UPDATE OF order_id ON ledger_rows FOR EACH ROW EXECUTE FUNCTION remake_money_check();

-- TBL-023 orders: 원래 주문은 재제작 주문이 모두 끝날 때까지 끝나지 않음(지연 제약 트리거). 아래 주석은 db/schema.sql과 같음
-- 원래 주문은 그 재제작 주문(TERM-034)이 모두 끝날 때까지 끝나지 않음(SPEC-060, SPEC-065, 4절 A22·A31, 설계 재검토 M13의 Codex 자동 검토 의견).
-- 재제작 주문의 취소·다시 신고의 환불을 원래 주문에 남기므로, 원래 주문이 먼저 끝나 지워지면 그 환불을 남길 곳이 없음. 끝난 시각을
-- 원래 주문과 재제작 주문에 한 트랜잭션에서 쓰므로 트랜잭션 끝에 봄(지연 제약 트리거). 끝난 재제작 주문을 다시 열면 원래 주문도 다시 엶
CREATE FUNCTION orders_remake_finish_check() RETURNS trigger
LANGUAGE plpgsql AS $remake_finish$
BEGIN
  IF EXISTS (SELECT 1 FROM orders o JOIN orders r ON r.remake_of_order_id = o.id
              WHERE o.id IN (NEW.id, NEW.remake_of_order_id) AND o.finished_at IS NOT NULL AND r.finished_at IS NULL) THEN
    RAISE EXCEPTION 'orders_remake_finish: 끝나지 않은 재제작 주문이 있는 원래 주문(%)은 끝나지 않음', coalesce(NEW.remake_of_order_id, NEW.id)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$remake_finish$;
CREATE CONSTRAINT TRIGGER orders_remake_finish AFTER INSERT OR UPDATE OF finished_at, remake_of_order_id ON orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orders_remake_finish_check();

-- 테이블·컬럼 설명(db/schema.sql과 같은 줄)
COMMENT ON TABLE refund_tiers IS 'TBL-012 단계별 환불: 기준 픽업 일시 몇 시간 전 취소면 몇 퍼센트. 버전마다 0시간부터 끝없음(빈 값)까지 빈 구간 없이 이어지고(앱, SPEC-005) 겹치지 않음(refund_tiers_no_overlap)';
COMMENT ON COLUMN operating_rules.cancellation_fee_krw IS '고정 취소 수수료(TERM-016), 0원~1,000만 원. 저장할 때는 주문 금액과 견주지 않고, 환불 계산에서 비율보다 먼저 빼며 바탕보다 크면 환불 0원(SPEC-016, 4절 A30)';
COMMENT ON COLUMN operating_rules.pre_production_refund_pct IS '제작 전 취소의 환불 비율: 수수료를 뺀 값에 곱하고 원 미만 버림, 기본 전액(REQ-031). 단계별 환불이 없는 버전은 맞춤 재료 주문·제작 시작 뒤 취소에도 씀(SPEC-016)';
COMMENT ON COLUMN operating_rules.date_change_refund_basis IS '날짜를 바꾼 주문의 환불 기준일: 처음 픽업일(주문 내용 첫 버전의 픽업 일시)·바꾼 픽업일. 단계별 환불의 남은 시간을 이 픽업 일시까지로 셈(SPEC-016). 기본값 없음, 가게가 정함';
COMMENT ON COLUMN refund_tiers.hours_before_min IS '취소가 기준 픽업 일시 몇 시간 전부터(이 값 포함). 남은 시간은 1시간 미만을 버림(SPEC-016)';
COMMENT ON COLUMN orders.remake_of_order_id IS '재제작(TERM-034) 주문이면 돈을 낸 원래 주문(R21). 재제작 주문을 가리키지 않음(트리거 orders_remake_root). 가격표·운영규정 버전은 원래 주문 것(SPEC-060, 4절 A31)';
COMMENT ON COLUMN orders.finished_at IS '주문이 끝난 시각: 받음·미수령·거절됨·취소됨이고 보내지 않은 환불·열린 신고·변경 요청·결제 안내·할 일이 없고, 원래 주문은 끝나지 않은 재제작 주문도 없음(SPEC-025, SPEC-060, SPEC-065, 트리거 orders_remake_finish). 그 뒤 늦은 신고나 들어온 입금 대조로 다시 열리면 개인정보를 지우기 전까지는 비움(A22)';
COMMENT ON COLUMN payment_requests.order_id IS '주문. 재제작 주문에는 없음(트리거 payment_requests_remake, SPEC-060)';
COMMENT ON COLUMN refunds.order_id IS '주문. 재제작 주문의 취소·보상 환불은 원래 주문에 남김(트리거 refunds_remake, SPEC-060, 4절 A31)';
COMMENT ON COLUMN refunds.decision IS '전액 환불·일부 환불·환불 없이 취소(REQ-085). 금액이 내려간 변경은 차액 돌려주기라 전액 환불이 없음(refunds_change_decision_chk, SPEC-047)';
COMMENT ON COLUMN refunds.calculated_amount IS '가게 규칙의 계산값(SPEC-016, 4절 A30). 손님 취소는 바탕(받은 금액 - 이미 정한 환불 - 따로 정할 환불)에서 취소 수수료(TERM-016)를 먼저 빼고(바탕보다 크면 0) 비율을 곱해 원 미만 버림. 가게 사정 취소는 바탕 전액, 금액이 내려간 변경은 내려간 금액, 보상은 고른 금액. 취소 뒤 들어온 입금·더 들어온 금액은 그 결제 안내에서 결제로 확인하지 않은 몫(들어온 금액 - 취소하지 않은 확인된 결제)을 넘지 않음(트리거 refunds_unconfirmed, 4절 A29)';
COMMENT ON COLUMN refunds.override_reason IS '계산값과 다른 금액을 고른 사유 1~200자(SPEC-047, REQ-084). 다르면 꼭(refunds_override_chk), 보상이 아니면 높을 때만 다를 수 있음(refunds_floor_chk). 보상은 고른 금액이 계산값이라 비움';
COMMENT ON COLUMN ledger_rows.order_id IS '주문. 재제작 주문의 행은 두지 않고 그 이벤트를 원래 주문 행에 적음(트리거 ledger_rows_remake, R21, SPEC-064)';
COMMENT ON COLUMN ledger_writes.event_kind IS '확정·변경·취소·환불·인도·미수령·재제작(원래 주문 행에 재제작 주문의 만듦·변경·인도·미수령·취소, SPEC-060)·환불 보냄(REQ-172)·결제 확인 취소(REQ-169)';
