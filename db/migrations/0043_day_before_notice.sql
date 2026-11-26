-- 전날 안내는 현재 가게 시각과 픽업 날짜를 대조하고 확정 주문만 선점한다.
CREATE INDEX orders_day_before_idx ON orders (confirmed_at) WHERE status = 'confirmed' AND personal_data_purged_at IS NULL;

ALTER TABLE notifications ADD COLUMN reply_claim_id uuid, ADD COLUMN reply_claim_until timestamptz,
  ADD CONSTRAINT notifications_reply_claim_chk CHECK ((reply_claim_id IS NULL) = (reply_claim_until IS NULL)
    AND (reply_claim_until IS NULL OR isfinite(reply_claim_until)));

-- 일반 역할에는 본문 UPDATE를 주지 않는다. 현재 주문의 공개 정보만 다시 만들고
-- 같은 수신자의 미전달·미시도 전날 안내 한 건만 갱신한다. 호출자가 본문을 정하지 못한다.
CREATE FUNCTION refresh_pending_day_before_notice(requesting_shop uuid, requested_order uuid, requested_time timestamptz)
RETURNS boolean LANGUAGE plpgsql STRICT SECURITY DEFINER SET search_path = pg_catalog AS $day_before_refresh$
BEGIN
  IF NOT isfinite(requested_time) THEN RETURN false; END IF;
  WITH source AS MATERIALIZED (
    SELECT t.customer_id,t.consultation_id,t.id AS order_id,t.order_no,t.pickup_at,s.time_zone,s.contact_phone,
      btrim(replace(replace(coalesce(s.pickup_address,''),E'\r\n',E'\n'),E'\r',E'\n'),
        E' \t\n\u000b\f\r\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff') AS address,
      'day_before:v1:'||md5(jsonb_build_array(t.version,extract(epoch FROM t.pickup_at),s.time_zone,s.pickup_address,s.contact_phone)::text) AS template_key,
      (((t.pickup_at AT TIME ZONE s.time_zone)::date-1)+coalesce(b.day_before_notice_time,'18:00'::time)) AT TIME ZONE s.time_zone AS scheduled_for
    FROM public.orders t JOIN public.shops s ON s.id=requesting_shop
    JOIN public.consultations c ON c.shop_id=requesting_shop AND c.id=t.consultation_id
      AND c.customer_id=t.customer_id AND c.deleted_at IS NULL
    JOIN public.customers recipient ON recipient.shop_id=requesting_shop AND recipient.id=t.customer_id
      AND recipient.purged_at IS NULL AND recipient.kakao_user_key IS NOT NULL
    LEFT JOIN public.business_calendars b ON b.shop_id=requesting_shop
    WHERE t.shop_id=requesting_shop AND t.id=requested_order AND t.status='confirmed'
      AND t.confirmed_at<=requested_time AND t.personal_data_purged_at IS NULL AND isfinite(t.pickup_at)
      AND nullif(btrim(s.contact_phone),'') IS NOT NULL
      AND (t.pickup_at AT TIME ZONE s.time_zone)::date=(requested_time AT TIME ZONE s.time_zone)::date+1
      AND (requested_time AT TIME ZONE s.time_zone)::time>=coalesce(b.day_before_notice_time,'18:00'::time)
      AND to_char(requested_time AT TIME ZONE s.time_zone,'HH24:MI') BETWEEN '08:00' AND '20:50'
      AND NOT EXISTS(SELECT 1 FROM public.notifications sent_notice WHERE sent_notice.shop_id=requesting_shop
        AND sent_notice.order_id=t.id AND sent_notice.kind='day_before' AND sent_notice.sent_at IS NOT NULL)
    FOR UPDATE OF t
  ), content AS (
    SELECT source.*,'주문번호 '||order_no||E'\n픽업: '||to_char(pickup_at AT TIME ZONE time_zone,'YYYY-MM-DD HH24:MI')
      ||CASE WHEN address<>'' THEN E'\n픽업 장소: '||address ELSE '' END
      ||E'\n가게 연락처: '||contact_phone AS body FROM source
  )
  UPDATE public.notifications n SET template_key=content.template_key,body=content.body,
    scheduled_for=content.scheduled_for,status='deferred',next_attempt_at=NULL,reply_claim_id=NULL,reply_claim_until=NULL
  FROM content WHERE n.shop_id=requesting_shop AND n.order_id=content.order_id
    AND n.event_key='notice:'||requested_order::text||':day_before' AND n.kind='day_before'
    AND n.customer_id=content.customer_id AND n.consultation_id=content.consultation_id
    AND n.sent_at IS NULL AND n.attempts=0 AND n.status IN ('pending','retrying','deferred','dropped')
    AND (n.reply_claim_until IS NULL OR n.reply_claim_until<=requested_time)
    AND char_length(content.body) BETWEEN 1 AND 1000 AND isfinite(content.scheduled_for)
    AND ((n.template_key,n.body,n.scheduled_for) IS DISTINCT FROM (content.template_key,content.body,content.scheduled_for)
      OR n.status='dropped');
  RETURN FOUND;
END
$day_before_refresh$;
REVOKE ALL ON FUNCTION refresh_pending_day_before_notice(uuid,uuid,timestamptz) FROM PUBLIC;
