import { describe, expect, it } from "vitest";
import { type PriceListInput, parsePriceList } from "../src/price-list-input";
import { ApiError, type FieldReason } from "../src/problem";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("합성 시험 항목 없음");
  return value;
}

const sourceDesignId = "00000000-0000-4000-8000-000000000001";
function input(): PriceListInput {
  return {
    baseRevision: null,
    options: [
      {
        key: "size",
        group: "size",
        name: "1호",
        priceKind: "fixed",
        amount: 35000,
        amountMax: null,
        inStandard: true,
        position: 0,
      },
      {
        key: "design",
        group: "design",
        name: "꽃",
        priceKind: "fixed",
        amount: 0,
        amountMax: null,
        inStandard: true,
        position: 0,
      },
    ],
    rules: [],
    designs: [{ name: "꽃 도안", sourceDesignId, optionKey: "design", inStandard: true, position: 0 }],
  };
}
function option(patch: Record<string, unknown>) {
  const v = input();
  return { ...v, options: [{ ...v.options[0], ...patch }, v.options[1]] };
}
function design(patch: Record<string, unknown>) {
  const v = input();
  return { ...v, designs: [{ ...v.designs[0], ...patch }] };
}
function rules(values: unknown[]) {
  return { ...input(), rules: values };
}
const exclude = { kind: "exclude", optionA: "size", optionB: "design", amount: null };
const surcharge = { ...exclude, kind: "surcharge", amount: 1000 };

describe("SPEC-004 가격표 전체 입력과 기본 디자인 범위", () => {
  it("0원·상한·30글자·부터/범위의 범위 밖 옵션은 허용", () => {
    const v = input();
    v.options[0] = {
      ...required(v.options[0]),
      name: "🎂".repeat(30),
      priceKind: "range",
      amount: 0,
      amountMax: 10000000,
      inStandard: false,
      position: 32767,
    };
    expect(parsePriceList(v)).toEqual(v);
    expect(parsePriceList(option({ priceKind: "from", amount: 10000000, inStandard: false }))).toBeTruthy();
  });

  const cases: [string, () => unknown, string, FieldReason][] = [
    ["본문 없음", () => null, "/", "bad_format"],
    ["알 수 없는 가게 필드", () => ({ ...input(), shopId: sourceDesignId }), "/shopId", "unknown_field"],
    [
      "버전 누락",
      () => {
        const { baseRevision: _, ...v } = input();
        return v;
      },
      "/baseRevision",
      "required",
    ],
    ["옵션 없음", () => ({ ...input(), options: [] }), "/options", "required"],
    ["옵션 목록 형식", () => ({ ...input(), options: {} }), "/options", "bad_format"],
    [
      "옵션 101개",
      () => ({
        ...input(),
        options: Array.from({ length: 101 }, (_, i) => ({ ...input().options[0], key: `o${i}`, name: `옵션${i}` })),
      }),
      "/options",
      "too_many",
    ],
    ["음수", () => option({ amount: -1 }), "/options/0/amount", "out_of_range"],
    ["천만 원 초과", () => option({ amount: 10000001 }), "/options/0/amount", "out_of_range"],
    ["원 미만", () => option({ amount: 0.5 }), "/options/0/amount", "bad_format"],
    ["숫자 문자열", () => option({ amount: "35000" }), "/options/0/amount", "bad_format"],
    ["빈 이름", () => option({ name: " " }), "/options/0/name", "too_short"],
    ["31글자 이름", () => option({ name: "🎂".repeat(31) }), "/options/0/name", "too_long"],
    ["널 문자", () => option({ name: "꽃\0도안" }), "/options/0/name", "bad_format"],
    ["목록 밖 종류", () => option({ group: "other" }), "/options/0/group", "not_allowed"],
    ["순서 상한", () => option({ position: 32768 }), "/options/0/position", "out_of_range"],
    ["범위 표시 누락", () => option({ inStandard: null }), "/options/0/inStandard", "bad_format"],
    ["부터 옵션의 범위 포함", () => option({ priceKind: "from" }), "/options/0/inStandard", "not_allowed"],
    [
      "범위 옵션의 범위 포함",
      () => option({ priceKind: "range", amountMax: 40000 }),
      "/options/0/inStandard",
      "not_allowed",
    ],
    ["범위 상한 없음", () => option({ priceKind: "range", inStandard: false }), "/options/0/amountMax", "required"],
    [
      "범위 상한 역전",
      () => option({ priceKind: "range", amountMax: 34000, inStandard: false }),
      "/options/0/amountMax",
      "out_of_range",
    ],
    ["확정 값의 상한", () => option({ amountMax: 40000 }), "/options/0/amountMax", "not_allowed"],
    ["중복 참조 이름", () => option({ key: "design" }), "/options/1/key", "duplicate"],
    ["같은 종류의 중복 이름", () => option({ group: "design", name: "꽃" }), "/options/1/name", "duplicate"],
    ["규칙 없는 옵션", () => rules([{ ...exclude, optionA: "missing" }]), "/rules/0/optionA", "reference_not_found"],
    ["자기 자신 규칙", () => rules([{ ...exclude, optionB: "size" }]), "/rules/0/optionB", "not_allowed"],
    [
      "역순 중복 규칙",
      () => rules([exclude, { ...exclude, optionA: "design", optionB: "size" }]),
      "/rules/1",
      "duplicate",
    ],
    [
      "역순 충돌 규칙",
      () => rules([exclude, { ...surcharge, optionA: "design", optionB: "size" }]),
      "/rules/1",
      "conflict",
    ],
    ["더하는 값 0원", () => rules([{ ...surcharge, amount: 0 }]), "/rules/0/amount", "out_of_range"],
    ["더하는 값 없음", () => rules([{ ...surcharge, amount: null }]), "/rules/0/amount", "required"],
    ["금지 규칙의 값", () => rules([{ ...exclude, amount: 1000 }]), "/rules/0/amount", "not_allowed"],
    ["규칙 501개", () => rules(Array(501).fill(exclude)), "/rules", "too_many"],
    [
      "도안 51개",
      () => ({
        ...input(),
        designs: Array.from({ length: 51 }, (_, i) => ({ ...input().designs[0], name: `도안${i}` })),
      }),
      "/designs",
      "too_many",
    ],
    ["도안 참조 두 종류", () => design({ uploadId: `upl_${"a".repeat(20)}` }), "/designs/0", "not_allowed"],
    [
      "도안 참조 없음",
      () => {
        const v = input();
        const { sourceDesignId: _, ...d } = required(v.designs[0]);
        return { ...v, designs: [d] };
      },
      "/designs/0",
      "required",
    ],
    ["도안 참조 형식", () => design({ sourceDesignId: "not-a-uuid" }), "/designs/0/sourceDesignId", "bad_format"],
    ["도안 옵션 없음", () => design({ optionKey: "missing" }), "/designs/0/optionKey", "reference_not_found"],
    ["도안에 크기 옵션", () => design({ optionKey: "size" }), "/designs/0/optionKey", "not_allowed"],
    [
      "범위 밖 옵션에 이은 도안 포함",
      () => {
        const v = input();
        required(v.options[1]).inStandard = false;
        return v;
      },
      "/designs/0/inStandard",
      "not_allowed",
    ],
    [
      "중복 도안 이름",
      () => ({ ...input(), designs: [...input().designs, ...input().designs] }),
      "/designs/1/name",
      "duplicate",
    ],
  ];
  it.each(cases)("%s는 해당 필드 오류", (_name, make, field, code) => {
    try {
      parsePriceList(make());
      throw new Error("잘못된 입력이 허용됨");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        code: "validation_failed",
        extras: { errors: expect.arrayContaining([{ field, code }]) },
      });
    }
  });

  it("옵션100개·규칙500개·도안50개 한도는 허용", () => {
    const v = input();
    v.options = Array.from({ length: 100 }, (_, i) => ({ ...required(v.options[0]), key: `o${i}`, name: `옵션${i}` }));
    v.rules = [];
    for (let a = 0; a < 100 && v.rules.length < 500; a++)
      for (let b = a + 1; b < 100 && v.rules.length < 500; b++)
        v.rules.push({ kind: "exclude", optionA: `o${a}`, optionB: `o${b}`, amount: null });
    v.designs = Array.from({ length: 50 }, (_, i) => ({
      name: `도안${i}`,
      sourceDesignId,
      optionKey: null,
      inStandard: false,
      position: i,
    }));
    expect(parsePriceList(v)).toEqual(v);
  });
});
