import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { expectSchema } from "./support/contract";
import { paymentResponseCases, paymentSamples } from "./support/kakao-payment-cases";

const screen = readFileSync(new URL("../../../docs/08-screens/SCR-005.md", import.meta.url), "utf8");
const rows = [...screen.matchAll(/^\| (API-07[13]#[^ |]+) \| ([^|]+) \|/gm)].map((m) => ({
  response: m[1],
  state: /SCR-005#([a-z-]+)/.exec(m[2] ?? "")?.[1] ?? null,
}));
it("SCR005의7상태와35응답을 현재 표시 함수와 공통 응답에 대조한다", async () => {
  const samples = paymentSamples(),
    cases = await paymentResponseCases();
  expect(samples.map((x) => x.state).sort()).toEqual(
    ["normal", "amount-confirm", "done", "deferred", "stale", "permission", "error"].sort(),
  );
  expect(rows).toHaveLength(35);
  expect(new Set(cases.map((x) => x.response)).size).toBe(35);
  expect(
    cases.map(({ response, state }) => ({ response, state })).sort((a, b) => a.response.localeCompare(b.response)),
  ).toEqual(rows.sort((a, b) => (a.response ?? "").localeCompare(b.response ?? "")));
  for (const item of [...samples, ...cases]) {
    if (item.body !== null) expectSchema("SkillTemplateResponse", item.body);
  }
  for (const item of cases) if (item.display !== "skill") expect(item.body).toBeNull();
  const cards = JSON.stringify(samples.find((x) => x.state === "amount-confirm")?.body);
  expect(cards).not.toContain("계좌번호");
  expect(cards).not.toContain("123456789012");
  expect(cards).not.toContain("webLink");
});
