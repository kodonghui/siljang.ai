import { expect, it } from "vitest";
import { type KakaoChangeRequestView, kakaoChangeRequestMessage } from "../src/kakao-change-request-message";
import { expandKakaoMessageContents, kakaoMessageOutputs } from "../src/kakao-message-content";
import { expectSchema } from "./support/contract";
import { changeRequestCard } from "./support/kakao-change-request-cases";

const normal = {
  state: "normal",
  ...changeRequestCard.changeRequest,
  cardKey: changeRequestCard.cardKey,
  blockId: changeRequestCard.blockId,
} as const;
it.each(["\r\n", "\r"])("여러 줄 디자인 설명의 줄바꿈을 정규화해 표시한다(%j)", (newline) => {
  const changes = [
    { label: "디자인 설명", before: `합성 앞줄${newline}합성 뒷줄`, after: `합성 새 앞줄${newline}합성 새 뒷줄` },
  ];
  const original = JSON.stringify(changes),
    body = kakaoChangeRequestMessage({ ...normal, changes });
  expectSchema("SkillTemplateResponse", body);
  expect(JSON.stringify(body)).toContain("합성 앞줄\\n합성 뒷줄");
  expect(JSON.stringify(body)).toContain("합성 새 앞줄\\n합성 새 뒷줄");
  expect(JSON.stringify(body)).not.toContain("\\r");
  expect(JSON.stringify(changes)).toBe(original);
});

it.each(["normal", "stale", "expired"] as const)(
  "변경 카드의 정해진 제목·두 행동·한도와 갱신 안내를 보인다(%s)",
  (state) => {
    const body = kakaoChangeRequestMessage({ ...normal, state });
    expectSchema("SkillTemplateResponse", body);
    expect(body.template.outputs).toHaveLength(1);
    const card = body.template.outputs[0];
    expect(card).toHaveProperty("textCard.title", "변경 요청");
    if (!card || !("textCard" in card)) throw new Error("missing action card");
    expect([...card.textCard.title, ...card.textCard.description].length).toBeLessThanOrEqual(400);
    expect(card.textCard.buttons.map((button) => button.label)).toEqual(["변경 요청", "안 할래요"]);
    expect(card.textCard.buttons.map((button) => button.extra.choice)).toEqual(["confirm", "decline"]);
    if (state !== "normal")
      expect(card.textCard.description).toContain(
        state === "stale" ? "내용이 바뀌었어요. 새 카드를 확인해 주세요" : "시간이 지나 새 카드를 보내 드려요",
      );
  },
);

it("긴 변경 전후와 이모지를 보존하면서 행동 카드를 마지막 세 번째 출력에 남긴다", () => {
  const changes = [
    { label: "디자인 요청", before: `${"가".repeat(499)}🌷`, after: `${"나".repeat(499)}🎉` },
    { label: "추가 사항", before: "다".repeat(637), after: "라".repeat(637) },
    { label: "색", before: "마".repeat(100), after: "바".repeat(100) },
    { label: "문구", before: `${"아".repeat(49)}💚`, after: `${"자".repeat(49)}💛` },
    { label: "크기", before: "차".repeat(30), after: "카".repeat(30) },
    { label: "맛", before: "타".repeat(30), after: "파".repeat(30) },
    { label: "디자인", before: "하".repeat(30), after: "거".repeat(30) },
  ];
  const prepared = { ...changeRequestCard, changeRequest: { ...normal, changes } };
  const expanded = expandKakaoMessageContents([prepared]);
  expect(expandKakaoMessageContents(expanded)).toEqual(expanded);
  const outputs = kakaoMessageOutputs(expanded);
  expectSchema("SkillTemplateResponse", { version: "2.0", template: { outputs } });
  expect(outputs).toHaveLength(3);
  expect(outputs[2]).toHaveProperty("textCard.buttons.0.label", "변경 요청");
  const detail = outputs
    .slice(0, -1)
    .map((output) => {
      if ("simpleText" in output) return output.simpleText.text;
      if (!("carousel" in output) || output.carousel.type !== "textCard") throw new Error("missing details");
      return output.carousel.items
        .map((item) => item.title.replace(/^변경 내용 \d+\n/, "") + (item.description ?? ""))
        .join("");
    })
    .join("");
  for (const change of changes) expect(detail).toContain(`${change.label}: ${change.before} → ${change.after}`);
  expect(detail).toContain("15:30까지 눌러 주세요");
});

it.each([
  ["결제 전 주문이에요. 주문 요청을 취소하고 다시 요청할 수 있어요", undefined],
  ["앞의 변경 요청을 사장님이 보고 있어요", undefined],
  ["변경 마감이 지나 바꿀 수 없어요", "변경 마감: 픽업 이틀 전까지 바꿀 수 있어요"],
] as const)("업무 처리기가 정한 현재 불가 상태와 마감 조문을 보인다(%s)", (currentStatus, clause) => {
  const body = kakaoChangeRequestMessage({
    ...normal,
    state: "stale",
    currentStatus,
    ...(clause === undefined ? {} : { clause }),
  });
  expectSchema("SkillTemplateResponse", body);
  expect(JSON.stringify(body)).toContain(`지금은 할 수 없어요: ${currentStatus}`);
  if (clause) expect(JSON.stringify(body)).toContain(clause);
  for (const secret of [normal.orderNo, normal.cardKey, normal.changes[0].before])
    expect(JSON.stringify(body)).not.toContain(secret);
});

it.each([
  { orderNo: "internal-order-uuid" },
  { currentVersion: 0 },
  { changes: [] },
  { changes: [{ label: "문구", before: "같음", after: "같음" }] },
  { changes: [{ label: "문구", before: "전", after: "후\0" }] },
  {
    changes: [
      { label: "문구", before: "전", after: "후" },
      { label: "문구", before: "전2", after: "후2" },
    ],
  },
  { expiresAt: "wrong-time" },
  { timeZone: "wrong/zone" },
  { cardKey: "wrong" },
  { blockId: "" },
])("잘못된 서버 표시 자료로 행동 카드를 만들지 않는다(%j)", (invalid) => {
  expect(() => kakaoChangeRequestMessage({ ...normal, ...invalid })).toThrow(RangeError);
});

it("변경 항목의 내부 필드 이름을 손님 카드로 내보내지 않는다", () => {
  expect(() =>
    kakaoChangeRequestMessage({
      ...normal,
      changes: [{ label: "customer_id", before: "private-before", after: "private-after" }],
    }),
  ).toThrow(RangeError);
});

it("정의되지 않은 오류 상태를 정상 문구로 바꾸지 않는다", () => {
  expect(() =>
    kakaoChangeRequestMessage({ state: "error", reason: "undefined_error" } as unknown as KakaoChangeRequestView),
  ).toThrow(RangeError);
});
