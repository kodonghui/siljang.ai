/** 운영규정 버전(API-020~023). 이전 버전의 조문과 단계 행은 읽기만 한다. */
import { requireJson } from "./body";
import { operatingRulesCardTexts } from "./operating-rules-card";
import {
  type ClauseInput,
  type OperatingRulesInput,
  parseOperatingRules,
  RULE_VALUE_KEYS,
} from "./operating-rules-input";
import { ApiError, fieldError } from "./problem";
import type { ShopRequest } from "./routes";
import type { ShopDb } from "./shop-scope";
import { toShopIso } from "./time";

interface Head {
  id: string;
  version: number;
  quote_valid_hours: number;
  payment_due_hours: number;
  issue_report_hours: number;
  change_deadline_hours: number;
  cancellation_fee_krw: number;
  pre_production_refund_pct: number;
  pre_production_lowered_ack: boolean;
  date_change_refund_basis: "original_pickup" | "new_pickup";
  created_at: Date;
  superseded_at: Date | null;
  revision: string;
}
interface ClauseRow {
  clause_key: ClauseInput["key"];
  position: number;
  title: string;
  condition_text: string;
  effect_text: string;
}
interface TierRow {
  hours_before_min: number;
  hours_before_max: number | null;
  refund_pct: number;
}

export const OPERATING_RULES_TEMPLATE = {
  version: null,
  isTemplate: true,
  current: false,
  quoteValidHours: 72,
  paymentDueHours: 12,
  issueReportHours: 24,
  changeDeadlineHours: null,
  cancellationFeeKrw: 0,
  preProductionRefundPct: 100,
  preProductionLoweredAck: false,
  dateChangeRefundBasis: null,
  clauses: [
    {
      key: "pre_production_cancel",
      position: 1,
      title: "제작 전 취소",
      conditionText: "맞춤 재료를 주문하기 전이고 제작을 시작하기 전에 취소하는 경우",
      effectText: "취소 수수료만 빼고 모두 돌려드립니다.",
    },
  ],
  refundTiers: [],
  createdAt: null,
  supersededAt: null,
  revision: null,
} as const;

async function current(db: ShopDb): Promise<Head | undefined> {
  return (
    await db.run<Head>(
      "SELECT r.*,r.xmin::text AS revision FROM operating_rules r WHERE r.shop_id=$1 AND r.superseded_at IS NULL",
    )
  ).rows[0];
}
async function contents(db: ShopDb, id: string) {
  const clauses = (
    await db.run<ClauseRow>(
      "SELECT c.clause_key,c.position,c.title,c.condition_text,c.effect_text FROM rule_clauses c WHERE c.shop_id=$1 AND c.operating_rules_id=$2 ORDER BY c.position",
      [id],
    )
  ).rows.map((c) => ({
    key: c.clause_key,
    position: c.position,
    title: c.title,
    conditionText: c.condition_text,
    effectText: c.effect_text,
  }));
  const refundTiers = (
    await db.run<TierRow>(
      "SELECT t.hours_before_min,t.hours_before_max,t.refund_pct FROM refund_tiers t WHERE t.shop_id=$1 AND t.operating_rules_id=$2 ORDER BY t.hours_before_min",
      [id],
    )
  ).rows.map((t) => ({
    hoursBeforeMin: t.hours_before_min,
    hoursBeforeMax: t.hours_before_max,
    refundPct: t.refund_pct,
  }));
  return { clauses, refundTiers };
}
function values(head: Head) {
  return {
    quoteValidHours: head.quote_valid_hours,
    paymentDueHours: head.payment_due_hours,
    issueReportHours: head.issue_report_hours,
    changeDeadlineHours: head.change_deadline_hours,
    cancellationFeeKrw: head.cancellation_fee_krw,
    preProductionRefundPct: head.pre_production_refund_pct,
    dateChangeRefundBasis: head.date_change_refund_basis,
  };
}
async function render(db: ShopDb, head: Head) {
  const zone = (await db.found<{ time_zone: string }>("SELECT s.time_zone FROM shops s WHERE s.id=$1")).time_zone;
  return {
    version: head.version,
    isTemplate: false,
    current: head.superseded_at === null,
    ...values(head),
    preProductionLoweredAck: head.pre_production_lowered_ack,
    ...(await contents(db, head.id)),
    createdAt: toShopIso(head.created_at, zone),
    supersededAt: head.superseded_at === null ? null : toShopIso(head.superseded_at, zone),
    revision: head.revision,
  };
}
function semantic(value: Pick<OperatingRulesInput, (typeof RULE_VALUE_KEYS)[number] | "clauses" | "refundTiers">) {
  return JSON.stringify([
    RULE_VALUE_KEYS.map((k) => value[k]),
    [...value.clauses]
      .sort((a, b) => a.position - b.position)
      .map((c) => [c.key, c.position, c.title, c.conditionText, c.effectText]),
    [...value.refundTiers]
      .sort((a, b) => a.hoursBeforeMin - b.hoursBeforeMin)
      .map((t) => [t.hoursBeforeMin, t.hoursBeforeMax, t.refundPct]),
  ]);
}

export async function getCurrentOperatingRules(r: ShopRequest): Promise<Response> {
  return r.json(
    await r.db.transaction(async (db) => {
      const head = await current(db);
      return head ? render(db, head) : OPERATING_RULES_TEMPLATE;
    }),
  );
}
export async function listOperatingRulesVersions(r: ShopRequest): Promise<Response> {
  const zone = (await r.db.found<{ time_zone: string }>("SELECT s.time_zone FROM shops s WHERE s.id=$1")).time_zone;
  const rows = await r.db.run<Head>(
    "SELECT r.version,r.created_at,r.superseded_at FROM operating_rules r WHERE r.shop_id=$1 ORDER BY r.version DESC LIMIT 1000",
  );
  return r.json({
    items: rows.rows.map((h) => ({
      version: h.version,
      createdAt: toShopIso(h.created_at, zone),
      supersededAt: h.superseded_at === null ? null : toShopIso(h.superseded_at, zone),
    })),
  });
}
export async function getOperatingRulesVersion(r: ShopRequest): Promise<Response> {
  const raw = r.req.param("version");
  if (!raw || !/^\d{1,10}$/.test(raw) || Number(raw) < 1 || Number(raw) > 2147483647) throw new ApiError("not_found");
  return r.json(
    await r.db.transaction(async (db) =>
      render(
        db,
        await db.found<Head>(
          "SELECT r.*,r.xmin::text AS revision FROM operating_rules r WHERE r.shop_id=$1 AND r.version=$2",
          [Number(raw)],
        ),
      ),
    ),
  );
}
export async function createOperatingRulesVersion(r: ShopRequest): Promise<Response> {
  requireJson(r.req.raw);
  const raw = await r.body(),
    input = parseOperatingRules(raw);
  return r.command({
    command: "API-021",
    pathIds: [],
    body: raw,
    async execute(db) {
      await db.found("SELECT s.id FROM shops s WHERE s.id=$1 FOR NO KEY UPDATE");
      const previous = await current(db);
      if (input.baseRevision !== (previous?.revision ?? null)) throw new ApiError("version_conflict");
      if (previous && semantic(input) === semantic({ ...values(previous), ...(await contents(db, previous.id)) }))
        return {
          status: 200,
          code: "unchanged",
          ref: { operatingRulesId: previous.id },
          body: { outcome: "unchanged", operatingRules: await render(db, previous) },
        };
      if ((previous?.version ?? 0) >= 2147483647) throw fieldError("/", "out_of_range");
      const version = (previous?.version ?? 0) + 1;
      operatingRulesCardTexts(input.clauses, version);
      if (input.preProductionRefundPct < 100 && !input.confirm.includes("lowered_refund"))
        throw new ApiError("confirmation_required", { confirm: [{ kind: "lowered_refund" }] });
      const now = r.services.now();
      if (previous)
        await db.run("UPDATE operating_rules SET superseded_at=$3 WHERE shop_id=$1 AND id=$2", [previous.id, now]);
      const head = await db.found<Head>(
        `INSERT INTO operating_rules (shop_id,version,quote_valid_hours,payment_due_hours,issue_report_hours,change_deadline_hours,cancellation_fee_krw,pre_production_refund_pct,pre_production_lowered_ack,date_change_refund_basis,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *,xmin::text AS revision`,
        [
          version,
          input.quoteValidHours,
          input.paymentDueHours,
          input.issueReportHours,
          input.changeDeadlineHours,
          input.cancellationFeeKrw,
          input.preProductionRefundPct,
          input.preProductionRefundPct < 100,
          input.dateChangeRefundBasis,
          now,
        ],
      );
      if (input.clauses.length)
        await db.run(
          `INSERT INTO rule_clauses (shop_id,operating_rules_id,clause_key,position,title,condition_text,effect_text)
            SELECT $1,$2,c.clause_key,c.position,c.title,c.condition_text,c.effect_text
            FROM unnest($3::text[],$4::smallint[],$5::text[],$6::text[],$7::text[])
              AS c(clause_key,position,title,condition_text,effect_text)`,
          [
            head.id,
            input.clauses.map((c) => c.key),
            input.clauses.map((c) => c.position),
            input.clauses.map((c) => c.title),
            input.clauses.map((c) => c.conditionText),
            input.clauses.map((c) => c.effectText),
          ],
        );
      if (input.refundTiers.length)
        await db.run(
          `INSERT INTO refund_tiers (shop_id,operating_rules_id,hours_before_min,hours_before_max,refund_pct)
            SELECT $1,$2,t.minimum,t.maximum,t.percentage FROM unnest($3::integer[],$4::integer[],$5::smallint[])
              AS t(minimum,maximum,percentage)`,
          [
            head.id,
            input.refundTiers.map((t) => t.hoursBeforeMin),
            input.refundTiers.map((t) => t.hoursBeforeMax),
            input.refundTiers.map((t) => t.refundPct),
          ],
        );
      return {
        status: 201,
        code: "created",
        ref: { operatingRulesId: head.id },
        body: { outcome: "created", operatingRules: await render(db, head) },
      };
    },
    async render(db, stored) {
      const head = await db.found<Head>(
        "SELECT r.*,r.xmin::text AS revision FROM operating_rules r WHERE r.shop_id=$1 AND r.id=$2",
        [stored.ref.operatingRulesId],
      );
      return { outcome: stored.code, operatingRules: await render(db, head) };
    },
  });
}
