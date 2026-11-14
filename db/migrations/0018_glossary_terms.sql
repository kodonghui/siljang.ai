-- 0018_glossary_terms: 01단계 용어집에 더한 TERM-075~086의 자리(설계 재검토 낮음 K1, 2026-11-15,
-- 2026-11-13 20:59 결정 카드 '높음·중간 뒤에 따로 고침 (추천)'. 설계 재검토 RA-21·RB-21, docs/05-erd/README.md 11절)
-- 01단계 domain.md 7-5절에 더한 용어 열둘은 이 스키마가 이미 쓰던 상태·값 이름이라, 그 컬럼·테이블 설명에 TERM 번호만 더함(check_erd.py S7).
-- 테이블·컬럼·제약은 바꾸지 않음.
-- 0017_ai_tool_calls_called_idx.sql 뒤에 한 트랜잭션으로 적용: psql -1 -v ON_ERROR_STOP=1 -f db/migrations/0018_glossary_terms.sql
-- 적용한 결과는 db/schema.sql과 같음(check_erd.py D2). 옮길 행이 없음.

-- TBL-031 결제 안내(TERM-078)
COMMENT ON TABLE payment_requests IS 'TBL-031 결제 안내(TERM-078): 금액·결제 방법·결제 기한을 담은 안내와 그 상태(1-3)';

-- 컬럼 설명 아홉(TERM-075·076·077·079·080·081·082·083·084·085·086)
COMMENT ON COLUMN consultations.status IS '열림·사장님 답 기다림·문의 끊김(TERM-075)·주문으로 전환됨·상담 끝남·지워짐(1-1). 상담 끝남과 지워짐은 다시 열지 않고 손님의 다음 말은 새 상담(REQ-189)';
COMMENT ON COLUMN operating_rules.change_deadline_hours IS '변경 마감(TERM-076): 픽업 일시 몇 시간 전까지(SPEC-041). 기본값 없음, 가게가 넣음';
COMMENT ON COLUMN customers.channel_friend IS '채널 친구(TERM-077)인지. 손님이 말을 걸 때마다 카카오가 알린 값으로 고치고 알리지 않았으면 친구 아님, 먼저 보낸 안내가 친구 아님으로 실패해도 친구 아님(REQ-219). 먼저 보내는 안내는 친구에게만(REQ-120)';
COMMENT ON COLUMN payment_requests.kind IS '첫 결제·다시 낸 결제(결제 기한 연장, TERM-037·TERM-086)·차액 결제(R13, TERM-079). 날짜 변경·재제작에는 없음';
COMMENT ON COLUMN business_calendars.reply_start IS '답하는 시간(TERM-080) 시작(REQ-118). 사장님 답 기다림은 이 안에서만 셈';
COMMENT ON COLUMN orders.order_no IS '주문번호(TERM-081): 손님에게 보이는 유일한 번호. 차례 번호가 아닌 무작위라 주문 수가 드러나지 않음(G6)';
COMMENT ON COLUMN confirm_cards.kind IS '주문 요청·입금 알리기(TERM-082)·변경 요청·취소·신고·동의 철회(SPEC-069)·주문자 정보(SPEC-072, 주문 요청 카드 앞에서 이름·연락처를 받음)·알레르기 정보(SPEC-075, 주문자 정보 카드 앞에서 따로 동의를 받음)·사진 게시 동의(SPEC-053, 완성 사진 안내의 버튼)·새 금액 확인(SPEC-076, 결제 안내를 전할 때 계좌 대신)';
COMMENT ON COLUMN payment_requests.status IS '나감·확인 요청됨(TERM-083)·맞추는 중(TERM-084)·확인됨·기한 지남·닫힘(1-3)';
COMMENT ON COLUMN payments.resolution IS '입금됨·대조 완료(TERM-085, 모자란 금액이 입금됨)·대조 완료(더 들어온 금액은 환불로 돌려줌, SPEC-047)(R15)';
