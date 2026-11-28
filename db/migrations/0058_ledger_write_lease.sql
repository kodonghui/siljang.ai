-- 장부 파일 단위 임대는 여러 주문이 동시에 같은 파일의 새 행을 선택하지 못하게 한다.
ALTER TABLE ledger_links ADD COLUMN write_lease_id uuid;
ALTER TABLE ledger_links ADD COLUMN write_lease_until timestamptz;
COMMENT ON COLUMN ledger_links.write_lease_id IS '장부 파일을 선점한 쓰기';
COMMENT ON COLUMN ledger_links.write_lease_until IS '파일 선점 만료 시각';
ALTER TABLE ledger_links ADD CONSTRAINT ledger_links_write_lease_chk CHECK ((write_lease_id IS NULL) = (write_lease_until IS NULL));
ALTER TABLE ledger_writes ADD COLUMN write_uncertain boolean NOT NULL DEFAULT false;
ALTER TABLE ledger_writes ADD COLUMN write_in_flight boolean NOT NULL DEFAULT false;
ALTER TABLE ledger_writes ADD COLUMN resume_approved boolean NOT NULL DEFAULT false;
ALTER TABLE ledger_writes ADD COLUMN resume_needs_audit boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN ledger_writes.resume_approved IS '확인 후 재개 허용';
COMMENT ON COLUMN ledger_writes.resume_needs_audit IS '재개 뒤 중복 확인 필요';
ALTER TABLE ledger_writes ADD COLUMN audit_due_at timestamptz;
ALTER TABLE ledger_writes ADD COLUMN audit_deadline timestamptz;
ALTER TABLE ledger_writes ADD COLUMN audit_checks smallint NOT NULL DEFAULT 0 CHECK (audit_checks BETWEEN 0 AND 48);
ALTER TABLE ledger_writes ADD COLUMN audit_repair_link_id uuid;
ALTER TABLE ledger_writes ADD COLUMN checkpoint_hashes jsonb;
COMMENT ON COLUMN ledger_writes.checkpoint_hashes IS '쓰기 전 장부 행의 HMAC 비교 기준';
ALTER TABLE ledger_rows ADD COLUMN sheet_hash text;
ALTER TABLE ledger_rows ADD COLUMN sheet_key_version text;
COMMENT ON COLUMN ledger_rows.sheet_key_version IS '장부 서명의 HMAC 키 버전';
ALTER TABLE ledger_rows ADD COLUMN sheet_hashes jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN ledger_rows.sheet_hashes IS '대상과 기록 ID별 장부 행의 앱 서명';
COMMENT ON COLUMN ledger_rows.sheet_hash IS '마지막 장부 행의 앱 서명';
COMMENT ON COLUMN ledger_writes.write_uncertain IS '외부 쓰기 결과 불확실 여부';
COMMENT ON COLUMN ledger_writes.write_in_flight IS '결과 기록 전 외부 쓰기 시도';
COMMENT ON COLUMN ledger_writes.audit_due_at IS '중복 정리 다음 확인 시각';
COMMENT ON COLUMN ledger_writes.audit_deadline IS '중복 정리 확인 기한';
COMMENT ON COLUMN ledger_writes.audit_checks IS '중복 정리 확인 횟수';
COMMENT ON COLUMN ledger_writes.audit_repair_link_id IS '사후 확인에서 재기록할 원래 연결';
DROP INDEX ledger_writes_due_idx;
CREATE INDEX ledger_writes_due_idx ON ledger_writes (next_attempt_at) WHERE status IN ('pending','retrying','alerted');
CREATE INDEX ledger_writes_audit_due_idx ON ledger_writes (audit_due_at) WHERE status='written' AND audit_due_at IS NOT NULL;

-- 구글 계정 식별자를 저장하지 않고도 사용자별 한도를 넘지 않게 모든 가게에 보수적인 공통 상한을 둔다.
CREATE TABLE siljang_ledger_private.ledger_call_slots (started_at timestamptz NOT NULL);
REVOKE ALL ON TABLE siljang_ledger_private.ledger_call_slots FROM PUBLIC;

-- 전송 중 연결 해제·교체가 완료되지 않도록 호출이 끝날 때까지 연결 행을 잠근다.
CREATE FUNCTION siljang_ledger_private.guard_ledger_write(p_shop uuid,p_link uuid,p_write uuid,p_lease timestamptz,p_file text,p_tab text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='3s' AS $fn$
BEGIN
  IF p_lease IS NULL OR p_lease<=pg_catalog.statement_timestamp() THEN RETURN false; END IF;
  PERFORM 1 FROM public.ledger_links l WHERE l.shop_id=p_shop AND l.id=p_link AND l.spreadsheet_id=p_file AND l.sheet_name=p_tab
    AND l.status IN ('linked','auth_lost') AND l.write_lease_id=p_write AND l.write_lease_until=p_lease FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM public.ledger_writes w WHERE w.shop_id=p_shop AND w.id=p_write
    AND ((w.status IN ('pending','retrying','alerted') AND w.next_attempt_at=p_lease) OR (w.status='written' AND w.audit_due_at=p_lease)));
END
$fn$;
REVOKE ALL ON FUNCTION siljang_ledger_private.guard_ledger_write(uuid,uuid,uuid,timestamptz,text,text) FROM PUBLIC;

-- 쓰기 전 비교 기준은 주문 ID와 HMAC만 별도 트랜잭션에 저장한다.
CREATE FUNCTION siljang_ledger_private.save_ledger_checkpoint(p_shop uuid,p_write uuid,p_lease timestamptz,p_link uuid,p_checkpoint jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='3s' AS $fn$
DECLARE saved uuid; r jsonb;
BEGIN
  IF p_checkpoint IS NULL OR pg_catalog.jsonb_typeof(p_checkpoint)<>'object' OR pg_catalog.octet_length(p_checkpoint::text)>1500000 THEN RETURN false; END IF;
  IF p_checkpoint-ARRAY['scope','keyVersion','sentDigest','rows','unidentifiedRows','conflicted','affectedOrderIds'] <> '{}'::jsonb
     OR coalesce(p_checkpoint->>'keyVersion','') !~ '^[A-Za-z0-9_-]{43}$' OR coalesce(p_checkpoint->>'scope','') !~ '^[A-Za-z0-9_-]{43}$' OR coalesce(p_checkpoint->>'sentDigest','') !~ '^[A-Za-z0-9_-]{43}$'
     OR pg_catalog.jsonb_typeof(p_checkpoint->'unidentifiedRows') IS DISTINCT FROM 'boolean'
     OR pg_catalog.jsonb_typeof(p_checkpoint->'conflicted') IS DISTINCT FROM 'boolean'
     OR pg_catalog.jsonb_typeof(p_checkpoint->'rows') IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_typeof(p_checkpoint->'affectedOrderIds') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF pg_catalog.jsonb_array_length(p_checkpoint->'rows')>5000 OR pg_catalog.jsonb_array_length(p_checkpoint->'affectedOrderIds')>5000 THEN RETURN false; END IF;
  FOR r IN SELECT value FROM pg_catalog.jsonb_array_elements(p_checkpoint->'rows') LOOP
    IF pg_catalog.jsonb_typeof(r)<>'object' OR r-ARRAY['key','digest','orderId'] <> '{}'::jsonb
       OR coalesce(r->>'key','') !~ '^[A-Za-z0-9_-]{43}$' OR coalesce(r->>'digest','') !~ '^[A-Za-z0-9_-]{43}$'
       OR coalesce(r->>'orderId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements_text(p_checkpoint->'affectedOrderIds') x WHERE x.value !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN RETURN false; END IF;
  -- 삭제와 기준 저장을 주문 행으로 직렬화하고, 이미 삭제된 주문의 HMAC은 저장하지 않는다.
  PERFORM o.id FROM public.orders o WHERE o.shop_id=p_shop AND (o.id::text IN
    (SELECT x.value->>'orderId' FROM pg_catalog.jsonb_array_elements(p_checkpoint->'rows') x) OR o.id::text IN
    (SELECT x.value FROM pg_catalog.jsonb_array_elements_text(p_checkpoint->'affectedOrderIds') x) OR o.id IN
    (SELECT r.order_id FROM public.ledger_rows r JOIN public.ledger_writes w ON w.shop_id=r.shop_id AND w.ledger_row_id=r.id WHERE w.shop_id=p_shop AND w.id=p_write)) FOR SHARE;
  p_checkpoint:=pg_catalog.jsonb_set(p_checkpoint,'{affectedOrderIds}',coalesce((SELECT pg_catalog.jsonb_agg(x.value) FROM pg_catalog.jsonb_array_elements(p_checkpoint->'affectedOrderIds') x WHERE NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.shop_id=p_shop AND o.id::text=x.value#>>'{}' AND o.personal_data_purged_at IS NOT NULL)),'[]'::jsonb));
  p_checkpoint:=pg_catalog.jsonb_set(p_checkpoint,'{rows}',coalesce((
    SELECT pg_catalog.jsonb_agg(x.value) FROM pg_catalog.jsonb_array_elements(p_checkpoint->'rows') x
    WHERE NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.shop_id=p_shop AND o.id::text=x.value->>'orderId' AND o.personal_data_purged_at IS NOT NULL)
  ),'[]'::jsonb));
  UPDATE public.ledger_writes w SET checkpoint_hashes=p_checkpoint
   WHERE w.shop_id=p_shop AND w.id=p_write AND w.next_attempt_at=p_lease AND w.status IN ('pending','retrying','alerted') AND w.write_in_flight
     AND EXISTS (SELECT 1 FROM public.ledger_rows r JOIN public.orders o ON o.shop_id=r.shop_id AND o.id=r.order_id WHERE r.shop_id=p_shop AND r.id=w.ledger_row_id AND o.personal_data_purged_at IS NULL)
     AND EXISTS (SELECT 1 FROM public.ledger_links l WHERE l.shop_id=p_shop AND l.id=p_link AND l.status IN ('linked','auth_lost')
       AND l.write_lease_id=p_write AND l.write_lease_until=p_lease AND l.write_lease_until>pg_catalog.statement_timestamp())
   RETURNING w.id INTO saved;
  RETURN saved IS NOT NULL;
END
$fn$;
REVOKE ALL ON FUNCTION siljang_ledger_private.save_ledger_checkpoint(uuid,uuid,timestamptz,uuid,jsonb) FROM PUBLIC;

CREATE FUNCTION siljang_ledger_private.claim_ledger_write(p_shop uuid,p_write uuid,p_lease timestamptz)
RETURNS TABLE(link_id uuid,spreadsheet_id text,sheet_name text,row_values jsonb,uncertain boolean,auditing boolean,order_id uuid,expected_hash text,expected_hashes jsonb,checkpoint_hashes jsonb,resume_approved boolean,sheet_key_version text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v_link public.ledger_links%ROWTYPE; v_order uuid; v_values jsonb; v_uncertain boolean; v_audit boolean; v_in_flight boolean; v_hash text; v_hashes jsonb; v_checkpoint jsonb; v_resume boolean; v_key_version text;
BEGIN
  IF p_lease IS NULL OR p_lease<=pg_catalog.statement_timestamp() OR p_lease>pg_catalog.statement_timestamp()+interval '5 minutes' THEN RETURN; END IF;
  SELECT w.ledger_row_id,w.write_uncertain,(w.status='written'),w.write_in_flight,w.checkpoint_hashes,w.resume_approved INTO v_order,v_uncertain,v_audit,v_in_flight,v_checkpoint,v_resume FROM public.ledger_writes w
    WHERE w.shop_id=p_shop AND w.id=p_write AND ((w.status IN ('pending','retrying','alerted') AND w.next_attempt_at<=pg_catalog.statement_timestamp()) OR (w.status='written' AND w.audit_due_at<=pg_catalog.statement_timestamp())) FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT v_audit AND v_in_flight THEN
    UPDATE public.ledger_writes SET write_in_flight=false,write_uncertain=true,first_failed_at=coalesce(first_failed_at,pg_catalog.statement_timestamp()),next_attempt_at=pg_catalog.statement_timestamp()+interval '5 minutes' WHERE shop_id=p_shop AND id=p_write;
    RETURN;
  END IF;
  IF NOT v_audit AND EXISTS (SELECT 1 FROM public.ledger_rows r JOIN public.owner_tasks t ON t.shop_id=r.shop_id AND t.order_id=r.order_id
      WHERE r.shop_id=p_shop AND r.id=v_order AND t.event_key='task:ledger_conflict:'||r.order_id::text AND t.closed_at IS NULL) THEN
    UPDATE public.ledger_writes SET status='unlinked',next_attempt_at=NULL,last_error_kind='conflict' WHERE shop_id=p_shop AND id=p_write;
    RETURN;
  END IF;
  IF NOT v_audit AND EXISTS (SELECT 1 FROM public.ledger_writes prior JOIN public.ledger_writes current ON current.shop_id=prior.shop_id AND current.ledger_row_id=prior.ledger_row_id
      WHERE current.shop_id=p_shop AND current.id=p_write AND prior.status<>'written'
        AND (prior.created_at,prior.id)<(current.created_at,current.id)) THEN
    UPDATE public.ledger_writes SET next_attempt_at=pg_catalog.statement_timestamp()+interval '1 minute' WHERE shop_id=p_shop AND id=p_write;
    RETURN;
  END IF;
  SELECT l.* INTO v_link FROM public.ledger_links l WHERE l.shop_id=p_shop AND l.status IN ('linked','auth_lost') FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    IF NOT EXISTS(SELECT 1 FROM public.ledger_links WHERE shop_id=p_shop AND status IN ('linked','auth_lost')) THEN
      IF v_audit THEN UPDATE public.ledger_writes SET audit_due_at=NULL,audit_deadline=NULL,write_uncertain=false WHERE shop_id=p_shop AND id=p_write;
      ELSE UPDATE public.ledger_writes SET status='unlinked',next_attempt_at=NULL WHERE shop_id=p_shop AND id=p_write; END IF;
    END IF;
    RETURN;
  END IF;
  IF v_link.write_lease_until IS NOT NULL AND v_link.write_lease_until>pg_catalog.statement_timestamp() THEN RETURN; END IF;
  -- 같은 가게의 불확실하거나 결과 기록 전인 다른 쓰기를 먼저 확인한다.
  IF EXISTS (SELECT 1 FROM public.ledger_writes other WHERE other.shop_id=p_shop AND other.id<>p_write
    AND other.status IN ('pending','retrying','alerted') AND (other.write_uncertain OR other.write_in_flight)) THEN
    IF v_audit THEN UPDATE public.ledger_writes SET audit_due_at=pg_catalog.statement_timestamp()+interval '1 minute' WHERE shop_id=p_shop AND id=p_write;
    ELSE UPDATE public.ledger_writes SET next_attempt_at=pg_catalog.statement_timestamp()+interval '1 minute' WHERE shop_id=p_shop AND id=p_write; END IF;
    RETURN;
  END IF;
  SELECT r.order_id,r.sheet_hash,r.sheet_hashes,r.sheet_key_version INTO v_order,v_hash,v_hashes,v_key_version FROM public.ledger_rows r WHERE r.shop_id=p_shop AND r.id=v_order;
  SELECT pg_catalog.jsonb_build_array(o.order_no,coalesce(d.customer_name,''),coalesce(d.customer_phone,''),
      pg_catalog.to_char(o.pickup_at AT TIME ZONE s.time_zone,'YYYY-MM-DD HH24:MI'),
      pg_catalog.concat_ws(' · ',sz.name,fl.name,de.name,ds.name,d.design_notes),coalesce(d.lettering,''),o.amount,
      CASE WHEN EXISTS(SELECT 1 FROM public.payments p WHERE p.shop_id=p_shop AND p.order_id=o.id AND p.voided_at IS NULL) THEN '확인됨' ELSE '미확인' END,
      CASE o.status WHEN 'requested' THEN '요청됨' WHEN 'awaiting_payment' THEN '결제 기다림' WHEN 'payment_overdue' THEN '결제 기한 지남' WHEN 'confirmed' THEN '확정됨' WHEN 'received' THEN '인도됨' WHEN 'no_pickup' THEN '미수령' WHEN 'rejected' THEN '거절됨' WHEN 'cancelled' THEN '취소됨' END,
      coalesce((SELECT sum(f.amount) FROM public.refunds f WHERE f.shop_id=p_shop AND f.order_id=o.id),0),
      coalesce(pg_catalog.to_char(pr.handed_over_at AT TIME ZONE s.time_zone,'YYYY-MM-DD HH24:MI'),''),
      coalesce((SELECT pg_catalog.to_char(m.pickup_at AT TIME ZONE s.time_zone,'YYYY-MM-DD HH24:MI')||' · '||CASE m.status WHEN 'confirmed' THEN '확정됨' WHEN 'received' THEN '인도됨' WHEN 'no_pickup' THEN '미수령' WHEN 'cancelled' THEN '취소됨' ELSE m.status END FROM public.orders m WHERE m.shop_id=p_shop AND m.remake_of_order_id=o.id ORDER BY m.requested_at DESC,m.id DESC LIMIT 1),'')) INTO v_values
    FROM public.orders o JOIN public.shops s ON s.id=o.shop_id
    JOIN public.order_details d ON d.shop_id=o.shop_id AND d.order_id=o.id AND d.version=o.version
    LEFT JOIN public.price_options sz ON sz.id=d.size_option_id AND sz.shop_id=o.shop_id
    LEFT JOIN public.price_options fl ON fl.id=d.flavor_option_id AND fl.shop_id=o.shop_id
    LEFT JOIN public.price_options de ON de.id=d.design_option_id AND de.shop_id=o.shop_id
    LEFT JOIN public.designs ds ON ds.id=d.design_id AND ds.shop_id=o.shop_id
    LEFT JOIN public.productions pr ON pr.order_id=o.id AND pr.shop_id=o.shop_id
    WHERE o.shop_id=p_shop AND o.id=v_order AND o.remake_of_order_id IS NULL AND o.personal_data_purged_at IS NULL;
  IF v_values IS NULL THEN RETURN; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(157,1);
  DELETE FROM siljang_ledger_private.ledger_call_slots WHERE started_at<=pg_catalog.statement_timestamp()-interval '60 seconds';
  IF (SELECT count(*) FROM siljang_ledger_private.ledger_call_slots)>=5 THEN
    -- 원래 예정 시각을 보존해야 뒤 배치의 더 새 작업에 계속 추월당하지 않는다.
    RETURN;
  END IF;
  INSERT INTO siljang_ledger_private.ledger_call_slots(started_at) VALUES(pg_catalog.statement_timestamp());
  UPDATE public.ledger_links SET write_lease_id=p_write,write_lease_until=p_lease WHERE shop_id=p_shop AND id=v_link.id;
  IF v_audit THEN UPDATE public.ledger_writes SET audit_due_at=p_lease WHERE shop_id=p_shop AND id=p_write;
  ELSE UPDATE public.ledger_writes SET first_failed_at=CASE WHEN attempts>0 THEN coalesce(first_failed_at,next_attempt_at) ELSE first_failed_at END,
    attempts=least(attempts+1,32767),next_attempt_at=p_lease,write_in_flight=true WHERE shop_id=p_shop AND id=p_write; END IF;
  RETURN QUERY SELECT v_link.id,v_link.spreadsheet_id,v_link.sheet_name,v_values,v_uncertain,v_audit,v_order,v_hash,v_hashes,v_checkpoint,v_resume,v_key_version;
END
$fn$;
REVOKE ALL ON FUNCTION siljang_ledger_private.claim_ledger_write(uuid,uuid,timestamptz) FROM PUBLIC;

CREATE FUNCTION siljang_ledger_private.finish_ledger_write(p_shop uuid,p_write uuid,p_lease timestamptz,p_result text,p_now timestamptz,p_columns jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v_link uuid; v_row uuid; v_order uuid; v_attempts int; v_failed timestamptz; v_alerted timestamptz; v_task uuid; v_delay interval; v_audit boolean; v_deadline timestamptz; v_checks integer; v_affected uuid;
BEGIN
  IF p_result NOT IN ('written','retry','auth_lost','uncertain','duplicate','conflict','audit_ok','audit_duplicate','audit_missing','audit_retry') OR p_now IS NULL OR NOT pg_catalog.isfinite(p_now) THEN RETURN false; END IF;
  IF p_result='written' AND p_columns IS NOT NULL AND p_columns ? 'sheetHash' AND (p_columns->>'sheetHash') !~ '^[A-Za-z0-9_-]{43}$' THEN RETURN false; END IF;
  IF p_result='written' AND p_columns ? 'keyVersion' AND (p_columns->>'keyVersion') !~ '^[A-Za-z0-9_-]{43}$' THEN RETURN false; END IF;
  IF p_result='written' AND p_columns ? 'targetKey' AND (p_columns->>'targetKey') !~ '^[A-Za-z0-9_-]{43}$' THEN RETURN false; END IF;
  -- 예약 시각이 아니라 결과를 기록한 실제 시각부터 실패 간격을 센다.
  p_now:=pg_catalog.statement_timestamp();
  SELECT l.id,l.failure_alerted_at INTO v_link,v_alerted FROM public.ledger_links l
    WHERE l.shop_id=p_shop AND l.write_lease_id=p_write AND l.write_lease_until=p_lease AND l.status IN ('linked','auth_lost') FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT w.ledger_row_id,w.attempts,w.first_failed_at,(w.status='written'),w.audit_deadline,w.audit_checks INTO v_row,v_attempts,v_failed,v_audit,v_deadline,v_checks FROM public.ledger_writes w
    WHERE w.shop_id=p_shop AND w.id=p_write AND ((w.next_attempt_at=p_lease AND w.status IN ('pending','retrying','alerted')) OR (w.audit_due_at=p_lease AND w.status='written')) FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT order_id INTO v_order FROM public.ledger_rows WHERE shop_id=p_shop AND id=v_row;
  IF NOT v_audit THEN UPDATE public.ledger_writes SET write_in_flight=false, checkpoint_hashes=CASE WHEN p_result IN ('written','conflict') OR (p_result='retry' AND NOT write_uncertain) THEN NULL ELSE checkpoint_hashes END WHERE shop_id=p_shop AND id=p_write; END IF;
  IF v_audit AND p_result IN ('audit_ok','audit_duplicate','audit_missing','audit_retry') THEN
    IF p_result='audit_missing' THEN
      UPDATE public.ledger_writes SET status='pending',written_at=NULL,next_attempt_at=p_now,write_uncertain=false,audit_due_at=NULL,audit_deadline=NULL,audit_repair_link_id=v_link WHERE shop_id=p_shop AND id=p_write;
    ELSE
      UPDATE public.ledger_writes SET audit_checks=least(v_checks+1,48),
        audit_due_at=CASE WHEN v_checks+1>=48 OR p_now>=v_deadline THEN NULL ELSE least(p_now+interval '30 minutes',v_deadline) END,
        audit_deadline=CASE WHEN v_checks+1>=48 OR p_now>=v_deadline THEN NULL ELSE v_deadline END,
        write_uncertain=CASE WHEN v_checks+1>=48 OR p_now>=v_deadline THEN false ELSE true END WHERE shop_id=p_shop AND id=p_write;
      IF p_result='audit_ok' AND EXISTS (SELECT 1 FROM public.owner_tasks WHERE shop_id=p_shop AND event_key='task:ledger_duplicate:'||v_order::text AND closed_at IS NULL) THEN
        UPDATE public.ledger_writes SET status='pending',written_at=NULL,next_attempt_at=p_now,write_uncertain=false,audit_due_at=NULL,audit_deadline=NULL,audit_repair_link_id=v_link WHERE shop_id=p_shop AND id=p_write;
      END IF;
      IF p_result='audit_duplicate' THEN
        INSERT INTO public.owner_tasks(shop_id,kind,event_key,order_id,opened_at) VALUES(p_shop,'ledger_relink','task:ledger_duplicate:'||v_order::text,v_order,p_now) ON CONFLICT(shop_id,event_key) DO UPDATE SET closed_at=NULL RETURNING id INTO v_task;
        IF v_task IS NOT NULL THEN INSERT INTO public.owner_alerts(shop_id,kind,event_key,owner_task_id,next_attempt_at,created_at) VALUES(p_shop,'ledger_failing','alert:ledger_duplicate:'||v_order::text,v_task,p_now,p_now) ON CONFLICT(shop_id,event_key) DO NOTHING; END IF;
      END IF;
      IF p_result<>'audit_ok' AND (v_checks+1>=48 OR p_now>=v_deadline) AND EXISTS (SELECT 1 FROM public.owner_tasks WHERE shop_id=p_shop AND event_key='task:ledger_duplicate:'||v_order::text AND closed_at IS NULL) THEN
        UPDATE public.ledger_writes SET status='retrying',written_at=NULL,next_attempt_at=p_now+interval '5 minutes',last_error_kind='duplicate',audit_repair_link_id=v_link WHERE shop_id=p_shop AND id=p_write;
      END IF;
    END IF;
  ELSIF v_audit OR p_result IN ('audit_ok','audit_duplicate','audit_missing','audit_retry') THEN RETURN false;
  ELSIF p_result='written' THEN
    UPDATE public.ledger_writes SET status='written',written_at=p_now,next_attempt_at=NULL,last_error_kind=NULL,audit_repair_link_id=NULL,
      audit_due_at=CASE WHEN write_uncertain OR resume_needs_audit THEN p_now+interval '30 minutes' END,
      audit_deadline=CASE WHEN write_uncertain OR resume_needs_audit THEN p_now+interval '24 hours' END,audit_checks=0,write_uncertain=write_uncertain OR resume_needs_audit,resume_needs_audit=false,resume_approved=false WHERE shop_id=p_shop AND id=p_write;
    -- 확인은 이 주문의 첫 성공에만 적용하며 후속 이벤트는 새 서명으로 검증한다.
    UPDATE public.ledger_writes SET resume_approved=false WHERE shop_id=p_shop AND ledger_row_id=v_row AND id<>p_write AND resume_approved;
    UPDATE public.ledger_rows SET first_written_at=coalesce(first_written_at,p_now),last_written_at=p_now,sheet_hash=coalesce(p_columns->>'sheetHash',sheet_hash), sheet_key_version=coalesce(p_columns->>'keyVersion',sheet_key_version), sheet_hashes=CASE WHEN p_columns ? 'sheetHash' AND p_columns ? 'targetKey' THEN pg_catalog.jsonb_build_object(p_columns->>'targetKey',pg_catalog.jsonb_build_object(pg_catalog.replace(p_write::text,'-',''),p_columns->>'sheetHash')) ELSE sheet_hashes END WHERE shop_id=p_shop AND id=v_row;
    UPDATE public.owner_tasks SET closed_at=p_now WHERE shop_id=p_shop AND event_key='task:ledger_duplicate:'||v_order::text AND closed_at IS NULL;
    UPDATE public.owner_tasks SET closed_at=p_now WHERE shop_id=p_shop AND event_key='task:ledger_conflict:'||v_order::text AND closed_at IS NULL;
    UPDATE public.ledger_links SET status='linked',our_columns=coalesce(p_columns-ARRAY['sheetHash','targetKey','keyVersion'],our_columns) WHERE shop_id=p_shop AND id=v_link;
    IF NOT EXISTS (SELECT 1 FROM public.ledger_writes WHERE shop_id=p_shop AND status<>'written') THEN
      UPDATE public.owner_tasks SET closed_at=p_now WHERE shop_id=p_shop AND event_key='task:ledger_relink:'||v_link::text AND closed_at IS NULL;
      UPDATE public.ledger_links SET failure_alerted_at=NULL WHERE shop_id=p_shop AND id=v_link;
    END IF;
  ELSIF p_result='conflict' THEN
    UPDATE public.ledger_writes SET status='unlinked',next_attempt_at=NULL,last_error_kind='conflict' WHERE shop_id=p_shop AND id=p_write;
    INSERT INTO public.owner_tasks(shop_id,kind,event_key,order_id,opened_at) VALUES(p_shop,'ledger_relink','task:ledger_conflict:'||v_order::text,v_order,p_now)
      ON CONFLICT(shop_id,event_key) DO UPDATE SET closed_at=NULL RETURNING id INTO v_task;
    INSERT INTO public.owner_alerts(shop_id,kind,event_key,owner_task_id,next_attempt_at,created_at)
      VALUES(p_shop,'ledger_failing','alert:ledger_conflict:'||v_order::text,v_task,p_now,p_now) ON CONFLICT(shop_id,event_key) DO NOTHING;
    FOR v_affected IN SELECT o.id FROM public.orders o WHERE o.shop_id=p_shop AND o.id<>v_order AND o.personal_data_purged_at IS NULL AND o.id::text IN (
      SELECT value FROM pg_catalog.jsonb_array_elements_text(CASE WHEN pg_catalog.jsonb_typeof(p_columns->'affectedOrderIds')='array' THEN p_columns->'affectedOrderIds' ELSE '[]'::jsonb END)) LOOP
      UPDATE public.ledger_writes w SET status='unlinked',next_attempt_at=NULL,last_error_kind='conflict'
        FROM public.ledger_rows r WHERE r.shop_id=p_shop AND r.order_id=v_affected AND w.shop_id=r.shop_id AND w.ledger_row_id=r.id AND w.status IN ('pending','retrying','alerted');
      INSERT INTO public.owner_tasks(shop_id,kind,event_key,order_id,opened_at) VALUES(p_shop,'ledger_relink','task:ledger_conflict:'||v_affected::text,v_affected,p_now)
        ON CONFLICT(shop_id,event_key) DO UPDATE SET closed_at=NULL RETURNING id INTO v_task;
      INSERT INTO public.owner_alerts(shop_id,kind,event_key,owner_task_id,next_attempt_at,created_at)
        VALUES(p_shop,'ledger_failing','alert:ledger_conflict:'||v_affected::text,v_task,p_now,p_now) ON CONFLICT(shop_id,event_key) DO NOTHING;
    END LOOP;
  ELSIF p_result='duplicate' THEN
    UPDATE public.ledger_writes SET status='retrying',next_attempt_at=p_now+interval '5 minutes',last_error_kind='duplicate' WHERE shop_id=p_shop AND id=p_write;
    INSERT INTO public.owner_tasks(shop_id,kind,event_key,order_id,opened_at) VALUES(p_shop,'ledger_relink','task:ledger_duplicate:'||v_order::text,v_order,p_now)
      ON CONFLICT(shop_id,event_key) DO UPDATE SET closed_at=NULL RETURNING id INTO v_task;
    IF v_task IS NOT NULL THEN
      INSERT INTO public.owner_alerts(shop_id,kind,event_key,owner_task_id,next_attempt_at,created_at)
        VALUES(p_shop,'ledger_failing','alert:ledger_duplicate:'||v_order::text,v_task,p_now,p_now) ON CONFLICT(shop_id,event_key) DO NOTHING;
    END IF;
  ELSE
    v_failed:=coalesce(v_failed,p_now);
    v_delay:=CASE v_attempts WHEN 1 THEN interval '1 minute' WHEN 2 THEN interval '5 minutes' WHEN 3 THEN interval '30 minutes' WHEN 4 THEN interval '2 hours' WHEN 5 THEN interval '6 hours' ELSE interval '1 day' END;
    UPDATE public.ledger_writes SET status=CASE WHEN p_result='auth_lost' OR v_alerted IS NOT NULL OR p_now>=v_failed+interval '24 hours' THEN 'alerted' ELSE 'retrying' END,
      first_failed_at=v_failed,write_uncertain=write_uncertain OR p_result='uncertain',last_error_kind=CASE WHEN p_result='auth_lost' THEN 'auth_lost' ELSE 'unavailable' END,
      next_attempt_at=CASE WHEN p_result='uncertain' THEN pg_catalog.statement_timestamp()+interval '5 minutes' WHEN p_result='auth_lost' OR v_alerted IS NOT NULL OR p_now>=v_failed+interval '24 hours'
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
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=role_name) THEN
      EXECUTE pg_catalog.format('REVOKE ALL ON TABLE siljang_ledger_private.ledger_call_slots FROM %I',role_name);
      EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION siljang_ledger_private.save_ledger_checkpoint(uuid,uuid,timestamptz,uuid,jsonb) FROM %I',role_name);
      EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION siljang_ledger_private.claim_ledger_write(uuid,uuid,timestamptz) FROM %I',role_name);
      EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION siljang_ledger_private.guard_ledger_write(uuid,uuid,uuid,timestamptz,text,text) FROM %I',role_name);
      EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION siljang_ledger_private.finish_ledger_write(uuid,uuid,timestamptz,text,timestamptz,jsonb) FROM %I',role_name);
      EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION siljang_ledger_private.count_unwritten_orders(uuid) FROM %I',role_name);
    END IF;
  END LOOP;
END
$block$;

-- 생성과 교체는 가게 행으로 직렬화하며, 토큰 저장은 같은 트랜잭션에서 이어진다.
CREATE OR REPLACE FUNCTION siljang_ledger_private.create_owner_ledger(p_shop uuid,p_owner uuid,p_link uuid,p_spreadsheet text,p_sheet text,p_columns jsonb,p_revision text,p_now timestamptz)
RETURNS TABLE(outcome text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE old_id uuid; old_status text; old_ref text; old_revision text; old_lease timestamptz; old_file text; old_sheet text;
BEGIN
  IF p_link IS NULL OR p_spreadsheet IS NULL OR p_sheet IS NULL OR p_columns IS NULL OR p_now IS NULL OR NOT pg_catalog.isfinite(p_now) THEN
    RAISE EXCEPTION 'invalid ledger input' USING ERRCODE='22023';
  END IF;
  PERFORM s.id FROM public.shops s WHERE s.id=p_shop AND s.owner_id=p_owner FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT l.id,l.status,l.credential_ref,l.id::text||CASE WHEN l.status='unlinked' THEN '.u' ELSE '.l' END,l.write_lease_until,l.spreadsheet_id,l.sheet_name INTO old_id,old_status,old_ref,old_revision,old_lease,old_file,old_sheet
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
  IF old_id IS NOT NULL AND (old_file IS DISTINCT FROM p_spreadsheet OR old_sheet IS DISTINCT FROM p_sheet) THEN
    UPDATE public.ledger_writes SET checkpoint_hashes=NULL,write_uncertain=false,write_in_flight=false WHERE shop_id=p_shop AND status<>'written' AND checkpoint_hashes IS NOT NULL;
    UPDATE public.ledger_writes SET audit_due_at=NULL,audit_deadline=NULL,write_uncertain=false WHERE shop_id=p_shop AND status='written' AND audit_due_at IS NOT NULL;
    UPDATE public.ledger_writes w SET status='written',written_at=coalesce((SELECT r.last_written_at FROM public.ledger_rows r WHERE r.shop_id=p_shop AND r.id=w.ledger_row_id),pg_catalog.statement_timestamp()),next_attempt_at=NULL,write_uncertain=false,write_in_flight=false,audit_due_at=NULL,audit_deadline=NULL,audit_repair_link_id=NULL WHERE w.shop_id=p_shop AND w.status<>'written' AND EXISTS (SELECT 1 FROM public.ledger_links origin WHERE origin.shop_id=w.shop_id AND origin.id=w.audit_repair_link_id AND (origin.spreadsheet_id IS DISTINCT FROM p_spreadsheet OR origin.sheet_name IS DISTINCT FROM p_sheet));
  END IF;
  -- 사장님이 충돌 안내에 따라 시트를 확인하고 다시 연결하면 중단된 주문을 재검증한다.
  IF old_id IS NOT NULL THEN UPDATE public.owner_tasks SET closed_at=pg_catalog.statement_timestamp()
    WHERE shop_id=p_shop AND event_key LIKE 'task:ledger_conflict:%' AND closed_at IS NULL; END IF;
  UPDATE public.ledger_writes SET resume_approved=true,resume_needs_audit=resume_needs_audit OR write_uncertain,write_uncertain=false,write_in_flight=false,checkpoint_hashes=NULL WHERE shop_id=p_shop AND status='unlinked' AND last_error_kind='conflict';
  UPDATE public.ledger_writes SET status='pending',next_attempt_at=greatest(pg_catalog.statement_timestamp(),coalesce(old_lease,pg_catalog.statement_timestamp()), CASE WHEN write_uncertain THEN coalesce(next_attempt_at,pg_catalog.statement_timestamp()) ELSE pg_catalog.statement_timestamp() END)
    WHERE shop_id=p_shop AND status IN ('unlinked','alerted','retrying','pending');
  RETURN QUERY SELECT CASE WHEN old_id IS NULL THEN 'created' ELSE 'relinked' END;
END
$fn$;
REVOKE ALL ON FUNCTION siljang_ledger_private.create_owner_ledger(uuid,uuid,uuid,text,text,jsonb,text,timestamptz) FROM PUBLIC;

-- 예약 임대와 무관하게 연결 ID·해제 여부로 설정 버전을 판정한다.
CREATE OR REPLACE FUNCTION read_owner_ledger(p_shop uuid,p_owner uuid,p_link uuid)
RETURNS TABLE(id uuid,status text,spreadsheet_id text,sheet_name text,our_columns jsonb,
  linked_at timestamptz,unlinked_at timestamptz,revision text,failing_since timestamptz,unwritten_count integer)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
  SELECT l.id,CASE WHEN l.status='linked' AND NOT siljang_ledger_private.ledger_vault_present(l.credential_ref,l.shop_id,l.id) THEN 'auth_lost' ELSE l.status END,l.spreadsheet_id,l.sheet_name,
    jsonb_build_object('columns',COALESCE((
      SELECT jsonb_agg(jsonb_build_object('header',c.value->'header','column',c.value->'column') ORDER BY c.position)
      FROM jsonb_array_elements(CASE
        WHEN jsonb_typeof(l.our_columns)='array' THEN l.our_columns
        WHEN jsonb_typeof(l.our_columns->'columns')='array' THEN l.our_columns->'columns'
        ELSE '[]'::jsonb END) WITH ORDINALITY AS c(value,position)
    ),'[]'::jsonb),'movedRight',COALESCE(l.our_columns->'movedRight','false'::jsonb)),
    l.linked_at,l.unlinked_at,l.id::text||CASE WHEN l.status='unlinked' THEN '.u' ELSE '.l' END,
    (SELECT min(w.first_failed_at) FROM public.ledger_writes w WHERE w.shop_id=p_shop AND w.status<>'written'),
    (SELECT least(count(*),100000)::int FROM public.ledger_writes wc WHERE wc.shop_id=p_shop AND wc.status<>'written')
  FROM public.ledger_links l WHERE l.shop_id=p_shop AND (p_link IS NULL OR l.id=p_link)
    AND EXISTS(SELECT 1 FROM public.shops s WHERE s.id=p_shop AND s.owner_id=p_owner)
  ORDER BY (l.status<>'unlinked') DESC,l.linked_at DESC,l.id DESC LIMIT 1
$fn$;
REVOKE ALL ON FUNCTION read_owner_ledger(uuid,uuid,uuid) FROM PUBLIC;


CREATE OR REPLACE FUNCTION siljang_ledger_private.lock_owner_ledger(p_shop uuid,p_owner uuid,p_revision text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE old_id uuid; old_revision text;
BEGIN
  PERFORM s.id FROM public.shops s WHERE s.id=p_shop AND s.owner_id=p_owner FOR UPDATE;
  IF NOT FOUND THEN RETURN 'missing'; END IF;
  SELECT l.id,l.id::text||CASE WHEN l.status='unlinked' THEN '.u' ELSE '.l' END INTO old_id,old_revision FROM public.ledger_links l WHERE l.shop_id=p_shop
    ORDER BY (l.status<>'unlinked') DESC,l.linked_at DESC,l.id DESC LIMIT 1 FOR UPDATE;
  IF (old_id IS NULL AND p_revision IS NOT NULL) OR (old_id IS NOT NULL AND p_revision IS DISTINCT FROM old_revision) THEN
    RETURN 'conflict';
  END IF;
  RETURN 'ok';
END
$fn$;
REVOKE ALL ON FUNCTION siljang_ledger_private.lock_owner_ledger(uuid,uuid,text) FROM PUBLIC;

-- 주문 개인정보 삭제와 동시에 그 가게의 진행 중 비교 기준 및 해당 주문의 서명을 지운다.
CREATE FUNCTION public.purge_ledger_signatures() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
  IF OLD.personal_data_purged_at IS NULL AND NEW.personal_data_purged_at IS NOT NULL THEN
    UPDATE public.ledger_rows SET sheet_hash=NULL,sheet_hashes='{}'::jsonb,sheet_key_version=NULL
      WHERE shop_id=NEW.shop_id AND order_id=NEW.id;
    UPDATE public.ledger_writes SET checkpoint_hashes=NULL WHERE shop_id=NEW.shop_id AND checkpoint_hashes IS NOT NULL;
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.purge_ledger_signatures() FROM PUBLIC;
DO $purge_revoke$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=role_name) THEN
      EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION public.purge_ledger_signatures() FROM %I',role_name);
    END IF;
  END LOOP;
END
$purge_revoke$;
CREATE TRIGGER orders_purge_ledger_signatures AFTER UPDATE OF personal_data_purged_at ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.purge_ledger_signatures();
