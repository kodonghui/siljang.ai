-- TASK-159: 배포용 역할은 닫힌 상담 한 건의 내용 지우기 함수만 실행한다.
CREATE FUNCTION purge_closed_consultation(p_shop uuid,p_consultation uuid,p_now timestamptz)
RETURNS integer LANGUAGE plpgsql STRICT SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE purged integer;
BEGIN
  IF NOT pg_catalog.isfinite(p_now) THEN
    RAISE EXCEPTION 'invalid purge cutoff' USING ERRCODE='22008';
  END IF;
  p_now := least(p_now, pg_catalog.statement_timestamp());
  IF NOT EXISTS (
    SELECT c.id FROM public.consultations c WHERE c.shop_id = p_shop AND c.id = p_consultation
           AND ((c.status = 'dropped' AND c.dropped_at <= p_now::timestamptz - interval '30 days')
             OR (c.status = 'ended' AND c.ended_at <= p_now::timestamptz - interval '30 days'))
           AND NOT EXISTS (SELECT 1 FROM public.handoffs ho WHERE ho.shop_id = p_shop AND ho.consultation_id = p_consultation AND ho.status = 'open')
           AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.shop_id = p_shop AND o.personal_data_purged_at IS NULL
             AND (o.consultation_id = p_consultation
               OR o.id IN (SELECT cc.order_id FROM public.confirm_cards cc WHERE cc.shop_id = p_shop AND cc.consultation_id = p_consultation)
               OR o.id IN (SELECT ide.order_id FROM public.issue_details ide WHERE ide.shop_id = p_shop AND ide.consultation_id = p_consultation)
               OR o.id IN (SELECT hr.order_id FROM public.handoffs hr WHERE hr.shop_id = p_shop AND hr.consultation_id = p_consultation)
               OR o.id IN (SELECT hd.day_used_order_id FROM public.handoffs hd WHERE hd.shop_id = p_shop AND hd.consultation_id = p_consultation)
               OR o.id IN (SELECT hl.limit_used_order_id FROM public.handoffs hl WHERE hl.shop_id = p_shop AND hl.consultation_id = p_consultation)
               OR o.id IN (SELECT hq.order_id FROM public.handoff_questions hq JOIN public.handoffs hj
                            ON hj.shop_id = p_shop AND hj.id = hq.handoff_id WHERE hq.shop_id = p_shop AND hj.consultation_id = p_consultation)
               OR o.id IN (SELECT no.order_id FROM public.notifications no WHERE no.shop_id = p_shop AND no.consultation_id = p_consultation)))
         FOR UPDATE SKIP LOCKED
  ) THEN RETURN 0; END IF;

  UPDATE public.owner_alerts SET owner_task_id = NULL WHERE shop_id = p_shop AND owner_task_id IN (
         SELECT t.id FROM public.owner_tasks t JOIN public.handoffs h ON h.shop_id = p_shop AND h.id = t.handoff_id
         WHERE t.shop_id = p_shop AND h.consultation_id = p_consultation);

  DELETE FROM public.owner_tasks WHERE shop_id = p_shop AND handoff_id IN (
         SELECT h.id FROM public.handoffs h WHERE h.shop_id = p_shop AND h.consultation_id = p_consultation);

  DELETE FROM public.handoff_questions WHERE shop_id = p_shop AND handoff_id IN (
         SELECT h.id FROM public.handoffs h WHERE h.shop_id = p_shop AND h.consultation_id = p_consultation);

  UPDATE public.issue_reports SET handoff_id = NULL WHERE shop_id = p_shop AND handoff_id IN (
         SELECT h.id FROM public.handoffs h WHERE h.shop_id = p_shop AND h.consultation_id = p_consultation);

  DELETE FROM public.handoffs WHERE shop_id = p_shop AND consultation_id = p_consultation;

  DELETE FROM public.confirm_cards WHERE shop_id = p_shop AND draft_id IN (
         SELECT d.id FROM public.order_drafts d WHERE d.shop_id = p_shop AND d.consultation_id = p_consultation
           AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.shop_id = p_shop AND o.draft_id = d.id));

  DELETE FROM public.quotes WHERE shop_id = p_shop AND draft_id IN (
         SELECT d.id FROM public.order_drafts d WHERE d.shop_id = p_shop AND d.consultation_id = p_consultation
           AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.shop_id = p_shop AND o.draft_id = d.id));

  WITH gone AS (DELETE FROM public.reference_photos WHERE shop_id = p_shop AND draft_id IN (
         SELECT d.id FROM public.order_drafts d WHERE d.shop_id = p_shop AND d.consultation_id = p_consultation) RETURNING storage_key)
       INSERT INTO public.file_deletions (shop_id, storage_key, source, queued_at)
       SELECT p_shop, storage_key, 'reference_photo', p_now FROM gone ON CONFLICT (storage_key) DO NOTHING;

  WITH gone AS (DELETE FROM public.issue_photos WHERE shop_id = p_shop AND issue_details_id IN (
         SELECT i.id FROM public.issue_details i WHERE i.shop_id = p_shop AND i.consultation_id = p_consultation AND i.status <> 'reported')
         RETURNING storage_key)
       INSERT INTO public.file_deletions (shop_id, storage_key, source, queued_at)
       SELECT p_shop, storage_key, 'issue_photo', p_now FROM gone ON CONFLICT (storage_key) DO NOTHING;

  DELETE FROM public.issue_details WHERE shop_id = p_shop AND consultation_id = p_consultation AND status <> 'reported';

  UPDATE public.issue_photos SET message_id = NULL WHERE shop_id = p_shop AND message_id IN (
         SELECT m.id FROM public.messages m WHERE m.shop_id = p_shop AND m.consultation_id = p_consultation);

  DELETE FROM public.order_draft_extras WHERE shop_id = p_shop AND draft_id IN (
         SELECT d.id FROM public.order_drafts d WHERE d.shop_id = p_shop AND d.consultation_id = p_consultation
           AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.shop_id = p_shop AND o.draft_id = d.id));

  DELETE FROM public.order_drafts d WHERE d.shop_id = p_shop AND d.consultation_id = p_consultation
         AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.shop_id = p_shop AND o.draft_id = d.id);

  INSERT INTO public.masked_value_erasures (shop_id,id,consultation_id,erased_at)
         SELECT p_shop,mv.id,p_consultation,p_now FROM public.masked_values mv WHERE mv.shop_id=p_shop AND mv.consultation_id=p_consultation
         ON CONFLICT DO NOTHING;

  DELETE FROM public.masked_values WHERE shop_id = p_shop AND consultation_id = p_consultation;

  DELETE FROM public.notifications WHERE shop_id = p_shop AND consultation_id = p_consultation;

  DELETE FROM public.ai_tool_calls WHERE shop_id = p_shop AND consultation_id = p_consultation;

  DELETE FROM public.messages WHERE shop_id = p_shop AND consultation_id = p_consultation;

  UPDATE public.consultations SET status = 'deleted', deleted_at = p_now, turn_trace_id = NULL, turn_started_at = NULL
       WHERE shop_id = p_shop AND id = p_consultation;
  GET DIAGNOSTICS purged=ROW_COUNT;
  RETURN purged;
END $fn$;
COMMENT ON FUNCTION purge_closed_consultation(uuid,uuid,timestamptz) IS '닫힌 지30일·열린 건 없음·주문 보관을 같은 가게와 상담에서 확인하고 내용/삭제ID/파일 삭제 대기를 한 트랜잭션으로 처리';
REVOKE ALL ON FUNCTION purge_closed_consultation(uuid,uuid,timestamptz) FROM PUBLIC;
