/** AI는 종류와 주문번호만 제안합니다. 카드의 대상·표시·버전은 현재 서버 기록으로 정합니다. */
import type { AiTurnOutput } from "./ai-turn-output";
import { CUSTOMER_COMMAND_KINDS, type CustomerCommandKind, showConfirmCardInTransaction } from "./confirm-card-store";
import type { ShopDb } from "./shop-scope";

export function supportedCardProposal(card: AiTurnOutput["card"]): boolean {
  return (
    card !== undefined &&
    CUSTOMER_COMMAND_KINDS.includes(card.kind as CustomerCommandKind) &&
    card.changes === undefined &&
    (card.order_no === undefined || /^[0-9A-Z]{6,12}$/.test(card.order_no)) &&
    (card.kind !== "order_request" || card.order_no === undefined)
  );
}

export async function prepareAiConfirmCard(
  db: ShopDb,
  card: NonNullable<AiTurnOutput["card"]>,
  input: {
    readonly customerId: string;
    readonly consultationId: string;
    readonly sourceMessageId: string;
    readonly now: Date;
  },
) {
  if (!supportedCardProposal(card)) return null;
  const kind = card.kind as CustomerCommandKind;
  if (kind === "order_request") {
    const drafts = await db.run<{ id: string }>(
      "SELECT id FROM order_drafts WHERE shop_id=$1 AND consultation_id=$2 AND status='active' LIMIT 2",
      [input.consultationId],
    );
    const draft = drafts.rows[0];
    return drafts.rows.length === 1 && draft !== undefined
      ? showConfirmCardInTransaction(db, { ...input, kind, draftId: draft.id })
      : null;
  }
  const orders = await db.run<{ id: string }>(
    `SELECT id FROM orders WHERE shop_id=$1 AND customer_id=$2
      AND (consultation_id=$3 OR $4::boolean) AND personal_data_purged_at IS NULL
      AND ($5::text IS NULL OR order_no=$5) ORDER BY id LIMIT 2`,
    [
      input.customerId,
      input.consultationId,
      ["issue_report", "consent_withdrawal"].includes(kind),
      card.order_no ?? null,
    ],
  );
  const order = orders.rows[0];
  return orders.rows.length === 1 && order !== undefined
    ? showConfirmCardInTransaction(db, { ...input, kind, orderId: order.id })
    : null;
}
