import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { expectSchema } from "./support/contract";
import { customerNoticeResponseCases, customerNoticeSamples } from "./support/kakao-customer-notice-cases";

const screen = readFileSync(new URL("../../../docs/08-screens/SCR-011.md", import.meta.url), "utf8");
it("SCR011의5상태와API073의6응답을 현재 공통 전송 표시에 대조한다", async () => {
  const states = [...screen.matchAll(/^\| SCR-011#([a-z-]+) \|/gm)].map((m) => m[1]).sort();
  const samples = customerNoticeSamples(),
    cases = await customerNoticeResponseCases();
  expect(samples.map((x) => x.state).sort()).toEqual(states);
  expect(states).toHaveLength(5);
  const rows = [...screen.matchAll(/^\| (API-073#[^ |]+) \| ([^|]+) \|/gm)].map((m) => ({
    response: m[1],
    state: /SCR-011#([a-z-]+)/.exec(m[2] ?? "")?.[1] ?? null,
  }));
  expect(rows).toHaveLength(6);
  expect(new Set(cases.map((x) => x.response)).size).toBe(6);
  expect(
    cases.map(({ response, state }) => ({ response, state })).sort((a, b) => a.response.localeCompare(b.response)),
  ).toEqual(rows.sort((a, b) => (a.response ?? "").localeCompare(b.response ?? "")));
  for (const row of [...samples, ...cases]) if (row.body !== null) expectSchema("SkillResponse", row.body);
  for (const row of cases) if (row.display !== "skill") expect(row.body).toBeNull();
  expect(samples.find((row) => row.state === "error")?.body).toBeNull();
});
it("다음 대화의 고지·사장님 답·현재 답 순서와 전달 오류의 무표시를 보존한다", () => {
  const value = JSON.stringify(customerNoticeSamples().find((row) => row.state === "deferred")?.body);
  const disclosure = value.indexOf("AI가 상담해요"),
    notice = value.indexOf("사장님이 남긴 합성 답 원문"),
    current = value.indexOf("현재 합성 상담 답");
  expect(disclosure).toBeGreaterThanOrEqual(0);
  expect(notice).toBeGreaterThan(disclosure);
  expect(current).toBeGreaterThan(notice);
});
