import { expect, it } from "vitest";
import { kakaoMessageOutputs, mergeKakaoAmountConfirmations } from "../src/kakao-message-content";
import { expectSchema } from "./support/contract";

const view = {
  state: "amount-confirm",
  kind: "difference",
  cardKey: "synthetic_amount_dedup_key_01",
  blockId: "synthetic-card",
  expiresAt: "2026-11-26T01:30:00Z",
  timeZone: "Asia/Seoul",
  changes: "문구를 바꿔요",
  currentAmount: 35000,
  newAmount: 55000,
  difference: 20000,
  changeDeadline: "2026-11-26T12:00:00Z",
} as const;
const content = { kind: "payment_notice", view } as const;

it("대기 안내와 새 참조가 같은 금액 카드면 행동 카드를 한 번 보인다", () => {
  const contents = mergeKakaoAmountConfirmations([content], [{ ...content }]);
  const outputs = kakaoMessageOutputs(contents);
  expect(outputs).toHaveLength(1);
  expectSchema("SkillTemplateResponse", { version: "2.0", template: { outputs } });
  expect(JSON.stringify(outputs)).toContain(view.cardKey);
});
it("다른 금액 카드의 버튼과 내용은 합치지 않는다", () => {
  const other = { ...content, view: { ...view, cardKey: "synthetic_other_amount_key_01" } };
  const outputs = kakaoMessageOutputs(mergeKakaoAmountConfirmations([content], [other]));
  expect(outputs).toHaveLength(2);
  for (const key of [view.cardKey, other.view.cardKey]) expect(JSON.stringify(outputs)).toContain(key);
});
it("같은 긴 금액 카드의 여러 부분을 보존하고 원문과 버튼을 한 번 보인다", () => {
  const long = { ...content, view: { ...view, changes: "🎂".repeat(1500) } };
  const contents = mergeKakaoAmountConfirmations([long], [long]);
  const outputs = kakaoMessageOutputs(contents);
  expect(outputs).toHaveLength(3);
  expectSchema("SkillTemplateResponse", { version: "2.0", template: { outputs } });
  const text = outputs
    .map((o) => ("simpleText" in o ? o.simpleText.text : "textCard" in o ? o.textCard.description : ""))
    .join("");
  expect(text).toContain(long.view.changes);
  expect(outputs.filter((o) => "textCard" in o)).toHaveLength(1);
  expect(mergeKakaoAmountConfirmations(contents, [long])).toEqual(contents);
});
it("같은 일반 글도 각각의 안내로 보존한다", () => {
  expect(mergeKakaoAmountConfirmations(["합성 안내"], ["합성 안내"])).toEqual(["합성 안내", "합성 안내"]);
});
