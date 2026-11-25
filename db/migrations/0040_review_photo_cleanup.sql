-- TASK-065: 붙이기 전에 중단된 후기 사진도 기존 파일 지우기 대기에서 회수한다.
BEGIN;
ALTER TABLE file_deletions DROP CONSTRAINT file_deletions_source_check;
ALTER TABLE file_deletions ADD CONSTRAINT file_deletions_source_check
  CHECK (source IN ('reference_photo','issue_photo','license_photo','review_photo'));
COMMENT ON COLUMN file_deletions.source IS '지운 참고·신고 사진과 옛 신고증 또는 중단된 후기 사진 올리기(SPEC-065)';
COMMIT;
