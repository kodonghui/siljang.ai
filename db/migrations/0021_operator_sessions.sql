-- 0021_operator_sessions: 운영자 세션과 운영자 로그인 실패(TASK-021, 06 DEC-27이 OPEN-6을 닫음)
-- (동희님 2026-11-16 17:01 무렵 Claude Code 채팅 답 "추천 모두 승인": TASK-003 운영자 인증은 Supabase Auth의 TOTP 2단계 인증. docs/05-erd/README.md 11절)
-- 운영자 세션(TBL-059): 쿠키 값(무작위 32바이트)은 남기지 않고 SHA-256만 둔다. 로그인한 때부터 12시간 고정(06 DEC-26)을 CHECK로 지킨다.
-- 운영자 로그인 실패(TBL-060): 이메일(소문자)의 HMAC만 두고 15분에 5번을 넘으면 429(06 DEC-16). 15분 지난 행은 로그인 시도 때 앱이 지운다.
-- 0020_awaiting_payment_limit.sql 뒤에 한 트랜잭션으로 적용: psql -1 -v ON_ERROR_STOP=1 -f db/migrations/0021_operator_sessions.sql
-- 적용한 결과는 db/schema.sql과 같음(check_erd.py D2). 새 테이블 둘이라 있는 행은 바뀌지 않음.

-- TBL-059 operator_sessions (CTX-007) ← SPEC-001 | terms: none
CREATE TABLE operator_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 세션 ID
  operator_id  uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT, -- 로그인한 운영자
  token_hash   text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'), -- 세션 쿠키 siljang_operator 값(무작위 32바이트)의 SHA-256 소문자 16진수. 쿠키 값은 남기지 않음(REQ-135)
  created_at   timestamptz NOT NULL,                  -- 로그인한 시각
  expires_at   timestamptz NOT NULL,                  -- 끝나는 시각. 로그인한 때부터 12시간이고 쓴다고 늘지 않음(06 DEC-26)
  ended_at     timestamptz,                           -- 로그아웃으로 끝낸 시각
  CONSTRAINT operator_sessions_token_uq UNIQUE (token_hash), -- 쿠키 하나에 세션 하나
  CONSTRAINT operator_sessions_fixed_chk CHECK (expires_at = created_at + interval '12 hours'), -- 늘리지 않음(06 DEC-26)
  CONSTRAINT operator_sessions_ended_chk CHECK (ended_at IS NULL OR ended_at >= created_at) -- 로그인 뒤에만 끝냄
);
CREATE INDEX operator_sessions_operator_idx ON operator_sessions (operator_id); -- 운영자마다 세션
CREATE INDEX operator_sessions_expires_idx ON operator_sessions (expires_at); -- 지난 세션 지우기(로그인 때)
COMMENT ON TABLE operator_sessions IS 'TBL-059 운영자 세션: 운영자 로그인(API-004)이 만들고 로그아웃(API-006)이 끝냄. 로그인한 때부터 12시간(06 DEC-26, DEC-27)';

-- TBL-060 operator_login_failures (CTX-007) ← SPEC-001 | terms: none
CREATE TABLE operator_login_failures (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- 시도 한 번
  email_hash    text NOT NULL CHECK (email_hash ~ '^[0-9a-f]{64}$'), -- 넣은 이메일(앞뒤 공백을 빼고 소문자)의 HMAC-SHA256 소문자 16진수. 이메일 글은 남기지 않음
  attempted_at  timestamptz NOT NULL                   -- 시도를 시작한 시각. 성공하면 그 이메일의 행을 모두 지우고, 인증 서비스가 답하지 않으면 그 행을 지움. 남은 행이 실패(06 DEC-16)
);
CREATE INDEX operator_login_failures_email_idx ON operator_login_failures (email_hash, attempted_at); -- 이메일마다 15분 안의 실패 세기
CREATE INDEX operator_login_failures_attempted_idx ON operator_login_failures (attempted_at); -- 15분 지난 행 지우기(로그인 시도 때)
COMMENT ON TABLE operator_login_failures IS 'TBL-060 운영자 로그인 실패: 이메일마다 15분에 5번을 넘으면 429(06 DEC-16). 15분 지난 행은 로그인 시도 때 지움(DEC-27)';

COMMENT ON COLUMN operator_sessions.id IS '세션 ID';
COMMENT ON COLUMN operator_sessions.operator_id IS '로그인한 운영자';
COMMENT ON COLUMN operator_sessions.token_hash IS '세션 쿠키 siljang_operator 값(무작위 32바이트)의 SHA-256 소문자 16진수. 쿠키 값은 남기지 않음(REQ-135)';
COMMENT ON COLUMN operator_sessions.created_at IS '로그인한 시각';
COMMENT ON COLUMN operator_sessions.expires_at IS '끝나는 시각. 로그인한 때부터 12시간이고 쓴다고 늘지 않음(06 DEC-26)';
COMMENT ON COLUMN operator_sessions.ended_at IS '로그아웃으로 끝낸 시각';
COMMENT ON COLUMN operator_login_failures.id IS '시도 한 번';
COMMENT ON COLUMN operator_login_failures.email_hash IS '넣은 이메일(앞뒤 공백을 빼고 소문자)의 HMAC-SHA256 소문자 16진수. 이메일 글은 남기지 않음';
COMMENT ON COLUMN operator_login_failures.attempted_at IS '시도를 시작한 시각. 성공하면 그 이메일의 행을 모두 지우고, 인증 서비스가 답하지 않으면 그 행을 지움. 남은 행이 실패(06 DEC-16)';
