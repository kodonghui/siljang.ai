-- TASK-156: 가게 소유를 확인한 장부 메타데이터 조회/연결 해제만 허용한다.
CREATE FUNCTION read_owner_ledger(p_shop uuid,p_owner uuid,p_link uuid)
RETURNS TABLE(id uuid,status text,spreadsheet_id text,sheet_name text,our_columns jsonb,
  linked_at timestamptz,unlinked_at timestamptz,revision text,failing_since timestamptz,unwritten_count integer)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
  SELECT l.id,l.status,l.spreadsheet_id,l.sheet_name,
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

CREATE FUNCTION unlink_owner_ledger(p_shop uuid,p_owner uuid,p_now timestamptz)
RETURNS TABLE(outcome text,link_id uuid,kept_writes integer)
LANGUAGE plpgsql STRICT SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v_id uuid; v_status text;
BEGIN
  IF NOT pg_catalog.isfinite(p_now) THEN RAISE EXCEPTION 'invalid unlink time' USING ERRCODE='22008'; END IF;
  p_now := least(p_now,pg_catalog.statement_timestamp());
  PERFORM s.id FROM public.shops s WHERE s.id=p_shop AND s.owner_id=p_owner FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT l.id,l.status INTO v_id,v_status FROM public.ledger_links l WHERE l.shop_id=p_shop
    ORDER BY (l.status<>'unlinked') DESC,l.linked_at DESC,l.id DESC LIMIT 1 FOR UPDATE OF l;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_status<>'unlinked' THEN
    UPDATE public.ledger_links l SET status='unlinked',unlinked_at=p_now WHERE l.shop_id=p_shop AND l.id=v_id;
  END IF;
  UPDATE public.ledger_writes w SET status='unlinked',next_attempt_at=NULL
    WHERE w.shop_id=p_shop AND w.status<>'written' AND (w.status<>'unlinked' OR w.next_attempt_at IS NOT NULL);
  RETURN QUERY SELECT CASE WHEN v_status='unlinked' THEN 'unchanged' ELSE 'done' END,v_id,least(count(*),100000)::int
    FROM public.ledger_writes w WHERE w.shop_id=p_shop AND w.status<>'written';
END
$fn$;
REVOKE ALL ON FUNCTION unlink_owner_ledger(uuid,uuid,timestamptz) FROM PUBLIC;
