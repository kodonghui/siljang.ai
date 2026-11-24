-- 수신 글 재처리와 AI 대화 기록의 가게별 확인 건 연결 조회를 지원합니다.
CREATE INDEX owner_tasks_handoff_idx ON owner_tasks (shop_id, handoff_id) WHERE handoff_id IS NOT NULL;
