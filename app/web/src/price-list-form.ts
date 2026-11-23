import type { OptionGroup, PriceKind, PriceList } from "./price-list-api";

export interface OptionForm {
  key: string;
  group: OptionGroup;
  name: string;
  priceKind: PriceKind;
  amount: string;
  amountMax: string;
  inStandard: boolean;
  position: number;
}
export interface RuleForm {
  key: string;
  kind: "exclude" | "surcharge";
  optionA: string;
  optionB: string;
  amount: string;
}
export interface DesignForm {
  key: string;
  name: string;
  imageUrl: string;
  sourceDesignId: string | null;
  baseDesignId: string | null;
  uploadId: string | null;
  optionKey: string | null;
  inStandard: boolean;
  position: number;
}
export interface PriceListForm {
  options: OptionForm[];
  rules: RuleForm[];
  designs: DesignForm[];
}
export const OPTION_GROUPS: readonly OptionGroup[] = ["size", "flavor", "design", "extra"];
export function priceListForm(list: PriceList | null): PriceListForm {
  return {
    options:
      list?.options.map((o) => ({
        key: o.optionId,
        group: o.group,
        name: o.name,
        priceKind: o.priceKind,
        amount: String(o.amount),
        amountMax: o.amountMax === null ? "" : String(o.amountMax),
        inStandard: o.inStandard,
        position: o.position,
      })) ?? [],
    rules:
      list?.rules.map((r) => ({
        key: JSON.stringify([r.optionAId, r.optionBId].sort()),
        kind: r.kind,
        optionA: r.optionAId,
        optionB: r.optionBId,
        amount: r.amount === null ? "" : String(r.amount),
      })) ?? [],
    designs:
      list?.designs.map((d) => ({
        key: d.designId,
        name: d.name,
        imageUrl: d.imageUrl,
        sourceDesignId: d.designId,
        baseDesignId: d.designId,
        uploadId: null,
        optionKey: d.optionId,
        inStandard: d.inStandard,
        position: d.position,
      })) ?? [],
  };
}
const integerOrText = (value: string) =>
  value.trim() !== "" && Number.isSafeInteger(Number(value)) ? Number(value) : value;
export function priceListPayload(base: PriceList | null, form: PriceListForm) {
  return {
    baseRevision: base?.revision ?? null,
    options: form.options.map((o) => ({
      ...o,
      amount: integerOrText(o.amount),
      amountMax: o.priceKind === "range" ? integerOrText(o.amountMax) : null,
    })),
    rules: form.rules.map((r) => ({
      kind: r.kind,
      optionA: r.optionA,
      optionB: r.optionB,
      amount: r.kind === "surcharge" ? integerOrText(r.amount) : null,
    })),
    designs: form.designs.map((d) => ({
      name: d.name,
      optionKey: d.optionKey,
      inStandard: d.inStandard,
      position: d.position,
      ...(d.uploadId !== null
        ? { uploadId: d.uploadId }
        : d.sourceDesignId !== null
          ? { sourceDesignId: d.sourceDesignId }
          : {}),
    })),
  };
}
export function removePriceOption(form: PriceListForm, key: string): PriceListForm {
  return {
    options: form.options.filter((o) => o.key !== key),
    rules: form.rules.filter((r) => r.optionA !== key && r.optionB !== key),
    designs: form.designs.map((d) => (d.optionKey === key ? { ...d, optionKey: null } : d)),
  };
}
function patch<T, K extends keyof T>(base: T, mine: T, keys: readonly K[]): Partial<Pick<T, K>> {
  const result: Partial<Pick<T, K>> = {};
  for (const key of keys) if (base[key] !== mine[key]) result[key] = mine[key];
  return result;
}
const optionIdentity = (o: OptionForm) => JSON.stringify([o.group, o.name]);
const pair = (r: Pick<RuleForm, "optionA" | "optionB">) => JSON.stringify([r.optionA, r.optionB].sort());
const ordered = <T extends { position: number }>(rows: readonly T[]) =>
  [...rows].sort((a, b) => a.position - b.position);
function applyOrder<T extends { key: string; position: number }>(rows: T[], wanted: string[]): T[] {
  const sorted = ordered(rows),
    present = new Map(rows.map((row) => [row.key, row]));
  const order = wanted.flatMap((key) => {
    const row = present.get(key);
    return row ? [row] : [];
  });
  const selected = new Set(order.map((row) => row.key));
  let index = 0;
  return sorted
    .map((row) => (selected.has(row.key) ? (order[index++] ?? row) : row))
    .map((row, i) => ({ ...row, position: i + 1 }));
}
/** G3: 버전마다 바뀌는 행 ID 대신 기준의 그룹/이름으로 대응을 확인한 뒤 내 변경만 적용한다. */
export function rebasePriceList(
  base: PriceList | null,
  mine: PriceListForm,
  latest: PriceList,
): { form: PriceListForm | null; conflicts: string[] } {
  const before = priceListForm(base),
    result = priceListForm(latest),
    conflicts: string[] = [];
  const keys = new Map<string, string>(),
    baseline = new Map(before.options.map((o) => [o.key, o]));
  const optionFields = ["group", "name", "priceKind", "amount", "amountMax", "inStandard"] as const;
  for (const original of before.options) {
    const own = mine.options.find((o) => o.key === original.key),
      current = result.options.find((o) => optionIdentity(o) === optionIdentity(original));
    if (current) keys.set(original.key, current.key);
    if (!own) {
      if (current) result.options = result.options.filter((o) => o.key !== current.key);
      continue;
    }
    const change = patch(original, own, optionFields);
    if (Object.keys(change).length === 0) continue;
    if (!current) {
      conflicts.push(`이름이 바뀌었거나 삭제된 옵션: ${original.name}`);
      continue;
    }
    Object.assign(current, change);
  }
  for (const added of mine.options.filter((o) => !baseline.has(o.key))) {
    const existing = result.options.find((o) => optionIdentity(o) === optionIdentity(added));
    if (existing) {
      if (Object.keys(patch(existing, added, optionFields)).length)
        conflicts.push(`다른 기기에서 같은 이름을 추가한 옵션: ${added.name}`);
      else keys.set(added.key, existing.key);
    } else {
      result.options.push({ ...added });
      keys.set(added.key, added.key);
    }
  }
  const present = new Set(result.options.map((o) => o.key));
  function mapped(key: string): string | null {
    const value = keys.get(key);
    return value && present.has(value) ? value : null;
  }
  function mappedRule(rule: RuleForm): RuleForm | null {
    const optionA = mapped(rule.optionA),
      optionB = mapped(rule.optionB);
    if (!optionA || !optionB) {
      conflicts.push("규칙에서 고른 옵션이 바뀌었거나 삭제됐어요");
      return null;
    }
    return { ...rule, optionA, optionB };
  }
  const basePairs = new Set(before.rules.map(pair));
  function putRule(rule: RuleForm) {
    result.rules = [...result.rules.filter((r) => pair(r) !== pair(rule)), { ...rule, key: pair(rule) }];
  }
  for (const original of before.rules) {
    const own = mine.rules.find((r) => pair(r) === pair(original));
    const a = mapped(original.optionA),
      b = mapped(original.optionB);
    if (!own) {
      if (a && b) result.rules = result.rules.filter((r) => pair(r) !== pair({ optionA: a, optionB: b }));
      continue;
    }
    if (own.kind === original.kind && own.amount === original.amount) continue;
    const rule = mappedRule(own);
    if (rule) putRule(rule);
  }
  for (const own of mine.rules.filter((r) => !basePairs.has(pair(r)))) {
    const rule = mappedRule(own);
    if (rule) putRule(rule);
  }
  // 옵션을 지웠을 때는 다른 기기가 그 옵션에 새로 붙인 규칙도 더는 성립하지 않는다.
  result.rules = result.rules.filter((r) => present.has(r.optionA) && present.has(r.optionB));
  const designKeys = new Map<string, string>(),
    baseDesigns = new Set(before.designs.map((d) => d.key));
  for (const original of before.designs) {
    const own = mine.designs.find((d) => d.key === original.key),
      current = result.designs.find((d) => d.name === original.name);
    if (current) designKeys.set(original.key, current.key);
    if (!own) {
      if (current) result.designs = result.designs.filter((d) => d.key !== current.key);
      continue;
    }
    if (current) {
      // 업로드 성공 여부와 무관하게 이 행의 파일/미리보기 부품은 유지한다.
      current.key = own.key;
      designKeys.set(original.key, current.key);
    }
    const change = patch(original, own, ["name", "inStandard"]);
    const linkChanged = own.optionKey !== original.optionKey,
      imageChanged = own.uploadId !== original.uploadId;
    if (Object.keys(change).length === 0 && !linkChanged && !imageChanged) continue;
    if (!current) {
      conflicts.push(`이름이 바뀌었거나 삭제된 도안: ${original.name}`);
      continue;
    }
    Object.assign(current, change);
    if (linkChanged) {
      const key = own.optionKey === null ? null : mapped(own.optionKey);
      if (own.optionKey !== null && key === null) conflicts.push(`연결 옵션이 바뀐 도안: ${own.name}`);
      else current.optionKey = key;
    }
    if (imageChanged) {
      current.uploadId = own.uploadId;
      current.sourceDesignId = own.sourceDesignId;
      current.imageUrl = own.imageUrl;
    }
  }
  for (const own of mine.designs.filter((d) => !baseDesigns.has(d.key))) {
    if (result.designs.some((d) => d.name === own.name)) {
      conflicts.push(`다른 기기에서 같은 이름을 추가한 도안: ${own.name}`);
      continue;
    }
    const key = own.optionKey === null ? null : mapped(own.optionKey);
    if (own.optionKey !== null && key === null) {
      conflicts.push(`연결 옵션이 바뀐 도안: ${own.name}`);
      continue;
    }
    result.designs.push({ ...own, optionKey: key });
    designKeys.set(own.key, own.key);
  }
  result.designs = result.designs.map((d) =>
    d.optionKey !== null && !present.has(d.optionKey) ? { ...d, optionKey: null } : d,
  );
  for (const group of OPTION_GROUPS) {
    const original = ordered(before.options.filter((o) => o.group === group)).map((o) => o.key),
      wanted = ordered(mine.options.filter((o) => o.group === group)).map((o) => o.key);
    if (JSON.stringify(original) === JSON.stringify(wanted)) continue;
    const reordered = applyOrder(
      result.options.filter((o) => o.group === group),
      wanted.flatMap((key) => {
        const value = mapped(key);
        return value ? [value] : [];
      }),
    );
    result.options = [...result.options.filter((o) => o.group !== group), ...reordered];
  }
  const oldDesignOrder = ordered(before.designs).map((d) => d.key),
    myDesignOrder = ordered(mine.designs).map((d) => d.key);
  if (JSON.stringify(oldDesignOrder) !== JSON.stringify(myDesignOrder))
    result.designs = applyOrder(
      result.designs,
      myDesignOrder.flatMap((key) => {
        const value = designKeys.get(key);
        return value ? [value] : [];
      }),
    );
  if (result.options.length > 100 || result.rules.length > 500 || result.designs.length > 50)
    conflicts.push("다시 적용한 항목 수가 한도를 넘어요");
  if (
    new Set(result.options.map(optionIdentity)).size !== result.options.length ||
    new Set(result.designs.map((d) => d.name)).size !== result.designs.length
  )
    conflicts.push("같은 이름의 항목이 있어요. 이름을 확인해 주세요");
  return { form: conflicts.length ? null : result, conflicts };
}
