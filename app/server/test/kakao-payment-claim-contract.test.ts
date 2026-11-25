import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { expectSchema } from "./support/contract";
import { paymentClaimResponseCases, paymentClaimSamples } from "./support/kakao-payment-claim-cases";

const screen = readFileSync(new URL("../../../docs/08-screens/SCR-006.md", import.meta.url), "utf8");
const rows = [...screen.matchAll(/^\| (API-071#[^ |]+) \| ([^|]+) \|/gm)].map((m) => ({
  response: m[1],
  state: /SCR-006#([a-z-]+)/.exec(m[2] ?? "")?.[1] ?? null,
}));
it("SCR006의7상태와29응답을 실제 표시 함수/공통 응답과 대조한다", async () => {
  const samples = paymentClaimSamples(),
    cases = await paymentClaimResponseCases();
  expect(samples.map((x) => x.state).sort()).toEqual(
    ["normal", "depositor", "done", "stale", "expired", "permission", "error"].sort(),
  );
  expect(rows).toHaveLength(29);
  expect(new Set(cases.map((x) => x.response)).size).toBe(29);
  expect(
    cases.map(({ response, state }) => ({ response, state })).sort((a, b) => a.response.localeCompare(b.response)),
  ).toEqual(rows.sort((a, b) => (a.response ?? "").localeCompare(b.response ?? "")));
  for (const item of [...samples, ...cases]) if (item.body !== null) expectSchema("SkillTemplateResponse", item.body);
  for (const item of cases) if (item.display !== "skill") expect(item.body).toBeNull();
});
