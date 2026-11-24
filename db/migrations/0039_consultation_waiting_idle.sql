-- TASK-076: 에스컬레이션 건이 닫힌 답 기다림 상담도 문의 끊김으로 찾는다.
CREATE INDEX consultations_waiting_idle_idx ON consultations (last_customer_message_at) WHERE status = 'awaiting_owner';
