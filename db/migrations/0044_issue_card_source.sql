-- TASK-147: 현재 손님·상담·주문의 모으는 신고 자료만 표시한다. 원문 전체 읽기와 쓰기는 열지 않는다.
CREATE FUNCTION read_prepared_issue_card(requesting_shop uuid, requested_customer uuid,
  requested_consultation uuid, requested_order uuid)
RETURNS TABLE(order_no text, status text, time_zone text, handed_over_at timestamptz,
  details_id uuid, description text, health_concern boolean, photos jsonb)
LANGUAGE plpgsql STRICT SECURITY DEFINER SET search_path = pg_catalog AS $issue_card_source$
DECLARE
  order_source record;
  current_details uuid;
  current_description text;
  current_health boolean;
  photo_metadata jsonb := '[]'::jsonb;
BEGIN
  SELECT o.order_no,o.status,s.time_zone,p.handed_over_at INTO order_source
  FROM public.orders o JOIN public.shops s ON s.id=requesting_shop
  JOIN public.consultations c ON c.shop_id=requesting_shop AND c.id=requested_consultation
    AND c.customer_id=requested_customer AND c.status NOT IN ('ended','deleted','dropped')
  LEFT JOIN public.productions p ON p.shop_id=requesting_shop AND p.order_id=o.id
  WHERE o.shop_id=requesting_shop AND o.id=requested_order AND o.customer_id=requested_customer
    AND o.personal_data_purged_at IS NULL FOR UPDATE OF o;
  IF NOT FOUND THEN RETURN; END IF;
  IF order_source.status='received' AND order_source.handed_over_at IS NOT NULL
    AND isfinite(order_source.handed_over_at) THEN
    -- 먼저 부모를 잠가 사진을 더하는 외래 키 쓰기도 기다리게 한다.
    SELECT i.id,i.description,i.health_concern INTO current_details,current_description,current_health
    FROM public.issue_details i WHERE i.shop_id=requesting_shop AND i.order_id=requested_order
      AND i.consultation_id=requested_consultation AND i.status='collecting' AND i.content_purged_at IS NULL
    FOR UPDATE OF i;
    IF FOUND THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'position',p.position) ORDER BY p.position,p.id),'[]'::jsonb)
      INTO photo_metadata FROM public.issue_photos p
      WHERE p.shop_id=requesting_shop AND p.issue_details_id=current_details;
    END IF;
  END IF;
  RETURN QUERY SELECT order_source.order_no::text,order_source.status::text,order_source.time_zone::text,
    order_source.handed_over_at,current_details,current_description,current_health,photo_metadata;
END
$issue_card_source$;
REVOKE ALL ON FUNCTION read_prepared_issue_card(uuid,uuid,uuid,uuid) FROM PUBLIC;
