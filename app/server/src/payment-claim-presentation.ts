/** SCR006의 개인 표시는 전송 직전에만 읽는다. 반환값 전체를 저장하거나 AI로 보내지 않는다. */
import type { KakaoPaymentClaimCard } from "./kakao-payment-claim-message";
import type { ShopDb } from "./shop-scope";

export interface PaymentClaimBinding {
  readonly paymentRequestId: string;
  readonly version: number;
  readonly amount: number;
  readonly dueAt: string;
  readonly awaitingDelivery: boolean;
}
export type PaymentClaimSource =
  | {
      readonly available: true;
      readonly binding: PaymentClaimBinding;
      readonly presentation: Omit<KakaoPaymentClaimCard, "cardKey" | "cardBlockId" | "expiresAt">;
    }
  | { readonly available: false; readonly text: string };

export async function readPaymentClaimSource(
  db: ShopDb,
  input: { readonly orderId: string; readonly customerId: string; readonly consultationId: string },
): Promise<PaymentClaimSource> {
  const row = (
    await db.run<{
      id: string;
      version: number;
      amount: number;
      due_at: Date;
      delivered_at: Date | null;
      kind: string;
      change_status: string | null;
      payment_due_hours: number;
      status: string;
      claimed_at: Date | null;
      needs_amount_confirm: boolean;
      amount_confirmed_at: Date | null;
      order_no: string;
      customer_name: string | null;
      time_zone: string;
      depositor_block_id: string;
    }>(
      `SELECT p.id,p.version,p.amount,p.due_at,p.delivered_at,p.kind,cr.status AS change_status,r.payment_due_hours,p.status,p.claimed_at,p.needs_amount_confirm,p.amount_confirmed_at,
        o.order_no,d.customer_name,s.time_zone,k.depositor_block_id
      FROM payment_requests p
      JOIN orders o ON o.shop_id=$1 AND o.id=p.order_id
      JOIN order_details d ON d.shop_id=$1 AND d.order_id=o.id AND d.version=o.version
      JOIN shops s ON s.id=$1
      JOIN operating_rules r ON r.shop_id=$1 AND r.id=o.operating_rules_id
      LEFT JOIN change_requests cr ON cr.shop_id=$1 AND cr.id=p.change_request_id AND cr.order_id=o.id
      JOIN customers c ON c.shop_id=$1 AND c.id=o.customer_id
      JOIN kakao_channels k ON k.shop_id=$1 AND k.id=c.kakao_channel_id AND k.status='linked'
      WHERE p.shop_id=$1 AND o.id=$2 AND o.customer_id=$3 AND o.consultation_id=$4
        AND o.personal_data_purged_at IS NULL
      ORDER BY p.issued_at DESC,p.id DESC LIMIT 1 FOR UPDATE OF p`,
      [input.orderId, input.customerId, input.consultationId],
    )
  ).rows[0];
  if (row === undefined) return { available: false, text: "지금은 할 수 없어요: 열린 결제 안내가 없어요" };
  if (row.kind === "difference" && row.change_status?.startsWith("closed"))
    return { available: false, text: "지금은 할 수 없어요: 변경 요청이 닫혀 차액 결제를 요청할 수 없어요" };
  if (row.status === "paid") return { available: false, text: "지금은 할 수 없어요: 이미 결제가 확인됐어요" };
  if (row.claimed_at !== null || row.status === "claimed")
    return { available: false, text: "지금은 할 수 없어요: 이미 결제 확인을 요청했어요" };
  if (row.kind === "difference" && (row.status !== "open" || row.change_status !== "awaiting_difference"))
    return { available: false, text: "지금은 할 수 없어요: 차액 결제를 기다리는 변경 요청이 없어요" };
  if (!["open", "expired"].includes(row.status))
    return { available: false, text: "지금은 할 수 없어요: 열린 결제 안내가 없어요" };
  if (row.needs_amount_confirm && row.amount_confirmed_at === null)
    return { available: false, text: "지금은 할 수 없어요: 새 금액을 먼저 확인해 주세요" };
  if (row.customer_name === null)
    return { available: false, text: "지금은 할 수 없어요: 주문자 정보를 다시 확인해 주세요" };
  return {
    available: true,
    binding: {
      paymentRequestId: row.id,
      version: row.version,
      amount: row.amount,
      dueAt: row.due_at.toISOString(),
      awaitingDelivery: row.delivered_at === null,
    },
    presentation: {
      orderNo: row.order_no,
      amount: row.amount,
      dueAt: row.due_at.toISOString(),
      depositorName: row.customer_name,
      timeZone: row.time_zone,
      depositorBlockId: row.depositor_block_id,
      ...(row.delivered_at === null ? { deliveryWindow: { hours: row.payment_due_hours } } : {}),
    },
  };
}
