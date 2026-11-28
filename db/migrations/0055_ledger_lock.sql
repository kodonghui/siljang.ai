-- 외부 시트를 바꾸기 전에 가게를 잠그고 화면 버전을 검사한다.
CREATE FUNCTION siljang_ledger_private.lock_owner_ledger(p_shop uuid,p_owner uuid,p_revision text)
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
REVOKE ALL ON FUNCTION siljang_ledger_private.lock_owner_ledger(uuid,uuid,text) FROM PUBLIC;
-- Supabase 기본 역할에 의도치 않은 기본 권한이 있어도 전용 함수에 접근하지 못하게 한다.
DO $revoke$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=role_name) THEN
      EXECUTE pg_catalog.format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA siljang_ledger_private FROM %I', role_name);
      EXECUTE pg_catalog.format('REVOKE ALL ON SCHEMA siljang_ledger_private FROM %I', role_name);
    END IF;
  END LOOP;
END
$revoke$;
