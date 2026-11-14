-- 0016_refund_counted_arrived: 들어온 입금의 환불을 정한 뒤 같은 결제 안내에 또 들어온 돈의 환불(설계 재검토 남은 빈 곳, 2026-11-15,
-- 2026-11-13 20:59 결정 카드 '모두 지금 고침 (추천)'. 설계 재검토 H1·M5가 남긴 빈 곳, docs/05-erd/README.md 4절 A29·A33)
-- refunds에 이 환불이 셈한 그 결제 안내의 들어온 금액(counted_arrived_amount)을 더하고, 결제 안내마다 하나이던 refunds_request_uq를
-- (결제 안내, 셈한 들어온 금액)으로 좁힘. 결제 확인 요청 중이거나 맞추는 중에 취소한 주문의 취소 환불도 그 결제 안내를 가질 수 있게 refunds_request_chk를
-- 넓히고 refunds_counted_chk를 더함. 트리거 refunds_unconfirmed가 셈한 금액을 채우고 같은 결제 안내의 환불을 차례로 셈해 앞 환불이 셈한
-- 몫을 다시 돌려주지 않음(SPEC-016, SPEC-071).
-- 0015_issue_kind_reporter.sql 뒤에 한 트랜잭션으로 적용: psql -1 -v ON_ERROR_STOP=1 -f db/migrations/0016_refund_counted_arrived.sql
-- 적용한 결과는 db/schema.sql과 같음(check_erd.py D2). 아직 운영 데이터가 없어(10단계 전) 옮길 행이 없음. 결제 안내를 가진 환불 행이 있으면
-- 아래 UPDATE가 그 결제 안내의 지금 들어온 금액으로 채움(지금까지는 결제 안내마다 환불 하나라 새 UNIQUE에 겹치지 않음).

-- TBL-033 refunds: 셈한 들어온 금액, 결제 안내의 들어온 금액(합)마다 환불 하나
ALTER TABLE refunds
  ADD COLUMN counted_arrived_amount integer CHECK (counted_arrived_amount BETWEEN 1 AND 100000000),
  DROP CONSTRAINT refunds_request_uq,
  DROP CONSTRAINT refunds_request_chk;
UPDATE refunds f SET counted_arrived_amount = r.arrived_amount
  FROM payment_requests r WHERE r.id = f.payment_request_id AND f.counted_arrived_amount IS NULL;
ALTER TABLE refunds
  ADD CONSTRAINT refunds_request_uq UNIQUE (payment_request_id, counted_arrived_amount),
  ADD CONSTRAINT refunds_request_chk CHECK ((cause NOT IN ('paid_after_cancel', 'over_received') OR payment_request_id IS NOT NULL) AND (cause IN ('paid_after_cancel', 'over_received', 'customer_cancel', 'shop_cancel') OR payment_request_id IS NULL)),
  ADD CONSTRAINT refunds_counted_chk CHECK (counted_arrived_amount IS NULL OR payment_request_id IS NOT NULL);

-- 트리거 refunds_unconfirmed: 셈한 금액을 채우고 같은 결제 안내의 환불을 차례로 셈함
CREATE OR REPLACE FUNCTION refunds_unconfirmed_check() RETURNS trigger
LANGUAGE plpgsql AS $unconfirmed$
DECLARE
  arrived integer;
  confirmed bigint;
  latest integer;
  prior integer;
BEGIN
  IF NEW.payment_request_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT r.arrived_amount INTO arrived FROM payment_requests r WHERE r.id = NEW.payment_request_id AND r.shop_id = NEW.shop_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF arrived IS NULL THEN
    RAISE EXCEPTION 'refunds_unconfirmed: 그 결제 안내에 들어온 금액이 없음' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.counted_arrived_amount IS NULL THEN
    NEW.counted_arrived_amount := arrived;
  END IF;
  IF NEW.counted_arrived_amount > arrived THEN
    RAISE EXCEPTION 'refunds_unconfirmed: 셈한 들어온 금액(%원)이 그 결제 안내의 들어온 금액(%원)을 넘음', NEW.counted_arrived_amount, arrived
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' OR NEW.payment_request_id IS DISTINCT FROM OLD.payment_request_id
     OR NEW.counted_arrived_amount IS DISTINCT FROM OLD.counted_arrived_amount THEN
    SELECT max(f.counted_arrived_amount) INTO latest FROM refunds f WHERE f.payment_request_id = NEW.payment_request_id AND f.id <> NEW.id;
    IF NEW.counted_arrived_amount < latest THEN
      RAISE EXCEPTION 'refunds_unconfirmed: 앞 환불이 그 결제 안내의 들어온 금액을 %원까지 셈함(새 환불은 그보다 적게 셈하지 못함)', latest
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.cause NOT IN ('paid_after_cancel', 'over_received') THEN
    RETURN NEW;
  END IF;
  SELECT max(f.counted_arrived_amount) INTO prior FROM refunds f
   WHERE f.payment_request_id = NEW.payment_request_id AND f.id <> NEW.id AND f.counted_arrived_amount < NEW.counted_arrived_amount;
  SELECT coalesce(sum(p.amount), 0) INTO confirmed FROM payments p WHERE p.payment_request_id = NEW.payment_request_id AND p.voided_at IS NULL;
  IF NEW.calculated_amount > NEW.counted_arrived_amount - greatest(confirmed, coalesce(prior, 0)) THEN
    RAISE EXCEPTION 'refunds_unconfirmed: 환불 계산값(%원)이 그 결제 안내에서 결제로 확인하지 않았고 앞 환불이 셈하지 않은 몫(%원)을 넘음',
      NEW.calculated_amount, NEW.counted_arrived_amount - greatest(confirmed, coalesce(prior, 0)) USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$unconfirmed$;
DROP TRIGGER refunds_unconfirmed ON refunds;
CREATE TRIGGER refunds_unconfirmed BEFORE INSERT OR UPDATE OF cause, payment_request_id, calculated_amount, counted_arrived_amount ON refunds FOR EACH ROW EXECUTE FUNCTION refunds_unconfirmed_check();

-- 컬럼 설명(db/schema.sql 끝과 같음)
COMMENT ON COLUMN payment_requests.arrived_amount IS '들어온 금액(받은 금액의 몫, REQ-165). 입금됨은 안내 금액, 맞추는 중은 다르게 들어온 금액(모자란 금액이 마저 들어오면 안내 금액, 더 들어온 채 대조 완료면 그대로), 결제로 확인하지 않은 들어온 입금은 사장님이 남긴 금액. 같은 결제 안내에 또 들어오면 더함(확인됨에 더 들어온 입금도, SPEC-071)';
COMMENT ON COLUMN payment_requests.arrived_at IS '들어온 금액을 마지막으로 남긴 시각. 결제 확인 취소(SPEC-070)면 지움';
COMMENT ON COLUMN refunds.payment_request_id IS '돌려줄 들어온 입금의 결제 안내(취소 뒤 들어온 입금·더 들어온 금액, SPEC-071). 결제 확인 요청 중이거나 맞추는 중에 취소한 주문의 취소 환불도 그 결제 안내의 들어온 금액을 셈했으면 가짐';
COMMENT ON COLUMN refunds.counted_arrived_amount IS '이 환불이 셈한 그 결제 안내의 들어온 금액(합). 비어 있으면 트리거 refunds_unconfirmed가 지금 값으로 채움. 같은 결제 안내에 다시 들어온 입금의 환불은 앞 환불보다 크게 셈하고 계산값은 새로 들어온 몫까지(4절 A29, 설계 재검토 남은 빈 곳)';
COMMENT ON COLUMN refunds.event_key IS '같은 환불을 두 번 정하지 않음(G2). 형식 refund:{대상 ID}:{사유}, 들어온 입금의 환불은 refund:{결제 안내 ID}:{사유}:{셈한 들어온 금액}. 대상은 취소한 주문·변경 요청·문제 신고·결제 안내이고 대상마다 하나(결제 안내는 셈한 들어온 금액마다 하나)는 UNIQUE로도 막음(4절 A33)';
