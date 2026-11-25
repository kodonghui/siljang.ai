import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { expectSchema } from "./support/contract";
import { myOrderResponseCases, myOrderSamples } from "./support/kakao-my-order-cases";

const screen = readFileSync(new URL("../../../docs/08-screens/SCR-007.md", import.meta.url), "utf8");
const rows = [...screen.matchAll(/^\| (API-070#[^ |]+) \| ([^|]+) \|/gm)].map((m) => ({
  response: m[1],
  state: /SCR-007#([a-z-]+)/.exec(m[2] ?? "")?.[1] ?? null,
}));
it("SCR007의8상태와23응답을 공통 전송과 현재 표시 함수에 대조한다", async () => {
  const samples = myOrderSamples(),
    cases = await myOrderResponseCases();
  expect(samples.map((x) => x.state).sort()).toEqual(
    ["normal", "loading", "empty", "error", "permission", "stale", "handed-over", "rate-limited"].sort(),
  );
  expect(rows).toHaveLength(23);
  expect(new Set(cases.map((x) => x.response)).size).toBe(23);
  expect(
    cases.map(({ response, state }) => ({ response, state })).sort((a, b) => a.response.localeCompare(b.response)),
  ).toEqual(rows.sort((a, b) => (a.response ?? "").localeCompare(b.response ?? "")));
  for (const row of [...samples, ...cases]) if (row.body !== null) expectSchema("SkillResponse", row.body);
  for (const row of cases) if (row.display !== "skill") expect(row.body).toBeNull();
  const fixed = cases.find((row) => row.response === "API-070#200:ai_output_rejected");
  for (const fact of [
    "주문 내용을 다시 확인해 주세요",
    "주문 확정",
    "31,000원(제작 전 취소)",
    "변경 마감: 11월 26일 14:00까지",
  ])
    expect(JSON.stringify(fixed?.body)).toContain(fact);
  const duplicate = cases.find((row) => row.response === "API-070#200:duplicate");
  expect(duplicate?.body).toEqual({ version: "2.0", template: { outputs: [] } });
  for (const state of ["error", "permission", "handed-over", "rate-limited"]) {
    const value = JSON.stringify(samples.find((row) => row.state === state)?.body);
    expect(value).not.toContain("AB1234CD");
    expect(value).not.toContain("36,000");
    expect(value).not.toContain("31,000");
  }
});
