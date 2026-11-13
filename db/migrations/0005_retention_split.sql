-- 0005_retention_split: 보관과 지우기(설계 재검토 H3, 2026-11-13 20:59 결정 카드 '추천안대로 (추천)')
-- 상담은 다룬 주문이 모두 끝나면 '상담 끝남'으로 닫고 손님의 다음 말은 새 상담으로 받음(REQ-189). 그래서 대화마다 어느 주문의 것인지 나뉨.
-- 주문은 끝난 시각(finished_at)을 남기고 끝나고 30일 뒤 개인정보를 지우며, 계약·결제 기록은 5년·문제 신고 기록은 3년 보관 기록(kept_records)으로 나눔(REQ-185~188).
-- 기간은 잠정(5-2 질문 7의 답으로 다시 봄). 상담을 지울 때 신고 사진은 메시지 연결만 비우고, 사장님 알림은 할 일 연결만 비움.
-- 상담이 모두 지워지고 주문이 모두 보관 기록이 된 손님은 카카오 사용자 키를 지움(REQ-190). 지우는 차례는 docs/05-erd/README.md 6절.
-- 0004_kakao_event_path.sql 뒤에 한 트랜잭션으로 적용: psql -1 -v ON_ERROR_STOP=1 -f db/migrations/0005_retention_split.sql
-- 적용한 결과는 db/schema.sql과 같음(check_erd.py D2). 아직 운영 데이터가 없어(10단계 전) 끝난 주문과 닫힌 상담이 없음. 있으면 finished_at을 채운 뒤 지우기를 돌림.

-- TBL-016 customers: 지운 카카오 사용자 키
ALTER TABLE customers
  ALTER COLUMN kakao_user_key DROP NOT NULL,
  ADD COLUMN purged_at timestamptz;
ALTER TABLE customers
  ADD CONSTRAINT customers_purged_chk CHECK ((kakao_user_key IS NULL) = (purged_at IS NOT NULL));

-- TBL-017 consultations: 상담 끝남(다시 열지 않음)과 닫은 시각, 손님마다 끝나지도 지워지지도 않은 상담 하나
ALTER TABLE consultations
  ADD COLUMN ended_at timestamptz;
ALTER TABLE consultations
  DROP CONSTRAINT consultations_status_check,
  ADD CONSTRAINT consultations_status_check CHECK (status IN ('open', 'awaiting_owner', 'dropped', 'ordered', 'ended', 'deleted')),
  ADD CONSTRAINT consultations_ended_chk CHECK (status <> 'ended' OR ended_at IS NOT NULL);
DROP INDEX consultations_one_live_per_customer;
CREATE UNIQUE INDEX consultations_one_live_per_customer ON consultations (customer_id) WHERE status NOT IN ('ended', 'deleted');
CREATE INDEX consultations_ordered_idx ON consultations (last_customer_message_at) WHERE status = 'ordered';
CREATE INDEX consultations_ended_idx ON consultations (ended_at) WHERE status = 'ended';

-- TBL-023 orders: 끝난 시각, 개인정보를 지운 주문은 끝난 주문이고 다시 열지 않음
ALTER TABLE orders
  ADD COLUMN finished_at timestamptz;
ALTER TABLE orders
  ADD CONSTRAINT orders_finished_chk CHECK (finished_at IS NULL OR status IN ('received', 'no_pickup', 'rejected', 'cancelled')),
  ADD CONSTRAINT orders_purged_chk CHECK (personal_data_purged_at IS NULL OR finished_at IS NOT NULL);
CREATE INDEX orders_purge_due_idx ON orders (finished_at) WHERE finished_at IS NOT NULL AND personal_data_purged_at IS NULL;

-- TBL-028 issue_details: 신고된 설명·사진을 지운 시각
ALTER TABLE issue_details
  ADD COLUMN content_purged_at timestamptz;
ALTER TABLE issue_details
  ADD CONSTRAINT issue_details_purged_chk CHECK (content_purged_at IS NULL OR (status = 'reported' AND description IS NULL));

-- TBL-029 issue_photos: 상담을 지울 때 메시지 연결만 비움
ALTER TABLE issue_photos
  ALTER COLUMN message_id DROP NOT NULL;

-- TBL-052 kept_records: 보관 기록(새 테이블)
CREATE TABLE kept_records (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 보관 기록 ID
  shop_id              uuid NOT NULL,                  -- 가게
  order_id             uuid NOT NULL,                  -- 보관 기록이 된 주문. 주문 내용 버전·결제·환불·문제 신고 행은 그 주문에 그대로 남음
  customer_name        text CHECK (char_length(customer_name) BETWEEN 1 AND 30), -- 주문자 이름: 계약 기록에서 손님을 알아볼 정보로 주문 내용에서 옮겨 둠(REQ-185). 주문자 정보가 없는 재제작 주문은 빈 값(원래 주문의 보관 기록에 있음)
  finished_at          timestamptz NOT NULL,           -- 주문이 끝난 시각(보관 기간의 셈)
  contract_keep_until  timestamptz NOT NULL,           -- 계약·결제 기록을 둘 때까지: 끝난 날부터 5년(REQ-187, 잠정). 지나면 이 행을 지움(REQ-188)
  issue_keep_until     timestamptz,                    -- 문제 신고 기록을 둘 때까지: 끝난 날부터 3년(REQ-187, 잠정). 그 주문에 신고가 없으면 빈 값
  issue_purged_at      timestamptz,                    -- 문제 신고의 설명·사진을 지운 시각(REQ-188)
  created_at           timestamptz NOT NULL DEFAULT now(), -- 보관 기록으로 나눈 시각(끝나고 30일 뒤)
  CONSTRAINT kept_records_order_fk FOREIGN KEY (shop_id, order_id) REFERENCES orders (shop_id, id) ON DELETE RESTRICT,
  CONSTRAINT kept_records_order_uq UNIQUE (order_id),   -- 주문 하나에 보관 기록 하나
  CONSTRAINT kept_records_keep_chk CHECK (contract_keep_until > finished_at AND (issue_keep_until IS NULL OR (issue_keep_until > finished_at AND issue_keep_until <= contract_keep_until))), -- 보관 기간은 끝난 뒤이고 신고 기록이 계약 기록보다 길지 않음
  CONSTRAINT kept_records_issue_purged_chk CHECK (issue_purged_at IS NULL OR issue_keep_until IS NOT NULL) -- 신고 기록을 지운 표시는 신고가 있는 주문에만
);
CREATE INDEX kept_records_contract_due_idx ON kept_records (contract_keep_until); -- 5년 지난 보관 기록 찾기(SPEC-065)
CREATE INDEX kept_records_issue_due_idx ON kept_records (issue_keep_until) WHERE issue_keep_until IS NOT NULL AND issue_purged_at IS NULL; -- 3년 지난 문제 신고 찾기(SPEC-065)

-- 테이블·컬럼 설명(db/schema.sql과 같은 줄)
COMMENT ON TABLE consultations IS 'TBL-017 상담(TERM-046): 손님 한 사람과 가게의 대화 하나. 다룬 주문이 모두 끝나면 닫고 다음 말은 새 상담(REQ-189)';
COMMENT ON TABLE kept_records IS 'TBL-052 보관 기록: 끝나고 30일이 지난 주문을 지금 데이터와 나눈 표시와 주문자 이름. 계약·결제 기록은 5년, 문제 신고 기록은 3년(잠정, 5-2 질문 7)';
COMMENT ON COLUMN customers.kakao_user_key IS '그 채널의 카카오 사용자 키. 손님 명령은 이 키로 구분함(G1). 상담이 모두 지워지고 주문이 모두 보관 기록이 되면 지움(SPEC-065, REQ-190)';
COMMENT ON COLUMN customers.purged_at IS '카카오 사용자 키를 지운 시각(SPEC-065, REQ-190). 같은 사용자가 다시 말을 걸면 새 손님 행으로 받음';
COMMENT ON COLUMN consultations.status IS '열림·사장님 답 기다림·문의 끊김·주문으로 전환됨·상담 끝남·지워짐(1-1). 상담 끝남과 지워짐은 다시 열지 않고 손님의 다음 말은 새 상담(REQ-189)';
COMMENT ON COLUMN consultations.dropped_at IS '문의 끊김으로 닫은 시각(30일 지우기 셈, REQ-186)';
COMMENT ON COLUMN consultations.ended_at IS '상담 끝남으로 닫은 시각: 다룬 주문이 모두 끝나고 손님의 마지막 메시지 뒤 가게가 정한 시간이 지남(30일 지우기 셈, SPEC-025, REQ-189)';
COMMENT ON COLUMN consultations.deleted_at IS '대화·사진·주문이 되지 않은 초안을 지운 시각(SPEC-065, REQ-186). 이 행은 내용 없이 남기고 주문·AI 호출 기록(비용)이 참조함';
COMMENT ON COLUMN orders.finished_at IS '주문이 끝난 시각: 받음·미수령·거절됨·취소됨이고 보내지 않은 환불·열린 신고·변경 요청·결제 안내·할 일이 없음(SPEC-025, SPEC-065). 그 뒤 늦은 신고나 들어온 입금 대조로 다시 열리면 개인정보를 지우기 전까지는 비움(A22)';
COMMENT ON COLUMN orders.personal_data_purged_at IS '끝나고 30일 뒤 개인정보를 지우고 보관 기록(kept_records)으로 나눈 시각(SPEC-065, REQ-185, REQ-187). 이 주문은 화면·API·AI가 읽지 않음(A22)';
COMMENT ON COLUMN confirm_cards.payload IS '서버가 저장된 값으로 만든 카드 내용(요약·금액·규정 버전·환불 계산값). AI가 쓰지 않음. 주문이 끝나고 30일 뒤 빈 객체({})로 비움(SPEC-065)';
COMMENT ON COLUMN change_requests.changes IS '바꾸려는 내용(디자인·문구·날짜·시간). 주문이 끝나고 30일 뒤 빈 객체({})로 비움(SPEC-065)';
COMMENT ON COLUMN order_details.design_notes IS '디자인 설명. 주문이 끝나고 30일 뒤 비움(SPEC-065)';
COMMENT ON COLUMN order_details.lettering IS '문구(TERM-021). 철자는 손님이 쓴 그대로(SPEC-028). 주문이 끝나고 30일 뒤 비움(SPEC-065)';
COMMENT ON COLUMN order_details.allergy_answer IS '알레르기 답. 이 주문 밖에서 쓰지 않고 장부에 적지 않음(REQ-142, SPEC-064). 주문이 끝나고 30일 뒤 지움(SPEC-065)';
COMMENT ON COLUMN order_details.excluded_ingredients IS '빼야 할 재료. 주문이 끝나고 30일 뒤 비움(SPEC-065)';
COMMENT ON COLUMN order_details.customer_name IS '주문자 이름. 주문이 끝나고 30일 뒤 비우고 보관 기록으로 옮김(SPEC-065, REQ-185)';
COMMENT ON COLUMN order_details.customer_phone IS '주문자 연락처. 주문이 끝나고 30일 뒤 지움(SPEC-065)';
COMMENT ON COLUMN issue_details.description IS '설명. 사진 없이도 신고할 수 있음. 신고된 것은 주문이 끝난 날부터 3년 뒤 비움(SPEC-065, REQ-188)';
COMMENT ON COLUMN issue_details.content_purged_at IS '신고된 설명과 사진을 지운 시각(주문이 끝난 날부터 3년, SPEC-065, REQ-188)';
COMMENT ON COLUMN issue_photos.message_id IS '사진이 온 메시지. 상담을 지울 때 신고된 사진은 메시지 연결만 비우고 주문이 끝난 날부터 3년 남김(SPEC-065, REQ-187)';
COMMENT ON COLUMN payment_requests.depositor_name IS '입금자 이름(입금 대조, TERM-063). 손님이 결제 확인을 요청할 때 AI를 거치지 않는 입력으로 받고, 따로 넣지 않으면 주문자 이름(SPEC-033, REQ-176). AI로 보내지 않음(REQ-178). 주문이 끝나고 30일 뒤 지움(SPEC-065)';
COMMENT ON COLUMN refunds.refund_bank_name IS '환불받을 손님 은행(SPEC-049). 주문이 끝나고 30일 뒤 지움(SPEC-065)';
COMMENT ON COLUMN refunds.refund_account_number IS '환불받을 손님 계좌번호. 그 가게 사장님 화면의 이 환불에만, AI·로그 0번(R19). 주문이 끝나고 30일 뒤 지움(SPEC-065)';
COMMENT ON COLUMN refunds.refund_holder_name IS '환불받을 계좌의 예금주. 주문이 끝나고 30일 뒤 지움(SPEC-065)';
COMMENT ON COLUMN owner_tasks.detail IS '보일 글감(보류 이유, 기준을 넘는 날과 주문 수 등). 손님 연락처·계좌·알레르기 없음. 주문이 끝나고 30일 뒤 비움(SPEC-065)';
COMMENT ON COLUMN owner_alerts.owner_task_id IS '알린 할 일. 상담을 지울 때 그 상담의 에스컬레이션 할 일은 지우고 이 연결만 비움(SPEC-065, 설계 재검토 H3)';
COMMENT ON COLUMN notifications.body IS '보낼 글. 다른 손님 정보·내부 ID 없음(G6). 주문이 끝나고 30일 뒤나 상담을 지울 때 행째 지움(SPEC-065)';
COMMENT ON COLUMN kept_records.id IS '보관 기록 ID';
COMMENT ON COLUMN kept_records.shop_id IS '가게';
COMMENT ON COLUMN kept_records.order_id IS '보관 기록이 된 주문. 주문 내용 버전·결제·환불·문제 신고 행은 그 주문에 그대로 남음';
COMMENT ON COLUMN kept_records.customer_name IS '주문자 이름: 계약 기록에서 손님을 알아볼 정보로 주문 내용에서 옮겨 둠(REQ-185). 주문자 정보가 없는 재제작 주문은 빈 값(원래 주문의 보관 기록에 있음)';
COMMENT ON COLUMN kept_records.finished_at IS '주문이 끝난 시각(보관 기간의 셈)';
COMMENT ON COLUMN kept_records.contract_keep_until IS '계약·결제 기록을 둘 때까지: 끝난 날부터 5년(REQ-187, 잠정). 지나면 이 행을 지움(REQ-188)';
COMMENT ON COLUMN kept_records.issue_keep_until IS '문제 신고 기록을 둘 때까지: 끝난 날부터 3년(REQ-187, 잠정). 그 주문에 신고가 없으면 빈 값';
COMMENT ON COLUMN kept_records.issue_purged_at IS '문제 신고의 설명·사진을 지운 시각(REQ-188)';
COMMENT ON COLUMN kept_records.created_at IS '보관 기록으로 나눈 시각(끝나고 30일 뒤)';
