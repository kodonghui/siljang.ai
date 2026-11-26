/** SPEC052: 전날 안내의 생성/새로 고침. 가게 트랜잭션 안에서만 부르며 바깥 발신은 하지 않는다. */

import { eventKeys } from "./event-keys";
import type { TransactionHandler } from "./job-runner";
import { normalizeLineBreaks } from "./line-breaks";
import { pathId, type ShopDb } from "./shop-scope";
import { toShopLocal } from "./time";

interface Source {
  customer_id: string;
  consultation_id: string;
  order_no: string;
  pickup_at: Date;
  time_zone: string;
  pickup_address: string | null;
  contact_phone: string;
  template_key: string;
  scheduled_for: Date;
}

/** 표시는 현재 공개 가게 정보/주문에 묶는다. 이미 보낸 안내와 시작한 시도는 바꾸지 않는다. */
export async function createDayBeforeNotice(db: ShopDb, orderId: string, now: Date): Promise<boolean> {
  if (!Number.isFinite(now.getTime())) throw new RangeError("invalid day before notice time");
  const id = pathId(orderId);
  const source = (
    await db.run<Source>(
      `SELECT t.customer_id,t.consultation_id,t.order_no,t.pickup_at,s.time_zone,s.pickup_address,s.contact_phone,
        'day_before:v1:'||md5(jsonb_build_array(t.version,extract(epoch FROM t.pickup_at),s.time_zone,s.pickup_address,s.contact_phone)::text) AS template_key,
        ((t.pickup_day-1)+coalesce(b.day_before_notice_time,'18:00'::time)) AT TIME ZONE s.time_zone AS scheduled_for
      FROM orders t JOIN shops s ON s.id=$1
      LEFT JOIN business_calendars b ON b.shop_id=$1
      WHERE t.shop_id=$1 AND t.id=$2 AND t.status='confirmed' AND t.confirmed_at<=$3
        AND t.personal_data_purged_at IS NULL AND nullif(btrim(s.contact_phone),'') IS NOT NULL
        AND t.pickup_day=($3::timestamptz AT TIME ZONE s.time_zone)::date+1
        AND ($3::timestamptz AT TIME ZONE s.time_zone)::time>=coalesce(b.day_before_notice_time,'18:00'::time)
        AND to_char($3::timestamptz AT TIME ZONE s.time_zone,'HH24:MI') BETWEEN '08:00' AND '20:50'
        AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.shop_id=$1 AND n.order_id=t.id AND n.kind='day_before' AND n.sent_at IS NOT NULL)
      FOR UPDATE OF t`,
      [id, now],
    )
  ).rows[0];
  if (source === undefined) return false;
  const pickup = toShopLocal(source.pickup_at, source.time_zone);
  const address = normalizeLineBreaks(source.pickup_address ?? "").trim();
  const body = [
    `주문번호 ${source.order_no}`,
    `픽업: ${pickup.date} ${pickup.time}`,
    ...(address ? [`픽업 장소: ${address}`] : []),
    `가게 연락처: ${source.contact_phone}`,
  ].join("\n");
  if ([...body].length > 1000) throw new RangeError("day before notice exceeds text limit");
  const result = await db.run(
    `INSERT INTO notifications(shop_id,event_key,customer_id,consultation_id,order_id,kind,template_key,body,status,scheduled_for,created_at)
      VALUES($1,$2,$3,$4,$5,'day_before',$6,$7,'deferred',$8,$9)
      ON CONFLICT(shop_id,event_key) DO UPDATE SET template_key=EXCLUDED.template_key,body=EXCLUDED.body,
        scheduled_for=EXCLUDED.scheduled_for,status='deferred',next_attempt_at=NULL
      WHERE notifications.shop_id=$1 AND notifications.kind='day_before'
        AND notifications.order_id=EXCLUDED.order_id AND notifications.customer_id=EXCLUDED.customer_id
        AND notifications.consultation_id=EXCLUDED.consultation_id
        AND notifications.sent_at IS NULL AND notifications.attempts=0
        AND notifications.status IN ('pending','retrying','deferred','dropped')
        AND ((notifications.template_key,notifications.body,notifications.scheduled_for)
          IS DISTINCT FROM (EXCLUDED.template_key,EXCLUDED.body,EXCLUDED.scheduled_for) OR notifications.status='dropped')
      RETURNING id`,
    [
      eventKeys.notice(id, "day_before"),
      source.customer_id,
      source.consultation_id,
      id,
      source.template_key,
      body,
      source.scheduled_for,
      now,
    ],
  );
  return result.rowCount === 1;
}

export const dayBeforeNoticeHandler: TransactionHandler = {
  mode: "transaction",
  run: async (db, item, ctx) => {
    await createDayBeforeNotice(db, item.id, ctx.now);
  },
};
