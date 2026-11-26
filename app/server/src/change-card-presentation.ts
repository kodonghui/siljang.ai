/** 서버에서 준비한 변경 제안을 현재 자기 주문의 표시 값에 연결한다. 변경 요청/자리/금액은 쓰지 않는다. */
import { calendarBookingDays } from "./calendar";
import type { KakaoChangeDeadlineClause, KakaoChangeRequestCard } from "./kakao-change-request-message";
import { normalizeLineBreaks } from "./line-breaks";
import { paymentChangeSummary } from "./payment-change-presentation";
import type { ShopDb } from "./shop-scope";
import { toShopLocal } from "./time";

export interface ChangeRequestStatus {
  readonly currentStatus: string;
  readonly clause?: string;
  readonly clauseDetails?: KakaoChangeDeadlineClause;
}
export type ChangeCardSource =
  | {
      readonly available: true;
      readonly proposal: Readonly<Record<string, unknown>>;
      readonly presentation: Omit<KakaoChangeRequestCard, "expiresAt">;
      readonly changeDeadline: Date;
    }
  | { readonly available: false; readonly text: string; readonly status: ChangeRequestStatus };
function unavailable(currentStatus: string, clauseDetails?: KakaoChangeDeadlineClause): ChangeCardSource {
  return {
    available: false,
    text: `지금은 할 수 없어요: ${currentStatus}`,
    status: {
      currentStatus,
      ...(clauseDetails === undefined
        ? {}
        : {
            clause: [clauseDetails.title, clauseDetails.conditionText, clauseDetails.effectText].join("\n"),
            clauseDetails,
          }),
    },
  };
}
export async function readPreparedChangeCard(
  db: ShopDb,
  input: {
    readonly orderId: string;
    readonly customerId: string;
    readonly consultationId: string;
    readonly proposedChanges?: Readonly<Record<string, unknown>>;
    readonly now: Date;
  },
): Promise<ChangeCardSource> {
  const row = (
    await db.run<{
      order_no: string;
      version: number;
      status: string;
      pickup_at: Date;
      time_zone: string;
      operating_rules_id: string;
      change_deadline_hours: number;
      size_name: string | null;
      flavor_name: string | null;
      design_name: string | null;
      design_notes: string | null;
      lettering: string | null;
      colors: string | null;
      courier_pickup: boolean;
      extras: string[];
    }>(
      `SELECT o.order_no,o.version,o.status,o.pickup_at,s.time_zone,o.operating_rules_id,r.change_deadline_hours,
      sz.name AS size_name,fl.name AS flavor_name,coalesce(de.name,ds.name) AS design_name,
      d.design_notes,d.lettering,d.colors,d.courier_pickup,
      ARRAY(SELECT p.name FROM order_detail_extras x JOIN price_options p ON p.shop_id=$1 AND p.price_list_id=x.price_list_id AND p.id=x.option_id
        WHERE x.shop_id=$1 AND x.order_detail_id=d.id ORDER BY p.position,p.id) AS extras
      FROM orders o JOIN order_details d ON d.shop_id=$1 AND d.order_id=o.id AND d.version=o.version
      JOIN shops s ON s.id=$1 JOIN operating_rules r ON r.shop_id=$1 AND r.id=o.operating_rules_id
      LEFT JOIN price_options sz ON sz.shop_id=$1 AND sz.price_list_id=d.price_list_id AND sz.id=d.size_option_id
      LEFT JOIN price_options fl ON fl.shop_id=$1 AND fl.price_list_id=d.price_list_id AND fl.id=d.flavor_option_id
      LEFT JOIN price_options ds ON ds.shop_id=$1 AND ds.price_list_id=d.price_list_id AND ds.id=d.design_option_id
      LEFT JOIN designs de ON de.shop_id=$1 AND de.price_list_id=d.price_list_id AND de.id=d.design_id
      WHERE o.shop_id=$1 AND o.id=$2 AND o.customer_id=$3 AND o.consultation_id=$4 AND o.personal_data_purged_at IS NULL`,
      [input.orderId, input.customerId, input.consultationId],
    )
  ).rows[0];
  if (!row) return unavailable("주문 내용을 다시 확인해 주세요");
  if (["requested", "awaiting_payment", "payment_overdue"].includes(row.status))
    return unavailable("결제 전 주문이에요. 주문 요청을 취소하고 다시 요청할 수 있어요");
  if (row.status !== "confirmed")
    return unavailable(
      row.status === "received"
        ? "이미 받은 주문이에요"
        : row.status === "cancelled"
          ? "이미 취소된 주문이에요"
          : "지금 변경할 수 없는 주문이에요",
    );
  const open = await db.run(
    "SELECT id FROM change_requests WHERE shop_id=$1 AND order_id=$2 AND status IN ('requested','awaiting_difference') LIMIT 1",
    [input.orderId],
  );
  if (open.rowCount) return unavailable("앞의 변경 요청을 사장님이 보고 있어요");
  const deadline = new Date(row.pickup_at.getTime() - row.change_deadline_hours * 3600000);
  if (input.now.getTime() >= deadline.getTime()) {
    const clause = (
      await db.run<{ title: string; condition_text: string; effect_text: string }>(
        "SELECT title,condition_text,effect_text FROM rule_clauses WHERE shop_id=$1 AND operating_rules_id=$2 AND clause_key='change_deadline' ORDER BY position LIMIT 1",
        [row.operating_rules_id],
      )
    ).rows[0];
    return unavailable(
      "변경 마감이 지나 바꿀 수 없어요",
      clause
        ? { title: clause.title, conditionText: clause.condition_text, effectText: clause.effect_text }
        : undefined,
    );
  }
  const proposed = input.proposedChanges;
  if (!proposed || paymentChangeSummary(proposed, row.time_zone) === null)
    return unavailable("바꾸려는 내용을 다시 말씀해 주세요");
  const proposal = Object.fromEntries(
    Object.entries(proposed).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]),
  );
  const changes: { label: string; before: string; after: string }[] = [];
  for (const [key, label, before] of [
    ["size", "크기", row.size_name],
    ["flavor", "맛", row.flavor_name],
    ["design", "디자인", row.design_name],
    ["designNotes", "디자인 설명", row.design_notes],
    ["lettering", "문구", row.lettering],
    ["colors", "색", row.colors],
  ] as const) {
    const after = proposal[key];
    if (typeof after === "string") {
      const original = normalizeLineBreaks(before ?? ""),
        proposed = normalizeLineBreaks(after);
      if (original !== proposed) changes.push({ label, before: original, after: proposed });
    }
  }
  if (Array.isArray(proposal.extras)) {
    const before = normalizeLineBreaks(row.extras.join(" · ")),
      after = normalizeLineBreaks(proposal.extras.join(" · "));
    if (before !== after) changes.push({ label: "더하는 옵션", before, after });
  }
  if (typeof proposal.courierPickup === "boolean" && proposal.courierPickup !== row.courier_pickup)
    changes.push({
      label: "픽업 방법",
      before: row.courier_pickup ? "손님이 부른 퀵" : "방문 픽업",
      after: proposal.courierPickup ? "손님이 부른 퀵" : "방문 픽업",
    });
  let requiresOwnerApproval = false;
  if (typeof proposal.pickupAt === "string") {
    const before = toShopLocal(row.pickup_at, row.time_zone),
      after = toShopLocal(new Date(proposal.pickupAt), row.time_zone);
    if (before.date !== after.date) {
      changes.push({ label: "픽업 날짜", before: before.date, after: after.date });
      const configured = await db.run("SELECT shop_id FROM business_calendars WHERE shop_id=$1");
      const days = configured.rowCount ? await calendarBookingDays(db, input.now) : [];
      requiresOwnerApproval = days.find((day) => day.day === after.date)?.status !== "open";
    }
    if (before.time !== after.time) changes.push({ label: "픽업 시간", before: before.time, after: after.time });
  }
  if (!changes.length) return unavailable("바꾸려는 내용이 지금 주문과 같아요");
  return {
    available: true,
    proposal,
    changeDeadline: deadline,
    presentation: {
      orderNo: row.order_no,
      currentVersion: row.version,
      changes,
      requiresOwnerApproval,
      timeZone: row.time_zone,
    },
  };
}
