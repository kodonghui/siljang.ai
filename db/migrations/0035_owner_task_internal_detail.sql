-- TASK-068: 내부 중복 확인 키는 화면 자료가 아니다. 행과 권한은 바꾸지 않는다.
COMMENT ON COLUMN owner_tasks.detail IS '할 일 자료(보류 이유, 기준을 넘는 날과 주문 수 등). 내부 키 closedDaySourceIds·closedDayAvailability는 화면과 API에서 제외하고 허용한 필드만 고름. 손님 연락처·계좌·알레르기 없음. 주문이 끝나고 30일 뒤 비움(SPEC-065)';
