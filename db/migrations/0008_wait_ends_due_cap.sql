-- 0008_wait_ends_due_cap: 사장님 답 기다림의 끝, 결제 기한 시작과 상한, 그날 자리 세기, 주문 상태와 제작 행의 짝(설계 재검토 M1·M2·M3·M9·M10, 2026-11-13 20:59 결정 카드 '모두 지금 고침 (추천)'·'추천안대로 (추천)')
-- M1: 맞춤 주문 요청은 그 픽업 날짜의 주문 마감에, 변경 요청은 변경 마감에, 에스컬레이션 건은 남긴 지 7일에 '답 없어 닫힘'으로 닫음(REQ-213, REQ-214, REQ-216).
--     결제 확인 요청·맞추는 중·환불 결정도 지연 안내와 다시 알림을 한 번씩 받는 기다림(REQ-215). '할 일에 남음'은 '지연'에 합침(1-7).
-- M2: 결제 기한은 결제 안내가 손님에게 전해진 시각부터 세고 결제 기한 상한(그날 주문 마감·픽업 일시·변경 마감)을 넘지 않음(REQ-218, 5절 E23).
-- M3·M9: 날짜별 그날 자리는 잡힘·확정된 자리·종료됨을 셈(1-4). 받음·미수령 주문은 제작 행의 인도·미수령 시각과 짝이 맞아야 커밋됨(4절 A27).
-- 0007_consent_allergy_photo.sql 뒤에 한 트랜잭션으로 적용: psql -1 -v ON_ERROR_STOP=1 -f db/migrations/0008_wait_ends_due_cap.sql
-- 적용한 결과는 db/schema.sql과 같음(check_erd.py D2). 아직 운영 데이터가 없어(10단계 전) 행이 없지만, 있으면 이렇게 옮김:
-- 결제 안내의 상한은 지금 결제 기한과 같게, '할 일에 남음'은 '지연'으로, 결제 확인 요청·맞추는 중·환불 결정 할 일은 닫혔으면 '답함',
-- 열려 있으면 생긴 때부터 '기다림'(다음 기한 처리에서 지연 안내와 다시 알림이 한 번씩 감). 받음·미수령인데 제작 행의 시각이 맞지 않는 주문이 있으면 커밋에서 실패함.

-- TBL-023 orders: 맞춤 주문 요청의 답 없어 닫힘(REQ-213)
ALTER TABLE orders
  DROP CONSTRAINT orders_cancel_kind_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_cancel_kind_check CHECK (cancel_kind IN ('customer', 'shop', 'no_payment', 'no_answer')),
  ADD CONSTRAINT orders_no_answer_chk CHECK (cancel_kind IS DISTINCT FROM 'no_answer' OR (kind = 'custom' AND accepted_at IS NULL AND remake_of_order_id IS NULL));

-- TBL-025 change_requests: 변경 마감까지 답이 없는 변경 요청의 답 없어 닫힘(REQ-214)
ALTER TABLE change_requests
  DROP CONSTRAINT change_requests_status_check;
ALTER TABLE change_requests
  ADD CONSTRAINT change_requests_status_check CHECK (status IN ('requested', 'awaiting_difference', 'applied', 'rejected', 'closed_no_difference', 'stale', 'closed_by_cancel', 'closed_no_answer')),
  ADD CONSTRAINT change_requests_no_answer_chk CHECK (status <> 'closed_no_answer' OR (closed_at IS NOT NULL AND decided_at IS NULL));

-- TBL-027 handoffs: 남긴 지 7일 지난 에스컬레이션 건의 답 없어 닫힘과 닫힌 시각(REQ-216)
ALTER TABLE handoffs
  DROP CONSTRAINT handoffs_status_check,
  ADD COLUMN closed_at timestamptz;
ALTER TABLE handoffs
  ADD CONSTRAINT handoffs_status_check CHECK (status IN ('open', 'answered', 'closed_no_answer')),
  ADD CONSTRAINT handoffs_closed_chk CHECK ((status = 'closed_no_answer') = (closed_at IS NOT NULL));
CREATE INDEX handoffs_open_age_idx ON handoffs (created_at) WHERE status = 'open';

-- TBL-031 payment_requests: 전해진 시각과 결제 기한 상한. 전해지기 전에는 상한이 결제 기한(REQ-218, REQ-223)
ALTER TABLE payment_requests
  ADD COLUMN delivered_at timestamptz,
  ADD COLUMN due_cap_at timestamptz;
UPDATE payment_requests SET due_cap_at = due_at;
ALTER TABLE payment_requests
  ALTER COLUMN due_cap_at SET NOT NULL,
  ADD CONSTRAINT payment_requests_due_cap_chk CHECK (due_at <= due_cap_at),
  ADD CONSTRAINT payment_requests_delivered_chk CHECK ((delivered_at IS NOT NULL OR due_at = due_cap_at) AND (delivered_at IS NULL OR delivered_at >= issued_at));
CREATE INDEX payment_requests_claim_cap_idx ON payment_requests (due_cap_at) WHERE status = 'claimed';

-- TBL-034 slot_holds: 날짜별 그날 자리 세기에 종료된 자리도 셈(1-4)
DROP INDEX slot_holds_day_live_idx;
CREATE INDEX slot_holds_day_live_idx ON slot_holds (shop_id, day) WHERE status IN ('held', 'fixed', 'done');

-- TBL-042 owner_tasks: 기다림의 상태(기다림·지연·답함·답 없어 닫힘)와 기다림이 있는 할 일 일곱(1-7, REQ-215)
ALTER TABLE owner_tasks
  DROP CONSTRAINT owner_tasks_wait_status_check,
  DROP CONSTRAINT owner_tasks_wait_kind_chk,
  DROP CONSTRAINT owner_tasks_late_chk,
  DROP CONSTRAINT owner_tasks_answered_chk;
UPDATE owner_tasks SET wait_status = 'late' WHERE wait_status = 'parked';
UPDATE owner_tasks SET wait_status = CASE WHEN closed_at IS NULL THEN 'waiting' ELSE 'answered' END, wait_due_at = opened_at
 WHERE kind IN ('payment_claim', 'payment_mismatch', 'refund_decision') AND wait_status IS NULL;
ALTER TABLE owner_tasks
  ADD CONSTRAINT owner_tasks_wait_status_check CHECK (wait_status IN ('waiting', 'late', 'answered', 'closed_no_answer')),
  ADD CONSTRAINT owner_tasks_wait_kind_chk CHECK ((kind IN ('handoff', 'custom_order', 'change_request', 'issue_report', 'payment_claim', 'payment_mismatch', 'refund_decision')) = (wait_status IS NOT NULL AND wait_due_at IS NOT NULL)),
  ADD CONSTRAINT owner_tasks_late_chk CHECK (wait_status IS DISTINCT FROM 'late' OR late_notice_at IS NOT NULL),
  ADD CONSTRAINT owner_tasks_answered_chk CHECK (wait_status IS NULL OR (wait_status IN ('answered', 'closed_no_answer')) = (closed_at IS NOT NULL)),
  ADD CONSTRAINT owner_tasks_no_answer_chk CHECK (wait_status IS DISTINCT FROM 'closed_no_answer' OR kind IN ('handoff', 'custom_order', 'change_request', 'payment_claim'));

-- TBL-044 notifications: 답 없어 닫힘 안내(REQ-213, REQ-214, REQ-216)
ALTER TABLE notifications
  DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('owner_reply', 'delay_notice', 'channel_add', 'custom_rejected', 'payment_request', 'payment_mismatch', 'order_confirmed', 'cancelled', 'change_result', 'change_not_applied', 'refund', 'compensation', 'day_before', 'completion_photo', 'review_request', 'refund_sent', 'payment_corrected', 'no_answer_closed'));

-- 받음·미수령인 주문은 제작 행의 인도·미수령 시각과 짝이 맞아야 커밋됨(설계 재검토 M9, 4절 A27, 5절 E3). 주문 상태와 제작 행을
-- 한 트랜잭션에서 쓰므로 트랜잭션 끝에 봄(지연 제약 트리거). 받음이면 인도 시각이 있고, 미수령이면 인도 시각 없이 미수령 시각이 있음
CREATE FUNCTION orders_production_sync_check() RETURNS trigger
LANGUAGE plpgsql AS $sync$
DECLARE
  target uuid;
  order_status text;
  handed timestamptz;
  missed timestamptz;
BEGIN
  IF TG_TABLE_NAME = 'orders' THEN
    target := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    target := OLD.order_id;
  ELSE
    target := NEW.order_id;
  END IF;
  SELECT o.status INTO order_status FROM orders o WHERE o.id = target;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT p.handed_over_at, p.no_pickup_at INTO handed, missed FROM productions p WHERE p.order_id = target;
  IF (order_status = 'received') <> (handed IS NOT NULL)
     OR (order_status = 'no_pickup') <> (missed IS NOT NULL AND handed IS NULL) THEN
    RAISE EXCEPTION 'orders_production_sync: 주문 상태(%)와 제작 행의 인도·미수령 시각이 맞지 않음', order_status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$sync$;
CREATE CONSTRAINT TRIGGER orders_production_sync AFTER INSERT OR UPDATE OF status ON orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orders_production_sync_check();
CREATE CONSTRAINT TRIGGER productions_order_sync AFTER INSERT OR UPDATE OF handed_over_at, no_pickup_at OR DELETE ON productions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orders_production_sync_check();

-- 테이블·컬럼 설명(db/schema.sql과 같은 줄)
COMMENT ON COLUMN shops.idle_close_hours IS '문의 끊김까지 시간(REQ-211, 기본 24시간)';
COMMENT ON COLUMN operating_rules.payment_due_hours IS '결제 기한(TERM-030, REQ-218): 결제 안내가 손님에게 전해진 뒤 기본 12시간, 결제 기한 상한까지';
COMMENT ON COLUMN customers.channel_friend IS '채널 친구인지. 손님이 말을 걸 때마다 카카오가 알린 값으로 고치고 알리지 않았으면 친구 아님, 먼저 보낸 안내가 친구 아님으로 실패해도 친구 아님(REQ-219). 먼저 보내는 안내는 친구에게만(REQ-120)';
COMMENT ON COLUMN consultations.last_customer_message_at IS '손님의 마지막 메시지 시각(문의 끊김 셈, REQ-211)';
COMMENT ON COLUMN orders.cancel_kind IS '손님이 취소함·가게 사정으로 취소됨·결제 없어 취소됨(사장님이 고르거나 픽업 일시까지 고르지 않음, REQ-217)·답 없어 닫힘(맞춤 주문 요청에 그 픽업 날짜의 주문 마감까지 사장님 답이 없음, REQ-213)';
COMMENT ON COLUMN change_requests.needs_owner_day IS '새 날이 휴무일이거나 마감된 날이라 사장님이 휴무일임이나 초과해 받는 것을 확인한 뒤에만 받음(SPEC-041, REQ-221, REQ-226)';
COMMENT ON COLUMN change_requests.status IS '요청됨·차액 결제 기다림·반영됨·거절됨·차액 없어 닫힘·오래된 버전이라 받지 않음·주문 취소로 닫힘·답 없어 닫힘(1-5). 답 없어 닫힘은 변경 마감까지 사장님 답이 없을 때(REQ-214)';
COMMENT ON COLUMN handoffs.status IS '열림·답함·답 없어 닫힘(남긴 지 7일, REQ-216)';
COMMENT ON COLUMN handoffs.closed_at IS '답 없어 닫힌 시각(남긴 지 7일, REQ-216). 그 뒤 상담은 문의 끊김으로 닫히고 지워질 수 있음(1-1)';
COMMENT ON COLUMN payment_requests.issued_at IS '낸 시각. 결제 기한은 이때가 아니라 손님에게 전해진 시각부터 셈(REQ-218)';
COMMENT ON COLUMN payment_requests.delivered_at IS '결제 안내가 손님에게 전해진 시각: 대화 중 답으로 보임·먼저 보낸 안내가 닿음·다음 대화 때 전함(SPEC-032). 빈 값이면 ''아직 못 전함''(SPEC-037)';
COMMENT ON COLUMN payment_requests.due_at IS '결제 기한(TERM-030): 전해진 시각에 운영규정의 결제 기한을 더한 때와 결제 기한 상한 가운데 이른 쪽. 전해지기 전에는 상한(REQ-218)';
COMMENT ON COLUMN payment_requests.due_cap_at IS '결제 기한 상한: 첫 결제·다시 낸 결제는 그 픽업 날짜의 주문 마감(이미 지났으면 픽업 일시), 차액 결제는 변경 마감(REQ-218, R18). 낼 때 정함. 확인 요청됨도 이때 기한 지남(REQ-223)';
COMMENT ON COLUMN payment_requests.claimed_at IS '손님이 입금했다고 알려 결제 확인을 요청한 시각(REQ-224). 기한 전이면 결제 기한 상한까지 자리를 지킴(R14, REQ-223)';
COMMENT ON COLUMN slot_holds.payment_request_id IS '잡힘이면 그 결제 안내. 그 결제 기한까지 잡고, 확인 요청됨이면 결제 기한 상한까지(R13, REQ-223)';
COMMENT ON COLUMN slot_holds.overbooked IS '마감 후 추가 수락: 다 찬 날이나 휴무일에 사장님이 확인하고 받은 자리(R10, REQ-221, REQ-226). 그날은 다른 손님에게 계속 마감(REQ-045)';
COMMENT ON COLUMN productions.handed_over_at IS '인도 시각(REQ-091). 있으면 주문은 받음(4절 A27)';
COMMENT ON COLUMN productions.no_pickup_at IS '미수령(TERM-025) 표시 시각. 인도 시각 없이 있으면 주문은 미수령(4절 A27)';
COMMENT ON COLUMN owner_tasks.wait_status IS '사장님 답 기다림(1-7): 기다림·지연(지연 안내와 다시 알림 뒤 할 일 목록에 남음)·답함·답 없어 닫힘. 에스컬레이션 건·맞춤 주문·변경 요청·문제 신고·결제 확인 요청·맞추는 중·환불 결정만(REQ-215)';
COMMENT ON COLUMN owner_tasks.wait_due_at IS '지연 안내를 보낼 시각: 기다리는 시간을 답하는 시간 안에서만 셈(REQ-118). 답 없어 닫는 때(1-7)와 다름';
COMMENT ON COLUMN owner_tasks.late_notice_at IS '손님에게 지연 안내(TERM-036)를 낸 시각(한 번, REQ-116, REQ-156, REQ-215)';
COMMENT ON COLUMN owner_tasks.realerted_at IS '사장님께 다시 알린 시각(한 번): 지연 뒤(REQ-117, REQ-215), 환불 보내기는 환불을 정하고 24시간 뒤(REQ-173)';
COMMENT ON COLUMN owner_tasks.closed_at IS '사장님이 처리해 닫히거나 답 없어 닫힌 시각(SPEC-067, 1-7)';
COMMENT ON COLUMN notifications.consultation_id IS '그 손님의 상담. 상담이 문의 끊김이어도 이 안내는 보내고, 못 보내면 다음 대화 때(새 상담이면 고지 뒤) 먼저 전함(REQ-122, REQ-212)';
COMMENT ON COLUMN notifications.kind IS '사장님 답·지연 안내(TERM-036)·채널 추가 권함·맞춤 거절·결제 안내·금액 불일치·확정 안내·취소·변경 결과(반영·거절)·변경 안 됨·환불·보상·전날 안내·완성 사진·후기 부탁·환불 보냄(REQ-172)·결제 확인 정정(REQ-169)·답 없어 닫힘(맞춤 주문 요청·변경 요청·에스컬레이션 건, REQ-213, REQ-214, REQ-216)';
