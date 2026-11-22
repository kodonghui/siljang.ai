-- TASK-028 실제 서버 역할의 쓰기/차단 확인. 합성 행만 만들고 전체를 ROLLBACK한다.
-- psql -v runtime_role=<기존 서버 역할> -f tools/staging-kakao-runtime-probe.sql
BEGIN;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '3s';
CREATE TEMP TABLE siljang_runtime_probe_role (name text NOT NULL) ON COMMIT DROP;
INSERT INTO siljang_runtime_probe_role VALUES (:'runtime_role');
DO $probe$
DECLARE
  original_role text := current_user;
  target_role text;
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
BEGIN
  SELECT name INTO STRICT target_role FROM siljang_runtime_probe_role;
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
  RAISE NOTICE 'runtime_probe: allowed_writes=true blocked_writes=5 rollback_required=true';
END
$probe$;
ROLLBACK;
