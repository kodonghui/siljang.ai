import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { parse } from "yaml";
import type { PriceList } from "./price-list-api";
import {
  type PriceListForm,
  priceListForm,
  priceListPayload,
  rebasePriceList,
  removePriceOption,
} from "./price-list-form";

const contract = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const fixture = (): PriceList =>
  structuredClone(
    contract.paths["/owner/price-list"].get.responses[200].content["application/json"].examples.current.value,
  );
function option(form: PriceListForm, name: string) {
  const o = form.options.find((x) => x.name === name);
  if (!o) throw new Error(`옵션 없음: ${name}`);
  return o;
}
function newer(base: PriceList) {
  const ids = new Map(
    base.options.map((o, i) => [o.optionId, `00000000-0000-4000-8000-${String(i + 100).padStart(12, "0")}`]),
  );
  const id = (value: string) => {
    const next = ids.get(value);
    if (!next) throw new Error("옵션 연결 없음");
    return next;
  };
  return {
    ...base,
    version: base.version + 1,
    revision: "synthetic-v5",
    options: base.options.map((o) => ({ ...o, optionId: id(o.optionId) })),
    rules: base.rules.map((r) => ({ ...r, optionAId: id(r.optionAId), optionBId: id(r.optionBId) })),
    designs: base.designs.map((d, i) => ({
      ...d,
      designId: `00000000-0000-4000-8000-${String(i + 500).padStart(12, "0")}`,
      optionId: d.optionId === null ? null : id(d.optionId),
    })),
  };
}
it("현재 옵션의 연결과 기존 도안 재사용 ID를 전체 저장 본문으로 옮김", () => {
  const base = fixture(),
    form = priceListForm(base),
    body = priceListPayload(base, form);
  expect(body.baseRevision).toBe(base.revision);
  expect(body.options[0]).toMatchObject({ key: base.options[0]?.optionId, amount: 35000 });
  expect(body.rules[0]).toMatchObject({ optionA: base.rules[0]?.optionAId, optionB: base.rules[0]?.optionBId });
  expect(body.designs[0]).toMatchObject({
    sourceDesignId: base.designs[0]?.designId,
    optionKey: base.designs[0]?.optionId,
  });
  expect(body.designs[0]).not.toHaveProperty("imageUrl");
  expect(priceListPayload(null, priceListForm(null)).baseRevision).toBeNull();
});
it("비어 있거나 소수인 금액을 0원 정수로 바꾸지 않음", () => {
  const base = fixture(),
    form = priceListForm(base);
  option(form, "1호").amount = "";
  option(form, "2호").amount = "12.5";
  expect(
    priceListPayload(base, form)
      .options.slice(0, 2)
      .map((x) => x.amount),
  ).toEqual(["", "12.5"]);
});
it("ID가 모두 바뀐 최신 버전 위에 내 변경만 얹고 다른 기기의 금액을 보존", () => {
  const base = fixture(),
    mine = priceListForm(base),
    latest = newer(base);
  option(mine, "1호").amount = "38000";
  latest.options = latest.options.map((o) => (o.name === "초코" ? { ...o, amount: 4000 } : o));
  const merged = rebasePriceList(base, mine, latest);
  expect(merged.conflicts).toEqual([]);
  if (!merged.form) throw new Error("재적용 실패");
  expect(option(merged.form, "1호").amount).toBe("38000");
  expect(option(merged.form, "초코").amount).toBe("4000");
  expect(option(merged.form, "1호").key).toBe(latest.options.find((o) => o.name === "1호")?.optionId);
  expect(merged.form.designs[0]?.sourceDesignId).toBe(latest.designs[0]?.designId);
});
it("추가한 옵션과 규칙의 옛 옵션 연결을 최신 ID로 바꿈", () => {
  const base = fixture(),
    mine = priceListForm(base),
    latest = newer(base);
  const origin = option(mine, "1호");
  mine.options.push({ ...origin, key: "new-size-049", name: "3호", amount: "65000", position: 3 });
  mine.rules.push({ key: "new-rule-049", kind: "exclude", optionA: origin.key, optionB: "new-size-049", amount: "" });
  const merged = rebasePriceList(base, mine, latest);
  expect(merged.conflicts).toEqual([]);
  if (!merged.form) throw new Error("재적용 실패");
  expect(merged.form.rules.find((r) => r.optionB === "new-size-049")).toMatchObject({
    optionA: option(merged.form, "1호").key,
  });
  expect(merged.form.rules).toHaveLength(base.rules.length + 1);
});
it("다른 기기가 이름을 바꾼 내 수정 행은 추측해 덮지 않고 원래 입력을 남김", () => {
  const base = fixture(),
    mine = priceListForm(base),
    latest = newer(base);
  option(mine, "1호").amount = "38000";
  latest.options = latest.options.map((o) => (o.name === "1호" ? { ...o, name: "작은 케이크" } : o));
  const before = structuredClone(mine),
    merged = rebasePriceList(base, mine, latest);
  expect(merged.form).toBeNull();
  expect(merged.conflicts.length).toBeGreaterThan(0);
  expect(mine).toEqual(before);
});
it("옵션 삭제는 연결 규칙을 지우고 도안 연결만 해제", () => {
  const form = priceListForm(fixture()),
    chosen = option(form, "기본 레터링");
  form.rules.push({
    key: "delete-rule-049",
    kind: "exclude",
    optionA: chosen.key,
    optionB: option(form, "1호").key,
    amount: "",
  });
  const next = removePriceOption(form, chosen.key);
  expect(next.options.some((o) => o.key === chosen.key)).toBe(false);
  expect(next.rules.some((r) => r.optionA === chosen.key || r.optionB === chosen.key)).toBe(false);
  expect(next.designs.find((d) => d.name === "하트 레터링")?.optionKey).toBeNull();
  expect(form.designs.find((d) => d.name === "하트 레터링")?.optionKey).toBe(chosen.key);
});
it("새로 들어온 원격 옵션의 자리를 남기고 내 순서 변경을 재적용", () => {
  const base = fixture(),
    mine = priceListForm(base),
    latest = newer(base);
  option(mine, "1호").position = 2;
  option(mine, "2호").position = 1;
  const first = latest.options.find((o) => o.name === "1호");
  if (!first) throw new Error("첫 옵션 없음");
  latest.options = latest.options.map((o) => (o.name === "2호" ? { ...o, position: 3 } : o));
  latest.options.push({ ...first, optionId: "00000000-0000-4000-8000-000000000999", name: "중간 크기", position: 2 });
  const merged = rebasePriceList(base, mine, latest);
  if (!merged.form) throw new Error("재적용 실패");
  expect(
    merged.form.options
      .filter((o) => o.group === "size")
      .sort((a, b) => a.position - b.position)
      .map((o) => o.name),
  ).toEqual(["2호", "중간 크기", "1호"]);
});

it("다시 적용하는 새 그림은 파일 상태를 가진 도안의 화면 키를 유지", () => {
  const base = fixture(),
    mine = priceListForm(base),
    latest = newer(base);
  const own = mine.designs[0];
  if (!own) throw new Error("도안 없음");
  own.uploadId = "upl_synthetic000000000000000049";
  own.sourceDesignId = null;
  own.imageUrl = "blob:synthetic-preview";
  const merged = rebasePriceList(base, mine, latest);
  if (!merged.form) throw new Error("재적용 실패");
  expect(merged.form.designs.find((d) => d.name === own.name)).toMatchObject({
    key: own.key,
    uploadId: own.uploadId,
    sourceDesignId: null,
    imageUrl: own.imageUrl,
  });
});

it("다른 기기의 규칙 순서가 달라져도 재적용한 규칙의 화면 키가 겹치지 않음", () => {
  const base = fixture(),
    mine = priceListForm(base),
    latest = newer(base);
  latest.rules.reverse();
  const rule = mine.rules[0];
  if (!rule) throw new Error("규칙 없음");
  rule.amount = "6000";
  const merged = rebasePriceList(base, mine, latest);
  if (!merged.form) throw new Error("재적용 실패");
  expect(merged.form.rules).toHaveLength(base.rules.length);
  expect(new Set(merged.form.rules.map((r) => r.key)).size).toBe(merged.form.rules.length);
});
