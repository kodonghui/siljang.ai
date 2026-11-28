-- 장부 파일 단위 임대는 여러 주문이 동시에 같은 파일의 새 행을 선택하지 못하게 한다.
ALTER TABLE ledger_links ADD COLUMN write_lease_id uuid;
ALTER TABLE ledger_links ADD COLUMN write_lease_until timestamptz;
COMMENT ON COLUMN ledger_links.write_lease_id IS '장부 파일을 선점한 쓰기';
COMMENT ON COLUMN ledger_links.write_lease_until IS '파일 선점 만료 시각';
ALTER TABLE ledger_links ADD CONSTRAINT ledger_links_write_lease_chk CHECK ((write_lease_id IS NULL) = (write_lease_until IS NULL));
DROP INDEX ledger_writes_due_idx;
CREATE INDEX ledger_writes_due_idx ON ledger_writes (next_attempt_at) WHERE status IN ('pending','retrying','alerted');

CREATE FUNCTION siljang_ledger_private.claim_ledger_write(p_shop uuid,p_write uuid,p_lease timestamptz)
RETURNS TABLE(link_id uuid,spreadsheet_id text,sheet_name text,row_values jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v_link public.ledger_links%ROWTYPE; v_order uuid; v_values jsonb;
BEGIN
  IF p_lease IS NULL OR p_lease<=pg_catalog.statement_timestamp() OR p_lease>pg_catalog.statement_timestamp()+interval '5 minutes' THEN RETURN; END IF;
  SELECT w.ledger_row_id INTO v_order FROM public.ledger_writes w
    WHERE w.shop_id=p_shop AND w.id=p_write AND w.status IN ('pending','retrying','alerted')
      AND w.next_attempt_at<=pg_catalog.statement_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.ledger_writes prior JOIN public.ledger_writes current ON current.shop_id=prior.shop_id AND current.ledger_row_id=prior.ledger_row_id
      WHERE current.shop_id=p_shop AND current.id=p_write AND prior.status<>'written'
        AND (prior.created_at,prior.id)<(current.created_at,current.id)) THEN
    UPDATE public.ledger_writes SET next_attempt_at=pg_catalog.statement_timestamp()+interval '1 minute' WHERE shop_id=p_shop AND id=p_write;
    RETURN;
  END IF;
  SELECT l.* INTO v_link FROM public.ledger_links l WHERE l.shop_id=p_shop AND l.status IN ('linked','auth_lost') FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    IF NOT EXISTS(SELECT 1 FROM public.ledger_links WHERE shop_id=p_shop AND status IN ('linked','auth_lost')) THEN
      UPDATE public.ledger_writes SET status='unlinked',next_attempt_at=NULL WHERE shop_id=p_shop AND id=p_write;
    END IF;
    RETURN;
  END IF;
  IF v_link.write_lease_until IS NOT NULL AND v_link.write_lease_until>pg_catalog.statement_timestamp() THEN RETURN; END IF;
  SELECT r.order_id INTO v_order FROM public.ledger_rows r WHERE r.shop_id=p_shop AND r.id=v_order;
  SELECT pg_catalog.jsonb_build_array(o.order_no,coalesce(d.customer_name,''),coalesce(d.customer_phone,''),
      pg_catalog.to_char(o.pickup_at AT TIME ZONE s.time_zone,'YYYY-MM-DD HH24:MI'),
      pg_catalog.concat_ws(' · ',sz.name,fl.name,de.name,ds.name,d.design_notes),coalesce(d.lettering,''),o.amount,
      CASE WHEN EXISTS(SELECT 1 FROM public.payments p WHERE p.shop_id=p_shop AND p.order_id=o.id AND p.voided_at IS NULL) THEN '확인됨' ELSE '미확인' END,
      CASE o.status WHEN 'requested' THEN '요청됨' WHEN 'awaiting_payment' THEN '결제 기다림' WHEN 'payment_overdue' THEN '결제 기한 지남' WHEN 'confirmed' THEN '확정됨' WHEN 'received' THEN '인도됨' WHEN 'no_pickup' THEN '미수령' WHEN 'rejected' THEN '거절됨' WHEN 'cancelled' THEN '취소됨' END,
      coalesce((SELECT sum(f.amount) FROM public.refunds f WHERE f.shop_id=p_shop AND f.order_id=o.id),0),
      coalesce(pg_catalog.to_char(pr.handed_over_at AT TIME ZONE s.time_zone,'YYYY-MM-DD HH24:MI'),''),
      coalesce((SELECT CASE m.status WHEN 'confirmed' THEN '확정됨' WHEN 'received' THEN '인도됨' WHEN 'no_pickup' THEN '미수령' WHEN 'cancelled' THEN '취소됨' ELSE m.status END FROM public.orders m WHERE m.shop_id=p_shop AND m.remake_of_order_id=o.id ORDER BY m.requested_at DESC,m.id DESC LIMIT 1),'')) INTO v_values
    FROM public.orders o JOIN public.shops s ON s.id=o.shop_id
    JOIN public.order_details d ON d.shop_id=o.shop_id AND d.order_id=o.id AND d.version=o.version
    LEFT JOIN public.price_options sz ON sz.id=d.size_option_id AND sz.shop_id=o.shop_id
    LEFT JOIN public.price_options fl ON fl.id=d.flavor_option_id AND fl.shop_id=o.shop_id
    LEFT JOIN public.price_options de ON de.id=d.design_option_id AND de.shop_id=o.shop_id
    LEFT JOIN public.designs ds ON ds.id=d.design_id AND ds.shop_id=o.shop_id
    LEFT JOIN public.productions pr ON pr.order_id=o.id AND pr.shop_id=o.shop_id
    WHERE o.shop_id=p_shop AND o.id=v_order AND o.remake_of_order_id IS NULL AND o.personal_data_purged_at IS NULL;
  IF v_values IS NULL THEN RETURN; END IF;
  UPDATE public.ledger_links SET write_lease_id=p_write,write_lease_until=p_lease WHERE shop_id=p_shop AND id=v_link.id;
  UPDATE public.ledger_writes SET first_failed_at=CASE WHEN attempts>0 THEN coalesce(first_failed_at,next_attempt_at) ELSE first_failed_at END,
    attempts=least(attempts+1,32767),next_attempt_at=p_lease WHERE shop_id=p_shop AND id=p_write;
  RETURN QUERY SELECT v_link.id,v_link.spreadsheet_id,v_link.sheet_name,v_values;
END
$fn$;
REVOKE ALL ON FUNCTION siljang_ledger_private.claim_ledger_write(uuid,uuid,timestamptz) FROM PUBLIC;

CREATE FUNCTION siljang_ledger_private.finish_ledger_write(p_shop uuid,p_write uuid,p_lease timestamptz,p_result text,p_now timestamptz,p_columns jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v_link uuid; v_row uuid; v_attempts int; v_failed timestamptz; v_alerted timestamptz; v_task uuid; v_delay interval;
BEGIN
  IF p_result NOT IN ('written','retry','auth_lost') OR p_now IS NULL OR NOT pg_catalog.isfinite(p_now) THEN RETURN false; END IF;
  p_now:=least(p_now,pg_catalog.statement_timestamp());
  SELECT l.id,l.failure_alerted_at INTO v_link,v_alerted FROM public.ledger_links l
    WHERE l.shop_id=p_shop AND l.write_lease_id=p_write AND l.write_lease_until=p_lease AND l.status IN ('linked','auth_lost') FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT w.ledger_row_id,w.attempts,w.first_failed_at INTO v_row,v_attempts,v_failed FROM public.ledger_writes w
    WHERE w.shop_id=p_shop AND w.id=p_write AND w.next_attempt_at=p_lease AND w.status IN ('pending','retrying','alerted') FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_result='written' THEN
    UPDATE public.ledger_writes SET status='written',written_at=p_now,next_attempt_at=NULL,last_error_kind=NULL WHERE shop_id=p_shop AND id=p_write;
    UPDATE public.ledger_rows SET first_written_at=coalesce(first_written_at,p_now),last_written_at=p_now WHERE shop_id=p_shop AND id=v_row;
    UPDATE public.ledger_links SET status='linked',our_columns=coalesce(p_columns,our_columns) WHERE shop_id=p_shop AND id=v_link;
    IF NOT EXISTS (SELECT 1 FROM public.ledger_writes WHERE shop_id=p_shop AND status<>'written') THEN
      UPDATE public.owner_tasks SET closed_at=p_now WHERE shop_id=p_shop AND event_key='task:ledger_relink:'||v_link::text AND closed_at IS NULL;
      UPDATE public.ledger_links SET failure_alerted_at=NULL WHERE shop_id=p_shop AND id=v_link;
    END IF;
  ELSE
    v_failed:=coalesce(v_failed,p_now);
    v_delay:=CASE v_attempts WHEN 1 THEN interval '1 minute' WHEN 2 THEN interval '5 minutes' WHEN 3 THEN interval '30 minutes' WHEN 4 THEN interval '2 hours' WHEN 5 THEN interval '6 hours' ELSE interval '1 day' END;
    UPDATE public.ledger_writes SET status=CASE WHEN p_result='auth_lost' OR v_alerted IS NOT NULL OR p_now>=v_failed+interval '24 hours' THEN 'alerted' ELSE 'retrying' END,
      first_failed_at=v_failed,last_error_kind=CASE WHEN p_result='auth_lost' THEN 'auth_lost' ELSE 'unavailable' END,
      next_attempt_at=CASE WHEN p_result='auth_lost' OR v_alerted IS NOT NULL OR p_now>=v_failed+interval '24 hours'
        THEN p_now+interval '1 day' ELSE least(p_now+v_delay,v_failed+interval '24 hours') END WHERE shop_id=p_shop AND id=p_write;
    IF (p_result='auth_lost' OR p_now>=v_failed+interval '24 hours') AND v_alerted IS NULL THEN
      INSERT INTO public.owner_tasks(shop_id,kind,event_key,opened_at) VALUES(p_shop,'ledger_relink','task:ledger_relink:'||v_link::text,p_now)
        ON CONFLICT(shop_id,event_key) DO UPDATE SET closed_at=NULL,opened_at=excluded.opened_at RETURNING id INTO v_task;
      INSERT INTO public.owner_alerts(shop_id,kind,event_key,owner_task_id,next_attempt_at,created_at)
        VALUES(p_shop,'ledger_failing','alert:ledger_failing:'||p_write::text,v_task,p_now,p_now) ON CONFLICT(shop_id,event_key) DO NOTHING;
      UPDATE public.ledger_links SET failure_alerted_at=p_now WHERE shop_id=p_shop AND id=v_link;
    END IF;
    IF p_result='auth_lost' THEN UPDATE public.ledger_links SET status='auth_lost' WHERE shop_id=p_shop AND id=v_link; END IF;
  END IF;
  UPDATE public.ledger_links SET write_lease_id=NULL,write_lease_until=NULL WHERE shop_id=p_shop AND id=v_link;
  RETURN true;
END
$fn$;
REVOKE ALL ON FUNCTION siljang_ledger_private.finish_ledger_write(uuid,uuid,timestamptz,text,timestamptz,jsonb) FROM PUBLIC;
CREATE FUNCTION siljang_ledger_private.count_unwritten_orders(p_shop uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
  SELECT least(count(DISTINCT ledger_row_id),100000)::integer FROM public.ledger_writes WHERE shop_id=p_shop AND status<>'written'
$fn$;
REVOKE ALL ON FUNCTION siljang_ledger_private.count_unwritten_orders(uuid) FROM PUBLIC;
DO $block$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=role_name) THEN
      EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION siljang_ledger_private.claim_ledger_write(uuid,uuid,timestamptz) FROM %I',role_name);
      EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION siljang_ledger_private.finish_ledger_write(uuid,uuid,timestamptz,text,timestamptz,jsonb) FROM %I',role_name);
      EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION siljang_ledger_private.count_unwritten_orders(uuid) FROM %I',role_name);
    END IF;
  END LOOP;
END
$block$;

-- 생성과 교체는 가게 행으로 직렬화하며, 토큰 저장은 같은 트랜잭션에서 이어진다.
CREATE OR REPLACE FUNCTION siljang_ledger_private.create_owner_ledger(p_shop uuid,p_owner uuid,p_link uuid,p_spreadsheet text,p_sheet text,p_columns jsonb,p_revision text,p_now timestamptz)
RETURNS TABLE(outcome text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE old_id uuid; old_status text; old_ref text; old_revision text; old_lease timestamptz;
BEGIN
  IF p_link IS NULL OR p_spreadsheet IS NULL OR p_sheet IS NULL OR p_columns IS NULL OR p_now IS NULL OR NOT pg_catalog.isfinite(p_now) THEN
    RAISE EXCEPTION 'invalid ledger input' USING ERRCODE='22023';
  END IF;
  PERFORM s.id FROM public.shops s WHERE s.id=p_shop AND s.owner_id=p_owner FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT l.id,l.status,l.credential_ref,l.xmin::text,l.write_lease_until INTO old_id,old_status,old_ref,old_revision,old_lease
    FROM public.ledger_links l WHERE l.shop_id=p_shop
    ORDER BY (l.status<>'unlinked') DESC,l.linked_at DESC,l.id DESC LIMIT 1 FOR UPDATE;
  IF (old_id IS NULL AND p_revision IS NOT NULL) OR (old_id IS NOT NULL AND p_revision IS DISTINCT FROM old_revision) THEN
    RETURN QUERY SELECT 'conflict'::text; RETURN;
  END IF;
  IF old_id IS NOT NULL AND old_status<>'unlinked' THEN
    UPDATE public.ledger_links SET status='unlinked', unlinked_at=least(p_now,pg_catalog.statement_timestamp()) WHERE shop_id=p_shop AND id=old_id;
    IF pg_catalog.to_regclass('vault.secrets') IS NOT NULL THEN
      EXECUTE 'DELETE FROM vault.secrets WHERE id::text=$1 AND name=$2' USING old_ref, 'siljang-ledger:'||p_shop::text||':'||old_id::text;
    END IF;
  END IF;
  INSERT INTO public.ledger_links(id,shop_id,spreadsheet_id,sheet_name,our_columns,credential_ref,linked_at)
    VALUES(p_link,p_shop,p_spreadsheet,p_sheet,p_columns,pg_catalog.gen_random_uuid()::text,least(p_now,pg_catalog.statement_timestamp()));
  UPDATE public.ledger_writes SET status='pending',next_attempt_at=greatest(pg_catalog.statement_timestamp(),coalesce(old_lease,pg_catalog.statement_timestamp()))
    WHERE shop_id=p_shop AND status IN ('unlinked','alerted','retrying','pending');
  RETURN QUERY SELECT CASE WHEN old_id IS NULL THEN 'created' ELSE 'relinked' END;
END
$fn$;
REVOKE ALL ON FUNCTION siljang_ledger_private.create_owner_ledger(uuid,uuid,uuid,text,text,jsonb,text,timestamptz) FROM PUBLIC;
