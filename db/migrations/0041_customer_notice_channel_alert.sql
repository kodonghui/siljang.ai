-- TASK-104: 먼저 보내기 설정 오류를 사장님에게 한 번 알린다. 기존 종류는 보존한다.
ALTER TABLE owner_alerts DROP CONSTRAINT owner_alerts_kind_check;
ALTER TABLE owner_alerts ADD CONSTRAINT owner_alerts_kind_check
  CHECK (kind IN ('new_task', 'task_realert', 'handoff_appended', 'health_concern', 'ledger_failing', 'license_on_hold', 'order_cancelled', 'change_not_applied', 'payment_account_changed', 'identity_change_applied', 'identity_change_on_hold', 'channel_event_unavailable'));
