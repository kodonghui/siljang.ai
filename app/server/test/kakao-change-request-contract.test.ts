import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { expectSchema } from "./support/contract";
import { changeRequestResponseCases, changeRequestSamples } from "./support/kakao-change-request-cases";

const screen = readFileSync(new URL("../../../docs/08-screens/SCR-008.md", import.meta.url), "utf8");
const rows = [...screen.matchAll(/^\| (API-071#[^ |]+) \| ([^|]+) \|/gm)].map((m) => ({
  response: m[1],
  state: /SCR-008#([a-z-]+)/.exec(m[2] ?? "")?.[1] ?? null,
}));
it("SCR008의6상태와29응답이 실제 공통 표시/응답과 계약에 맞는다", async () => {
  const samples = changeRequestSamples(),
    cases = await changeRequestResponseCases();
  expect(samples.map((x) => x.state).sort()).toEqual(
    ["normal", "done", "stale", "expired", "permission", "error"].sort(),
  );
  expect(rows).toHaveLength(29);
  expect(new Set(cases.map((x) => x.response)).size).toBe(29);
  expect(
    cases.map(({ response, state }) => ({ response, state })).sort((a, b) => a.response.localeCompare(b.response)),
  ).toEqual(rows.sort((a, b) => (a.response ?? "").localeCompare(b.response ?? "")));
  for (const item of [...samples, ...cases]) if (item.body !== null) expectSchema("SkillTemplateResponse", item.body);
  for (const item of cases) if (item.display !== "skill") expect(item.body).toBeNull();
});
