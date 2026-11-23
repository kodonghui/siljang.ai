import { type ApiResult, request } from "./api";
import { isApiTimestamp as date, INVALID_API_RESPONSE, isApiObject, isApiVersion } from "./api-response";

export const CLAUSE_KEYS = [
  "pre_production_cancel",
  "staged_refund",
  "cancellation_fee",
  "date_change_refund_basis",
  "shop_cancel_compensation",
  "other_shop_design",
  "issue_report_window",
  "quote_validity",
  "payment_due",
  "change_deadline",
  "custom",
] as const;
export type ClauseKey = (typeof CLAUSE_KEYS)[number];
export interface RuleClause {
  readonly key: ClauseKey;
  readonly position: number;
  readonly title: string;
  readonly conditionText: string;
  readonly effectText: string;
}
export interface RefundTier {
  readonly hoursBeforeMin: number;
  readonly hoursBeforeMax: number | null;
  readonly refundPct: number;
}
export interface OperatingRules {
  readonly version: number | null;
  readonly isTemplate: boolean;
  readonly current: boolean;
  readonly quoteValidHours: number;
  readonly paymentDueHours: number;
  readonly issueReportHours: number;
  readonly changeDeadlineHours: number | null;
  readonly cancellationFeeKrw: number;
  readonly preProductionRefundPct: number;
  readonly preProductionLoweredAck: boolean;
  readonly dateChangeRefundBasis: "original_pickup" | "new_pickup" | null;
  readonly clauses: readonly RuleClause[];
  readonly refundTiers: readonly RefundTier[];
  readonly createdAt: string | null;
  readonly supersededAt: string | null;
  readonly revision: string | null;
}
export interface OperatingRulesResult {
  readonly outcome: "created" | "unchanged";
  readonly operatingRules: OperatingRules;
}
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && !value.includes("\0") && [...value].length <= max;
function clause(value: unknown): value is RuleClause {
  return (
    isApiObject(value) &&
    typeof value.key === "string" &&
    CLAUSE_KEYS.some((key) => key === value.key) &&
    integer(value.position, 1, 32767) &&
    text(value.title, 60) &&
    text(value.conditionText, 1000) &&
    text(value.effectText, 1000)
  );
}
function tier(value: unknown): value is RefundTier {
  return (
    isApiObject(value) &&
    integer(value.hoursBeforeMin, 0, 8760) &&
    (value.hoursBeforeMax === null || integer(value.hoursBeforeMax, 1, 8760)) &&
    integer(value.refundPct, 0, 100)
  );
}
export function isOperatingRules(value: unknown): value is OperatingRules {
  if (
    !isApiObject(value) ||
    typeof value.isTemplate !== "boolean" ||
    typeof value.current !== "boolean" ||
    typeof value.preProductionLoweredAck !== "boolean" ||
    !integer(value.quoteValidHours, 1, 720) ||
    !integer(value.paymentDueHours, 1, 720) ||
    !integer(value.issueReportHours, 1, 720) ||
    !(integer(value.changeDeadlineHours, 1, 720) || (value.isTemplate && value.changeDeadlineHours === null)) ||
    !integer(value.cancellationFeeKrw, 0, 10000000) ||
    !integer(value.preProductionRefundPct, 0, 100) ||
    !(
      value.dateChangeRefundBasis === "original_pickup" ||
      value.dateChangeRefundBasis === "new_pickup" ||
      (value.isTemplate && value.dateChangeRefundBasis === null)
    ) ||
    !Array.isArray(value.clauses) ||
    value.clauses.length > 50 ||
    !value.clauses.every(clause) ||
    !Array.isArray(value.refundTiers) ||
    value.refundTiers.length > 20 ||
    !value.refundTiers.every(tier)
  )
    return false;
  const positions = value.clauses.map((row) => row.position),
    keys = value.clauses.filter((row) => row.key !== "custom").map((row) => row.key);
  if (new Set(positions).size !== positions.length || new Set(keys).size !== keys.length) return false;
  if (value.isTemplate)
    return (
      value.version === null &&
      value.current === false &&
      value.revision === null &&
      value.createdAt === null &&
      value.supersededAt === null
    );
  return (
    isApiVersion(value.version) &&
    text(value.revision, 64) &&
    /^[A-Za-z0-9._-]+$/.test(value.revision) &&
    date(value.createdAt) &&
    (value.current ? value.supersededAt === null : date(value.supersededAt)) &&
    (value.preProductionRefundPct === 100 || value.preProductionLoweredAck)
  );
}
export async function fetchOperatingRules(signal?: AbortSignal): Promise<ApiResult<OperatingRules>> {
  const result = await request<unknown>("/owner/operating-rules", { cache: "no-store", ...(signal ? { signal } : {}) });
  if (!result.ok) return result;
  return isOperatingRules(result.data) && (result.data.isTemplate || result.data.current)
    ? { ...result, data: result.data }
    : INVALID_API_RESPONSE;
}
export async function saveOperatingRules(
  body: Record<string, unknown>,
  key: string,
): Promise<ApiResult<OperatingRulesResult>> {
  const result = await request<unknown>("/owner/operating-rules/versions", { method: "POST", body, key });
  if (!result.ok) return result;
  const value = result.data;
  return isApiObject(value) &&
    (value.outcome === "created" || value.outcome === "unchanged") &&
    isOperatingRules(value.operatingRules) &&
    !value.operatingRules.isTemplate &&
    value.operatingRules.current
    ? { ...result, data: { outcome: value.outcome, operatingRules: value.operatingRules } }
    : INVALID_API_RESPONSE;
}
