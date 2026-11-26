-- TASK-159: 운영자의 가린 기록 조회. 원문 열기와 접속기록은 API-077/074~076의 같은 트랜잭션에서 처리한다.
BEGIN;

CREATE FUNCTION read_operator_order(p_shop uuid,p_operator uuid,p_order uuid)
RETURNS TABLE(body jsonb,customer_id uuid)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object(
    'orderId',o.id,'orderNo',o.order_no,'kind',o.kind,'status',o.status,
    'pickupAt',o.pickup_at,'amount',o.amount,
    'customerNameMasked',CASE WHEN nullif(btrim(d.customer_name),'') IS NULL THEN NULL ELSE left(btrim(d.customer_name),1)||repeat('*',greatest(char_length(btrim(d.customer_name))-1,0)) END,
    'customerPhoneMasked',CASE WHEN d.customer_phone IS NULL THEN NULL ELSE '***-****-'||right(regexp_replace(d.customer_phone,'[^0-9]','','g'),4) END,
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
          'holderNameMasked',CASE WHEN nullif(btrim(rf.refund_holder_name),'') IS NULL THEN NULL ELSE left(btrim(rf.refund_holder_name),1)||repeat('*',greatest(char_length(btrim(rf.refund_holder_name))-1,0)) END) END) AS value
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

COMMIT;
