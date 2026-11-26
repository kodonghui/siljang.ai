-- TASK-149: 같은 손님·상담·주문의 철회 가능한 사진 수와 게시 여부만 표시한다.
CREATE FUNCTION read_prepared_consent_withdrawal_card(requesting_shop uuid, requested_customer uuid,
  requested_consultation uuid, requested_order uuid)
RETURNS TABLE(order_no text, time_zone text, review_id uuid, review_version integer, photos jsonb)
LANGUAGE plpgsql STRICT SECURITY DEFINER SET search_path = pg_catalog AS $withdrawal_card_source$
DECLARE
  order_source record;
  current_review uuid;
  current_review_version integer;
  photo_metadata jsonb := '[]'::jsonb;
BEGIN
  SELECT o.order_no,s.time_zone INTO order_source
  FROM public.orders o JOIN public.shops s ON s.id=requesting_shop
  JOIN public.consultations c ON c.shop_id=requesting_shop AND c.id=requested_consultation
    AND c.customer_id=requested_customer AND c.status NOT IN ('ended','deleted','dropped')
  WHERE o.shop_id=requesting_shop AND o.id=requested_order AND o.customer_id=requested_customer
    AND o.personal_data_purged_at IS NULL FOR UPDATE OF o;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT r.id,r.version INTO current_review,current_review_version FROM public.reviews r
  WHERE r.shop_id=requesting_shop AND r.order_id=requested_order AND r.superseded_at IS NULL FOR UPDATE OF r;
  -- 동의 행을 먼저 잠근다. 사진 본문과 저장 위치는 반환하지 않는다.
  PERFORM p.id FROM public.photo_consents p
  WHERE p.shop_id=requesting_shop AND p.order_id=requested_order AND p.publishable
    AND p.consented AND p.withdrawn_at IS NULL ORDER BY p.id FOR UPDATE OF p;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'scope',p.scope,'published',EXISTS (
    SELECT 1 FROM public.portfolio_items i WHERE i.shop_id=requesting_shop AND i.photo_consent_id=p.id
      AND i.unpublished_at IS NULL
  )) ORDER BY p.id),'[]'::jsonb) INTO photo_metadata
  FROM public.photo_consents p
  WHERE p.shop_id=requesting_shop AND p.order_id=requested_order AND p.publishable
    AND p.consented AND p.withdrawn_at IS NULL AND (
      (p.scope='completion_photo' AND EXISTS (
        SELECT 1 FROM public.completion_photos cp JOIN public.productions pr
          ON pr.shop_id=requesting_shop AND pr.id=cp.production_id AND pr.order_id=requested_order
        WHERE cp.shop_id=requesting_shop AND cp.id=p.completion_photo_id
      )) OR (p.scope='review_photo' AND EXISTS (
        SELECT 1 FROM public.review_photos rp JOIN public.reviews r
          ON r.shop_id=requesting_shop AND r.id=rp.review_id AND r.order_id=requested_order
        WHERE rp.shop_id=requesting_shop AND rp.id=p.review_photo_id
      ))
    );
  RETURN QUERY SELECT order_source.order_no::text,order_source.time_zone::text,
    current_review,current_review_version,photo_metadata;
END
$withdrawal_card_source$;
REVOKE ALL ON FUNCTION read_prepared_consent_withdrawal_card(uuid,uuid,uuid,uuid) FROM PUBLIC;
