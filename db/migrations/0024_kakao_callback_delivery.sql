-- TASK-028. 수신 행 하나에 암호화한 콜백 주소와 실행 기한을 둡니다.
ALTER TABLE messages
  ADD COLUMN kakao_callback_enc text,
  ADD COLUMN kakao_callback_deadline_at timestamptz,
  ADD COLUMN kakao_callback_claim_until timestamptz,
  ADD CONSTRAINT messages_kakao_callback_chk CHECK (
    (kakao_callback_enc IS NULL AND kakao_callback_deadline_at IS NULL AND kakao_callback_claim_until IS NULL)
    OR (direction = 'inbound'
        AND kakao_callback_enc IS NOT NULL
        AND kakao_callback_enc ~ '^v[1-9][0-9]{0,2}:[A-Za-z0-9_-]{39,}$'
        AND kakao_callback_deadline_at IS NOT NULL
        AND kakao_callback_deadline_at > created_at
        AND kakao_callback_deadline_at <= created_at + interval '55 seconds'
        AND (kakao_callback_claim_until IS NULL OR kakao_callback_claim_until <= kakao_callback_deadline_at))
  );
CREATE INDEX messages_kakao_callback_deadline_idx ON messages (kakao_callback_deadline_at) WHERE kakao_callback_enc IS NOT NULL;
COMMENT ON COLUMN messages.kakao_callback_enc IS '수신 메시지에 연결한 콜백 주소의 암호화 봉투(SPEC-017, DEC-29)';
COMMENT ON COLUMN messages.kakao_callback_deadline_at IS '수신 뒤 최대 55초의 콜백 처리 기한';
COMMENT ON COLUMN messages.kakao_callback_claim_until IS '같은 콜백을 중복 실행하지 않도록 잡은 끝 시각';
