-- 0002_refund_path: 환불 길(설계 재검토 H1·H2, 2026-11-13 20:59 결정 카드 '추천안대로 (추천)')
-- 받은 금액을 확인된 결제와 결제로 확인하지 않은 들어온 금액의 합으로 셈(REQ-165, REQ-166), 잘못 누른 결제 확인 취소(REQ-169),
-- 보상이 아닌 환불의 하한(REQ-170), 환불 보내기 할 일(REQ-173)·들어온 입금 대조 할 일(REQ-167), 환불 보냄 안내·장부(REQ-172).
-- 0001_init.sql 뒤에 한 트랜잭션으로 적용: psql -1 -v ON_ERROR_STOP=1 -f db/migrations/0002_refund_path.sql
-- 적용한 결과는 db/schema.sql과 같음(check_erd.py D2). 아직 운영 데이터가 없어(10단계 전) 옛 행을 바꾸는 문장은 확인된·맞추는 중 결제 안내의 들어온 금액 채우기뿐.

-- TBL-031 payment_requests: 들어온 금액(받은 금액의 몫)
ALTER TABLE payment_requests
  ADD COLUMN arrived_amount integer CHECK (arrived_amount BETWEEN 1 AND 100000000),
  ADD COLUMN arrived_at timestamptz;
UPDATE payment_requests SET arrived_amount = amount, arrived_at = paid_at WHERE status = 'paid';
UPDATE payment_requests SET arrived_amount = mismatch_amount, arrived_at = mismatch_at WHERE status = 'mismatch';
ALTER TABLE payment_requests
  ADD CONSTRAINT payment_requests_arrived_chk CHECK ((arrived_amount IS NULL) = (arrived_at IS NULL)),
  ADD CONSTRAINT payment_requests_arrived_amount_chk CHECK (arrived_amount IS NULL OR arrived_amount <= amount * 10),
  ADD CONSTRAINT payment_requests_arrived_status_chk CHECK (status NOT IN ('open', 'claimed') OR arrived_amount IS NULL),
  ADD CONSTRAINT payment_requests_arrived_paid_chk CHECK (status <> 'paid' OR (arrived_amount IS NOT NULL AND arrived_amount >= amount)),
  ADD CONSTRAINT payment_requests_arrived_mismatch_chk CHECK (status <> 'mismatch' OR arrived_amount IS NOT DISTINCT FROM mismatch_amount);

-- TBL-032 payments: 잘못 누른 결제 확인 취소. 결제 안내 하나에 확인된 결제 하나는 취소한 것을 빼고 셈
ALTER TABLE payments
  ADD COLUMN voided_at timestamptz,
  ADD COLUMN void_reason text CHECK (char_length(void_reason) BETWEEN 1 AND 200),
  DROP CONSTRAINT payments_one_per_request,
  ADD CONSTRAINT payments_void_chk CHECK ((voided_at IS NULL) = (void_reason IS NULL));
CREATE UNIQUE INDEX payments_one_live_per_request ON payments (payment_request_id) WHERE voided_at IS NULL;

-- TBL-033 refunds: 더 들어온 금액, 돌려줄 결제 안내, 계산값 하한, 할 일이 참조할 키
ALTER TABLE refunds DROP CONSTRAINT refunds_cause_check;
ALTER TABLE refunds
  ADD CONSTRAINT refunds_cause_check CHECK (cause IN ('customer_cancel', 'shop_cancel', 'change_reduced', 'compensation', 'paid_after_cancel', 'over_received')),
  ADD COLUMN payment_request_id uuid,
  ADD CONSTRAINT refunds_shop_scope UNIQUE (shop_id, id),
  ADD CONSTRAINT refunds_request_fk FOREIGN KEY (shop_id, payment_request_id) REFERENCES payment_requests (shop_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT refunds_floor_chk CHECK (cause = 'compensation' OR amount >= calculated_amount),
  ADD CONSTRAINT refunds_request_chk CHECK ((cause IN ('paid_after_cancel', 'over_received')) = (payment_request_id IS NOT NULL));

-- TBL-042 owner_tasks: 환불 보내기·들어온 입금 대조 할 일
ALTER TABLE owner_tasks DROP CONSTRAINT owner_tasks_kind_check, DROP CONSTRAINT owner_tasks_subject_chk;
ALTER TABLE owner_tasks
  ADD CONSTRAINT owner_tasks_kind_check CHECK (kind IN ('handoff', 'custom_order', 'change_request', 'issue_report', 'payment_claim', 'payment_mismatch', 'payment_overdue', 'refund_decision', 'paid_after_cancel', 'stale_change', 'ledger_relink', 'license_on_hold', 'calendar_conflict', 'refund_send', 'arrival_check')),
  ADD COLUMN refund_id uuid,
  ADD CONSTRAINT owner_tasks_refund_fk FOREIGN KEY (shop_id, refund_id) REFERENCES refunds (shop_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT owner_tasks_subject_chk CHECK (
    (kind <> 'handoff' OR handoff_id IS NOT NULL)
    AND (kind NOT IN ('change_request', 'stale_change') OR change_request_id IS NOT NULL)
    AND (kind <> 'issue_report' OR issue_report_id IS NOT NULL)
    AND (kind NOT IN ('payment_claim', 'payment_mismatch', 'arrival_check') OR payment_request_id IS NOT NULL)
    AND (kind <> 'refund_send' OR refund_id IS NOT NULL)
    AND (kind NOT IN ('custom_order', 'payment_overdue', 'refund_decision', 'paid_after_cancel', 'refund_send', 'arrival_check') OR order_id IS NOT NULL));

-- TBL-044 notifications: 환불 보냄·결제 확인 정정 안내
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('owner_reply', 'delay_notice', 'channel_add', 'custom_rejected', 'payment_request', 'payment_mismatch', 'order_confirmed', 'cancelled', 'change_result', 'change_not_applied', 'refund', 'compensation', 'day_before', 'completion_photo', 'review_request', 'refund_sent', 'payment_corrected'));

-- TBL-047 ledger_writes: 환불 보냄·결제 확인 취소
ALTER TABLE ledger_writes DROP CONSTRAINT ledger_writes_event_kind_check;
ALTER TABLE ledger_writes ADD CONSTRAINT ledger_writes_event_kind_check CHECK (event_kind IN ('confirmed', 'changed', 'cancelled', 'refund', 'handed_over', 'no_pickup', 'remake', 'refund_sent', 'payment_voided'));

-- 설명(db/schema.sql 끝의 컬럼 설명과 같음)
COMMENT ON TABLE payments IS 'TBL-032 확인된 결제(TERM-049): 결제 안내마다 하나(결제 확인을 취소한 것은 빼고), 사장님이 입금 대조로 확인';
COMMENT ON COLUMN payment_requests.arrived_amount IS '들어온 금액(받은 금액의 몫, REQ-165). 입금됨은 안내 금액, 맞추는 중은 다르게 들어온 금액(모자란 금액이 마저 들어오면 안내 금액, 더 들어온 채 대조 완료면 그대로), 결제로 확인하지 않은 들어온 입금은 사장님이 남긴 금액(SPEC-071)';
COMMENT ON COLUMN payment_requests.arrived_at IS '들어온 금액을 남긴 시각. 결제 확인 취소(SPEC-070)면 지움';
COMMENT ON COLUMN payments.amount IS '확인된 금액 = 안내 금액. 받은 금액은 결제 안내의 들어온 금액으로 셈(REQ-165). 선결제(TERM-014)는 가게 계좌로 감';
COMMENT ON COLUMN payments.resolution IS '입금됨·대조 완료(모자란 금액이 입금됨)·대조 완료(더 들어온 금액은 환불로 돌려줌, SPEC-047)(R15)';
COMMENT ON COLUMN payments.voided_at IS '사장님이 잘못 누른 결제 확인을 취소한 시각(SPEC-070). 취소한 결제는 받은 금액에 들지 않음';
COMMENT ON COLUMN payments.void_reason IS '결제 확인을 취소한 사유(REQ-169). 손님 안내에는 적지 않음';
COMMENT ON COLUMN refunds.cause IS '손님 취소·가게 사정 취소·금액이 내려간 변경·보상·취소 뒤 들어온 입금·더 들어온 금액(안내 금액을 넘은 몫, 기한 뒤 차액, SPEC-071)';
COMMENT ON COLUMN refunds.payment_request_id IS '돌려줄 들어온 입금의 결제 안내(취소 뒤 들어온 입금·더 들어온 금액, SPEC-071)';
COMMENT ON COLUMN refunds.amount IS '정한 환불 금액. 주문의 환불 합은 받은 금액(결제 안내의 들어온 금액 합)을 넘지 않음(REQ-165, 앱이 주문 행을 잠그고 셈). 보상이 아니면 계산값 이상(REQ-170)';
COMMENT ON COLUMN refunds.calc_basis IS '근거: 운영규정 버전·조문·취소 시각·맞춤 재료 주문 시각·제작 시작 시각·받은 금액의 몫(확인된 결제와 결제로 확인하지 않은 들어온 금액, REQ-084, REQ-165)';
COMMENT ON COLUMN refunds.override_reason IS '계산값과 다른 금액을 고른 이유(SPEC-047). 보상이 아니면 계산값보다 높을 때만';
COMMENT ON COLUMN refunds.sent_at IS '사장님이 ''보냄''을 표시한 시각(REQ-172). 우리는 돈을 옮기지 않음(REQ-079). 그 전까지 환불 보내기 할 일이 남음(REQ-173)';
COMMENT ON COLUMN owner_tasks.kind IS '에스컬레이션 건·맞춤 주문·변경 요청·문제 신고·결제 확인 요청·맞추는 중·결제 기한 지남·환불 결정·취소 뒤 들어온 입금·이전 버전 변경·장부 다시 연결·영업 신고 보류·영업 캘린더 기준을 넘는 날·환불 보내기(REQ-173)·들어온 입금 대조(REQ-167)';
COMMENT ON COLUMN owner_tasks.refund_id IS '보낼 환불(환불 보내기, REQ-173)';
COMMENT ON COLUMN owner_tasks.realerted_at IS '사장님께 다시 알린 시각(한 번): 지연 뒤(REQ-117), 환불 보내기는 환불을 정하고 24시간 뒤(REQ-173)';
COMMENT ON COLUMN notifications.kind IS '사장님 답·지연 안내(TERM-036)·채널 추가 권함·맞춤 거절·결제 안내·금액 불일치·확정 안내·취소·변경 결과(반영·거절)·변경 안 됨·환불·보상·전날 안내·완성 사진·후기 부탁·환불 보냄(REQ-172)·결제 확인 정정(REQ-169)';
COMMENT ON COLUMN ledger_writes.event_kind IS '확정·변경·취소·환불·인도·미수령·재제작·환불 보냄(REQ-172)·결제 확인 취소(REQ-169)';
