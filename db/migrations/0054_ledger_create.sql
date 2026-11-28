-- 생성과 교체는 가게 행으로 직렬화하며, 토큰 저장은 같은 트랜잭션에서 이어진다.
CREATE FUNCTION private.create_owner_ledger(p_shop uuid,p_owner uuid,p_link uuid,p_spreadsheet text,p_sheet text,p_columns jsonb,p_revision text,p_now timestamptz)
RETURNS TABLE(outcome text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE old_id uuid; old_status text; old_ref text; old_revision text;
BEGIN
  IF p_link IS NULL OR p_spreadsheet IS NULL OR p_sheet IS NULL OR p_columns IS NULL OR p_now IS NULL OR NOT pg_catalog.isfinite(p_now) THEN
    RAISE EXCEPTION 'invalid ledger input' USING ERRCODE='22023';
  END IF;
  PERFORM s.id FROM public.shops s WHERE s.id=p_shop AND s.owner_id=p_owner FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT l.id,l.status,l.credential_ref,l.xmin::text INTO old_id,old_status,old_ref,old_revision
    FROM public.ledger_links l WHERE l.shop_id=p_shop
    ORDER BY (l.status<>'unlinked') DESC,l.linked_at DESC,l.id DESC LIMIT 1 FOR UPDATE;
  IF (old_id IS NULL AND p_revision IS NOT NULL) OR (old_id IS NOT NULL AND p_revision IS DISTINCT FROM old_revision) THEN
    RETURN QUERY SELECT 'conflict'::text; RETURN;
  END IF;
  IF old_id IS NOT NULL AND old_status<>'unlinked' THEN
    UPDATE public.ledger_links SET status='unlinked', unlinked_at=least(p_now,pg_catalog.statement_timestamp()) WHERE shop_id=p_shop AND id=old_id;
    IF pg_catalog.to_regclass('vault.secrets') IS NOT NULL THEN
      EXECUTE 'DELETE FROM vault.secrets WHERE id::text=$1' USING old_ref;
    END IF;
  END IF;
  INSERT INTO public.ledger_links(id,shop_id,spreadsheet_id,sheet_name,our_columns,credential_ref,linked_at)
    VALUES(p_link,p_shop,p_spreadsheet,p_sheet,p_columns,pg_catalog.gen_random_uuid()::text,least(p_now,pg_catalog.statement_timestamp()));
  UPDATE public.ledger_writes SET status='pending',next_attempt_at=pg_catalog.statement_timestamp()
    WHERE shop_id=p_shop AND status='unlinked';
  RETURN QUERY SELECT CASE WHEN old_id IS NULL THEN 'created' ELSE 'relinked' END;
END
$fn$;
REVOKE ALL ON FUNCTION private.create_owner_ledger(uuid,uuid,uuid,text,text,jsonb,text,timestamptz) FROM PUBLIC;
