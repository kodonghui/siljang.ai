import { expect, it } from "vitest";
import { kakaoCancellationMessage } from "../src/kakao-cancellation-message";
import { expectSchema } from "./support/contract";

const normal = {
  state: "normal",
  orderNo: "AB1234CD",
  pickupAt: "2026-11-28T06:00:00Z",
  timeZone: "Asia/Seoul",
  refund: { kind: "calculated", amount: 24000, clauseNames: ["이틀 전 취소", "맞춤 재료 비용"] },
  cardKey: "synthetic_cancellation_key_01",
  blockId: "synthetic-card",
} as const;
it.each(["\r\n", "\r"])("취소 조문 이름의 줄바꿈 %j를 LF와 같은 내용으로 표시한다", (newline) => {
  const refund = { kind: "calculated", amount: 24000, clauseNames: [`합성${newline}취소 조문`] } as const;
  const body = kakaoCancellationMessage({ ...normal, refund });
  expectSchema("SkillTemplateResponse", body);
  expect(body).toEqual(
    kakaoCancellationMessage({ ...normal, refund: { ...refund, clauseNames: ["합성\n취소 조문"] } }),
  );
});
it.each(["normal", "stale", "expired"] as const)("취소 카드의 상태·별도 두 행동·카드 한도를 지킨다(%s)", (state) => {
  const body = kakaoCancellationMessage({ ...normal, state });
  expectSchema("SkillTemplateResponse", body);
  expect(body.template.outputs).toHaveLength(1);
  const output = body.template.outputs[0];
  if (!output || !("textCard" in output)) throw new Error("missing cancellation action");
  expect([...output.textCard.title, ...output.textCard.description].length).toBeLessThanOrEqual(400);
  expect(output.textCard.buttons.map((b) => b.label)).toEqual(["주문 취소하기", "취소 안 함"]);
  expect(output.textCard.buttons.map((b) => b.extra)).toEqual(
    ["confirm", "decline"].map((choice) => ({ cardKey: normal.cardKey, choice })),
  );
  if (state !== "normal")
    expect(output.textCard.description).toContain(
      state === "stale" ? "내용이 바뀌었어요. 새 카드를 확인해 주세요" : "시간이 지나 새 카드를 보내 드려요",
    );
});
it.each([
  ["paid", "주문을 취소했어요. 환불은 사장님이 정한 뒤 알려 드려요"],
  ["unpaid", "주문을 취소했어요"],
  ["declined", "알겠어요. 더 궁금한 것이 있으면 말씀해 주세요"],
] as const)("끝난 취소의 정해진 말만 보인다(%s)", (kind, text) => {
  const body = kakaoCancellationMessage({ state: "done", kind });
  expectSchema("SkillTemplateResponse", body);
  expect(body.template.outputs).toEqual([{ simpleText: { text } }]);
});
it.each(["이미 받은 주문이에요", "이미 취소된 주문이에요"])(
  "받을 수 없는 주문은 현재 상태만 보인다(%s)",
  (currentStatus) => {
    const body = kakaoCancellationMessage({ ...normal, state: "stale", currentStatus });
    expectSchema("SkillTemplateResponse", body);
    expect(body.template.outputs).toEqual([{ simpleText: { text: `지금은 할 수 없어요: ${currentStatus}` } }]);
    for (const value of [normal.orderNo, normal.cardKey, "24,000"]) expect(JSON.stringify(body)).not.toContain(value);
  },
);
it.each(["retry_needed", "server_error"] as const)("오류의 내부 설명 없이 정해진 말만 보인다(%s)", (reason) => {
  const body = kakaoCancellationMessage({ state: "error", reason });
  expectSchema("SkillTemplateResponse", body);
  expect(body.template.outputs).toEqual([
    { simpleText: { text: reason === "retry_needed" ? "다시 눌러 주세요" : "잠시 뒤 다시 말씀해 주세요" } },
  ]);
});
it("최대50개 긴 조문 이름과 결합 이모지를 모두 보존하고 행동 카드를 마지막에 둔다", () => {
  const clauseNames = Array.from({ length: 50 }, () => "👩‍🍳".repeat(20));
  const body = kakaoCancellationMessage({ ...normal, refund: { kind: "calculated", amount: 0, clauseNames } });
  expectSchema("SkillTemplateResponse", body);
  expect(body.template.outputs).toHaveLength(3);
  const fields = body.template.outputs
    .slice(0, -1)
    .flatMap((output) =>
      "simpleText" in output
        ? [output.simpleText.text]
        : "carousel" in output
          ? output.carousel.items.flatMap((item) => [
              item.title.replace(/^취소 내용 \d+\n/, ""),
              item.description ?? "",
            ])
          : [],
    );
  expect(fields.join("")).toContain(clauseNames.join(", "));
  expect(body.template.outputs.at(-1)).toHaveProperty("textCard.buttons.0.label", "주문 취소하기");
  for (const field of fields) expect(field.replaceAll("👩‍🍳", "")).not.toMatch(/[👩🍳\u200d]/u);
});
it.each([
  { orderNo: "internal-order-uuid" },
  { pickupAt: "bad-time" },
  { timeZone: "wrong/zone" },
  { cardKey: "bad" },
  { blockId: "" },
  { refund: { kind: "calculated", amount: -1, clauseNames: ["합성 조문"] } },
  { refund: { kind: "calculated", amount: 1, clauseNames: [] } },
  { refund: { kind: "calculated", amount: 1, clauseNames: Array.from({ length: 51 }, () => "합성 조문") } },
  { refund: { kind: "calculated", amount: 1, clauseNames: ["가".repeat(61)] } },
  { refund: { kind: "calculated", amount: 1, clauseNames: ["합성\0조문"] } },
] as const)("잘못된 서버 표시 값으로 취소 버튼을 만들지 않는다(%j)", (invalid) => {
  expect(() => kakaoCancellationMessage({ ...normal, ...invalid })).toThrow(RangeError);
});
