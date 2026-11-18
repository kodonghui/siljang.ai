-- 0022_operator_auth_binding: 운영자 행을 Supabase 사용자·TOTP 인증 수단에 묶고, 막기·2단계 인증 바꾸기가 열린 세션을 끝냄
-- (TASK-021 독립 보안 검토 후속 1·2, 06 DEC-27 '로그아웃(API-006)·계정 막기로 끝냄'. docs/05-erd/README.md 11절)
-- 1. operators.auth_user_id(Supabase Auth 사용자 ID)와 mfa_factor_id(등록 도구가 확인한 TOTP 인증 수단 ID)를 더한다. 로그인은 그 사용자의
--    그 인증 수단으로만 확인한다. 2단계 인증을 켠 시각과 인증 수단 ID는 둘 다 있거나 둘 다 없고, 인증 수단이 있으면 사용자 ID도 있다.
-- 2. operators의 막은 시각·2단계 인증을 켠 시각·인증 수단 ID·Supabase 사용자 ID 가운데 하나가 바뀌면 그 운영자의 열린 세션을 같은
--    트랜잭션에서 모두 끝낸다(트리거 operators_end_sessions). 앱 밖(대시보드·SQL)에서 막아도 듣는다.
-- 3. 있는 운영자 행에는 인증 수단 ID가 없으므로 2단계 인증을 켠 시각을 비우고(등록 도구를 다시 돌려 묶음), 열린 운영자 세션을 모두 끝낸다.
-- 0021_operator_sessions.sql 뒤에 한 트랜잭션으로 적용: psql -1 -v ON_ERROR_STOP=1 -f db/migrations/0022_operator_auth_binding.sql
-- 적용한 결과는 db/schema.sql과 같음(check_erd.py D2).

-- TBL-002 운영자: Supabase 사용자·인증 수단 ID(SPEC-001, DEC-27)
ALTER TABLE operators
  ADD COLUMN auth_user_id uuid,
  ADD COLUMN mfa_factor_id uuid;

-- 막기·2단계 인증 바꾸기가 그 운영자의 열린 세션을 끝냄(DEC-27, TASK-021 보안 검토 후속 1). 끝낸 시각은 로그인한 시각보다 앞서지 않게
-- (operator_sessions_ended_chk) 지금과 로그인한 시각 가운데 늦은 쪽. 같은 값을 다시 쓰면 끝내지 않음
CREATE FUNCTION operators_end_sessions() RETURNS trigger
LANGUAGE plpgsql AS $end_sessions$
BEGIN
  IF NEW.disabled_at IS DISTINCT FROM OLD.disabled_at
     OR NEW.mfa_enrolled_at IS DISTINCT FROM OLD.mfa_enrolled_at
     OR NEW.mfa_factor_id IS DISTINCT FROM OLD.mfa_factor_id
     OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id THEN
    UPDATE operator_sessions SET ended_at = greatest(now(), created_at)
     WHERE operator_id = NEW.id AND ended_at IS NULL;
  END IF;
  RETURN NULL;
END
$end_sessions$;
CREATE TRIGGER operators_end_sessions AFTER UPDATE OF disabled_at, mfa_enrolled_at, mfa_factor_id, auth_user_id ON operators FOR EACH ROW EXECUTE FUNCTION operators_end_sessions();

-- 있는 행: 인증 수단 ID가 없으니 2단계 인증을 켜지 않은 것으로(등록 도구를 다시 돌림). 트리거가 그 운영자의 세션을 끝냄
UPDATE operators SET mfa_enrolled_at = NULL WHERE mfa_enrolled_at IS NOT NULL;
-- 2단계 인증을 켜지 않았거나 막힌 운영자에게 남은 세션도 끝냄(0021까지는 행을 바꿔도 끝내지 않았음)
UPDATE operator_sessions SET ended_at = greatest(now(), created_at) WHERE ended_at IS NULL;

ALTER TABLE operators
  ADD CONSTRAINT operators_auth_user_uq UNIQUE (auth_user_id),
  ADD CONSTRAINT operators_mfa_chk CHECK ((mfa_enrolled_at IS NULL) = (mfa_factor_id IS NULL) AND (mfa_factor_id IS NULL OR auth_user_id IS NOT NULL));

-- 컬럼 설명(schema.sql의 COMMENT ON과 같은 글)
COMMENT ON COLUMN operators.mfa_enrolled_at IS '2단계 인증을 켠 시각. 빈 동안 운영자 화면에 못 들어옴(R2). 인증 수단 ID와 함께 있거나 함께 비고, 바뀌면 열린 세션이 끝남(DEC-27)';
COMMENT ON COLUMN operators.disabled_at IS '계정을 막은 시각. 바뀌면 그 운영자의 열린 세션이 끝남(DEC-27)';
COMMENT ON COLUMN operators.auth_user_id IS 'Supabase Auth 사용자 ID(등록 도구가 씀). 비밀번호 로그인이 돌려준 사용자가 이것과 같아야 로그인됨. 바뀌면 열린 세션이 끝남';
COMMENT ON COLUMN operators.mfa_factor_id IS '등록 도구가 확인한 Supabase TOTP 인증 수단 ID. 로그인은 이 인증 수단으로만 확인하고, 바뀌면 열린 세션이 끝남(DEC-27)';
COMMENT ON COLUMN operator_sessions.ended_at IS '끝낸 시각: 로그아웃, 또는 운영자를 막거나 2단계 인증·Supabase 사용자를 바꿈(트리거 operators_end_sessions)';
