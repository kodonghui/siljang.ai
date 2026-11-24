/** SPEC-067: 알림은 허용한 종류·주문 번호·주소만 만든다. detail과 개인정보는 읽지 않는다. */
import { type OwnerAlert, renderOwnerAlert, TASK_LABELS } from "./owner-alert-card";
import type { ShopDb } from "./shop-scope";

export interface OwnerAlertContent {
  readonly text: string;
  readonly url: string;
}
export async function ownerAlertContent(
  db: ShopDb,
  row: { id: string; kind: string; event_key: string; task_kind: string | null },
  origin: URL,
): Promise<OwnerAlertContent | null> {
  const count =
    (
      await db.run<{ count: number }>(
        "SELECT (count(*)+1)::int AS count FROM owner_alerts WHERE shop_id=$1 AND batched_into_id=$2",
        [row.id],
      )
    ).rows[0]?.count ?? 1;
  let alert: OwnerAlert;
  let orderNotice = false;
  switch (row.kind) {
    case "new_task":
    case "task_realert": {
      if (row.task_kind === null || !Object.hasOwn(TASK_LABELS, row.task_kind)) return null;
      const task = row.task_kind as keyof typeof TASK_LABELS;
      alert = row.kind === "new_task" ? { kind: row.kind, task, count } : { kind: row.kind, task };
      break;
    }
    case "handoff_appended":
    case "ledger_failing":
    case "payment_account_changed":
    case "identity_change_applied":
      alert = { kind: row.kind };
      break;
    case "license_on_hold":
    case "identity_change_on_hold":
      alert = { kind: row.kind, reason: "자세한 내용은 영업 신고 화면에서 확인해 주세요" };
      break;
    case "order_cancelled":
    case "new_amount_declined":
    case "change_not_applied":
    case "health_concern": {
      const parts = row.event_key.split(":"),
        id = parts[2];
      if (
        parts[0] !== "alert" ||
        parts[1] !== row.kind ||
        !id ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
      )
        return null;
      const order = (
        await db.run<{ id: string; order_no: string }>(
          `SELECT o.id,o.order_no FROM orders o WHERE o.shop_id=$1 AND
        (o.id=$2 OR o.id IN (SELECT c.order_id FROM change_requests c WHERE c.shop_id=$1 AND c.id=$2)
        OR o.id IN (SELECT i.order_id FROM issue_reports i WHERE i.shop_id=$1 AND i.id=$2))`,
          [id],
        )
      ).rows[0];
      if (!order) return null;
      alert = { kind: row.kind, orderId: order.id, orderNo: order.order_no };
      orderNotice = true;
      break;
    }
    default:
      return null;
  }
  const card = renderOwnerAlert(alert, "normal", origin)?.template.outputs[0].textCard;
  if (!card) return null;
  const text = `${card.title}\n${card.description}${count > 1 && row.kind !== "new_task" ? `\n같은 종류의 알림 ${count}건이 있어요.` : ""}`;
  return {
    text: text.length > 400 ? `${text.slice(0, 399)}…` : text,
    url: orderNotice && count > 1 ? new URL("/owner/orders", origin).href : card.buttons[0].webLinkUrl,
  };
}
