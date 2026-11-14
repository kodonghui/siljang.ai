-- 0019_disclosure_policy_order_amount: AI 상담 고지에 링크한 처리방침 버전, 재제작이 아닌 주문의 1원부터와 주문번호 6~8자
-- (설계 재검토 낮음 K2, 2026-11-15, 2026-11-13 20:59 결정 카드 '높음·중간 뒤에 따로 고침 (추천)'. 설계 재검토 RC-20·RC-19·RB-24, docs/05-erd/README.md 11절)
-- RC-20: 상담에 고지한 처리방침 버전(가게의 버전을 가리키는 외래 키)을 두고 고지 시각과 짝으로 둠. 위탁 동의의 지난 기록은 다음 마이그레이션 후보(5절 E33).
-- RC-19(K1이 04단계에서 막은 0원 주문 요청): 재제작이 아닌 주문은 1원부터. RB-24: 주문번호는 영문 대문자·숫자 6~8자(SPEC-029).
-- 요구사항 버전 5에서 K1이 바꾼 번호(REQ-033→258, REQ-118→259, REQ-183→260)로 컬럼 설명 넷을 고침.
-- 0018_glossary_terms.sql 뒤에 한 트랜잭션으로 적용: psql -1 -v ON_ERROR_STOP=1 -f db/migrations/0019_disclosure_policy_order_amount.sql
-- 적용한 결과는 db/schema.sql과 같음(check_erd.py D2). 개발 전이라 옮길 행이 없지만, 고지한 상담이 있으면 고지할 때 게시된 가장 최근 버전을 채움.

-- TBL-017 상담: 고지한 처리방침 버전(RC-20)
ALTER TABLE consultations ADD COLUMN ai_disclosed_policy_version integer;
UPDATE consultations c
   SET ai_disclosed_policy_version = (SELECT max(p.version) FROM privacy_policies p
                                       WHERE p.shop_id = c.shop_id AND p.published_at <= c.ai_disclosed_at)
 WHERE c.ai_disclosed_at IS NOT NULL;
ALTER TABLE consultations
  ADD CONSTRAINT consultations_disclosed_policy_fk FOREIGN KEY (shop_id, ai_disclosed_policy_version) REFERENCES privacy_policies (shop_id, version) ON DELETE RESTRICT,
  ADD CONSTRAINT consultations_disclosed_policy_chk CHECK ((ai_disclosed_at IS NULL) = (ai_disclosed_policy_version IS NULL));

-- TBL-023 주문: 주문번호 6~8자(RB-24), 재제작이 아닌 주문은 1원부터(RC-19)
ALTER TABLE orders
  DROP CONSTRAINT orders_order_no_check,
  ADD CONSTRAINT orders_order_no_check CHECK (order_no ~ '^[0-9A-Z]{6,8}$'),
  ADD CONSTRAINT orders_amount_paid_chk CHECK (remake_of_order_id IS NOT NULL OR amount >= 1);

-- 컬럼 설명(schema.sql의 COMMENT ON과 같은 글)
COMMENT ON COLUMN owners.kakao_account_id IS '카카오 로그인 사용자 번호. 사장님 알림을 보내는 Event API의 appUserId(SPEC-067, REQ-260). 카카오 토큰은 어디에도 두지 않음(SPEC-001, REQ-135)';
COMMENT ON COLUMN rule_clauses.clause_key IS '템플릿의 조문 필드(REQ-031, REQ-258)나 가게가 더한 조문';
COMMENT ON COLUMN business_calendars.reply_start IS '답하는 시간(TERM-080) 시작(REQ-259). 사장님 답 기다림은 이 안에서만 셈';
COMMENT ON COLUMN consultations.ai_disclosed_policy_version IS '그 고지에 링크한 가게 처리방침(TBL-005)의 버전(REQ-140). 고지 시각과 함께 쓰고, 고지할 때 게시된 가장 최근 버전(4절 A39, 설계 재검토 RC-20)';
COMMENT ON COLUMN orders.order_no IS '주문번호(TERM-081): 손님에게 보이는 유일한 번호. 영문 대문자·숫자 6~8자(SPEC-029). 차례 번호가 아닌 무작위라 주문 수가 드러나지 않음(G6)';
COMMENT ON COLUMN owner_tasks.wait_due_at IS '지연 안내를 보낼 시각: 기다리는 시간을 답하는 시간 안에서만 셈(REQ-259). 답 없어 닫는 때(1-7)와 다름';
