/** 요청 당시 규정의 계산 공통부. 수입·환불의 몫 배분과 API-049는 TASK-121에서 연결한다. */
import { pathId, type ShopDb } from "./shop-scope";

interface Rule {
  rule_id: string;
  version: number;
  cancellation_fee_krw: number;
  pre_production_refund_pct: number;
  date_change_refund_basis: "original_pickup" | "new_pickup";
  pickup_at: Date;
  original_pickup_at: Date;
  custom_material_ordered_at: Date | null;
  production_started_at: Date | null;
}

/** funds는 호출자가 원장 배분으로 검증한 금액이다. 외부 요청 본문을 그대로 넘기지 않는다. */
export async function quoteOrderCancellation(
  db: ShopDb,
  input: {
    readonly orderId: string;
    readonly cancelledAt: Date;
    readonly funds: { readonly received: number; readonly decided: number; readonly reserved: number };
    readonly reason: "customer" | "shop";
  },
) {
  for (const amount of Object.values(input.funds))
    if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError("invalid cancellation funds");
  if (!Number.isFinite(input.cancelledAt.getTime())) throw new RangeError("invalid cancellation time");
  const rule = await db.found<Rule>(
    `SELECT r.id AS rule_id,r.version,r.cancellation_fee_krw,r.pre_production_refund_pct,r.date_change_refund_basis,
      o.pickup_at,d.pickup_at AS original_pickup_at,p.custom_material_ordered_at,p.production_started_at
     FROM orders o JOIN operating_rules r ON r.shop_id=$1 AND r.id=o.operating_rules_id
     JOIN order_details d ON d.shop_id=$1 AND d.order_id=o.id AND d.version=1
     LEFT JOIN productions p ON p.shop_id=$1 AND p.order_id=o.id WHERE o.shop_id=$1 AND o.id=$2`,
    [pathId(input.orderId)],
  );
  const base = Math.max(0, Math.max(0, input.funds.received - input.funds.decided) - input.funds.reserved);
  const pickup = rule.date_change_refund_basis === "original_pickup" ? rule.original_pickup_at : rule.pickup_at;
  const hoursBefore = Math.max(0, Math.floor((pickup.getTime() - input.cancelledAt.getTime()) / 3600000));
  const started = [rule.custom_material_ordered_at, rule.production_started_at].some(
    (at) => at !== null && at.getTime() <= input.cancelledAt.getTime(),
  );
  const tiers = (
    await db.run<{ hours_before_min: number; hours_before_max: number | null; refund_pct: number }>(
      "SELECT hours_before_min,hours_before_max,refund_pct FROM refund_tiers WHERE shop_id=$1 AND operating_rules_id=$2 ORDER BY hours_before_min",
      [rule.rule_id],
    )
  ).rows;
  let refundPct = rule.pre_production_refund_pct;
  let clauseKey = "pre_production_cancel";
  if (input.reason === "customer" && started && tiers.length > 0) {
    const tier = tiers.find(
      (t) => t.hours_before_min <= hoursBefore && (t.hours_before_max === null || hoursBefore < t.hours_before_max),
    );
    if (!tier) throw new Error("cancellation tier gap");
    refundPct = tier.refund_pct;
    clauseKey = "staged_refund";
  }
  const fee = input.reason === "shop" ? 0 : Math.min(base, rule.cancellation_fee_krw);
  if (input.reason === "shop") refundPct = 100;
  const amount = Number((BigInt(base - fee) * BigInt(refundPct)) / 100n);
  const clause = (
    await db.run<{ title: string }>(
      "SELECT title FROM rule_clauses WHERE shop_id=$1 AND operating_rules_id=$2 AND clause_key=$3",
      [rule.rule_id, clauseKey],
    )
  ).rows[0];
  return {
    amount,
    operatingRulesVersion: rule.version,
    clauseTitle:
      input.reason === "shop"
        ? "가게 사정 취소"
        : (clause?.title ?? (clauseKey === "staged_refund" ? "제작 뒤 취소" : "제작 전 취소")),
    basis: {
      operatingRulesId: rule.rule_id,
      ...input.funds,
      base,
      fee,
      refundPct,
      hoursBefore,
      pickupAt: pickup.toISOString(),
      cancelledAt: input.cancelledAt.toISOString(),
      customMaterialOrderedAt: rule.custom_material_ordered_at?.toISOString() ?? null,
      productionStartedAt: rule.production_started_at?.toISOString() ?? null,
    },
  };
}
