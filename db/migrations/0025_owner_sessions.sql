-- TASK-020 · SPEC-001 · DEC-26. 기존 기록은 바꾸지 않음.
-- TBL-061 owner_sessions (CTX-007) ← SPEC-001 | terms: none
CREATE TABLE owner_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 세션 ID
  owner_id      uuid NOT NULL REFERENCES owners (id) ON DELETE RESTRICT, -- 로그인한 사장님
  token_hash    text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'), -- 세션 쿠키 값의 SHA-256. 원래 쿠키 값은 남기지 않음(REQ-135)
  created_at    timestamptz NOT NULL, -- 로그인한 시각
  last_seen_at  timestamptz NOT NULL, -- 마지막으로 쓴 시각. 동시에 온 요청에서 뒤로 가지 않음
  expires_at    timestamptz NOT NULL, -- 마지막으로 쓴 때부터 30일(2592000초, DEC-26)
  ended_at      timestamptz, -- 로그아웃한 시각. 끝난 세션은 다시 늘리지 않음
  CONSTRAINT owner_sessions_token_uq UNIQUE (token_hash),
  CONSTRAINT owner_sessions_seen_chk CHECK (last_seen_at >= created_at),
  CONSTRAINT owner_sessions_sliding_chk CHECK (expires_at = last_seen_at + interval '2592000 seconds'),
  CONSTRAINT owner_sessions_ended_chk CHECK (ended_at IS NULL OR ended_at >= created_at)
);
CREATE INDEX owner_sessions_owner_idx ON owner_sessions (owner_id);
CREATE INDEX owner_sessions_expires_idx ON owner_sessions (expires_at);
COMMENT ON TABLE owner_sessions IS 'TBL-061 사장님 세션: 마지막 사용부터 30일로 연장하고 로그아웃 때 끝냄(DEC-26)';

COMMENT ON COLUMN owner_sessions.id IS '세션 ID';
COMMENT ON COLUMN owner_sessions.owner_id IS '로그인한 사장님';
COMMENT ON COLUMN owner_sessions.token_hash IS '세션 쿠키 값의 SHA-256. 원래 쿠키 값은 남기지 않음(REQ-135)';
COMMENT ON COLUMN owner_sessions.created_at IS '로그인한 시각';
COMMENT ON COLUMN owner_sessions.last_seen_at IS '마지막으로 쓴 시각. 동시에 온 요청에서 뒤로 가지 않음';
COMMENT ON COLUMN owner_sessions.expires_at IS '마지막으로 쓴 때부터 30일(2592000초, DEC-26)';
COMMENT ON COLUMN owner_sessions.ended_at IS '로그아웃한 시각. 끝난 세션은 다시 늘리지 않음';
