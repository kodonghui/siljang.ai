-- TASK-159: 운영자의 가린 기록 조회. 원문 열기와 접속기록은 API-077/074~076의 같은 트랜잭션에서 처리한다.
-- 트랜잭션은 db-migrate.sh와 스테이징 갱신기가 연다.

CREATE FUNCTION read_operator_order(p_shop uuid,p_operator uuid,p_order uuid)
RETURNS TABLE(body jsonb,customer_id uuid)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object(
    'orderId',o.id,'orderNo',o.order_no,'kind',o.kind,'status',o.status,
    'pickupAt',o.pickup_at,'amount',o.amount,
    'customerNameMasked',CASE WHEN left(btrim(d.customer_name),1) ~ '^[^*[:space:]]$' THEN left(btrim(d.customer_name),1)||repeat('*',greatest(char_length(btrim(d.customer_name))-1,0)) END,
    'customerPhoneMasked',CASE WHEN char_length(regexp_replace(d.customer_phone,'[^0-9]','','g'))>=4 THEN '***-****-'||right(regexp_replace(d.customer_phone,'[^0-9]','','g'),4) END,
    'allergyAnswered',nullif(d.allergy_answer,'') IS NOT NULL,
    'excludedIngredientsAnswered',nullif(d.excluded_ingredients,'') IS NOT NULL,
    'referencePhotoCount',(SELECT count(*)::int FROM public.reference_photos rp WHERE rp.shop_id=p_shop AND rp.draft_id=o.draft_id),
    'consultationId',o.consultation_id,
    'paymentRequests',coalesce((SELECT jsonb_agg(p.value ORDER BY p.issued_at,p.id) FROM (
      SELECT pr.id,pr.issued_at,jsonb_build_object('paymentRequestId',pr.id,'kind',pr.kind,'status',pr.status,'amount',pr.amount,'issuedAt',pr.issued_at,'paidAt',pr.paid_at) AS value
      FROM public.payment_requests pr WHERE pr.shop_id=p_shop AND pr.order_id=o.id ORDER BY pr.issued_at DESC,pr.id DESC LIMIT 20
    ) p),'[]'::jsonb),
    'refunds',coalesce((SELECT jsonb_agg(f.value ORDER BY f.decided_at,f.id) FROM (
      SELECT rf.id,rf.decided_at,jsonb_build_object('refundId',rf.id,'cause',rf.cause,'decision',rf.decision,'amount',rf.amount,'decidedAt',rf.decided_at,'sentAt',rf.sent_at,
        'refundAccount',CASE WHEN rf.refund_account_last4 IS NULL THEN NULL ELSE jsonb_build_object('bankName',rf.refund_bank_name,'accountMasked','***-****-'||rf.refund_account_last4,
          'holderNameMasked',CASE WHEN left(btrim(rf.refund_holder_name),1) ~ '^[^*[:space:]]$' THEN left(btrim(rf.refund_holder_name),1)||repeat('*',greatest(char_length(btrim(rf.refund_holder_name))-1,0)) END) END) AS value
      FROM public.refunds rf WHERE rf.shop_id=p_shop AND rf.order_id=o.id ORDER BY rf.decided_at DESC,rf.id DESC LIMIT 20
    ) f),'[]'::jsonb),
    'createdAt',o.requested_at
  ),o.customer_id
  FROM public.orders o JOIN public.order_details d ON d.shop_id=p_shop AND d.order_id=o.id AND d.version=o.version
  WHERE o.shop_id=p_shop AND o.id=p_order AND o.personal_data_purged_at IS NULL
    AND EXISTS(SELECT 1 FROM public.operators op WHERE op.id=p_operator AND op.disabled_at IS NULL AND op.mfa_enrolled_at IS NOT NULL AND op.mfa_factor_id IS NOT NULL);
$$;
COMMENT ON FUNCTION read_operator_order(uuid,uuid,uuid) IS 'TASK-159 운영자 주문 조회: 현재 이름·연락처·환불 계좌는 가린 값, 건강 답은 유무만. 원문·사진 경로는 반환하지 않음';
REVOKE ALL ON FUNCTION read_operator_order(uuid,uuid,uuid) FROM PUBLIC;

CREATE FUNCTION read_operator_record_list(p_shop uuid,p_operator uuid,p_kind text,p_after jsonb,p_limit integer,p_now timestamptz)
RETURNS TABLE(item jsonb,customer_id uuid,cursor_at text,cursor_key text)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path=pg_catalog AS $$
  WITH authorized AS (
    SELECT 1 FROM public.operators op WHERE op.id=p_operator AND op.disabled_at IS NULL AND op.mfa_enrolled_at IS NOT NULL AND op.mfa_factor_id IS NOT NULL
  ), records AS (
    SELECT jsonb_build_object(
      'orderId',o.id,'orderNo',o.order_no,'kept',k.id IS NOT NULL,'keptRecordId',k.id,
      'status',CASE WHEN k.id IS NULL THEN o.status END,
      'pickupAt',CASE WHEN k.id IS NULL THEN o.pickup_at END,
      'amount',CASE WHEN k.id IS NULL THEN o.amount END,
      'customerNameMasked',CASE WHEN k.id IS NULL AND left(btrim(d.customer_name),1) ~ '^[^*[:space:]]$' THEN left(btrim(d.customer_name),1)||repeat('*',greatest(char_length(btrim(d.customer_name))-1,0)) END,
      'customerPhoneMasked',CASE WHEN k.id IS NULL AND char_length(regexp_replace(d.customer_phone,'[^0-9]','','g'))>=4 THEN '***-****-'||right(regexp_replace(d.customer_phone,'[^0-9]','','g'),4) END,
      'finishedAt',coalesce(k.finished_at,o.finished_at),'contractKeepUntil',k.contract_keep_until,'createdAt',o.requested_at
    ) AS item,o.customer_id,o.requested_at AS at,o.id
    FROM public.orders o
    LEFT JOIN public.order_details d ON d.shop_id=p_shop AND d.order_id=o.id AND d.version=o.version AND o.personal_data_purged_at IS NULL
    LEFT JOIN public.kept_records k ON k.shop_id=p_shop AND k.order_id=o.id AND k.contract_keep_until>p_now
    WHERE o.shop_id=p_shop AND p_kind='orders' AND EXISTS(SELECT 1 FROM authorized)
      AND (o.personal_data_purged_at IS NULL OR k.id IS NOT NULL)
    UNION ALL
    SELECT jsonb_build_object(
      'consultationId',c.id,'status',c.status,'startedAt',c.opened_at,
      'lastMessageAt',(SELECT max(m.created_at) FROM public.messages m WHERE m.shop_id=p_shop AND m.consultation_id=c.id),
      'orderNos',coalesce((SELECT jsonb_agg(q.order_no ORDER BY q.requested_at DESC,q.id DESC) FROM (
        SELECT ro.id,ro.order_no,ro.requested_at FROM public.orders ro WHERE ro.shop_id=p_shop AND ro.consultation_id=c.id
        ORDER BY ro.requested_at DESC,ro.id DESC LIMIT 20
      ) q),'[]'::jsonb),
      'maskedValueCount',(SELECT least(count(*),1000)::int FROM public.masked_values mv WHERE mv.shop_id=p_shop AND mv.consultation_id=c.id)
    ),c.customer_id,c.opened_at,c.id
    FROM public.consultations c WHERE c.shop_id=p_shop AND p_kind='consultations' AND EXISTS(SELECT 1 FROM authorized)
  )
  SELECT r.item,r.customer_id,to_char(r.at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),r.id::text
  FROM records r
  WHERE p_limit BETWEEN 1 AND 101 AND (p_after->>'at' IS NULL OR (r.at,r.id)<((p_after->>'at')::timestamptz,(p_after->>'key')::uuid))
  ORDER BY r.at DESC,r.id DESC LIMIT greatest(0,least(p_limit,101));
$$;
COMMENT ON FUNCTION read_operator_record_list(uuid,uuid,text,jsonb,integer,timestamptz) IS 'TASK-159 운영자 주문/상담 목록: 원문·사진 경로 없이 가린 값과 페이지 위치만. 보관 기록은 식별/기간만';
REVOKE ALL ON FUNCTION read_operator_record_list(uuid,uuid,text,jsonb,integer,timestamptz) FROM PUBLIC;

CREATE FUNCTION read_operator_consultation(p_shop uuid,p_operator uuid,p_consultation uuid)
RETURNS TABLE(body jsonb,customer_id uuid)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('consultationId',c.id,'status',c.status,
    'maskedValues',CASE WHEN c.status='deleted' THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(v.item ORDER BY v.kind,v.number,v.id) FROM (
        SELECT mv.id,mv.kind,regexp_replace(mv.placeholder,'[^0-9]','','g')::integer AS number,
          jsonb_build_object('maskedValueId',mv.id,'kind',mv.kind,'placeholder',mv.placeholder,'last4',mv.last4,
            'originalKept',mv.kind IN ('phone','account') AND mv.original_enc IS NOT NULL) AS item
        FROM public.masked_values mv WHERE mv.shop_id=p_shop AND mv.consultation_id=c.id
        ORDER BY mv.kind,regexp_replace(mv.placeholder,'[^0-9]','','g')::integer,mv.id LIMIT 200
      ) v
    ),'[]'::jsonb) END
  ),c.customer_id
  FROM public.consultations c WHERE c.shop_id=p_shop AND c.id=p_consultation
    AND EXISTS(SELECT 1 FROM public.operators op WHERE op.id=p_operator AND op.disabled_at IS NULL AND op.mfa_enrolled_at IS NOT NULL AND op.mfa_factor_id IS NOT NULL);
$$;
COMMENT ON FUNCTION read_operator_consultation(uuid,uuid,uuid) IS 'TASK-159 운영자 상담: 상태와 플레이스홀더/끝4자리만, 지운 상담은 빈 목록';
REVOKE ALL ON FUNCTION read_operator_consultation(uuid,uuid,uuid) FROM PUBLIC;

CREATE FUNCTION read_operator_messages(p_shop uuid,p_operator uuid,p_consultation uuid,p_after jsonb,p_limit integer)
RETURNS TABLE(item jsonb,cursor_at text,cursor_key text)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('messageId',m.id,'at',m.created_at,'direction',m.direction,'author',m.author,'kind',m.kind,
    'textLength',CASE WHEN m.direction='inbound' AND m.kind IN ('photo','unsupported') THEN 0 ELSE coalesce(char_length(m.body_masked),0) END,
    'photoCount',(
      (SELECT count(*) FROM public.reference_photos rp WHERE rp.shop_id=p_shop AND rp.message_id=m.id)+
      (SELECT count(*) FROM public.issue_photos ip WHERE ip.shop_id=p_shop AND ip.message_id=m.id)+
      (SELECT count(*) FROM public.review_photos rv WHERE rv.shop_id=p_shop AND rv.storage_key LIKE ('shops/'||p_shop::text||'/review/'||m.id::text||'/%'))
    )::integer
  ),to_char(m.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),m.timeline_seq::text
  FROM public.messages m JOIN public.consultations c ON c.shop_id=p_shop AND c.id=m.consultation_id
  WHERE m.shop_id=p_shop AND m.consultation_id=p_consultation AND c.status<>'deleted' AND p_limit BETWEEN 1 AND 101
    AND (p_after->>'at' IS NULL OR (m.created_at,m.timeline_seq)>((p_after->>'at')::timestamptz,(p_after->>'key')::bigint))
    AND EXISTS(SELECT 1 FROM public.operators op WHERE op.id=p_operator AND op.disabled_at IS NULL AND op.mfa_enrolled_at IS NOT NULL AND op.mfa_factor_id IS NOT NULL)
  ORDER BY m.created_at,m.timeline_seq LIMIT greatest(0,least(p_limit,101));
$$;
COMMENT ON FUNCTION read_operator_messages(uuid,uuid,uuid,jsonb,integer) IS 'TASK-159 운영자 메시지 메타데이터: 글자 수·저장된 사진 수만, 글과 사진 경로는 반환하지 않음';
REVOKE ALL ON FUNCTION read_operator_messages(uuid,uuid,uuid,jsonb,integer) FROM PUBLIC;

CREATE FUNCTION read_operator_original(p_shop uuid,p_operator uuid,p_kind text,p_target uuid,p_after jsonb,p_now timestamptz)
RETURNS TABLE(source jsonb,customer_id uuid)
LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  v_parent record;
  v_row record;
  v_value jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.operators op WHERE op.id=p_operator AND op.disabled_at IS NULL AND op.mfa_enrolled_at IS NOT NULL AND op.mfa_factor_id IS NOT NULL) THEN RETURN; END IF;
  IF p_kind='masked_value' THEN
    -- 상담 지우기와 같은 순서: 상담을 먼저 잠그고, 그 안의 값만 읽는다.
    SELECT c.id,c.customer_id,c.status INTO v_parent FROM public.consultations c
      JOIN public.masked_values mv ON mv.shop_id=p_shop AND mv.consultation_id=c.id AND mv.id=p_target
      WHERE c.shop_id=p_shop FOR SHARE OF c;
    IF NOT FOUND THEN RETURN; END IF;
    IF v_parent.status='deleted' THEN
      RETURN QUERY SELECT jsonb_build_object('state','erased'),v_parent.customer_id; RETURN;
    END IF;
    SELECT mv.* INTO v_row FROM public.masked_values mv WHERE mv.shop_id=p_shop AND mv.id=p_target AND mv.consultation_id=v_parent.id FOR SHARE OF mv;
    IF NOT FOUND THEN RETURN; END IF;
    IF v_row.kind NOT IN ('phone','account') OR v_row.original_enc IS NULL THEN
      RETURN QUERY SELECT jsonb_build_object('state','not_kept'),v_parent.customer_id; RETURN;
    END IF;
    v_value:=jsonb_build_object('kind',v_row.kind,'original_enc',v_row.original_enc,'last4',v_row.last4,'placeholder',v_row.placeholder,'consultationId',v_parent.id,'valueHmac',v_row.value_hmac);
  ELSIF p_kind='order_contact' THEN
    SELECT o.id,o.customer_id,o.version,o.personal_data_purged_at INTO v_parent FROM public.orders o
      WHERE o.shop_id=p_shop AND o.id=p_target FOR SHARE OF o;
    IF NOT FOUND THEN RETURN; END IF;
    IF v_parent.personal_data_purged_at IS NOT NULL THEN
      RETURN QUERY SELECT jsonb_build_object('state','erased'),v_parent.customer_id; RETURN;
    END IF;
    SELECT jsonb_build_object('customerName',d.customer_name,'customerPhone',d.customer_phone) INTO v_value
      FROM public.order_details d WHERE d.shop_id=p_shop AND d.order_id=v_parent.id AND d.version=v_parent.version;
    IF NOT FOUND THEN RETURN; END IF;
  ELSIF p_kind='refund_account' THEN
    -- 주문 지우기는 주문을 먼저 잠근다. 환불 행부터 잠그면 지우기와 교착할 수 있다.
    SELECT o.id,o.customer_id,o.personal_data_purged_at INTO v_parent FROM public.orders o
      JOIN public.refunds rf ON rf.shop_id=p_shop AND rf.order_id=o.id AND rf.id=p_target
      WHERE o.shop_id=p_shop FOR SHARE OF o;
    IF NOT FOUND THEN RETURN; END IF;
    IF v_parent.personal_data_purged_at IS NOT NULL THEN
      RETURN QUERY SELECT jsonb_build_object('state','erased'),v_parent.customer_id; RETURN;
    END IF;
    SELECT rf.* INTO v_row FROM public.refunds rf WHERE rf.shop_id=p_shop AND rf.id=p_target AND rf.order_id=v_parent.id FOR SHARE OF rf;
    IF NOT FOUND THEN RETURN; END IF;
    IF v_row.refund_account_enc IS NULL THEN
      RETURN QUERY SELECT jsonb_build_object('state','not_kept'),v_parent.customer_id; RETURN;
    END IF;
    v_value:=jsonb_build_object('enc',v_row.refund_account_enc,'last4',v_row.refund_account_last4,'bankName',v_row.refund_bank_name,'holderName',v_row.refund_holder_name);
  ELSIF p_kind='consultation_text' THEN
    SELECT c.id,c.customer_id,c.status INTO v_parent FROM public.consultations c
      WHERE c.shop_id=p_shop AND c.id=p_target FOR SHARE OF c;
    IF NOT FOUND THEN RETURN; END IF;
    IF v_parent.status='deleted' THEN
      RETURN QUERY SELECT jsonb_build_object('state','erased'),v_parent.customer_id; RETURN;
    END IF;
    SELECT jsonb_build_object('consultationId',v_parent.id,'items',coalesce(jsonb_agg(q.item ORDER BY q.created_at,q.timeline_seq),'[]'::jsonb)) INTO v_value FROM (
      SELECT m.created_at,m.timeline_seq,jsonb_build_object('messageId',m.id,'at',m.created_at,'author',m.author,
        'textMasked',CASE WHEN m.direction='inbound' AND m.kind IN ('photo','unsupported') THEN NULL ELSE m.body_masked END) AS item
      FROM public.messages m WHERE m.shop_id=p_shop AND m.consultation_id=v_parent.id
        AND (p_after->>'at' IS NULL OR (m.created_at,m.timeline_seq)>((p_after->>'at')::timestamptz,(p_after->>'key')::bigint))
      ORDER BY m.created_at,m.timeline_seq LIMIT 20
    ) q;
  ELSIF p_kind='kept_record' THEN
    SELECT k.*,o.order_no,o.customer_id INTO v_parent FROM public.kept_records k
      JOIN public.orders o ON o.shop_id=p_shop AND o.id=k.order_id
      WHERE k.shop_id=p_shop AND k.id=p_target AND k.contract_keep_until>p_now FOR SHARE OF k;
    IF NOT FOUND THEN RETURN; END IF;
    SELECT jsonb_build_object('keptRecordId',v_parent.id,'orderNo',v_parent.order_no,'customerName',v_parent.customer_name,
      'finishedAt',v_parent.finished_at,'contractKeepUntil',v_parent.contract_keep_until,'issueKeepUntil',v_parent.issue_keep_until,'issuePurgedAt',v_parent.issue_purged_at,
      'details',coalesce((SELECT jsonb_agg(q.item ORDER BY q.version) FROM (
        SELECT d.version,jsonb_build_object('version',d.version,'createdAt',d.created_at,'pickupAt',d.pickup_at,'amount',d.amount,
          'summary',left(concat_ws(' · ','계약 버전 '||d.version::text,
            (SELECT string_agg(po.name,' · ' ORDER BY po.option_group,po.position,po.id) FROM public.price_options po
              WHERE po.shop_id=p_shop AND po.price_list_id=d.price_list_id AND (po.id IN (d.size_option_id,d.flavor_option_id,d.design_option_id)
                OR po.id IN (SELECT x.option_id FROM public.order_detail_extras x WHERE x.shop_id=p_shop AND x.order_detail_id=d.id))),
            CASE WHEN d.courier_pickup THEN '퀵 픽업' END),300)) AS item
        FROM public.order_details d WHERE d.shop_id=p_shop AND d.order_id=v_parent.order_id ORDER BY d.version LIMIT 50
      ) q),'[]'::jsonb),
      'payments',coalesce((SELECT jsonb_agg(q.item ORDER BY q.issued_at,q.id) FROM (
        SELECT pr.id,pr.issued_at,jsonb_build_object('kind',pr.kind,'status',pr.status,'amount',pr.amount,'issuedAt',pr.issued_at,'paidAt',pr.paid_at) AS item
        FROM public.payment_requests pr WHERE pr.shop_id=p_shop AND pr.order_id=v_parent.order_id ORDER BY pr.issued_at DESC,pr.id DESC LIMIT 20
      ) q),'[]'::jsonb),
      'refunds',coalesce((SELECT jsonb_agg(q.item ORDER BY q.decided_at,q.id) FROM (
        SELECT rf.id,rf.decided_at,jsonb_build_object('cause',rf.cause,'decision',rf.decision,'amount',rf.amount,'decidedAt',rf.decided_at,'sentAt',rf.sent_at) AS item
        FROM public.refunds rf WHERE rf.shop_id=p_shop AND rf.order_id=v_parent.order_id ORDER BY rf.decided_at DESC,rf.id DESC LIMIT 20
      ) q),'[]'::jsonb)
    ) INTO v_value;
  ELSE RETURN;
  END IF;
  RETURN QUERY SELECT jsonb_build_object('state','ready','value',v_value),v_parent.customer_id;
END;
$$;
COMMENT ON FUNCTION read_operator_original(uuid,uuid,text,uuid,jsonb,timestamptz) IS 'TASK-159 사유 있는 원문 열기 자료: 가게·운영자·대상 한 개만, 지우기와 같은 부모 잠금 순서. 호출자는 응답과 접속기록을 같은 트랜잭션에 둠';
REVOKE ALL ON FUNCTION read_operator_original(uuid,uuid,text,uuid,jsonb,timestamptz) FROM PUBLIC;
