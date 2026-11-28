-- 임대한 장부 쓰기에만 Vault의 앱 암호문을 반환한다. 평문 토큰은 DB에 없다.
CREATE FUNCTION siljang_ledger_private.read_leased_ledger_credential(p_shop uuid, p_link uuid, p_write uuid, p_lease timestamptz)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE v_ref text; v_envelope text;
BEGIN
  IF p_shop IS NULL OR p_link IS NULL OR p_write IS NULL OR p_lease IS NULL OR NOT pg_catalog.isfinite(p_lease) OR p_lease <= pg_catalog.statement_timestamp() THEN RETURN NULL; END IF;
  SELECT l.credential_ref INTO v_ref FROM public.ledger_links l
    JOIN public.ledger_writes w ON w.shop_id=l.shop_id
    WHERE l.shop_id=p_shop AND l.id=p_link AND l.status IN ('linked','auth_lost')
      AND l.write_lease_id=p_write AND l.write_lease_until=p_lease
      AND w.id=p_write AND ((w.status IN ('pending','retrying','alerted') AND w.next_attempt_at=p_lease) OR (w.status='written' AND w.audit_due_at=p_lease));
  IF NOT FOUND OR pg_catalog.to_regclass('vault.decrypted_secrets') IS NULL THEN RETURN NULL; END IF;
  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id::text=$1 AND name=$2'
    INTO v_envelope USING v_ref, 'siljang-ledger:'||p_shop::text||':'||p_link::text;
  IF v_envelope !~ '^v[1-9][0-9]{0,2}:[A-Za-z0-9_-]{39,}$' OR length(v_envelope)>12000 THEN RETURN NULL; END IF;
  RETURN v_envelope;
END
$fn$;
REVOKE ALL ON FUNCTION siljang_ledger_private.read_leased_ledger_credential(uuid,uuid,uuid,timestamptz) FROM PUBLIC;
DO $block$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=role_name) THEN
      EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION siljang_ledger_private.read_leased_ledger_credential(uuid,uuid,uuid,timestamptz) FROM %I',role_name);
    END IF;
  END LOOP;
END
$block$;
