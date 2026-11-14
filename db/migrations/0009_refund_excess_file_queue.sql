-- 0009_refund_excess_file_queue: 더 들어온 금액의 환불 계산값, 환불 금액 상한, 지울 사진 파일, 운영자가 여는 상담의 대화 글(Codex 후속,
-- 2026-11-14. 합친 PR에 남은 Codex 자동 검토 의견 넷을 2026-11-13 20:59 결정 카드 '추천안대로 (추천)'의 H1·H3·H4를 지키도록 고침)
-- PR #27 의견 둘: 취소 뒤 들어온 입금·더 들어온 금액의 환불 계산값은 그 결제 안내에서 결제로 확인하지 않은 몫(들어온 금액 - 결제 확인을
--     취소하지 않은 확인된 결제)을 넘지 않음(트리거 refunds_unconfirmed, 4절 A29). 환불 금액·계산값의 상한을 들어온 금액의 상한과 같은 1억 원으로 넓힘.
-- PR #30 의견: 지우기가 지운 참고 사진·신고 사진의 저장 위치를 같은 트랜잭션에서 지울 파일(TBL-054)로 남기고, 저장소에서 파일을 지운 뒤에만
--     그 행을 지움(5절 E24, 6절).
-- PR #31 의견: 운영자가 사유를 적고 여는 대상에 상담의 대화 글(consultation_text)을 더함(REQ-227, SPEC-073).
-- 0008_wait_ends_due_cap.sql 뒤에 한 트랜잭션으로 적용: psql -1 -v ON_ERROR_STOP=1 -f db/migrations/0009_refund_excess_file_queue.sql
-- 적용한 결과는 db/schema.sql과 같음(check_erd.py D2). 아직 운영 데이터가 없어(10단계 전) 옮길 행이 없음. 있으면 트리거는 새로 쓰거나 고치는
-- 환불만 보므로 이미 정한 환불의 계산값은 앱이 다시 셈.

-- TBL-033 refunds: 환불 금액과 계산값의 상한을 1억 원으로(PR #27 의견)
ALTER TABLE refunds
  DROP CONSTRAINT refunds_amount_check,
  DROP CONSTRAINT refunds_calculated_amount_check;
ALTER TABLE refunds
  ADD CONSTRAINT refunds_amount_check CHECK (amount BETWEEN 0 AND 100000000),
  ADD CONSTRAINT refunds_calculated_amount_check CHECK (calculated_amount BETWEEN 0 AND 100000000);

-- TBL-053 access_logs: 운영자가 여는 대상에 상담의 대화 글(REQ-227)
ALTER TABLE access_logs
  DROP CONSTRAINT access_logs_target_kind_check;
ALTER TABLE access_logs
  ADD CONSTRAINT access_logs_target_kind_check CHECK (target_kind IN ('masked_value', 'order_contact', 'refund_account', 'kept_record', 'consultation_text'));

-- TBL-033 refunds: 계산값이 결제로 확인하지 않은 몫을 넘지 않음(PR #27 의견, 트리거). 아래 주석은 db/schema.sql과 같음
-- 취소 뒤 들어온 입금·더 들어온 금액의 환불 계산값은 그 결제 안내에서 결제로 확인하지 않은 몫(들어온 금액 - 결제 확인을 취소하지 않은
-- 확인된 결제)을 넘지 않음(SPEC-016, SPEC-071, 4절 A29, Codex 후속). 환불 행을 쓸 때 봄. 결제 안내가 없거나 다른 가게의 것이면
-- CHECK(refunds_request_chk)와 외래 키(refunds_request_fk)가 막으므로 넘김
CREATE FUNCTION refunds_unconfirmed_check() RETURNS trigger
LANGUAGE plpgsql AS $unconfirmed$
DECLARE
  arrived integer;
  confirmed bigint;
BEGIN
  IF NEW.cause NOT IN ('paid_after_cancel', 'over_received') OR NEW.payment_request_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT r.arrived_amount INTO arrived FROM payment_requests r WHERE r.id = NEW.payment_request_id AND r.shop_id = NEW.shop_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  SELECT coalesce(sum(p.amount), 0) INTO confirmed FROM payments p WHERE p.payment_request_id = NEW.payment_request_id AND p.voided_at IS NULL;
  IF NEW.calculated_amount > coalesce(arrived, 0) - confirmed THEN
    RAISE EXCEPTION 'refunds_unconfirmed: 환불 계산값(%원)이 그 결제 안내에서 결제로 확인하지 않은 몫(%원)을 넘음', NEW.calculated_amount, coalesce(arrived, 0) - confirmed
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$unconfirmed$;
CREATE TRIGGER refunds_unconfirmed BEFORE INSERT OR UPDATE OF cause, payment_request_id, calculated_amount ON refunds FOR EACH ROW EXECUTE FUNCTION refunds_unconfirmed_check();

-- TBL-054 file_deletions: 지울 파일(새 테이블). 지우기가 사진 행을 지우는 트랜잭션에서 그 저장 위치를 넣음(PR #30 의견)
CREATE TABLE file_deletions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 지울 파일 ID
  shop_id        uuid NOT NULL REFERENCES shops (id) ON DELETE RESTRICT, -- 어느 가게의 사진 파일인지
  storage_key    text NOT NULL,                            -- 저장소에서 지울 사진 파일의 저장 위치(지운 참고 사진·신고 사진 행의 storage_key). 사진의 내용·손님 정보는 두지 않음
  source         text NOT NULL CHECK (source IN ('reference_photo', 'issue_photo')), -- 지운 행: 참고 사진·신고 사진(SPEC-065)
  queued_at      timestamptz NOT NULL DEFAULT now(),       -- 사진 행을 지운 트랜잭션의 시각. 그 트랜잭션에서 이 행을 넣음(5절 E24)
  attempts       integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10000), -- 저장소에서 지우려다 실패한 횟수. 지우면 이 행을 지움
  last_tried_at  timestamptz,                              -- 마지막으로 지우려다 실패한 시각. 다음 날 지우기가 다시 지움
  CONSTRAINT file_deletions_key_uq UNIQUE (storage_key), -- 같은 파일은 한 행
  CONSTRAINT file_deletions_tried_chk CHECK ((attempts = 0) = (last_tried_at IS NULL)) -- 실패한 적이 있으면 그 시각
);
COMMENT ON TABLE file_deletions IS 'TBL-054 지울 파일: 지우기(SPEC-065)가 지운 참고 사진·신고 사진의 저장 위치. 저장소에서 파일을 지운 뒤에만 행을 지우고, 실패하면 남아 다음 날 다시 지움';

COMMENT ON COLUMN refunds.amount IS '정한 환불 금액. 주문의 환불 합은 받은 금액(결제 안내의 들어온 금액 합)을 넘지 않음(REQ-165, 앱이 주문 행을 잠그고 셈). 보상이 아니면 계산값 이상(REQ-170). 상한은 들어온 금액의 상한과 같은 1억 원';
COMMENT ON COLUMN refunds.calculated_amount IS '가게 규칙의 계산값(SPEC-016). 취소 수수료(TERM-016)를 뺀 값. 취소 뒤 들어온 입금·더 들어온 금액은 그 결제 안내에서 결제로 확인하지 않은 몫(들어온 금액 - 취소하지 않은 확인된 결제)을 넘지 않음(트리거 refunds_unconfirmed, 4절 A29)';
COMMENT ON COLUMN access_logs.target_kind IS '연 대상: 대화 속 원래 값·주문자 이름과 연락처·환불 계좌·보관 기록·상담의 대화 글(SPEC-073, REQ-227)';
COMMENT ON COLUMN access_logs.target_id IS '연 대상의 ID(상담의 대화 글은 상담 ID). 대상 행이 지워져도 이 기록은 2년 남으므로 외래 키를 두지 않음';
COMMENT ON COLUMN file_deletions.id IS '지울 파일 ID';
COMMENT ON COLUMN file_deletions.shop_id IS '어느 가게의 사진 파일인지';
COMMENT ON COLUMN file_deletions.storage_key IS '저장소에서 지울 사진 파일의 저장 위치(지운 참고 사진·신고 사진 행의 storage_key). 사진의 내용·손님 정보는 두지 않음';
COMMENT ON COLUMN file_deletions.source IS '지운 행: 참고 사진·신고 사진(SPEC-065)';
COMMENT ON COLUMN file_deletions.queued_at IS '사진 행을 지운 트랜잭션의 시각. 그 트랜잭션에서 이 행을 넣음(5절 E24)';
COMMENT ON COLUMN file_deletions.attempts IS '저장소에서 지우려다 실패한 횟수. 지우면 이 행을 지움';
COMMENT ON COLUMN file_deletions.last_tried_at IS '마지막으로 지우려다 실패한 시각. 다음 날 지우기가 다시 지움';
