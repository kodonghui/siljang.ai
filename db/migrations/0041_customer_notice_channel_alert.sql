-- TASK-104: 먼저 보내기 설정 오류를 사장님에게 한 번 알린다. 기존 종류는 보존한다.
ALTER TABLE owner_alerts DROP CONSTRAINT owner_alerts_kind_check;
ALTER TABLE owner_alerts ADD CONSTRAINT owner_alerts_kind_check
  CHECK (kind IN ('new_task', 'task_realert', 'handoff_appended', 'health_concern', 'ledger_failing', 'license_on_hold', 'order_cancelled', 'change_not_applied', 'payment_account_changed', 'identity_change_applied', 'identity_change_on_hold', 'channel_event_unavailable'));

COMMENT ON COLUMN owner_alerts.kind IS '새 할 일·지연 뒤 다시 알림·새 질문 덧붙음·먹고 아프다는 신고·장부 적기 실패·영업 신고 보류·주문 취소됨(SPEC-050)·변경 반영 안 됨(SPEC-044)·결제 받을 계좌 바뀜(할 일 없이 알림만, 계좌번호 없음, SPEC-067, REQ-198)·사업자 정보 변경 반영됨·보류됨(할 일 없이 알림만, SPEC-078, REQ-245)·손님 안내 먼저 보내기 설정 오류(SPEC-066, REQ-181)';
