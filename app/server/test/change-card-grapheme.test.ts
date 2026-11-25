import { expect, it } from "vitest";
import { kakaoChangeRequestMessage } from "../src/kakao-change-request-message";
import { expectSchema } from "./support/contract";
import { changeRequestCard } from "./support/kakao-change-request-cases";

const EMOJI = "👩‍🍳";
const normal = {
  ...changeRequestCard.changeRequest,
  state: "normal",
  cardKey: changeRequestCard.cardKey,
  blockId: changeRequestCard.blockId,
} as const;
const prefix = `주문번호 ${normal.orderNo} · 지금 버전 ${normal.currentVersion}\n디자인 요청: `;

it.each([1000, 40, 168])("긴 변경의 %s자 경계에서 결합 이모지를 나누지 않는다", (boundary) => {
  const before = boundary === 1000 ? "가".repeat(500) : `${"가".repeat(boundary - [...prefix].length - 2)}${EMOJI}`;
  const after =
    boundary === 1000 ? `${"나".repeat(1000 - [...`${prefix}${before} → `].length - 2)}${EMOJI}끝` : "나".repeat(500);
  const changes = [
    { label: "디자인 요청", before, after },
    ...(boundary === 1000
      ? []
      : [
          { label: "추가 사항", before: "다".repeat(638), after: "라".repeat(638) },
          { label: "색", before: "마".repeat(100), after: "바".repeat(100) },
          { label: "문구", before: "사".repeat(50), after: "아".repeat(50) },
        ]),
  ];
  const body = kakaoChangeRequestMessage({ ...normal, changes });
  expectSchema("SkillTemplateResponse", body);
  const fields = body.template.outputs.flatMap((o) =>
    "simpleText" in o
      ? [o.simpleText.text]
      : "carousel" in o
        ? o.carousel.items.flatMap((item) => [item.title, item.description ?? ""])
        : [],
  );
  expect(fields.some((text) => text.includes(EMOJI))).toBe(true);
  expect(fields.some((text) => text.endsWith("\u200d") || text.startsWith("\u200d"))).toBe(false);
  expect(body.template.outputs.length).toBeLessThanOrEqual(3);
});
