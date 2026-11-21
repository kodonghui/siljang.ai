-- 생성: tools/build-staging-db-update.py. 이 파일을 직접 고치지 않는다.
-- 원본 SQL 커밋: fab4d3dde7dd7207a02baa76cd4673e5caccddf0
-- 권한 파일 SHA-256: 0f23afddd02bbfbf74b1669b1099337cbc7af7de6f3ad73974117e6fafb40018
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = public, pg_temp;
SELECT pg_advisory_xact_lock(hashtextextended('siljang:staging:migrations', 0));
DO $siljang_update$
BEGIN
IF to_regclass('siljang_deploy.migrations') IS NULL THEN RAISE EXCEPTION 'migration_ledger_missing'; END IF;
IF EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE NOT (filename = ANY(ARRAY['0001_init.sql','0002_refund_path.sql','0003_order_input_lock.sql','0004_kakao_event_path.sql','0005_retention_split.sql','0006_account_encryption_access_log.sql','0007_consent_allergy_photo.sql','0008_wait_ends_due_cap.sql','0009_refund_excess_file_queue.sql','0010_refund_calc_remake.sql','0011_amount_confirm_standard_quote.sql','0012_request_keys_questions_extras.sql','0013_ai_calls_skill_keys.sql','0014_shop_identity_settings.sql','0015_issue_kind_reporter.sql','0016_refund_counted_arrived.sql','0017_ai_tool_calls_called_idx.sql','0018_glossary_terms.sql','0019_disclosure_policy_order_amount.sql','0020_awaiting_payment_limit.sql','0021_operator_sessions.sql','0022_operator_auth_binding.sql','0023_kakao_trial_contract_comments.sql','0024_kakao_callback_delivery.sql','0025_owner_sessions.sql']::text[]))) THEN RAISE EXCEPTION 'migration_ledger_unknown_file'; END IF;
IF (SELECT count(*) <> count(DISTINCT filename) OR coalesce(max(left(filename, 4)::int), 0) <> count(*) FROM siljang_deploy.migrations) THEN RAISE EXCEPTION 'migration_ledger_not_prefix'; END IF;
IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siljang_runtime' AND rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole) THEN RAISE EXCEPTION 'runtime_role_not_limited'; END IF;
IF has_table_privilege('siljang_runtime', 'public.access_logs', 'SELECT,UPDATE,TRUNCATE') OR has_any_column_privilege('siljang_runtime', 'public.access_logs', 'UPDATE') THEN RAISE EXCEPTION 'access_log_privilege_drift'; END IF;
IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.access_logs'::regclass AND attnum > 0 AND NOT attisdropped AND attname <> 'accessed_at' AND has_column_privilege('siljang_runtime', 'public.access_logs', attname, 'SELECT')) THEN RAISE EXCEPTION 'access_log_column_drift'; END IF;
IF EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0001_init.sql' AND sha256 IS DISTINCT FROM 'b7cdda85bb2fae6c9fd943c21587ed758b5c3260b397cc9c4a70ed99ddf60e97') THEN RAISE EXCEPTION 'migration_hash_mismatch'; END IF;
IF NOT EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0001_init.sql') THEN RAISE EXCEPTION 'migration_baseline_missing'; END IF;
IF EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0002_refund_path.sql' AND sha256 IS DISTINCT FROM 'e74e58c2a66aaf66663f7af5c263dd30aacbb7f151437ffcb696fab290285443') THEN RAISE EXCEPTION 'migration_hash_mismatch'; END IF;
IF NOT EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0002_refund_path.sql') THEN RAISE EXCEPTION 'migration_baseline_missing'; END IF;
IF EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0003_order_input_lock.sql' AND sha256 IS DISTINCT FROM 'c8a00535bc12f5d73ad65fdb4e9e50cd22614a209b84f260d89bf0b019de9d5a') THEN RAISE EXCEPTION 'migration_hash_mismatch'; END IF;
IF NOT EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0003_order_input_lock.sql') THEN RAISE EXCEPTION 'migration_baseline_missing'; END IF;
IF EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0004_kakao_event_path.sql' AND sha256 IS DISTINCT FROM '3039349f30e8d597082dd441a5e1c3bbd483bc304c0f08e1687f9779c2574501') THEN RAISE EXCEPTION 'migration_hash_mismatch'; END IF;
IF NOT EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0004_kakao_event_path.sql') THEN RAISE EXCEPTION 'migration_baseline_missing'; END IF;
IF EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0005_retention_split.sql' AND sha256 IS DISTINCT FROM '7a8dced860ef1f5bd503a8baddac4e961259a8c2e71b41205745717edd891a4f') THEN RAISE EXCEPTION 'migration_hash_mismatch'; END IF;
IF NOT EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0005_retention_split.sql') THEN RAISE EXCEPTION 'migration_baseline_missing'; END IF;
IF EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0006_account_encryption_access_log.sql' AND sha256 IS DISTINCT FROM '8bf76b73dfbe20e72b33fa80e77a9cbfe471d91f0a8bb88075ca821beb5eb902') THEN RAISE EXCEPTION 'migration_hash_mismatch'; END IF;
IF NOT EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0006_account_encryption_access_log.sql') THEN RAISE EXCEPTION 'migration_baseline_missing'; END IF;
IF EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0007_consent_allergy_photo.sql' AND sha256 IS DISTINCT FROM 'e1704f46609d9f8c68dc7829865be4a0d1c194d8a3bc79b846b9295541ad55a6') THEN RAISE EXCEPTION 'migration_hash_mismatch'; END IF;
IF NOT EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0007_consent_allergy_photo.sql') THEN RAISE EXCEPTION 'migration_baseline_missing'; END IF;
IF EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0008_wait_ends_due_cap.sql' AND sha256 IS DISTINCT FROM '3a4e677c61f1478f72dbaa2ff118cd6ec29d678be8211d9f2aee7fa37a5ddf51') THEN RAISE EXCEPTION 'migration_hash_mismatch'; END IF;
IF NOT EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0008_wait_ends_due_cap.sql') THEN RAISE EXCEPTION 'migration_baseline_missing'; END IF;
IF EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0009_refund_excess_file_queue.sql' AND sha256 IS DISTINCT FROM '689b437cd6d6b464acde4f7d69370eb5a32bed8f8bc422df995bac3df67aeb67') THEN RAISE EXCEPTION 'migration_hash_mismatch'; END IF;
IF NOT EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0009_refund_excess_file_queue.sql') THEN RAISE EXCEPTION 'migration_baseline_missing'; END IF;
IF EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0010_refund_calc_remake.sql' AND sha256 IS DISTINCT FROM 'd12996be012fc6f339eefc68e31d4d6942559e6eb032caa05a93ce6f0b11d50e') THEN RAISE EXCEPTION 'migration_hash_mismatch'; END IF;
IF NOT EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0010_refund_calc_remake.sql') THEN RAISE EXCEPTION 'migration_baseline_missing'; END IF;
IF EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0011_amount_confirm_standard_quote.sql' AND sha256 IS DISTINCT FROM 'd714012b9a573afc0ba24c17f5a746086190ae9dc8ea3b7856ea9508a269b0b3') THEN RAISE EXCEPTION 'migration_hash_mismatch'; END IF;
IF NOT EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0011_amount_confirm_standard_quote.sql') THEN RAISE EXCEPTION 'migration_baseline_missing'; END IF;
IF EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0012_request_keys_questions_extras.sql' AND sha256 IS DISTINCT FROM 'e13978d3a07970bf35cb28b4f08d8dcbd11941da9bcd40f6bc2d1abca85c77dc') THEN RAISE EXCEPTION 'migration_hash_mismatch'; END IF;
IF NOT EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0012_request_keys_questions_extras.sql') THEN RAISE EXCEPTION 'migration_baseline_missing'; END IF;
IF EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0013_ai_calls_skill_keys.sql' AND sha256 IS DISTINCT FROM '7e0738c3acc92162d548fe10661add86c69ed0abc3d76e89fe49b0d3427c336f') THEN RAISE EXCEPTION 'migration_hash_mismatch'; END IF;
IF NOT EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0013_ai_calls_skill_keys.sql') THEN RAISE EXCEPTION 'migration_baseline_missing'; END IF;
IF EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0014_shop_identity_settings.sql' AND sha256 IS DISTINCT FROM '1cf8e9fdffaf75088c849c76a3d4a900989aaeca43cf113f3a1a863e3cf2c799') THEN RAISE EXCEPTION 'migration_hash_mismatch'; END IF;
IF NOT EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0014_shop_identity_settings.sql') THEN RAISE EXCEPTION 'migration_baseline_missing'; END IF;
IF EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0015_issue_kind_reporter.sql' AND sha256 IS DISTINCT FROM '1986e5827d6a1b14df4b86e20d5834b8045c9ebc4019e6b2e65976c0eb7f0af7') THEN RAISE EXCEPTION 'migration_hash_mismatch'; END IF;
IF NOT EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0015_issue_kind_reporter.sql') THEN RAISE EXCEPTION 'migration_baseline_missing'; END IF;
IF EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0016_refund_counted_arrived.sql' AND sha256 IS DISTINCT FROM '567fb804cfc73dafde62f85cd9fd01fdf51d86be01a412ac5451dcde7fab7d55') THEN RAISE EXCEPTION 'migration_hash_mismatch'; END IF;
IF NOT EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0016_refund_counted_arrived.sql') THEN RAISE EXCEPTION 'migration_baseline_missing'; END IF;
IF EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0017_ai_tool_calls_called_idx.sql' AND sha256 IS DISTINCT FROM 'adbe135724dfa0f1c55106ba23613204ba0b971091ac7713560f7ea604554f7d') THEN RAISE EXCEPTION 'migration_hash_mismatch'; END IF;
IF NOT EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0017_ai_tool_calls_called_idx.sql') THEN RAISE EXCEPTION 'migration_baseline_missing'; END IF;
IF EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0018_glossary_terms.sql' AND sha256 IS DISTINCT FROM '87be31f656db1ff212c623a14b32f4750117f17d6f933e77a97c35691a40b15b') THEN RAISE EXCEPTION 'migration_hash_mismatch'; END IF;
IF NOT EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0018_glossary_terms.sql') THEN RAISE EXCEPTION 'migration_baseline_missing'; END IF;
IF EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0019_disclosure_policy_order_amount.sql' AND sha256 IS DISTINCT FROM '412f3d2c7529e62726adcfcaa4ef1aabd65bee89e57a2fa06a8da31fca04dc5f') THEN RAISE EXCEPTION 'migration_hash_mismatch'; END IF;
IF NOT EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0019_disclosure_policy_order_amount.sql') THEN RAISE EXCEPTION 'migration_baseline_missing'; END IF;
IF EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0020_awaiting_payment_limit.sql' AND sha256 IS DISTINCT FROM '4c745fbc222057fdcdb6e1788a9b069f16b1724cc8dfa196d1c4de4d32ba4ccd') THEN RAISE EXCEPTION 'migration_hash_mismatch'; END IF;
IF NOT EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0020_awaiting_payment_limit.sql') THEN RAISE EXCEPTION 'migration_baseline_missing'; END IF;
IF EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0021_operator_sessions.sql' AND sha256 IS DISTINCT FROM 'dbea0e998d47139cd72b381bc14faa1cd16b130bac7a4afe2cd64587046227d3') THEN RAISE EXCEPTION 'migration_hash_mismatch'; END IF;
IF NOT EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0021_operator_sessions.sql') THEN RAISE EXCEPTION 'migration_baseline_missing'; END IF;
IF EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0022_operator_auth_binding.sql' AND sha256 IS DISTINCT FROM '4d03e5dceb0da47cb131dba6d3f140bdc1946ae324b984760e2d15cef227c417') THEN RAISE EXCEPTION 'migration_hash_mismatch'; END IF;
IF NOT EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0022_operator_auth_binding.sql') THEN RAISE EXCEPTION 'migration_baseline_missing'; END IF;
IF EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0023_kakao_trial_contract_comments.sql' AND sha256 IS DISTINCT FROM 'cd5cc93dd42f3ee0b716aee9e1fad2d2b7b736bb74278c94d059ad992d4932a5') THEN RAISE EXCEPTION 'migration_hash_mismatch'; END IF;
IF EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0024_kakao_callback_delivery.sql' AND sha256 IS DISTINCT FROM '4125f2bdc26ceb59ebf27a64d49dba18b45a09e4b459ad94ab630ab51e6c6cda') THEN RAISE EXCEPTION 'migration_hash_mismatch'; END IF;
IF EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0025_owner_sessions.sql' AND sha256 IS DISTINCT FROM '8cf014f4ae4ef854a90377ea75d263d77c490cecf580afbd01b41a0309c2a1ec') THEN RAISE EXCEPTION 'migration_hash_mismatch'; END IF;
IF NOT EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0023_kakao_trial_contract_comments.sql') THEN
-- TASK-011. 계약에서 확인한 값의 의미를 스키마 주석과 맞춥니다.
COMMENT ON COLUMN messages.kakao_message_id IS '수신 카카오 메시지의 HMAC-SHA256 중복 확인 키. 정규 봇 ID·사용자 키·블록 ID·발화·수신 2초 구간에서 만듦(REQ-132, 06 DEC-28)';
COMMENT ON COLUMN kakao_channels.bot_id IS '오픈빌더 설정의 기본 봇 ID. 수신 값의 끝 느낌표 하나를 제거한 뒤 가게를 찾음(SPEC-017, 06 DEC-28)';

INSERT INTO siljang_deploy.migrations (filename, source_commit, sha256, applied_at) VALUES ('0023_kakao_trial_contract_comments.sql', 'fab4d3dde7dd7207a02baa76cd4673e5caccddf0', 'cd5cc93dd42f3ee0b716aee9e1fad2d2b7b736bb74278c94d059ad992d4932a5', now());
END IF;
IF NOT EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0024_kakao_callback_delivery.sql') THEN
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

INSERT INTO siljang_deploy.migrations (filename, source_commit, sha256, applied_at) VALUES ('0024_kakao_callback_delivery.sql', 'fab4d3dde7dd7207a02baa76cd4673e5caccddf0', '4125f2bdc26ceb59ebf27a64d49dba18b45a09e4b459ad94ab630ab51e6c6cda', now());
END IF;
IF NOT EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = '0025_owner_sessions.sql') THEN
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

INSERT INTO siljang_deploy.migrations (filename, source_commit, sha256, applied_at) VALUES ('0025_owner_sessions.sql', 'fab4d3dde7dd7207a02baa76cd4673e5caccddf0', '8cf014f4ae4ef854a90377ea75d263d77c490cecf580afbd01b41a0309c2a1ec', now());
END IF;
-- TASK-173: 사장님 세션과 카카오 수신·콜백에 필요한 서버 역할 권한.
-- psql -v runtime_role=<기존 서버 역할> -f tools/staging-login-callback-grants.sql
-- 실제 역할은 새로 만들지 않는다. 접속기록·운영 기록의 권한은 바꾸지 않는다.
GRANT SELECT, INSERT, UPDATE ON owners, customers, consultations, messages TO "siljang_runtime";
-- 로그인할 때 기한 지난 세션을 정리하므로 DELETE도 필요하다(owner-session.ts).
GRANT SELECT, INSERT, UPDATE, DELETE ON owner_sessions TO "siljang_runtime";
GRANT SELECT ON shops, kakao_channels TO "siljang_runtime";
-- FOR SHARE에는 열 하나의 UPDATE 권한이 필요하다. 앱의 이 경로는 ID를 바꾸지 않는다.
GRANT UPDATE (id) ON shops, kakao_channels TO "siljang_runtime";
-- TASK-028: AI 실패/콜백 만료의 질문 참조·할 일·발신 대기 알림.
-- 이 경로는 새 행만 넣는다. 기존 건의 수정·삭제나 운영 기록/접속기록 권한은 더하지 않는다.
GRANT SELECT, INSERT ON handoffs, handoff_questions, owner_tasks, owner_alerts TO "siljang_runtime";
-- 사장님 기다림을 가게의 답하는 시간 안에서 계산한다.
GRANT SELECT ON business_calendars TO "siljang_runtime";
-- TASK-028: 누적 비용 확인만 한다. 호출 기록의 추가/수정/삭제 권한은 주지 않는다.
GRANT SELECT ON ai_calls TO "siljang_runtime";
-- TASK-028: 번호를 가린 본문과 원본 최소 정보는 같은 수신 트랜잭션에서 새로 남긴다.
GRANT SELECT, INSERT ON masked_values TO "siljang_runtime";
-- TASK-028: 미전달 일반 글은 다음 응답/콜백에 전한 뒤 상태와 시각만 고친다.
GRANT SELECT, UPDATE (status, sent_at) ON notifications TO "siljang_runtime";

IF to_regclass('public.owner_sessions') IS NULL OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'messages' AND column_name IN ('kakao_callback_enc','kakao_callback_deadline_at','kakao_callback_claim_until')) <> 3 THEN RAISE EXCEPTION 'migration_schema_incomplete'; END IF;
END;
$siljang_update$;
COMMIT;
SELECT count(*)::int AS migration_count, to_regclass('public.owner_sessions') IS NOT NULL AS owner_sessions_present, has_table_privilege('siljang_runtime', 'public.owner_sessions', 'UPDATE') AS owner_session_update, has_table_privilege('siljang_runtime', 'public.access_logs', 'SELECT') AS access_log_full_select FROM siljang_deploy.migrations;
