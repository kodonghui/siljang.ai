import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { expectSchema } from "./support/contract";
import { consentWithdrawalResponseCases, consentWithdrawalSamples } from "./support/kakao-consent-withdrawal-cases";

it("SCR013의6상태와29응답 행을 정본의 상태에 대응한다", async () => {
  const screen = readFileSync(new URL("../../../docs/08-screens/SCR-013.md", import.meta.url), "utf8");
  const states = [...screen.matchAll(/^\| SCR-013#([a-z-]+) \|/gm)].map((match) => match[1]).sort();
  expect(
    consentWithdrawalSamples()
      .map((row) => row.state)
      .sort(),
  ).toEqual(states);
  const expected = [...screen.matchAll(/^\| (API-071#[^|]+) \| ([^|]+) \|/gm)].map((match) => ({
    response: match[1]?.trim(),
    state: /SCR-013#([a-z-]+)/.exec(match[2] ?? "")?.[1] ?? null,
  }));
  const cases = await consentWithdrawalResponseCases();
  expect(cases).toHaveLength(29);
  expect(
    cases.map(({ response, state }) => ({ response, state })).sort((a, b) => a.response.localeCompare(b.response)),
  ).toEqual(expected.sort((a, b) => (a.response ?? "").localeCompare(b.response ?? "")));
  for (const row of cases)
    if (row.display === "skill") expectSchema("SkillTemplateResponse", row.body);
    else expect(row.body).toBeNull();
  expect(cases.filter((row) => row.display === "skill")).toHaveLength(10);
  expect(cases.filter((row) => row.display === "kakao-client")).toHaveLength(3);
});
