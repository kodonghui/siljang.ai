/** 안내 키의 업무 자료는 같은 손님·가게에서만 읽고, 계좌는 표시 직전에만 풉니다. */
import { openAccountNumber } from "./account-number";
import { TEXT_CUSTOMER_NOTICE_KINDS } from "./customer-notice-store";
import type { FieldCrypto } from "./field-crypto";
import type { KakaoMessageContent } from "./kakao-message-content";
import type { ShopDb } from "./shop-scope";
import { toShopLocal } from "./time";

export const READABLE_CUSTOMER_NOTICE_KINDS = [...TEXT_CUSTOMER_NOTICE_KINDS, "payment_request"] as const;
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
  bank_name: string;
  holder_name: string;
  account_number_enc: string;
  time_zone: string;
}
export function customerNoticeTexts(body: string): string[] {
  const chars = [...body],
    contents: string[] = [];
  for (let at = 0; at < chars.length; at += 1000) contents.push(chars.slice(at, at + 1000).join(""));
  return contents;
}
export async function customerNoticeContents(
  db: ShopDb,
  notice: CustomerNoticeView,
  now: Date,
  fields?: () => FieldCrypto,
): Promise<readonly KakaoMessageContent[] | null> {
  if (notice.kind !== "payment_request") return notice.body.trim() ? customerNoticeTexts(notice.body) : null;
  const payment = (
    await db.run<Payment>(
      `SELECT p.kind,p.status,p.amount,p.requested_amount,p.needs_amount_confirm,p.amount_confirmed_at,p.amount_card_id,
      p.delivered_at,p.issued_at,p.due_at,p.due_cap_at,p.card_payment_url,o.id AS order_id,o.order_no,o.version AS order_version,
      o.status AS order_status,cr.status AS change_status,a.bank_name,a.holder_name,a.account_number_enc,s.time_zone
      FROM notifications n JOIN orders o ON o.shop_id=$1 AND o.id=n.order_id AND o.customer_id=n.customer_id
      JOIN payment_requests p ON p.shop_id=$1 AND p.order_id=o.id AND n.event_key='notice:'||p.id::text||':payment_request'
      JOIN payment_accounts a ON a.shop_id=$1 AND a.id=p.payment_account_id JOIN shops s ON s.id=$1
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
  if (payment.needs_amount_confirm && payment.amount_confirmed_at === null) {
    const card =
      payment.amount_card_id === null
        ? undefined
        : (
            await db.run<{ card_key: string; block_card_confirm_id: string | null }>(
              `SELECT k.card_key,ch.block_card_confirm_id FROM confirm_cards k
        JOIN customers u ON u.shop_id=$1 AND u.id=k.customer_id
        JOIN kakao_channels ch ON ch.shop_id=$1 AND ch.id=u.kakao_channel_id AND ch.status='linked'
        WHERE k.shop_id=$1 AND k.id=$2 AND k.customer_id=$3 AND k.kind='amount_confirm'
          AND k.order_id=$4 AND k.order_version=$5 AND k.created_at<=$6 AND k.expires_at>$6 AND k.used_at IS NULL`,
              [payment.amount_card_id, notice.customerId, payment.order_id, payment.order_version, now],
            )
          ).rows[0];
    if (!card?.block_card_confirm_id) return ["지금은 새 금액 확인 카드를 사용할 수 없어요"];
    return [
      {
        cardKey: card.card_key,
        title: "새 금액 확인",
        description: `주문번호 ${payment.order_no}\n${payment.kind === "difference" ? "추가 결제할 금액" : "새 결제 금액"} ${payment.amount.toLocaleString("ko-KR")}원`,
        confirmLabel: "이 금액으로 할게요",
        blockId: card.block_card_confirm_id,
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
  const deadline = toShopLocal(payment.delivered_at === null ? payment.due_cap_at : payment.due_at, payment.time_zone);
  const when =
    payment.delivered_at === null
      ? `이 안내가 전달된 때부터 12시간 안(상한 ${deadline.date} ${deadline.time})`
      : `${deadline.date} ${deadline.time}`;
  let body = `주문번호 ${payment.order_no}\n결제할 금액 ${payment.amount.toLocaleString("ko-KR")}원\n은행 ${payment.bank_name}\n계좌번호 ${account}\n예금주 ${payment.holder_name}\n결제 기한 ${when}`;
  if (payment.card_payment_url) {
    try {
      const url = new URL(payment.card_payment_url);
      if (url.protocol === "https:" && !url.username && !url.password) body += `\n카드 결제 ${url.href}`;
    } catch {
      /* 잘못된 옛 링크는 안내에 넣지 않는다. */
    }
  }
  return customerNoticeTexts(body);
}
