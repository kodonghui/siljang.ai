import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { expectSchema } from "./support/contract";
import { orderRequestResponseCases, orderRequestSamples } from "./support/kakao-order-request-cases";

const screen = readFileSync(new URL("../../../docs/08-screens/SCR-004.md", import.meta.url), "utf8");
const rows = [...screen.matchAll(/^\| (API-071#[^ |]+) \| ([^|]+) \|/gm)].map((m) => ({
  response: m[1],
  state: /SCR-004#([a-z-]+)/.exec(m[2] ?? "")?.[1] ?? null,
}));
it("SCR004의9상태와29응답을 실제 표시/공통 응답에 대조하고 다른 카드 결과나 카카오 자체 오류를 만들지 않는다", async () => {
  const samples = orderRequestSamples();
  expect(samples.map((x) => x.state).sort()).toEqual(
    ["normal", "allergy", "orderer", "done", "stale", "expired", "day-full", "permission", "error"].sort(),
  );
  const cases = await orderRequestResponseCases();
  expect(rows).toHaveLength(29);
  expect(new Set(cases.map((x) => x.response)).size).toBe(29);
  expect(
    cases.map(({ response, state }) => ({ response, state })).sort((a, b) => a.response.localeCompare(b.response)),
  ).toEqual(rows.sort((a, b) => (a.response ?? "").localeCompare(b.response ?? "")));
  for (const item of [...samples, ...cases]) {
    if (item.body === null) continue;
    expectSchema("SkillTemplateResponse", item.body);
    const body = item.body as { template: { outputs: { textCard?: { title: string; description: string } }[] } };
    expect(body.template.outputs.length).toBeLessThanOrEqual(3);
    for (const output of body.template.outputs)
      if (output.textCard)
        expect([...output.textCard.title, ...output.textCard.description].length).toBeLessThanOrEqual(400);
  }
  for (const item of cases) if (item.display !== "skill") expect(item.body).toBeNull();
});
