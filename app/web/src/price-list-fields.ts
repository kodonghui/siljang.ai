import type { PriceList } from "./price-list-api";
import { type PriceListForm, priceListForm } from "./price-list-form";
import type { FieldError, FieldReason } from "./problems";

export const OPTION_FIELDS = ["name", "priceKind", "amount", "amountMax", "inStandard", "position"] as const;
export const RULE_FIELDS = ["kind", "optionA", "optionB", "amount"] as const;
export const DESIGN_FIELDS = ["name", "optionKey", "inStandard", "uploadId", "position"] as const;
export function priceFieldPointers(form: PriceListForm): string[] {
  return [
    ...form.options.flatMap((_, i) => OPTION_FIELDS.filter((f) => f !== "position").map((f) => `/options/${i}/${f}`)),
    ...form.rules.flatMap((_, i) => [`/rules/${i}`, ...RULE_FIELDS.map((f) => `/rules/${i}/${f}`)]),
    ...form.designs.flatMap((_, i) => DESIGN_FIELDS.filter((f) => f !== "position").map((f) => `/designs/${i}/${f}`)),
  ];
}
export function priceListIssues(form: PriceListForm): FieldError[] {
  const errors: FieldError[] = [],
    add = (field: string, code: FieldReason) => errors.push({ field, code });
  const named = (v: string, field: string) => {
    if (!v.trim()) add(field, "required");
    else if (v.length > 30) add(field, "too_long");
  };
  const cash = (v: string, field: string, min = 0) => {
    if (!v.trim()) add(field, "required");
    else if (!Number.isSafeInteger(Number(v)) || Number(v) < min || Number(v) > 10000000) add(field, "out_of_range");
  };
  if (!form.options.length || form.options.length > 100) add("/options", "out_of_range");
  if (form.rules.length > 500) add("/rules", "out_of_range");
  if (form.designs.length > 50) add("/designs", "out_of_range");
  const names = new Map<string, number>(),
    pairs = new Map<string, number>(),
    designNames = new Map<string, number>();
  const options = new Map(form.options.map((o) => [o.key, o]));
  for (const [i, o] of form.options.entries()) {
    const p = `/options/${i}`;
    named(o.name, `${p}/name`);
    cash(o.amount, `${p}/amount`);
    if (o.priceKind === "range") {
      cash(o.amountMax, `${p}/amountMax`);
      if (o.amountMax.trim() && Number(o.amountMax) < Number(o.amount)) add(`${p}/amountMax`, "out_of_range");
    }
    if (o.priceKind !== "fixed" && o.inStandard) add(`${p}/inStandard`, "not_allowed");
    const identity = JSON.stringify([o.group, o.name]),
      previous = names.get(identity);
    if (previous !== undefined) {
      add(`${p}/name`, "duplicate");
      add(`/options/${previous}/name`, "duplicate");
    }
    names.set(identity, i);
  }
  for (const [i, r] of form.rules.entries()) {
    const p = `/rules/${i}`;
    for (const f of ["optionA", "optionB"] as const) if (!options.has(r[f])) add(`${p}/${f}`, "reference_not_found");
    if (r.optionA === r.optionB) add(`${p}/optionB`, "not_allowed");
    if (r.kind === "surcharge") cash(r.amount, `${p}/amount`, 1);
    const pair = JSON.stringify([r.optionA, r.optionB].sort()),
      previous = pairs.get(pair);
    if (previous !== undefined) {
      const reason = form.rules[previous]?.kind === r.kind ? "duplicate" : "conflict";
      add(p, reason);
      add(`/rules/${previous}`, reason);
    }
    pairs.set(pair, i);
  }
  for (const [i, d] of form.designs.entries()) {
    const p = `/designs/${i}`;
    named(d.name, `${p}/name`);
    if (!d.sourceDesignId && !d.uploadId) add(`${p}/uploadId`, "required");
    const linked = d.optionKey === null ? null : options.get(d.optionKey);
    if (d.optionKey !== null && !linked) add(`${p}/optionKey`, "reference_not_found");
    if (linked && linked.group !== "design") add(`${p}/optionKey`, "not_allowed");
    if (linked && d.inStandard && !linked.inStandard) add(`${p}/inStandard`, "not_allowed");
    const previous = designNames.get(d.name);
    if (previous !== undefined) {
      add(`${p}/name`, "duplicate");
      add(`/designs/${previous}/name`, "duplicate");
    }
    designNames.set(d.name, i);
  }
  return errors;
}
export function priceListChanges(base: PriceList | null, form: PriceListForm): number {
  const original = priceListForm(base);
  function count<T extends { key: string }>(
    before: T[],
    after: T[],
    fields: readonly (keyof T)[],
    identity: (row: T) => string = (row) => row.key,
  ): number {
    const old = new Map(before.map((row) => [identity(row), row])),
      seen = new Set(after.map(identity));
    let n = 0;
    for (const row of after) {
      const previous = old.get(identity(row));
      n += previous ? fields.filter((f) => row[f] !== previous[f]).length : fields.length;
    }
    return n + before.filter((row) => !seen.has(identity(row))).length * fields.length;
  }
  return (
    count(original.options, form.options, OPTION_FIELDS) +
    count(original.rules, form.rules, RULE_FIELDS) +
    count(original.designs, form.designs, DESIGN_FIELDS, (d) => d.baseDesignId ?? d.key)
  );
}
