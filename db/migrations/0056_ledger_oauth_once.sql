-- 구글 인가 코드는 교환 시도 전에 HMAC 지문만 24시간 보관해 재교환을 막는다.
CREATE FUNCTION siljang_ledger_private.consume_owner_ledger_code(p_shop uuid,p_owner uuid,p_hash text)
RETURNS boolean LANGUAGE plpgsql STRICT SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE inserted boolean;
BEGIN
  IF p_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid code fingerprint' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shops s WHERE s.id=p_shop AND s.owner_id=p_owner) THEN RETURN false; END IF;
  INSERT INTO public.request_keys(actor_kind,actor_id,request_key,command,request_hash,state,done_at,response_status,response_code)
  VALUES ('owner',p_owner,'lc-' || left(p_hash,61),'LEDGER-OAUTH-CODE',p_hash,'done',clock_timestamp(),422,'google_authorization_failed')
  ON CONFLICT DO NOTHING RETURNING true INTO inserted;
  RETURN COALESCE(inserted,false);
END
$fn$;
REVOKE ALL ON FUNCTION siljang_ledger_private.consume_owner_ledger_code(uuid,uuid,text) FROM PUBLIC;
DO $revoke$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=role_name) THEN
      EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION siljang_ledger_private.consume_owner_ledger_code(uuid,uuid,text) FROM %I',role_name);
    END IF;
  END LOOP;
END
$revoke$;
