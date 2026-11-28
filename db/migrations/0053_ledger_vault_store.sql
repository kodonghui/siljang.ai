-- 가게 소유와 연결을 잠근 뒤 앱이 만든 암호문만 Vault에 저장한다.
CREATE FUNCTION siljang_ledger_private.store_ledger_credential(p_shop uuid,p_owner uuid,p_link uuid,p_envelope text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE old_ref text; new_ref uuid;
BEGIN
  IF p_envelope IS NULL OR length(p_envelope) > 12000 OR p_envelope !~ '^v[1-9][0-9]{0,2}:[A-Za-z0-9_-]{39,}$' THEN
    RAISE EXCEPTION 'invalid ledger envelope' USING ERRCODE='22023';
  END IF;
  PERFORM s.id FROM public.shops s WHERE s.id=p_shop AND s.owner_id=p_owner FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT l.credential_ref INTO old_ref FROM public.ledger_links l
    WHERE l.shop_id=p_shop AND l.id=p_link AND l.status<>'unlinked' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  EXECUTE 'DELETE FROM vault.secrets WHERE id::text=$1 AND name=$2' USING old_ref, 'siljang-ledger:'||p_shop::text||':'||p_link::text;
  EXECUTE 'SELECT vault.create_secret($1,$2)' INTO new_ref USING p_envelope, 'siljang-ledger:'||p_shop::text||':'||p_link::text;
  UPDATE public.ledger_links SET credential_ref=new_ref::text WHERE shop_id=p_shop AND id=p_link;
  RETURN true;
END
$fn$;
REVOKE ALL ON FUNCTION siljang_ledger_private.store_ledger_credential(uuid,uuid,uuid,text) FROM PUBLIC;
