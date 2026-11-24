-- TASK-077: 같은 시각의 메시지와 손님 안내를 안정적으로 정렬한다(API-043, DEC-14).
-- 기존 기록의 완전히 같은 시각은 삽입 순서를 복구할 수 없어 시각·종류·ID 순으로 채운다.
-- 이후 기록은 두 테이블의 공통 순번을 쓴다. 번호의 공백은 허용하고 응답 필드에는 넣지 않는다.
CREATE SEQUENCE consultation_timeline_seq AS bigint;
COMMENT ON SEQUENCE consultation_timeline_seq IS '상담 메시지·손님 안내의 공통 표시 순번';
ALTER TABLE messages ADD COLUMN timeline_seq bigint;
ALTER TABLE notifications ADD COLUMN timeline_seq bigint;
WITH prior AS (
  SELECT id, created_at, 0 AS source FROM messages
  UNION ALL SELECT id, created_at, 1 AS source FROM notifications
), ranked AS (
  SELECT id, source, row_number() OVER (ORDER BY created_at, source, id) AS seq FROM prior
)
UPDATE messages m SET timeline_seq = r.seq FROM ranked r WHERE r.source = 0 AND r.id = m.id;
WITH prior AS (
  SELECT id, created_at, 0 AS source FROM messages
  UNION ALL SELECT id, created_at, 1 AS source FROM notifications
), ranked AS (
  SELECT id, source, row_number() OVER (ORDER BY created_at, source, id) AS seq FROM prior
)
UPDATE notifications n SET timeline_seq = r.seq FROM ranked r WHERE r.source = 1 AND r.id = n.id;
DO $timeline$
BEGIN
  PERFORM setval('consultation_timeline_seq', coalesce(max(n), 1), max(n) IS NOT NULL)
  FROM (SELECT max(timeline_seq) AS n FROM messages UNION ALL SELECT max(timeline_seq) AS n FROM notifications) all_sequences;
END;
$timeline$;
ALTER TABLE messages ALTER COLUMN timeline_seq SET DEFAULT nextval('consultation_timeline_seq'), ALTER COLUMN timeline_seq SET NOT NULL;
ALTER TABLE notifications ALTER COLUMN timeline_seq SET DEFAULT nextval('consultation_timeline_seq'), ALTER COLUMN timeline_seq SET NOT NULL;
ALTER TABLE messages ADD CONSTRAINT messages_timeline_seq_check CHECK (timeline_seq >= 1);
ALTER TABLE notifications ADD CONSTRAINT notifications_timeline_seq_check CHECK (timeline_seq >= 1);
CREATE UNIQUE INDEX messages_timeline_seq_uq ON messages (timeline_seq);
CREATE INDEX messages_timeline_page_idx ON messages (shop_id, consultation_id, created_at, timeline_seq);
CREATE UNIQUE INDEX notifications_timeline_seq_uq ON notifications (timeline_seq);
CREATE INDEX notifications_timeline_page_idx ON notifications (shop_id, consultation_id, (coalesce(sent_at, created_at)), timeline_seq);
COMMENT ON COLUMN messages.timeline_seq IS '같은 시각의 메시지·손님 안내를 함께 정렬하는 삽입 순번(API-043, DEC-14)';
COMMENT ON COLUMN notifications.timeline_seq IS '같은 시각의 메시지·손님 안내를 함께 정렬하는 삽입 순번(API-043, DEC-14)';
