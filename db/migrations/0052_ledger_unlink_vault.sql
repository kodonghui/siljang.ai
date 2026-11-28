-- 연결 해제와 이 연결의 Vault 암호문 삭제는 같은 트랜잭션에서 처리한다.
CREATE OR REPLACE FUNCTION unlink_owner_ledger(p_shop uuid,p_owner uuid,p_now timestamptz)
RETURNS TABLE(outcome text,link_id uuid,kept_writes integer)
LANGUAGE plpgsql STRICT SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v_id uuid; v_status text; v_ref text;
BEGIN
  IF NOT pg_catalog.isfinite(p_now) THEN RAISE EXCEPTION 'invalid unlink time' USING ERRCODE='22008'; END IF;
  p_now := least(p_now,pg_catalog.statement_timestamp());
  PERFORM s.id FROM public.shops s WHERE s.id=p_shop AND s.owner_id=p_owner FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT l.id,l.status,l.credential_ref INTO v_id,v_status,v_ref FROM public.ledger_links l WHERE l.shop_id=p_shop
    ORDER BY (l.status<>'unlinked') DESC,l.linked_at DESC,l.id DESC LIMIT 1 FOR UPDATE OF l;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_status<>'unlinked' THEN
    IF pg_catalog.to_regclass('vault.secrets') IS NOT NULL THEN
      EXECUTE 'DELETE FROM vault.secrets WHERE id::text = $1' USING v_ref;
    END IF;
    UPDATE public.ledger_links l SET status='unlinked',unlinked_at=p_now WHERE l.shop_id=p_shop AND l.id=v_id;
  END IF;
  UPDATE public.ledger_writes w SET status='unlinked',next_attempt_at=NULL
    WHERE w.shop_id=p_shop AND w.status<>'written' AND (w.status<>'unlinked' OR w.next_attempt_at IS NOT NULL);
  RETURN QUERY SELECT CASE WHEN v_status='unlinked' THEN 'unchanged' ELSE 'done' END,v_id,least(count(*),100000)::int
    FROM public.ledger_writes w WHERE w.shop_id=p_shop AND w.status<>'written';
END
$fn$;
REVOKE ALL ON FUNCTION unlink_owner_ledger(uuid,uuid,timestamptz) FROM PUBLIC;
