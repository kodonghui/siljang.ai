import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { expectSchema } from "./support/contract";
import { reviewQuestionSamples, reviewResponseCases, reviewSamples } from "./support/kakao-review-cases";

const screen = readFileSync(new URL("../../../docs/08-screens/SCR-012.md", import.meta.url), "utf8");
it("SCR012의4상태와 세 질문을 실제 표시 함수로 만든다", () => {
  const states = [...screen.matchAll(/^\| SCR-012#([a-z-]+) \|/gm)].map((m) => m[1]).sort();
  expect(
    reviewSamples()
      .map((sample) => sample.state)
      .sort(),
  ).toEqual(states);
  expect(reviewQuestionSamples().map((sample) => sample.question)).toEqual([
    "review_text",
    "review_photos",
    "photo_consent",
  ]);
  for (const sample of [...reviewSamples(), ...reviewQuestionSamples()])
    expectSchema("SkillTemplateResponse", sample.body);
});
it("API072의12응답 행은 정해진 상태와 표시 주체에 대응한다", async () => {
  const defined = [...screen.matchAll(/^\| (API-072#[^|]+) \|/gm)].map((m) => m[1]?.trim());
  const rows = await reviewResponseCases();
  expect(rows.map((row) => row.response)).toEqual(defined);
  expect(rows).toHaveLength(12);
  expect(rows.filter((row) => row.display === "skill")).toHaveLength(7);
  expect(rows.filter((row) => row.display === "not-shown")).toHaveLength(2);
  expect(rows.filter((row) => row.display === "kakao-client")).toHaveLength(3);
  for (const row of rows) {
    if (row.display === "skill") {
      expect(row.state).toMatch(/^(done|permission|error)$/);
      expectSchema("SkillTemplateResponse", row.body);
    } else expect(row.body).toBeNull();
  }
});
