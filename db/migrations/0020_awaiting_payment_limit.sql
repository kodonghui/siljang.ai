-- 0020_awaiting_payment_limit: 한 손님의 결제 기다림 주문 한도와 그 에스컬레이션 건
-- (동희님 2026-11-15 14:19 결정 카드 '가게가 한도를 정함', 설계 재검토 RB-25. 같은 카드의 '지금대로 둠 (추천)'으로 0015의 다른 카카오 사용자 건(RB-15)은 그대로 확정. docs/05-erd/README.md 11절)
-- 가게 설정 awaiting_payment_limit(0~10건, 기본 2건, 0이면 한도 없음)을 더하고, 한도에 닿은 기본 디자인 주문 요청을 사장님께 넘기는 사유 'order_limit'과
-- 한도를 넘겨 받기·받지 않음(limit_decision), 넘겨 받은 24시간(limit_accept_expires_at), 그것을 쓴 주문 요청(limit_used_order_id, 하나만)을 에스컬레이션 건에 더함.
-- 0019_disclosure_policy_order_amount.sql 뒤에 한 트랜잭션으로 적용: psql -1 -v ON_ERROR_STOP=1 -f db/migrations/0020_awaiting_payment_limit.sql
-- 적용한 결과는 db/schema.sql과 같음(check_erd.py D2). 있는 가게는 기본값 2건을 받음.

-- TBL-003 가게: 한 손님의 결제 기다림 주문 한도(REQ-263, REQ-265)
ALTER TABLE shops ADD COLUMN awaiting_payment_limit smallint NOT NULL DEFAULT 2 CHECK (awaiting_payment_limit BETWEEN 0 AND 10);

-- TBL-027 에스컬레이션 건: 사유 'order_limit'과 한도 넘겨 받기(REQ-263, REQ-264)
ALTER TABLE handoffs
  ADD COLUMN limit_decision text CHECK (limit_decision IN ('accepted', 'declined')),
  ADD COLUMN limit_accept_expires_at timestamptz,
  ADD COLUMN limit_used_order_id uuid,
  DROP CONSTRAINT handoffs_reason_check,
  ADD CONSTRAINT handoffs_reason_check CHECK (reason IN ('edibility', 'cannot_answer', 'closed_day', 'legal_medical', 'customer_request', 'other_user', 'pre_receipt_issue', 'ai_failure', 'ai_cost_limit', 'callback_timeout', 'masking_failed', 'empty_answer', 'clause_missing', 'order_limit')),
  DROP CONSTRAINT handoffs_answer_chk,
  ADD CONSTRAINT handoffs_answer_chk CHECK (status <> 'answered' OR answer_text IS NOT NULL OR day_decision IS NOT NULL OR limit_decision IS NOT NULL),
  ADD CONSTRAINT handoffs_limit_used_fk FOREIGN KEY (shop_id, limit_used_order_id) REFERENCES orders (shop_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT handoffs_limit_used_uq UNIQUE (limit_used_order_id),
  ADD CONSTRAINT handoffs_limit_chk CHECK (limit_decision IS NULL OR reason = 'order_limit'),
  ADD CONSTRAINT handoffs_limit_used_chk CHECK (limit_used_order_id IS NULL OR limit_decision IS NOT DISTINCT FROM 'accepted'),
  ADD CONSTRAINT handoffs_limit_accept_chk CHECK ((limit_decision IS NOT DISTINCT FROM 'accepted') = (limit_accept_expires_at IS NOT NULL));
DROP INDEX handoffs_one_open_per_consultation;
CREATE UNIQUE INDEX handoffs_one_open_per_consultation ON handoffs (consultation_id) WHERE status = 'open' AND reason NOT IN ('closed_day', 'order_limit') AND (reason <> 'other_user' OR order_id IS NULL);
CREATE UNIQUE INDEX handoffs_one_open_limit_per_consultation ON handoffs (consultation_id) WHERE status = 'open' AND reason = 'order_limit';

-- 컬럼 설명(schema.sql의 COMMENT ON과 같은 글)
COMMENT ON COLUMN shops.awaiting_payment_limit IS '한 손님의 결제 기다림 주문 한도(REQ-263, REQ-265, 기본 2건, 0이면 한도 없음). 기본 디자인 주문 요청 때 그 손님의 결제 기다림 주문 수와 견줌(4절 A40). 바꾸면 저장한 때부터 씀';
COMMENT ON COLUMN handoffs.reason IS '에스컬레이션한 사유: 먹어도 되는지·답할 수 없음·마감된 날·법·의료·손님 요청·다른 사용자·받기 전 문제·AI 실패·AI 비용 한도·콜백 시간 초과·마스킹 실패·빈 답·조문 없음·결제 기다림 주문 한도(REQ-263)';
COMMENT ON COLUMN handoffs.limit_decision IS '결제 기다림 주문 한도: 한도를 넘겨 받기·받지 않음(SPEC-023, REQ-264)';
COMMENT ON COLUMN handoffs.limit_accept_expires_at IS '한도를 넘겨 받은 상담의 주문 요청이 한도를 넘을 수 있는 기한(24시간, SPEC-023, REQ-264)';
COMMENT ON COLUMN handoffs.limit_used_order_id IS '한도 넘겨 받기를 쓴 주문 요청. 넘겨 받기 하나는 주문 요청 하나에만(SPEC-023, SPEC-029, 4절 A40)';
