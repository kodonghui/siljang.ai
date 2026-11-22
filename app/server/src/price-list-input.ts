/** 가격표 전체 입력(API-017). 참조 이름은 요청 안에서만 쓰고 저장하지 않는다. */
import { ApiError, type FieldError, fieldError } from "./problem";
import { isUuid } from "./shop-scope";

export interface PriceOptionInput {
  key: string;
  group: "size" | "flavor" | "design" | "extra";
  name: string;
  priceKind: "fixed" | "from" | "range";
  amount: number;
  amountMax: number | null;
  inStandard: boolean;
  position: number;
}
export interface PriceRuleInput {
  kind: "exclude" | "surcharge";
  optionA: string;
  optionB: string;
  amount: number | null;
}
export interface DesignInput {
  name: string;
  uploadId?: string;
  sourceDesignId?: string;
  optionKey: string | null;
  inStandard: boolean;
  position: number;
}
export interface PriceListInput {
  baseRevision: string | null;
  options: PriceOptionInput[];
  rules: PriceRuleInput[];
  designs: DesignInput[];
}

type Input = Record<string, unknown>;
function record(value: unknown, field: string): Input {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fieldError(field, "bad_format");
  return value as Input;
}

export function parsePriceList(body: unknown): PriceListInput {
  const errors: FieldError[] = [];
  const error = (field: string, code: FieldError["code"]) => {
    errors.push({ field, code });
  };
  const object = (value: unknown, path: string, required: string[], optional: string[] = []): Input => {
    const item = record(value, path || "/");
    for (const key of required) if (!Object.hasOwn(item, key)) error(`${path}/${key}`, "required");
    for (const key of Object.keys(item))
      if (![...required, ...optional].includes(key))
        error(/^[A-Za-z0-9_]{1,100}$/.test(key) ? `${path}/${key}` : path || "/", "unknown_field");
    return item;
  };
  const text = (value: unknown, path: string, max: number, pattern?: RegExp) => {
    if (value === undefined) return;
    if (typeof value !== "string" || value.includes("\0")) error(path, "bad_format");
    else if (!value.trim()) error(path, "too_short");
    else if ([...value].length > max) error(path, "too_long");
    else if (pattern && !pattern.test(value)) error(path, "bad_format");
  };
  const integer = (value: unknown, path: string, min: number, max: number) => {
    if (value === undefined) return;
    if (typeof value !== "number" || !Number.isInteger(value)) error(path, "bad_format");
    else if (value < min || value > max) error(path, "out_of_range");
  };
  const boolean = (value: unknown, path: string) => {
    if (value !== undefined && typeof value !== "boolean") error(path, "bad_format");
  };
  const enumeration = (value: unknown, path: string, values: string[]) => {
    if (value === undefined) return;
    if (typeof value !== "string") error(path, "bad_format");
    else if (!values.includes(value)) error(path, "not_allowed");
  };
  const list = (value: unknown, path: string, min: number, max: number): unknown[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      error(path, "bad_format");
      return [];
    }
    if (value.length < min) error(path, "required");
    if (value.length > max) {
      error(path, "too_many");
      return [];
    }
    return value;
  };
  const input = object(body, "", ["baseRevision", "options", "rules", "designs"]);
  if (input.baseRevision !== null) text(input.baseRevision, "/baseRevision", 64, /^[A-Za-z0-9._:-]+$/);
  const options = list(input.options, "/options", 1, 100);
  const byKey = new Map<string, Input>();
  const names = new Set<string>();
  for (const [i, value] of options.entries()) {
    const p = `/options/${i}`,
      o = object(value, p, ["key", "group", "name", "priceKind", "amount", "amountMax", "inStandard", "position"]);
    text(o.key, `${p}/key`, 40, /^[A-Za-z0-9_-]+$/);
    text(o.name, `${p}/name`, 30);
    enumeration(o.group, `${p}/group`, ["size", "flavor", "design", "extra"]);
    enumeration(o.priceKind, `${p}/priceKind`, ["fixed", "from", "range"]);
    integer(o.amount, `${p}/amount`, 0, 10000000);
    integer(o.position, `${p}/position`, 0, 32767);
    boolean(o.inStandard, `${p}/inStandard`);
    if (o.amountMax !== null) integer(o.amountMax, `${p}/amountMax`, 0, 10000000);
    if (o.priceKind === "range") {
      if (o.amountMax === null) error(`${p}/amountMax`, "required");
      else if (typeof o.amountMax === "number" && typeof o.amount === "number" && o.amountMax < o.amount)
        error(`${p}/amountMax`, "out_of_range");
    } else if (o.amountMax !== undefined && o.amountMax !== null) error(`${p}/amountMax`, "not_allowed");
    if (o.priceKind !== "fixed" && o.inStandard === true) error(`${p}/inStandard`, "not_allowed");
    if (typeof o.key === "string") {
      if (byKey.has(o.key)) error(`${p}/key`, "duplicate");
      byKey.set(o.key, o);
    }
    const name = JSON.stringify([o.group, o.name]);
    if (names.has(name)) error(`${p}/name`, "duplicate");
    names.add(name);
  }
  const pairs = new Map<string, unknown>();
  for (const [i, value] of list(input.rules, "/rules", 0, 500).entries()) {
    const p = `/rules/${i}`,
      rule = object(value, p, ["kind", "optionA", "optionB", "amount"]);
    enumeration(rule.kind, `${p}/kind`, ["exclude", "surcharge"]);
    for (const name of ["optionA", "optionB"]) {
      text(rule[name], `${p}/${name}`, 40, /^[A-Za-z0-9_-]+$/);
      if (typeof rule[name] === "string" && !byKey.has(rule[name] as string))
        error(`${p}/${name}`, "reference_not_found");
    }
    if (rule.optionA === rule.optionB) error(`${p}/optionB`, "not_allowed");
    if (rule.kind === "surcharge") integer(rule.amount, `${p}/amount`, 1, 10000000);
    if (rule.kind === "surcharge" && rule.amount === null) error(`${p}/amount`, "required");
    if (rule.kind === "exclude" && rule.amount !== undefined && rule.amount !== null)
      error(`${p}/amount`, "not_allowed");
    const pair = JSON.stringify([rule.optionA, rule.optionB].sort());
    if (pairs.has(pair)) error(p, pairs.get(pair) === rule.kind ? "duplicate" : "conflict");
    pairs.set(pair, rule.kind);
  }
  const designNames = new Set<string>();
  for (const [i, value] of list(input.designs, "/designs", 0, 50).entries()) {
    const p = `/designs/${i}`,
      d = object(value, p, ["name", "optionKey", "inStandard", "position"], ["uploadId", "sourceDesignId"]);
    text(d.name, `${p}/name`, 30);
    integer(d.position, `${p}/position`, 0, 32767);
    boolean(d.inStandard, `${p}/inStandard`);
    const upload = Object.hasOwn(d, "uploadId"),
      source = Object.hasOwn(d, "sourceDesignId");
    if (upload === source) error(p, upload ? "not_allowed" : "required");
    if (upload) text(d.uploadId, `${p}/uploadId`, 204, /^upl_[A-Za-z0-9_-]{20,200}$/);
    if (source && !isUuid(d.sourceDesignId)) error(`${p}/sourceDesignId`, "bad_format");
    if (d.optionKey !== null) {
      text(d.optionKey, `${p}/optionKey`, 40, /^[A-Za-z0-9_-]+$/);
      const option = byKey.get(String(d.optionKey));
      if (!option) error(`${p}/optionKey`, "reference_not_found");
      else if (option.group !== "design") error(`${p}/optionKey`, "not_allowed");
      else if (d.inStandard === true && option.inStandard !== true) error(`${p}/inStandard`, "not_allowed");
    }
    if (typeof d.name === "string") {
      if (designNames.has(d.name)) error(`${p}/name`, "duplicate");
      designNames.add(d.name);
    }
  }
  if (errors.length) throw new ApiError("validation_failed", { errors: errors.slice(0, 50) });
  return input as unknown as PriceListInput;
}
