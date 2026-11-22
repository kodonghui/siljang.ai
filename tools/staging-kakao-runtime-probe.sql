-- TASK-028 실제 서버 역할의 쓰기/차단 확인. 내부 저장점의 합성 쓰기를 되돌리고 결과만 반환한다.
-- psql -v runtime_role=<기존 서버 역할> -f tools/staging-kakao-runtime-probe.sql
-- pg_temp 함수는 현재 연결에만 있으며 공개 스키마에 남지 않는다. SQL Editor에서도 마지막 SELECT 결과를 볼 수 있다.
CREATE OR REPLACE FUNCTION pg_temp.siljang_kakao_runtime_probe(target_role text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $probe$
DECLARE
  original_role text := current_user;
  owner_id uuid := gen_random_uuid();
  shop_id uuid := gen_random_uuid();
  channel_id uuid := gen_random_uuid();
  customer_id uuid := gen_random_uuid();
  consultation_id uuid := gen_random_uuid();
  message_id uuid := gen_random_uuid();
  call_id uuid := gen_random_uuid();
  draft_id uuid;
  changed integer;
  blocked integer := 0;
  operation text;
  tag text := replace(gen_random_uuid()::text, '-', '');
  allowed boolean := false;
  failure_sqlstate text;
BEGIN
  BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = target_role AND NOT rolsuper) THEN
    RAISE EXCEPTION 'runtime_probe_target_invalid';
  END IF;
  INSERT INTO owners (id, kakao_account_id) VALUES (owner_id, -abs(('x' || left(tag, 12))::bit(48)::bigint));
  INSERT INTO shops (id, owner_id, name, contact_phone, contact_email, business_address, business_name,
    representative_name, business_reg_no, mail_order_exemption, food_license_no, food_business_type,
    license_photo_key, entrustment_terms_version, entrustment_consented_at)
    VALUES (shop_id, owner_id, '합성 권한 확인 가게', '02-000-0000', 'probe@example.com', '합성 시험 주소',
      '합성 권한 확인 가게', '합성 대표', '0000000000', '합성 시험', '합성 시험', 'bakery',
      'synthetic/probe.jpg', 'probe-v1', now());
  INSERT INTO kakao_channels (id, shop_id, bot_id, channel_public_id, status, check_started_at, claim_expires_at)
    VALUES (channel_id, shop_id, left(tag, 24), '_' || tag, 'pending', now(), now() + interval '10 minutes');
  INSERT INTO customers (id, shop_id, kakao_channel_id, kakao_user_key)
    VALUES (customer_id, shop_id, channel_id, 'synthetic-' || tag);
  INSERT INTO consultations (id, shop_id, customer_id) VALUES (consultation_id, shop_id, customer_id);
  EXECUTE format('SET LOCAL ROLE %I', target_role);

  INSERT INTO messages (id, shop_id, consultation_id, direction, author, kind, kakao_message_id, body_masked,
    kakao_callback_enc, kakao_callback_deadline_at, kakao_callback_claim_until)
    VALUES (message_id, shop_id, consultation_id, 'inbound', 'customer', 'text', tag, '합성 문구',
      'v1:' || repeat('A', 43), now() + interval '55 seconds', now() + interval '55 seconds');
  UPDATE consultations SET turn_trace_id = tag, turn_started_at = now() WHERE id = consultation_id;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION 'runtime_probe_turn_missing'; END IF;
  INSERT INTO ai_calls (id, shop_id, consultation_id, trace_id, provider, model, prompt_version, sent_at,
    input_tokens, output_tokens, cost_usd, cost_krw, result)
    VALUES (call_id, shop_id, consultation_id, tag, 'openai', 'gpt-6-luna', 'synthetic-permission-probe', now(),
      1, 1, 0, 0, 'success');
  UPDATE ai_calls SET fallback_reason = 'schema_invalid' WHERE id = call_id;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION 'runtime_probe_ai_call_missing'; END IF;
  INSERT INTO order_drafts (shop_id, consultation_id, lettering) VALUES (shop_id, consultation_id, '합성 문구')
    RETURNING id INTO draft_id;
  UPDATE order_drafts SET lettering = '합성 문구 확인', revision = revision + 1, updated_at = now() WHERE id = draft_id;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION 'runtime_probe_draft_missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM order_drafts WHERE id = draft_id AND lettering = '합성 문구 확인' AND revision = 2) THEN
    RAISE EXCEPTION 'runtime_probe_draft_result_invalid';
  END IF;
  UPDATE messages SET kakao_callback_enc = NULL, kakao_callback_deadline_at = NULL, kakao_callback_claim_until = NULL
    WHERE id = message_id;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION 'runtime_probe_callback_missing'; END IF;

  FOREACH operation IN ARRAY ARRAY[
    format('UPDATE ai_calls SET cost_krw = 1 WHERE id = %L', call_id),
    format('DELETE FROM ai_calls WHERE id = %L', call_id),
    format('UPDATE order_drafts SET customer_phone = ''02-000-0000'' WHERE id = %L', draft_id),
    format('SELECT allergy_answer FROM order_drafts WHERE id = %L', draft_id),
    format('DELETE FROM order_drafts WHERE id = %L', draft_id)
  ] LOOP
    BEGIN
      EXECUTE operation;
      RAISE EXCEPTION 'runtime_probe_unexpected_privilege';
    EXCEPTION WHEN insufficient_privilege THEN
      blocked := blocked + 1;
    END;
  END LOOP;
  IF blocked <> 5 THEN RAISE EXCEPTION 'runtime_probe_block_count_invalid'; END IF;
  EXECUTE format('SET LOCAL ROLE %I', original_role);
  allowed := true;
  -- 예상한 예외가 내부 저장점의 모든 합성 행과 권한 전환을 되돌린다. 지역 변수의 검사 결과만 남는다.
  RAISE EXCEPTION USING ERRCODE = 'ZP028', MESSAGE = 'runtime_probe_expected_rollback';
  EXCEPTION WHEN SQLSTATE 'ZP028' THEN NULL;
  WHEN OTHERS THEN failure_sqlstate := SQLSTATE;
  END;
  RETURN jsonb_build_object('allowed_writes', allowed, 'blocked_writes', blocked,
    'rollback_verified', NOT EXISTS (SELECT 1 FROM shops WHERE id = shop_id),
    'role_restored', current_user = original_role, 'failure_sqlstate', failure_sqlstate);
END
$probe$;
SELECT pg_temp.siljang_kakao_runtime_probe(:'runtime_role') AS runtime_probe;
