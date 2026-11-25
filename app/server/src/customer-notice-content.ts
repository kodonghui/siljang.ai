/** 안내 키의 업무 자료는 같은 손님·가게에서만 읽고, 계좌는 표시 직전에만 풉니다. */
import { openAccountNumber } from "./account-number";
import { confirmedNoticeContents, reviewNoticeContents } from "./customer-notice-presentation";
import { TEXT_CUSTOMER_NOTICE_KINDS } from "./customer-notice-store";
import type { FieldCrypto } from "./field-crypto";
import type { KakaoMessageContent } from "./kakao-message-content";
import type { KakaoPaymentNormalView } from "./kakao-payment-message";
import { paymentChangeSummary } from "./payment-change-presentation";
import type { ShopDb } from "./shop-scope";

export const READABLE_CUSTOMER_NOTICE_KINDS = [...TEXT_CUSTOMER_NOTICE_KINDS, "payment_request"] as const;
/** JavaScript trim과 같은 공백 문자. SQL 정리와 표시 가능 여부가 서로 어긋나지 않게 한다. */
export const CUSTOMER_NOTICE_WHITESPACE =
  "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
export interface CustomerNoticeView {
  readonly id: string;
  readonly customerId: string;
  readonly kind: string;
  readonly body: string;
}
interface Payment {
  kind: string;
  status: string;
  amount: number;
  requested_amount: number | null;
  quote_amount: number | null;
  quote_amount_max: number | null;
  quote_display: string | null;
  amount_change_reason: string | null;
  needs_amount_confirm: boolean;
  amount_confirmed_at: Date | null;
  amount_card_id: string | null;
  delivered_at: Date | null;
  issued_at: Date;
  due_at: Date;
  due_cap_at: Date;
  card_payment_url: string | null;
  order_id: string;
  order_no: string;
  order_version: number;
  order_status: string;
  change_status: string | null;
  change_set: unknown;
  change_base_version: number | null;
  change_delta: number | null;
  order_amount: number;
  bank_name: string;
  holder_name: string;
  account_number_enc: string;
  time_zone: string;
  payment_due_hours: number;
}
export async function customerNoticeContents(
  db: ShopDb,
  notice: CustomerNoticeView,
  now: Date,
  fields?: () => FieldCrypto,
): Promise<readonly KakaoMessageContent[] | null> {
  if (notice.kind === "order_confirmed") return confirmedNoticeContents(db, notice);
  if (notice.kind === "review_request") return reviewNoticeContents(db, notice);
  if (notice.kind !== "payment_request") {
    if (!notice.body.trim()) return null;
    return [
      {
        kind: "customer_notice",
        view: {
          state: "normal",
          notice:
            notice.kind === "payment_mismatch"
              ? { kind: "payment_mismatch" }
              : { kind: "server_text", text: notice.body },
        },
      },
    ];
  }
  const payment = (
    await db.run<Payment>(
      `SELECT p.kind,p.status,p.amount,p.requested_amount,p.needs_amount_confirm,p.amount_confirmed_at,p.amount_card_id,
      p.delivered_at,p.issued_at,p.due_at,p.due_cap_at,p.card_payment_url,o.id AS order_id,o.order_no,o.version AS order_version,
      q.amount AS quote_amount,q.amount_max AS quote_amount_max,q.display_kind AS quote_display,accepted.amount_change_reason,
      o.status AS order_status,o.amount AS order_amount,cr.status AS change_status,cr.changes AS change_set,
      cr.base_version AS change_base_version,cr.amount_delta AS change_delta,
      a.bank_name,a.holder_name,a.account_number_enc,s.time_zone,r.payment_due_hours
      FROM notifications n JOIN orders o ON o.shop_id=$1 AND o.id=n.order_id AND o.customer_id=n.customer_id
      JOIN payment_requests p ON p.shop_id=$1 AND p.order_id=o.id AND n.event_key='notice:'||p.id::text||':payment_request'
      JOIN payment_accounts a ON a.shop_id=$1 AND a.id=p.payment_account_id JOIN shops s ON s.id=$1
      JOIN operating_rules r ON r.shop_id=$1 AND r.id=o.operating_rules_id
      LEFT JOIN order_details original ON original.shop_id=$1 AND original.order_id=o.id AND original.version=1
      LEFT JOIN quotes q ON q.shop_id=$1 AND q.id=original.quote_id
      LEFT JOIN order_details accepted ON accepted.shop_id=$1 AND accepted.order_id=o.id AND accepted.version=o.accepted_version
      LEFT JOIN change_requests cr ON cr.shop_id=$1 AND cr.id=p.change_request_id AND cr.order_id=o.id
      WHERE n.shop_id=$1 AND n.id=$2 AND n.customer_id=$3 AND n.kind='payment_request' AND n.status<>'dropped'
        AND o.personal_data_purged_at IS NULL`,
      [notice.id, notice.customerId],
    )
  ).rows[0];
  if (!payment || payment.issued_at > now) return null;
  if (payment.due_cap_at <= now) return ["결제 기한이 지나 사장님이 확인하고 있어요"];
  if (
    payment.status !== "open" ||
    (payment.kind === "difference"
      ? payment.order_status !== "confirmed" || payment.change_status !== "awaiting_difference"
      : payment.order_status !== "awaiting_payment")
  )
    return ["지금은 이 결제 안내를 사용할 수 없어요"];
  let adjustment: KakaoPaymentNormalView["adjustment"];
  if (payment.requested_amount !== null) {
    if (payment.quote_amount !== payment.requested_amount || !payment.quote_display || !payment.amount_change_reason)
      return ["지금은 이 결제 안내를 사용할 수 없어요"];
    const amount = payment.requested_amount.toLocaleString("ko-KR");
    const display =
      payment.quote_display === "from"
        ? `${amount}원부터`
        : payment.quote_display === "range" && payment.quote_amount_max !== null
          ? `${amount}~${payment.quote_amount_max.toLocaleString("ko-KR")}원`
          : payment.quote_display === "fixed"
            ? `${amount}원`
            : null;
    if (display === null) return ["지금은 이 결제 안내를 사용할 수 없어요"];
    const displayKind = payment.quote_display;
    if (displayKind !== "fixed" && displayKind !== "from" && displayKind !== "range")
      return ["지금은 이 결제 안내를 사용할 수 없어요"];
    adjustment = {
      requestedQuote: { amount: payment.requested_amount, amountMax: payment.quote_amount_max, displayKind },
      reason: payment.amount_change_reason,
    };
  }
  if (payment.needs_amount_confirm && payment.amount_confirmed_at === null) {
    const card =
      payment.amount_card_id === null
        ? undefined
        : (
            await db.run<{ card_key: string; card_block_id: string | null; expires_at: Date }>(
              `SELECT k.card_key,ch.card_block_id,k.expires_at FROM confirm_cards k
        JOIN customers u ON u.shop_id=$1 AND u.id=k.customer_id
        JOIN kakao_channels ch ON ch.shop_id=$1 AND ch.id=u.kakao_channel_id AND ch.status='linked'
        WHERE k.shop_id=$1 AND k.id=$2 AND k.customer_id=$3 AND k.kind='amount_confirm'
          AND k.order_id=$4 AND k.order_version=$5 AND k.created_at<=$6 AND k.expires_at>$6 AND k.used_at IS NULL`,
              [payment.amount_card_id, notice.customerId, payment.order_id, payment.order_version, now],
            )
          ).rows[0];
    if (!card?.card_block_id) return ["지금은 새 금액 확인 카드를 사용할 수 없어요"];
    if (payment.kind !== "difference") {
      if (!adjustment) return ["지금은 새 금액 확인 카드를 사용할 수 없어요"];
      return [
        {
          kind: "payment_notice",
          view: {
            state: "amount-confirm",
            kind: "custom",
            requestedQuote: adjustment.requestedQuote,
            amount: payment.amount,
            reason: adjustment.reason,
            cardKey: card.card_key,
            blockId: card.card_block_id,
            expiresAt: card.expires_at.toISOString(),
            timeZone: payment.time_zone,
          },
        },
      ];
    }
    const changes = paymentChangeSummary(payment.change_set, payment.time_zone);
    if (
      changes === null ||
      payment.change_base_version !== payment.order_version ||
      payment.change_delta !== payment.amount ||
      payment.order_amount + payment.amount > 10000000
    )
      return ["지금은 새 금액 확인 카드를 사용할 수 없어요"];
    return [
      {
        kind: "payment_notice",
        view: {
          state: "amount-confirm",
          kind: "difference",
          changes,
          currentAmount: payment.order_amount,
          newAmount: payment.order_amount + payment.amount,
          difference: payment.amount,
          changeDeadline: payment.due_cap_at.toISOString(),
          cardKey: card.card_key,
          blockId: card.card_block_id,
          expiresAt: card.expires_at.toISOString(),
          timeZone: payment.time_zone,
        },
      },
    ];
  }
  if (payment.delivered_at !== null && payment.due_at <= now) return ["결제 기한이 지나 사장님이 확인하고 있어요"];
  if (fields === undefined) return null;
  const account = await openAccountNumber(
    fields(),
    payment.account_number_enc,
    "payment_accounts.account_number",
    db.scope.shopId,
  );
  const kind = payment.kind;
  if (kind !== "first" && kind !== "reissue" && kind !== "difference")
    return ["지금은 이 결제 안내를 사용할 수 없어요"];
  return [
    {
      kind: "payment_notice",
      view: {
        state: "normal",
        kind,
        orderNo: payment.order_no,
        amount: payment.amount,
        account: { bankName: payment.bank_name, number: account, holderName: payment.holder_name },
        dueAt: (payment.delivered_at === null ? payment.due_cap_at : payment.due_at).toISOString(),
        timeZone: payment.time_zone,
        ...(payment.card_payment_url === null ? {} : { cardPaymentUrl: payment.card_payment_url }),
        ...(payment.delivered_at === null ? { deliveryWindow: { hours: payment.payment_due_hours } } : {}),
        ...(adjustment === undefined ? {} : { adjustment }),
        ...(payment.needs_amount_confirm && payment.amount_confirmed_at !== null ? { amountConfirmed: true } : {}),
      },
    },
  ];
}
