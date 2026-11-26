/** 같은 n/o/s 별칭에서 예약 안내의 현재 의미와 보낼 시간을 대조한다. 값은 바인딩한다. */
type TimeParameter = 3 | 5 | 6;

export function scheduledNoticeMeaningSql(parameter: TimeParameter): string {
  const at = `$${parameter}::timestamptz`;
  return `(
    n.kind NOT IN ('day_before','review_request') OR (
      n.scheduled_for IS NOT NULL AND o.id IS NOT NULL AND o.customer_id=n.customer_id AND (
        (n.kind='day_before' AND o.status='confirmed' AND o.pickup_at>${at}
          AND (${at} AT TIME ZONE s.time_zone)::date<=(n.scheduled_for AT TIME ZONE s.time_zone)::date
          AND o.pickup_day=(n.scheduled_for AT TIME ZONE s.time_zone)::date+1
          AND (left(n.template_key,14)<>'day_before:v1:' OR (
            n.template_key='day_before:v1:'||md5(jsonb_build_array(o.version,extract(epoch FROM o.pickup_at),s.time_zone,s.pickup_address,s.contact_phone)::text)
            AND n.scheduled_for=(((o.pickup_day-1)+coalesce(
              (SELECT current_calendar.day_before_notice_time FROM business_calendars current_calendar WHERE current_calendar.shop_id=$1),
              '18:00'::time)) AT TIME ZONE s.time_zone)
          )))
        OR (n.kind='review_request' AND o.status='received' AND o.remake_of_order_id IS NULL
          AND NOT EXISTS(SELECT 1 FROM issue_reports reported WHERE reported.shop_id=$1 AND reported.order_id=o.id))
      )
    )
  )`;
}

export function scheduledNoticeReadySql(parameter: TimeParameter): string {
  const at = `$${parameter}::timestamptz`;
  return `(n.kind NOT IN ('day_before','review_request') OR (
    n.scheduled_for<=${at} AND to_char(${at} AT TIME ZONE s.time_zone,'HH24:MI') BETWEEN '08:00' AND '20:50'
  ))`;
}
