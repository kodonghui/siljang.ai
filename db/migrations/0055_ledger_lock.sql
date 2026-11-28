-- 외부 시트를 바꾸기 전에 가게를 잠그고 화면 버전을 검사한다.
CREATE FUNCTION private.lock_owner_ledger(p_shop uuid,p_owner uuid,p_revision text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE old_id uuid; old_revision text;
BEGIN
  PERFORM s.id FROM public.shops s WHERE s.id=p_shop AND s.owner_id=p_owner FOR UPDATE;
  IF NOT FOUND THEN RETURN 'missing'; END IF;
  SELECT l.id,l.xmin::text INTO old_id,old_revision FROM public.ledger_links l WHERE l.shop_id=p_shop
    ORDER BY (l.status<>'unlinked') DESC,l.linked_at DESC,l.id DESC LIMIT 1 FOR UPDATE;
  IF (old_id IS NULL AND p_revision IS NOT NULL) OR (old_id IS NOT NULL AND p_revision IS DISTINCT FROM old_revision) THEN
    RETURN 'conflict';
  END IF;
  RETURN 'ok';
END
$fn$;
REVOKE ALL ON FUNCTION private.lock_owner_ledger(uuid,uuid,text) FROM PUBLIC;
