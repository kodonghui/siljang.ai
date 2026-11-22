/** 운영규정 전체 입력(API-021). 조문 원문은 검사 뒤 그대로 버전에 남긴다. */
import { ApiError, type FieldError } from "./problem";

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
export const RULE_VALUE_KEYS = [
  "quoteValidHours",
  "paymentDueHours",
  "issueReportHours",
  "changeDeadlineHours",
  "cancellationFeeKrw",
  "preProductionRefundPct",
  "dateChangeRefundBasis",
] as const;

export interface ClauseInput {
  key: (typeof CLAUSE_KEYS)[number];
  position: number;
  title: string;
  conditionText: string;
  effectText: string;
}
export interface RefundTierInput {
  hoursBeforeMin: number;
  hoursBeforeMax: number | null;
  refundPct: number;
}
export interface OperatingRulesInput {
  baseRevision: string | null;
  quoteValidHours: number;
  paymentDueHours: number;
  issueReportHours: number;
  changeDeadlineHours: number;
  cancellationFeeKrw: number;
  preProductionRefundPct: number;
  dateChangeRefundBasis: "original_pickup" | "new_pickup";
  clauses: ClauseInput[];
  refundTiers: RefundTierInput[];
  confirm: "lowered_refund"[];
}

type Input = Record<string, unknown>;
export function parseOperatingRules(body: unknown): OperatingRulesInput {
  const errors: FieldError[] = [];
  const error = (field: string, code: FieldError["code"]) => errors.push({ field, code });
  function object(
    value: unknown,
    path: string,
    required: readonly string[],
    optional: readonly string[] = [],
  ): Input | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      error(path || "/", "bad_format");
      return;
    }
    const o = value as Input;
    for (const key of required) if (!Object.hasOwn(o, key)) error(`${path}/${key}`, "required");
    for (const key of Object.keys(o))
      if (![...required, ...optional].includes(key))
        error(/^[A-Za-z0-9_]{1,100}$/.test(key) ? `${path}/${key}` : path || "/", "unknown_field");
    return o;
  }
  function text(value: unknown, field: string, max: number, pattern?: RegExp) {
    if (value === undefined) return;
    if (typeof value !== "string" || value.includes("\0")) error(field, "bad_format");
    else if (!value.trim()) error(field, "too_short");
    else if ([...value].length > max) error(field, "too_long");
    else if (pattern && !pattern.test(value)) error(field, "bad_format");
  }
  function integer(value: unknown, field: string, min: number, max: number) {
    if (value === undefined) return;
    if (typeof value !== "number" || !Number.isInteger(value)) error(field, "bad_format");
    else if (value < min || value > max) error(field, "out_of_range");
  }
  function enumeration(value: unknown, field: string, values: readonly string[]) {
    if (value === undefined) return;
    if (typeof value !== "string") error(field, "bad_format");
    else if (!values.includes(value)) error(field, "not_allowed");
  }
  function list(value: unknown, field: string, min: number, max: number): unknown[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      error(field, "bad_format");
      return [];
    }
    if (value.length < min) error(field, "required");
    if (value.length > max) {
      error(field, "too_many");
      return [];
    }
    return value;
  }
  const o = object(body, "", ["baseRevision", ...RULE_VALUE_KEYS, "clauses", "refundTiers"], ["confirm"]);
  if (!o) throw new ApiError("validation_failed", { errors });
  if (o.baseRevision !== null) text(o.baseRevision, "/baseRevision", 64, /^[A-Za-z0-9._-]+$/);
  for (const key of ["quoteValidHours", "paymentDueHours", "issueReportHours", "changeDeadlineHours"])
    integer(o[key], `/${key}`, 1, 720);
  integer(o.cancellationFeeKrw, "/cancellationFeeKrw", 0, 10000000);
  integer(o.preProductionRefundPct, "/preProductionRefundPct", 0, 100);
  enumeration(o.dateChangeRefundBasis, "/dateChangeRefundBasis", ["original_pickup", "new_pickup"]);
  const clauses = list(o.clauses, "/clauses", 1, 50);
  const keys = new Set<string>(),
    positions = new Set<number>();
  for (const [i, value] of clauses.entries()) {
    const p = `/clauses/${i}`,
      c = object(value, p, ["key", "position", "title", "conditionText", "effectText"]);
    if (!c) continue;
    enumeration(c.key, `${p}/key`, CLAUSE_KEYS);
    integer(c.position, `${p}/position`, 1, 32767);
    text(c.title, `${p}/title`, 60);
    text(c.conditionText, `${p}/conditionText`, 1000);
    text(c.effectText, `${p}/effectText`, 1000);
    if (typeof c.key === "string" && c.key !== "custom") {
      if (keys.has(c.key)) error(`${p}/key`, "duplicate");
      keys.add(c.key);
    }
    if (typeof c.position === "number") {
      if (positions.has(c.position)) error(`${p}/position`, "duplicate");
      positions.add(c.position);
    }
  }
  const tiers = list(o.refundTiers, "/refundTiers", 0, 20);
  const valid: (RefundTierInput & { index: number })[] = [];
  for (const [i, value] of tiers.entries()) {
    const p = `/refundTiers/${i}`,
      t = object(value, p, ["hoursBeforeMin", "hoursBeforeMax", "refundPct"]);
    if (!t) continue;
    const before = errors.length;
    integer(t.hoursBeforeMin, `${p}/hoursBeforeMin`, 0, 8760);
    if (t.hoursBeforeMax !== null) integer(t.hoursBeforeMax, `${p}/hoursBeforeMax`, 1, 8760);
    integer(t.refundPct, `${p}/refundPct`, 0, 100);
    if (
      typeof t.hoursBeforeMin === "number" &&
      typeof t.hoursBeforeMax === "number" &&
      t.hoursBeforeMax <= t.hoursBeforeMin
    )
      error(`${p}/hoursBeforeMax`, "out_of_range");
    if (errors.length === before && ["hoursBeforeMin", "hoursBeforeMax", "refundPct"].every((k) => Object.hasOwn(t, k)))
      valid.push({ ...(t as unknown as RefundTierInput), index: i });
  }
  if (valid.length === tiers.length && valid.length) {
    valid.sort((a, b) => a.hoursBeforeMin - b.hoursBeforeMin);
    if (valid[0]?.hoursBeforeMin !== 0) error(`/refundTiers/${valid[0]?.index}`, "gap");
    for (let i = 1; i < valid.length; i++) {
      const prev = valid[i - 1],
        next = valid[i];
      if (!prev || !next) continue;
      if (prev.hoursBeforeMax === null || prev.hoursBeforeMax > next.hoursBeforeMin)
        error(`/refundTiers/${next.index}`, "overlaps");
      else if (prev.hoursBeforeMax < next.hoursBeforeMin) error(`/refundTiers/${next.index}`, "gap");
    }
    const last = valid.at(-1);
    if (last && last.hoursBeforeMax !== null) error(`/refundTiers/${last.index}`, "gap");
  }
  if (
    Array.isArray(o.clauses) &&
    o.clauses.length <= 50 &&
    Array.isArray(o.refundTiers) &&
    o.refundTiers.length <= 20
  ) {
    if (keys.has("staged_refund") && !tiers.length) error("/refundTiers", "required");
    if (!keys.has("staged_refund") && tiers.length) error("/clauses", "required");
  }
  const confirm = o.confirm === undefined ? [] : list(o.confirm, "/confirm", 0, 1);
  for (const [i, value] of confirm.entries()) enumeration(value, `/confirm/${i}`, ["lowered_refund"]);
  if (errors.length) throw new ApiError("validation_failed", { errors: errors.slice(0, 50) });
  return { ...o, confirm } as unknown as OperatingRulesInput;
}
