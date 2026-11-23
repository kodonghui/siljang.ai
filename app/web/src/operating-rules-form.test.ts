import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { parse } from "yaml";
import type { OperatingRules } from "./operating-rules-api";
import { rebaseRules, rulesForm, rulesIssues, rulesPayload } from "./operating-rules-form";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const fixture = (name = "current"): OperatingRules =>
  structuredClone(
    api.paths["/owner/operating-rules"].get.responses[200].content["application/json"].examples[name].value,
  );
it("템플릿의 기본값과 빠진 정책은 구분하고 모든 기본 조문 필드를 연다", () => {
  const f = rulesForm(fixture("template"));
  expect(f).toMatchObject({
    quoteValidHours: "72",
    paymentDueHours: "12",
    issueReportHours: "24",
    changeDeadlineHours: "",
    dateChangeRefundBasis: "",
    preProductionRefundPct: "100",
  });
  expect(f.clauses.filter((c) => c.enabled)).toHaveLength(1);
  for (const key of [
    "pre_production_cancel",
    "other_shop_design",
    "date_change_refund_basis",
    "cancellation_fee",
    "shop_cancel_compensation",
    "issue_report_window",
    "quote_validity",
    "payment_due",
    "change_deadline",
  ])
    expect(f.clauses.some((c) => c.key === key)).toBe(true);
  expect(rulesPayload(fixture("template"), f).clauses).toHaveLength(1);
  expect(rulesIssues(f)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ field: "/changeDeadlineHours", code: "required" }),
      expect.objectContaining({ field: "/dateChangeRefundBasis", code: "required" }),
    ]),
  );
});
it("현재 원문과 연결 값을 전체 본문으로 옮기며 빈 값을0으로 바꾸지 않는다", () => {
  const base = fixture(),
    f = rulesForm(base),
    body = rulesPayload(base, f);
  expect(body).toMatchObject({
    baseRevision: base.revision,
    quoteValidHours: 72,
    cancellationFeeKrw: 5000,
    clauses: base.clauses,
    refundTiers: base.refundTiers,
  });
  f.cancellationFeeKrw = "";
  expect(rulesPayload(base, f).cancellationFeeKrw).toBe("");
  expect(rulesIssues(f)).toContainEqual({ field: "/cancellationFeeKrw", code: "required" });
});
it("단계가 비거나 겹치면 해당 행을 지목하고 양 끝을 이어야 한다", () => {
  const f = rulesForm(fixture());
  f.refundTiers = [{ id: "a", hoursBeforeMin: "72", hoursBeforeMax: "", refundPct: "50" }];
  expect(rulesIssues(f)).toContainEqual({ field: "/refundTiers/0", code: "gap" });
  f.refundTiers = [
    { id: "a", hoursBeforeMin: "0", hoursBeforeMax: "100", refundPct: "0" },
    { id: "b", hoursBeforeMin: "72", hoursBeforeMax: "", refundPct: "50" },
  ];
  expect(rulesIssues(f)).toContainEqual({ field: "/refundTiers/1", code: "overlaps" });
  const first = f.refundTiers[0];
  if (!first) throw Error("첫 단계 없음");
  first.hoursBeforeMax = "72";
  expect(rulesIssues(f)).toEqual([]);
});
it("단계 표와 단계 조문을 함께 넣거나 함께 뺀다", () => {
  const f = rulesForm(fixture());
  f.refundTiers = [];
  expect(rulesIssues(f)).toContainEqual({ field: "/refundTiers", code: "required" });
  const row = f.clauses.find((c) => c.key === "staged_refund");
  if (!row) throw Error("조문 없음");
  row.enabled = false;
  expect(rulesIssues(f)).toEqual([]);
});
it("조문 원문 길이는 유니코드 글자 수로 보고 기한/금액 범위를 검사한다", () => {
  const f = rulesForm(fixture()),
    row = f.clauses.find((c) => c.enabled);
  if (!row) throw Error("조문 없음");
  row.title = "😀".repeat(60);
  expect(rulesIssues(f)).toEqual([]);
  row.title += "가";
  f.quoteValidHours = "721";
  f.preProductionRefundPct = "101";
  expect(rulesIssues(f)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ field: "/quoteValidHours", code: "out_of_range" }),
      expect.objectContaining({ field: "/preProductionRefundPct", code: "out_of_range" }),
      expect.objectContaining({ code: "too_long" }),
    ]),
  );
});
it("충돌은 내가 바꾼 값만 최신 위에 얹어 다른 기기의 기한/조문을 보존한다", () => {
  const base = fixture(),
    mine = rulesForm(base);
  mine.quoteValidHours = "120";
  const latest = {
    ...base,
    version: 3,
    revision: "synthetic-v3",
    paymentDueHours: 24,
    clauses: base.clauses.map((c) =>
      c.key === "other_shop_design" ? { ...c, effectText: "직접 그린 디자인만 받아요" } : c,
    ),
  };
  const result = rebaseRules(base, mine, latest);
  expect(result.conflicts).toEqual([]);
  expect(result.form).toMatchObject({ quoteValidHours: "120", paymentDueHours: "24" });
  expect(result.form?.clauses.find((c) => c.key === "other_shop_design")?.effectText).toBe("직접 그린 디자인만 받아요");
  if (!result.form) throw Error("재적용 없음");
  const v4 = { ...latest, version: 4, revision: "synthetic-v4", issueReportHours: 48 };
  expect(rebaseRules(latest, result.form, v4).form).toMatchObject({
    quoteValidHours: "120",
    paymentDueHours: "24",
    issueReportHours: "48",
  });
});
it("같은 직접 쓴 조문 둘은 재적용 대상을 추측하지 않고 원래 입력을 남긴다", () => {
  const source = fixture(),
    sample = source.clauses[0];
  if (!sample) throw Error("조문 없음");
  const base = {
    ...source,
    clauses: [
      ...source.clauses,
      { ...sample, key: "custom" as const, position: 5 },
      { ...sample, key: "custom" as const, position: 6 },
    ],
  };
  const mine = rulesForm(base),
    row = mine.clauses.find((c) => c.key === "custom");
  if (!row) throw Error("직접 쓴 조문 없음");
  row.effectText = "내가 바꾼 조문";
  const copy = structuredClone(mine),
    result = rebaseRules(base, mine, { ...base, version: 3, revision: "synthetic-v3" });
  expect(result.form).toBeNull();
  expect(result.conflicts.length).toBeGreaterThan(0);
  expect(mine).toEqual(copy);
});

it("삭제한 직접 쓴 조문은 충돌 재적용 뒤 선택지 카드로 돌아오지 않는다", () => {
  const value = fixture();
  const base = {
    ...value,
    clauses: [
      ...value.clauses,
      {
        key: "custom" as const,
        position: 99,
        title: "직접 쓴 합성 조문",
        conditionText: "합성 조건",
        effectText: "합성 효과",
      },
    ],
  };
  const mine = rulesForm(base);
  mine.clauses = mine.clauses.filter((c) => c.key !== "custom");
  const merged = rebaseRules(base, mine, { ...base, version: 3, revision: "synthetic-v3" });
  expect(merged.conflicts).toEqual([]);
  expect(merged.form?.clauses.some((c) => c.key === "custom")).toBe(false);
});
it.each(["1e2", "0x1F", "12.0"])("숫자 %s를 다른 정수로 바꾸지 않고 오류로 남긴다", (value) => {
  const base = fixture(),
    form = rulesForm(base);
  form.cancellationFeeKrw = value;
  expect(rulesIssues(form)).toContainEqual({ field: "/cancellationFeeKrw", code: "out_of_range" });
  expect(rulesPayload(base, form).cancellationFeeKrw).toBe(value);
});
