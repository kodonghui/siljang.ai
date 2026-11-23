import { changedFields as changed, isIntegerText, numberOrText } from "./form-values";
import { CLAUSE_KEYS, type ClauseKey, type OperatingRules } from "./operating-rules-api";
import type { FieldError } from "./problems";

export const RULE_NUMBER_FIELDS = [
  "quoteValidHours",
  "paymentDueHours",
  "issueReportHours",
  "changeDeadlineHours",
  "cancellationFeeKrw",
  "preProductionRefundPct",
] as const;
export const CLAUSE_NAMES: Record<ClauseKey, string> = {
  pre_production_cancel: "제작 전 취소",
  staged_refund: "단계별 환불",
  cancellation_fee: "취소 수수료",
  date_change_refund_basis: "날짜를 바꾼 주문의 환불 기준",
  shop_cancel_compensation: "가게 사정 취소 보상",
  other_shop_design: "다른 가게 디자인",
  issue_report_window: "문제 신고 기한",
  quote_validity: "견적 유효 기한",
  payment_due: "결제 기한",
  change_deadline: "변경 마감",
  custom: "직접 쓴 조문",
};
export interface ClauseForm {
  id: string;
  key: ClauseKey;
  position: number;
  title: string;
  conditionText: string;
  effectText: string;
  enabled: boolean;
}
export interface TierForm {
  id: string;
  hoursBeforeMin: string;
  hoursBeforeMax: string;
  refundPct: string;
}
export type OperatingRulesForm = Record<(typeof RULE_NUMBER_FIELDS)[number], string> & {
  dateChangeRefundBasis: "original_pickup" | "new_pickup" | "";
  clauses: ClauseForm[];
  refundTiers: TierForm[];
};
export function rulesForm(base: OperatingRules): OperatingRulesForm {
  const clauses: ClauseForm[] = base.clauses.map((c, i) => ({
    ...c,
    id: c.key === "custom" ? `custom:${i}` : c.key,
    enabled: true,
  }));
  for (const key of CLAUSE_KEYS)
    if (key !== "custom" && !clauses.some((c) => c.key === key))
      clauses.push({
        id: key,
        key,
        position: 0,
        title: CLAUSE_NAMES[key],
        conditionText: "",
        effectText: "",
        enabled: false,
      });
  return {
    quoteValidHours: String(base.quoteValidHours),
    paymentDueHours: String(base.paymentDueHours),
    issueReportHours: String(base.issueReportHours),
    changeDeadlineHours: base.changeDeadlineHours === null ? "" : String(base.changeDeadlineHours),
    cancellationFeeKrw: String(base.cancellationFeeKrw),
    preProductionRefundPct: String(base.preProductionRefundPct),
    dateChangeRefundBasis: base.dateChangeRefundBasis ?? "",
    clauses,
    refundTiers: base.refundTiers.map((t, i) => ({
      id: `tier:${i}`,
      hoursBeforeMin: String(t.hoursBeforeMin),
      hoursBeforeMax: t.hoursBeforeMax === null ? "" : String(t.hoursBeforeMax),
      refundPct: String(t.refundPct),
    })),
  };
}
export function rulesPayload(base: OperatingRules, form: OperatingRulesForm) {
  return {
    baseRevision: base.revision,
    quoteValidHours: numberOrText(form.quoteValidHours),
    paymentDueHours: numberOrText(form.paymentDueHours),
    issueReportHours: numberOrText(form.issueReportHours),
    changeDeadlineHours: numberOrText(form.changeDeadlineHours),
    cancellationFeeKrw: numberOrText(form.cancellationFeeKrw),
    preProductionRefundPct: numberOrText(form.preProductionRefundPct),
    dateChangeRefundBasis: form.dateChangeRefundBasis,
    clauses: form.clauses
      .filter((c) => c.enabled)
      .sort((a, b) => a.position - b.position)
      .map(({ key, position, title, conditionText, effectText }) => ({
        key,
        position,
        title,
        conditionText,
        effectText,
      })),
    refundTiers: form.refundTiers.map((t) => ({
      hoursBeforeMin: numberOrText(t.hoursBeforeMin),
      hoursBeforeMax: t.hoursBeforeMax.trim() === "" ? null : numberOrText(t.hoursBeforeMax),
      refundPct: numberOrText(t.refundPct),
    })),
  };
}
export function rulesIssues(form: OperatingRulesForm): FieldError[] {
  const errors: FieldError[] = [],
    add = (field: string, code: FieldError["code"]) => errors.push({ field, code });
  const integer = (value: string, field: string, min: number, max: number) => {
    if (!value.trim()) {
      add(field, "required");
      return false;
    }
    if (!isIntegerText(value) || Number(value) < min || Number(value) > max) {
      add(field, "out_of_range");
      return false;
    }
    return true;
  };
  for (const key of RULE_NUMBER_FIELDS)
    integer(
      form[key],
      `/${key}`,
      key === "cancellationFeeKrw" || key === "preProductionRefundPct" ? 0 : 1,
      key === "cancellationFeeKrw" ? 10000000 : key === "preProductionRefundPct" ? 100 : 720,
    );
  if (!form.dateChangeRefundBasis) add("/dateChangeRefundBasis", "required");
  const selected = form.clauses.filter((c) => c.enabled),
    positions = new Set<number>(),
    keys = new Set<string>();
  if (!selected.length || selected.length > 50) add("/clauses", "out_of_range");
  for (const [i, c] of selected.sort((a, b) => a.position - b.position).entries()) {
    const p = `/clauses/${i}`;
    for (const field of ["title", "conditionText", "effectText"] as const) {
      const value = c[field];
      if (!value.trim()) add(`${p}/${field}`, "required");
      else if (value.includes("\0")) add(`${p}/${field}`, "bad_format");
      else if ([...value].length > (field === "title" ? 60 : 1000)) add(`${p}/${field}`, "too_long");
    }
    if (!Number.isInteger(c.position) || c.position < 1 || c.position > 32767) add(`${p}/position`, "out_of_range");
    if (positions.has(c.position)) add(`${p}/position`, "duplicate");
    positions.add(c.position);
    if (c.key !== "custom") {
      if (keys.has(c.key)) add(`${p}/key`, "duplicate");
      keys.add(c.key);
    }
  }
  if (form.refundTiers.length > 20) add("/refundTiers", "out_of_range");
  const valid: { index: number; min: number; max: number | null }[] = [];
  for (const [i, t] of form.refundTiers.entries()) {
    const p = `/refundTiers/${i}`,
      before = errors.length;
    integer(t.hoursBeforeMin, `${p}/hoursBeforeMin`, 0, 8760);
    integer(t.refundPct, `${p}/refundPct`, 0, 100);
    if (t.hoursBeforeMax.trim() !== "") {
      if (
        integer(t.hoursBeforeMax, `${p}/hoursBeforeMax`, 1, 8760) &&
        Number(t.hoursBeforeMax) <= Number(t.hoursBeforeMin)
      )
        add(`${p}/hoursBeforeMax`, "out_of_range");
    }
    if (errors.length === before)
      valid.push({
        index: i,
        min: Number(t.hoursBeforeMin),
        max: t.hoursBeforeMax.trim() === "" ? null : Number(t.hoursBeforeMax),
      });
  }
  if (valid.length === form.refundTiers.length && valid.length) {
    valid.sort((a, b) => a.min - b.min);
    const first = valid[0],
      last = valid.at(-1);
    if (first && first.min !== 0) add(`/refundTiers/${first.index}`, "gap");
    for (let i = 1; i < valid.length; i++) {
      const before = valid[i - 1],
        after = valid[i];
      if (!before || !after) continue;
      if (before.max === null || before.max > after.min) add(`/refundTiers/${after.index}`, "overlaps");
      else if (before.max < after.min) add(`/refundTiers/${after.index}`, "gap");
    }
    if (last && last.max !== null) add(`/refundTiers/${last.index}`, "gap");
  }
  if (keys.has("staged_refund") && !form.refundTiers.length) add("/refundTiers", "required");
  if (!keys.has("staged_refund") && form.refundTiers.length) add("/clauses", "required");
  return errors;
}

const clauseIdentity = (c: ClauseForm) =>
  c.key === "custom" ? JSON.stringify([c.key, c.title, c.conditionText, c.effectText]) : c.key;
const tierIdentity = (t: TierForm) => JSON.stringify([t.hoursBeforeMin, t.hoursBeforeMax]);
/** 원문이 일치하는지 확인할 수 없는 직접 쓴 조문은 대응을 추측하지 않는다. */
export function rebaseRules(
  base: OperatingRules,
  mine: OperatingRulesForm,
  latest: OperatingRules,
): { form: OperatingRulesForm | null; conflicts: string[] } {
  const before = rulesForm(base),
    result = rulesForm(latest),
    conflicts: string[] = [];
  Object.assign(result, changed(before, mine, [...RULE_NUMBER_FIELDS, "dateChangeRefundBasis"]));
  const clauseFields = ["title", "conditionText", "effectText", "position"] as const;
  for (const original of before.clauses.filter((c) => c.enabled)) {
    const own = mine.clauses.find((c) => c.id === original.id),
      patch = own ? changed(original, own, clauseFields) : {};
    if (own?.enabled && Object.keys(patch).length === 0) continue;
    const candidates = result.clauses.filter((c) => c.enabled && clauseIdentity(c) === clauseIdentity(original));
    if (
      candidates.length !== 1 ||
      before.clauses.filter((c) => c.enabled && clauseIdentity(c) === clauseIdentity(original)).length !== 1
    ) {
      if (!own?.enabled && original.key !== "custom" && candidates.length === 0) continue;
      conflicts.push(`대응할 수 없는 조문: ${original.title}`);
      continue;
    }
    const target = candidates[0];
    if (!target) continue;
    if (!own?.enabled) {
      if (original.key === "custom") result.clauses = result.clauses.filter((c) => c.id !== target.id);
      else target.enabled = false;
    } else Object.assign(target, patch);
  }
  const oldIds = new Set(before.clauses.filter((c) => c.enabled).map((c) => c.id));
  for (const own of mine.clauses.filter((c) => c.enabled && !oldIds.has(c.id))) {
    const matched = result.clauses.find((c) => c.enabled && clauseIdentity(c) === clauseIdentity(own));
    if (matched) {
      conflicts.push(`다른 기기에서 같은 조문을 추가했어요: ${own.title}`);
      continue;
    }
    const position = Math.max(0, ...result.clauses.filter((c) => c.enabled).map((c) => c.position)) + 1;
    const slot = own.key === "custom" ? undefined : result.clauses.find((c) => c.key === own.key);
    if (slot) Object.assign(slot, own, { id: slot.id, position });
    else result.clauses.push({ ...own, position });
  }
  for (const original of before.refundTiers) {
    const own = mine.refundTiers.find((t) => t.id === original.id),
      patch = own ? changed(original, own, ["hoursBeforeMin", "hoursBeforeMax", "refundPct"]) : {};
    if (own && Object.keys(patch).length === 0) continue;
    const targets = result.refundTiers.filter((t) => tierIdentity(t) === tierIdentity(original));
    if (targets.length !== 1) {
      conflicts.push("대응할 수 없는 환불 단계가 있어요");
      continue;
    }
    const target = targets[0];
    if (!target) continue;
    if (!own) result.refundTiers = result.refundTiers.filter((t) => t.id !== target.id);
    else Object.assign(target, patch);
  }
  const tierIds = new Set(before.refundTiers.map((t) => t.id));
  for (const own of mine.refundTiers.filter((t) => !tierIds.has(t.id))) {
    if (result.refundTiers.some((t) => tierIdentity(t) === tierIdentity(own)))
      conflicts.push("다른 기기에서 같은 환불 단계를 추가했어요");
    else result.refundTiers.push({ ...own });
  }
  const selected = result.clauses.filter((c) => c.enabled);
  if (new Set(selected.map((c) => c.position)).size !== selected.length)
    conflicts.push("다시 적용한 조문 순서가 겹쳐요");
  if (selected.length > 50 || result.refundTiers.length > 20) conflicts.push("다시 적용한 항목 수가 한도를 넘어요");
  return { form: conflicts.length ? null : result, conflicts };
}
