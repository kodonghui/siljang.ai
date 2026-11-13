-- 0003_order_input_lock: 주문자 정보 카드와 잠금 번호(설계 재검토 H11·H12, 2026-11-13 20:59 결정 카드 '추천안대로 (추천)')
-- 주문 요청 확인 카드 전에 주문자 이름·연락처를 AI를 거치지 않는 입력으로 받는 주문자 정보 카드(REQ-175, SPEC-072),
-- 결제 확인 요청 때 받는 입금자 이름(REQ-176), 쓸 때마다 하나 오르는 주문·변경 요청의 잠금 번호(README 4절 A6, 5절 E15, 06단계 DEC-05).
-- 0002_refund_path.sql 뒤에 한 트랜잭션으로 적용: psql -1 -v ON_ERROR_STOP=1 -f db/migrations/0003_order_input_lock.sql
-- 적용한 결과는 db/schema.sql과 같음(check_erd.py D2). 아직 운영 데이터가 없어(10단계 전) 옛 행은 잠금 번호 1로 시작.

-- TBL-023 orders, TBL-025 change_requests: 잠금 번호. 쓰기는 읽은 값과 같을 때만 하고 하나 올림
ALTER TABLE orders ADD COLUMN lock_version integer NOT NULL DEFAULT 1 CHECK (lock_version >= 1);
ALTER TABLE change_requests ADD COLUMN lock_version integer NOT NULL DEFAULT 1 CHECK (lock_version >= 1);

-- TBL-024 confirm_cards: 주문자 정보 카드(초안에 묶이고 주문은 아직 없음)
ALTER TABLE confirm_cards
  DROP CONSTRAINT confirm_cards_kind_check,
  DROP CONSTRAINT confirm_cards_draft_chk,
  DROP CONSTRAINT confirm_cards_order_chk,
  ADD CONSTRAINT confirm_cards_kind_check CHECK (kind IN ('order_request', 'payment_claim', 'change_request', 'cancel', 'issue_report', 'consent_withdrawal', 'orderer_info')),
  ADD CONSTRAINT confirm_cards_draft_chk CHECK ((kind IN ('order_request', 'orderer_info')) = (draft_id IS NOT NULL AND draft_revision IS NOT NULL)),
  ADD CONSTRAINT confirm_cards_order_chk CHECK (kind IN ('order_request', 'orderer_info') OR (order_id IS NOT NULL AND order_version IS NOT NULL));

-- 컬럼 설명(db/schema.sql과 같은 줄)
COMMENT ON COLUMN orders.version IS '주문 내용의 지금 버전(TERM-005). 카드·변경 요청이 이 값에 묶임(G3, G9). 상태만 바꾸는 쓰기에는 오르지 않아 동시 쓰기는 잠금 번호(lock_version)로 견줌(A6)';
COMMENT ON COLUMN orders.lock_version IS '잠금 번호: 이 행을 쓸 때마다(상태·시각·금액·버전) 하나 오름. 읽은 값과 같을 때만 씀(A6, E15, 설계 재검토 H12). 06단계 주문의 revision(DEC-05)';
COMMENT ON COLUMN change_requests.lock_version IS '잠금 번호: 이 행을 쓸 때마다(상태·답·반영·닫힘) 하나 오름. 읽은 값과 같을 때만 씀(A6, E15, 설계 재검토 H12). 06단계 변경 요청의 revision(DEC-05)';
COMMENT ON COLUMN confirm_cards.kind IS '주문 요청·입금 알리기·변경 요청·취소·신고·동의 철회(SPEC-069)·주문자 정보(SPEC-072, 주문 요청 카드 앞에서 이름·연락처를 받음)';
COMMENT ON COLUMN confirm_cards.draft_id IS '주문 요청·주문자 정보 카드의 초안';
COMMENT ON COLUMN order_drafts.customer_name IS '주문자 이름(SPEC-064·065가 말하는 주문의 이름). 주문 요청 확인 카드 전에 AI를 거치지 않는 입력으로 받음(SPEC-072, REQ-175). AI로 보내지 않음(REQ-178)';
COMMENT ON COLUMN order_drafts.customer_phone IS '주문자 연락처(픽업·급한 연락). 주문 요청 확인 카드 전에 AI를 거치지 않는 입력으로 받음(SPEC-072, REQ-175). AI로 보내지 않음(REQ-178)';
COMMENT ON COLUMN payment_requests.depositor_name IS '입금자 이름(입금 대조, TERM-063). 손님이 결제 확인을 요청할 때 AI를 거치지 않는 입력으로 받고, 따로 넣지 않으면 주문자 이름(SPEC-033, REQ-176). AI로 보내지 않음(REQ-178)';
