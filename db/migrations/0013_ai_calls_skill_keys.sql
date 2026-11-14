-- 0013_ai_calls_skill_keys: AI 호출 순번과 다시 한 종류, 스킬 키 버전과 '연결 확인 중' 선점(설계 재검토 M16·M18, 2026-11-14,
-- 2026-11-13 20:59 결정 카드 '모두 지금 고침 (추천)', 검토자의 고치는 방향대로)
-- M16(RC-07): ai_calls.attempt의 위 끝(3)을 없애 차례 안 호출 순번(1부터)으로 두고, 다시 한 종류(call_kind: 처음·도구 뒤 이어 하기·다시 하기·
--     다시 쓰기)를 따로 둠. 처음은 순번 1에만(ai_calls_kind_chk). 차례마다 호출 상한(8번)은 AI-1이 호출 전에 막고, 막은 이유는
--     fallback_reason 'call_limit'으로 남김(04 AI-1, 4절 A35).
-- M18(RD-06): 연결마다 스킬 키 버전(skill_key_version)·만든 시각(skill_key_issued_at)·바로 앞 버전 키를 받는 끝(previous_key_until, 바꾼 때부터
--     24시간까지, kakao_channels_prev_key_chk). 키와 연결 문구는 서버 시크릿으로 만들어 저장하지 않음(06 DEC-08, 해시도 두지 않음, 4절 A36).
--     '연결 확인 중' 선점이 풀리는 시각(claim_expires_at, 마지막 저장이나 연결 확인 시작에서 30분, kakao_channels_claim_chk, REQ-238).
-- M16(RB-14): 알레르기 답 컬럼 설명의 요구사항을 REQ-142에서 REQ-236으로. 연결 확인 컬럼 설명의 '테스트 메시지'를 '연결 문구'로.
-- 0012_request_keys_questions_extras.sql 뒤에 한 트랜잭션으로 적용: psql -1 -v ON_ERROR_STOP=1 -f db/migrations/0013_ai_calls_skill_keys.sql
-- 적용한 결과는 db/schema.sql과 같음(check_erd.py D2). 아직 운영 데이터가 없어(10단계 전) 옮길 행이 없음. 있으면 아래 UPDATE가 옛 값을
-- 옮김: 지난 호출은 순번 1을 처음, 나머지를 다시 하기로, 스킬 키는 버전 1을 연결을 만든 시각에 만든 것으로, 연결 확인 중인 연결은
-- 연결 확인 시작(없으면 만든 시각)에서 30분을 선점이 풀리는 시각으로.

-- TBL-048 ai_calls: 차례 안 호출 순번(위 끝 없음)과 다시 한 종류, 호출 상한 이유
ALTER TABLE ai_calls
  DROP CONSTRAINT ai_calls_attempt_check,
  DROP CONSTRAINT ai_calls_fallback_reason_check,
  ADD COLUMN call_kind text NOT NULL DEFAULT 'first' CHECK (call_kind IN ('first', 'after_tool', 'retry', 'regenerate'));
UPDATE ai_calls SET call_kind = 'retry' WHERE attempt > 1;
ALTER TABLE ai_calls
  ADD CONSTRAINT ai_calls_attempt_check CHECK (attempt >= 1),
  ADD CONSTRAINT ai_calls_fallback_reason_check CHECK (fallback_reason IN ('schema_invalid', 'amount_mismatch', 'forbidden_phrase', 'clause_mismatch', 'placeholder_or_ad', 'card_not_allowed', 'empty_answer', 'model_error', 'timeout', 'cost_limit', 'call_limit')),
  ADD CONSTRAINT ai_calls_kind_chk CHECK ((call_kind = 'first') = (attempt = 1));

-- TBL-004 kakao_channels: 스킬 키 버전과 앞 버전 키를 받는 끝, '연결 확인 중' 선점이 풀리는 시각
ALTER TABLE kakao_channels
  ADD COLUMN skill_key_version smallint NOT NULL DEFAULT 1 CHECK (skill_key_version BETWEEN 1 AND 10000),
  ADD COLUMN skill_key_issued_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN previous_key_until timestamptz,
  ADD COLUMN claim_expires_at timestamptz;
UPDATE kakao_channels SET skill_key_issued_at = created_at;
UPDATE kakao_channels SET claim_expires_at = coalesce(check_started_at, created_at) + interval '30 minutes' WHERE status = 'pending';
ALTER TABLE kakao_channels
  ADD CONSTRAINT kakao_channels_prev_key_chk CHECK (previous_key_until IS NULL OR (skill_key_version >= 2 AND previous_key_until <= skill_key_issued_at + interval '24 hours')),
  ADD CONSTRAINT kakao_channels_claim_chk CHECK ((status = 'pending') = (claim_expires_at IS NOT NULL));

-- 컬럼 설명(schema.sql 끝의 설명과 같음)
COMMENT ON COLUMN kakao_channels.check_started_at IS '''연결 확인''을 누른 시각(10분 안에 연결 문구와 버튼 블록 다섯이 와야 함)';
COMMENT ON COLUMN kakao_channels.test_user_key IS '연결 확인 때 연결 문구를 보낸 사용자 키. 시험 버튼과 시험 안내를 이 사용자로 함(SPEC-008, REQ-238)';
COMMENT ON COLUMN kakao_channels.skill_key_version IS '스킬 키 버전. 키는 서버 시크릿·연결 ID·버전으로 만들고 저장하지 않음(06단계 DEC-08). 사장님이 바꿀 때마다 1 늘림(REQ-237)';
COMMENT ON COLUMN kakao_channels.skill_key_issued_at IS '지금 버전의 스킬 키를 만든 시각(REQ-237)';
COMMENT ON COLUMN kakao_channels.previous_key_until IS '바로 앞 버전의 키도 받는 끝 시각: 바꾼 때부터 24시간까지. 바로 끊었거나 바꾼 적이 없으면 비움(REQ-237)';
COMMENT ON COLUMN kakao_channels.claim_expires_at IS '''연결 확인 중'' 선점이 풀리는 시각: 마지막 저장이나 연결 확인 시작에서 30분. 지난 뒤 다른 가게가 같은 봇을 넣으면 이 연결은 ''연결 안 됨''(REQ-238)';
COMMENT ON COLUMN ai_calls.attempt IS '차례 안 호출 순번(1부터, 위 끝 없음). 차례마다 호출 상한(8번)은 AI-1이 호출 전에 막음';
COMMENT ON COLUMN ai_calls.call_kind IS '다시 한 종류: 처음·도구 뒤 이어 하기·다시 하기(시간 초과·429·5xx)·다시 쓰기(서버 확인을 지나지 못한 답·빈 답). 처음은 순번 1에만';
COMMENT ON COLUMN ai_calls.fallback_reason IS '정해진 문장이나 에스컬레이션을 쓴 이유(AI-1의 서버 확인·실패·차례마다 호출 상한)';
COMMENT ON COLUMN order_drafts.allergy_answer IS '알레르기 답(''없음''도 답, REQ-200). 알레르기 정보에 동의한 뒤 전용 블록으로 AI를 거치지 않고 받음(SPEC-075, REQ-202). AI로 보내지 않고(REQ-204) 이 주문 밖에서 쓰지 않음(REQ-236)';
COMMENT ON COLUMN order_details.allergy_answer IS '알레르기 답. 알레르기 정보에 동의한 주문에만(REQ-200, REQ-203). 이 주문 밖에서 쓰지 않고 장부에 적지 않고 AI로 보내지 않음(REQ-236, REQ-204, SPEC-064). 주문이 끝나고 30일 뒤 지움(SPEC-065)';
