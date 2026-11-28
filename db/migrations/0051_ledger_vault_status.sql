-- Vault에 비밀 행이 없으면 복구 뒤 재연결이 필요한 상태로 표시한다.
CREATE SCHEMA siljang_ledger_private;
REVOKE ALL ON SCHEMA siljang_ledger_private FROM PUBLIC;
CREATE FUNCTION siljang_ledger_private.ledger_vault_present(p_ref text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE present boolean;
BEGIN
  IF pg_catalog.to_regclass('vault.secrets') IS NULL THEN RETURN false; END IF;
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM vault.secrets WHERE id::text = $1)' INTO present USING p_ref;
  RETURN present;
END
$fn$;
REVOKE ALL ON FUNCTION siljang_ledger_private.ledger_vault_present(text) FROM PUBLIC;

-- TASK-156: 가게 소유를 확인한 장부 메타데이터 조회/연결 해제만 허용한다.
CREATE OR REPLACE FUNCTION read_owner_ledger(p_shop uuid,p_owner uuid,p_link uuid)
RETURNS TABLE(id uuid,status text,spreadsheet_id text,sheet_name text,our_columns jsonb,
  linked_at timestamptz,unlinked_at timestamptz,revision text,failing_since timestamptz,unwritten_count integer)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
  SELECT l.id,CASE WHEN l.status='linked' AND NOT siljang_ledger_private.ledger_vault_present(l.credential_ref) THEN 'auth_lost' ELSE l.status END,l.spreadsheet_id,l.sheet_name,
    jsonb_build_object('columns',COALESCE((
      SELECT jsonb_agg(jsonb_build_object('header',c.value->'header','column',c.value->'column') ORDER BY c.position)
      FROM jsonb_array_elements(CASE
        WHEN jsonb_typeof(l.our_columns)='array' THEN l.our_columns
        WHEN jsonb_typeof(l.our_columns->'columns')='array' THEN l.our_columns->'columns'
        ELSE '[]'::jsonb END) WITH ORDINALITY AS c(value,position)
    ),'[]'::jsonb),'movedRight',COALESCE(l.our_columns->'movedRight','false'::jsonb)),
    l.linked_at,l.unlinked_at,l.xmin::text,
    (SELECT min(w.first_failed_at) FROM public.ledger_writes w WHERE w.shop_id=p_shop AND w.status<>'written'),
    (SELECT least(count(*),100000)::int FROM public.ledger_writes wc WHERE wc.shop_id=p_shop AND wc.status<>'written')
  FROM public.ledger_links l WHERE l.shop_id=p_shop AND (p_link IS NULL OR l.id=p_link)
    AND EXISTS(SELECT 1 FROM public.shops s WHERE s.id=p_shop AND s.owner_id=p_owner)
  ORDER BY (l.status<>'unlinked') DESC,l.linked_at DESC,l.id DESC LIMIT 1
$fn$;
REVOKE ALL ON FUNCTION read_owner_ledger(uuid,uuid,uuid) FROM PUBLIC;

