import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { expectSchema } from "./support/contract";
import { consultationResponseCases } from "./support/kakao-consultation-cases";

const screen = readFileSync(new URL("../../../docs/08-screens/SCR-003.md", import.meta.url), "utf8");
const rows = [...screen.matchAll(/^\| (API-(?:070|073)#[^ |]+) \| ([^|]+) \|/gm)].map((match) => ({
  response: match[1],
  state: /SCR-003#([a-z-]+)/.exec(match[2] ?? "")?.[1] ?? null,
}));

it("SCR003 응답29행마다 실제 표시 함수의 자료와 정한 상태가 있고 다른 API의 안내는 그리지 않는다", async () => {
  const cases = await consultationResponseCases();
  expect(rows).toHaveLength(29);
  expect(new Set(cases.map((row) => row.response)).size).toBe(cases.length);
  expect(
    cases.map(({ response, state }) => ({ response, state })).sort((a, b) => a.response.localeCompare(b.response)),
  ).toEqual(rows.sort((a, b) => (a.response ?? "").localeCompare(b.response ?? "")));
  for (const row of cases) {
    if (row.display !== "skill") {
      expect(row.body).toBeNull();
      continue;
    }
    expectSchema("SkillResponse", row.body);
    const body = row.body as { template?: { outputs: { textCard?: { title: string; description: string } }[] } };
    expect(body.template?.outputs.length ?? 0).toBeLessThanOrEqual(3);
    for (const output of body.template?.outputs ?? [])
      if (output.textCard)
        expect([...output.textCard.title, ...output.textCard.description].length).toBeLessThanOrEqual(400);
  }
});
