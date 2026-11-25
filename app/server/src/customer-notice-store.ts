/** SPEC-066: 안내 생성은 업무 명령의 가게 트랜잭션 안에서 호출한다. */

import { readOrderNoticeSummary } from "./customer-notice-presentation";
import { eventKeys, insertOnce, type Once } from "./event-keys";
import type { ShopDb } from "./shop-scope";
import { toShopLocal } from "./time";

export const TEXT_CUSTOMER_NOTICE_KINDS = [
  "owner_reply",
  "delay_notice",
  "custom_rejected",
  "no_answer_closed",
  "order_confirmed",
  "day_before",
  "review_request",
  "channel_add",
  "payment_mismatch",
  "cancelled",
  "change_result",
  "change_not_applied",
  "refund",
  "compensation",
  "completion_photo",
  "refund_sent",
  "payment_corrected",
] as const;

export async function createPaymentRequestNotice(
  db: ShopDb,
  paymentRequestId: string,
  now: Date,
  options: { readonly sendEnabled?: boolean } = {},
): Promise<Once | null> {
  const key = eventKeys.notice(paymentRequestId, "payment_request");
  const existing = (
    await db.run<{ id: string }>("SELECT id FROM notifications WHERE shop_id=$1 AND event_key=$2", [key])
  ).rows[0];
  if (existing) return { id: existing.id, created: false };
  const source = (
    await db.run<{
      customer_id: string;
      consultation_id: string;
      order_id: string;
      channel_friend: boolean;
      channel_status: string;
      event_status: string;
    }>(
      `SELECT o.customer_id,o.consultation_id,o.id AS order_id,u.channel_friend,ch.status AS channel_status,ch.event_status
    FROM payment_requests p JOIN orders o ON o.shop_id=$1 AND o.id=p.order_id
    JOIN consultations c ON c.shop_id=$1 AND c.id=o.consultation_id AND c.customer_id=o.customer_id
    JOIN customers u ON u.shop_id=$1 AND u.id=o.customer_id
    JOIN kakao_channels ch ON ch.shop_id=$1 AND ch.id=u.kakao_channel_id
    LEFT JOIN change_requests cr ON cr.shop_id=$1 AND cr.id=p.change_request_id AND cr.order_id=o.id
    WHERE p.shop_id=$1 AND p.id=$2 AND p.status='open' AND p.issued_at<=$3 AND p.due_cap_at>$3
      AND o.personal_data_purged_at IS NULL AND c.status<>'deleted'
      AND (CASE WHEN p.kind='difference' THEN o.status='confirmed' AND cr.status='awaiting_difference' ELSE o.status='awaiting_payment' END)`,
      [paymentRequestId, now],
    )
  ).rows[0];
  if (!source) return null;
  const send =
    options.sendEnabled === true &&
    source.channel_friend &&
    source.channel_status === "linked" &&
    source.event_status === "ready";
  return insertOnce(
    db,
    "notifications",
    `INSERT INTO notifications (shop_id, event_key, customer_id, consultation_id, order_id, kind, template_key, body, status, next_attempt_at, created_at)
    VALUES ($1, $2, $3, $4, $5, 'payment_request', 'payment_request:v1', '결제 안내를 확인해 주세요', $6, $7, $8)
    ON CONFLICT (shop_id, event_key) DO NOTHING RETURNING id`,
    [
      key,
      source.customer_id,
      source.consultation_id,
      source.order_id,
      send ? "pending" : "deferred",
      send ? now : null,
      now,
    ],
  );
}

/** 실제 전달 표시와 같은 트랜잭션에서만 결제 시계를 시작한다. */
export async function recordPaymentNoticeDelivery(
  db: ShopDb,
  noticeId: string,
  customerId: string,
  at: Date,
): Promise<boolean> {
  if (!Number.isFinite(at.getTime())) throw new RangeError("invalid customer notice delivery time");
  const result = await db.run(
    `UPDATE payment_requests p SET delivered_at=$4,due_at=LEAST($4::timestamptz+make_interval(hours=>r.payment_due_hours),p.due_cap_at)
      FROM notifications n JOIN orders o ON o.shop_id=$1 AND o.id=n.order_id AND o.customer_id=n.customer_id
      JOIN operating_rules r ON r.shop_id=$1 AND r.id=o.operating_rules_id
      LEFT JOIN order_details original ON original.shop_id=$1 AND original.order_id=o.id AND original.version=1
      LEFT JOIN quotes q ON q.shop_id=$1 AND q.id=original.quote_id
      LEFT JOIN order_details accepted ON accepted.shop_id=$1 AND accepted.order_id=o.id AND accepted.version=o.accepted_version
      WHERE p.shop_id=$1 AND p.order_id=o.id AND p.status='open' AND p.delivered_at IS NULL
        AND NOT p.needs_amount_confirm AND p.issued_at<=$4 AND p.due_cap_at>$4
        AND (p.requested_amount IS NULL OR (q.amount=p.requested_amount AND q.display_kind IN ('fixed','from','range') AND accepted.amount_change_reason IS NOT NULL))
        AND o.status='awaiting_payment' AND o.personal_data_purged_at IS NULL
        AND n.shop_id=$1 AND n.id=$2 AND n.customer_id=$3 AND n.kind='payment_request'
        AND n.event_key='notice:'||p.id::text||':payment_request'
        AND n.status IN ('sent','delivered_on_reply') AND n.sent_at=$4`,
    [noticeId, customerId, at],
  );
  return result.rowCount === 1;
}

interface ConfirmedOrder {
  version: number;
  customer_id: string;
  consultation_id: string;
  order_no: string;
  pickup_at: Date;
  paid_amount: number;
  business_name: string;
  representative_name: string;
  business_address: string;
  contact_phone: string;
  time_zone: string;
  channel_friend: boolean;
  channel_status: string;
  event_status: string;
}

export async function createOrderConfirmedNotice(
  db: ShopDb,
  orderId: string,
  now: Date,
  options: { readonly sendEnabled?: boolean } = {},
): Promise<Once | null> {
  const key = eventKeys.notice(orderId, "order_confirmed");
  const existing = (
    await db.run<{ id: string }>("SELECT n.id FROM notifications n WHERE n.shop_id=$1 AND n.event_key=$2", [key])
  ).rows[0];
  if (existing) return { id: existing.id, created: false };
  const order = (
    await db.run<ConfirmedOrder>(
      `SELECT o.customer_id,o.consultation_id,o.order_no,o.version,o.pickup_at,p.amount AS paid_amount,
      s.business_name,s.representative_name,s.business_address,s.contact_phone,s.time_zone,
      u.channel_friend,ch.status AS channel_status,ch.event_status
      FROM orders o JOIN shops s ON s.id=$1
      JOIN payments p ON p.shop_id=$1 AND p.order_id=o.id AND p.id=o.confirmed_payment_id AND p.voided_at IS NULL
      JOIN consultations c ON c.shop_id=$1 AND c.id=o.consultation_id AND c.customer_id=o.customer_id
      JOIN customers u ON u.shop_id=$1 AND u.id=o.customer_id
      JOIN kakao_channels ch ON ch.shop_id=$1 AND ch.id=u.kakao_channel_id
      WHERE o.shop_id=$1 AND o.id=$2 AND o.status IN ('confirmed','received','no_pickup')
        AND o.personal_data_purged_at IS NULL AND c.status<>'deleted'`,
      [orderId],
    )
  ).rows[0];
  if (!order) return null;
  const summary = await readOrderNoticeSummary(db, orderId, order.version);
  if (summary === null) return null;
  const pickup = toShopLocal(order.pickup_at, order.time_zone);
  const body = `주문이 확정됐어요\n주문번호 ${order.order_no}\n결제가 확인된 금액 ${order.paid_amount.toLocaleString("ko-KR")}원\n픽업 ${pickup.date} ${pickup.time}\n상호 ${order.business_name}\n대표자 ${order.representative_name}\n사업장 주소 ${order.business_address}\n전화번호 ${order.contact_phone}\n${summary}`;
  if ([...body].length > 2000) throw new RangeError("confirmed notice body too long");
  const send =
    options.sendEnabled === true &&
    order.channel_friend &&
    order.channel_status === "linked" &&
    order.event_status === "ready";
  return insertOnce(
    db,
    "notifications",
    `INSERT INTO notifications (shop_id, event_key, customer_id, consultation_id, order_id, kind, template_key, body, status, next_attempt_at, created_at)
     VALUES ($1, $2, $3, $4, $5, 'order_confirmed', 'order_confirmed:v2', $6, $7, $8, $9)
     ON CONFLICT (shop_id, event_key) DO NOTHING RETURNING id`,
    [
      key,
      order.customer_id,
      order.consultation_id,
      orderId,
      body,
      send ? "pending" : "deferred",
      send ? now : null,
      now,
    ],
  );
}
