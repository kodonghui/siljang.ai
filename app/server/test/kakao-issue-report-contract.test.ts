import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { expectSchema } from "./support/contract";
import { issueReportResponseCases, issueReportSamples } from "./support/kakao-issue-report-cases";

it("SCR010의6상태와29응답 행을 정본의 상태에 대응한다", async () => {
  const screen = readFileSync(new URL("../../../docs/08-screens/SCR-010.md", import.meta.url), "utf8");
  const states = [...screen.matchAll(/^\| SCR-010#([a-z-]+) \|/gm)].map((m) => m[1]).sort();
  expect(
    issueReportSamples()
      .map((r) => r.state)
      .sort(),
  ).toEqual(states);
  const expected = [...screen.matchAll(/^\| (API-071#[^|]+) \| ([^|]+) \|/gm)].map((m) => ({
    response: m[1]?.trim(),
    state: /SCR-010#([a-z-]+)/.exec(m[2] ?? "")?.[1] ?? null,
  }));
  const cases = await issueReportResponseCases();
  expect(cases).toHaveLength(29);
  expect(
    cases.map(({ response, state }) => ({ response, state })).sort((a, b) => a.response.localeCompare(b.response)),
  ).toEqual(expected.sort((a, b) => (a.response ?? "").localeCompare(b.response ?? "")));
  for (const row of cases) {
    if (row.display === "skill") expectSchema("SkillTemplateResponse", row.body);
    else expect(row.body).toBeNull();
  }
  expect(cases.filter((r) => r.display === "skill")).toHaveLength(10);
  expect(cases.filter((r) => r.display === "kakao-client")).toHaveLength(3);
});
