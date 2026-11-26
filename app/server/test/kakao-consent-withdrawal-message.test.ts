import { expect, it } from "vitest";
import {
  type KakaoConsentWithdrawalView,
  kakaoConsentWithdrawalMessage,
} from "../src/kakao-consent-withdrawal-message";
import { expectSchema } from "./support/contract";

const normal = {
  state: "normal",
  orderNo: "ABCD1234",
  completionPhotoCount: 2,
  reviewPhotoCount: 3,
  publishedCount: 1,
  expiresAt: "2026-11-27T09:30:00Z",
  timeZone: "Asia/Seoul",
  cardKey: "ConsentWithdrawal149Fixture",
  blockId: "withdrawal-block",
} as const satisfies KakaoConsentWithdrawalView;
function render(view: KakaoConsentWithdrawalView) {
  const body = kakaoConsentWithdrawalMessage(view);
  expectSchema("SkillTemplateResponse", body);
  expect(body.template.outputs.length).toBeLessThanOrEqual(3);
  for (const output of body.template.outputs) {
    if ("simpleText" in output) expect([...output.simpleText.text].length).toBeLessThanOrEqual(1000);
    else {
      expect([...output.textCard.title, ...output.textCard.description].length).toBeLessThanOrEqual(400);
      for (const button of output.textCard.buttons) expect([...button.label].length).toBeLessThanOrEqual(14);
    }
  }
  return body;
}
it("철회할 두 종류의 사진 수·현재 게시 여부와 두 확인 버튼을 보인다", () => {
  const body = render(normal);
  expect(body.template.outputs).toHaveLength(1);
  expect(body.template.outputs[0]).toMatchObject({
    textCard: {
      title: "사진 게시 동의 철회",
      description: expect.stringContaining("완성 사진 2장 · 후기 사진 3장"),
      buttons: [
        {
          label: "동의 철회",
          action: "block",
          blockId: normal.blockId,
          extra: { cardKey: normal.cardKey, choice: "confirm" },
        },
        {
          label: "안 할래요",
          action: "block",
          blockId: normal.blockId,
          extra: { cardKey: normal.cardKey, choice: "decline" },
        },
      ],
    },
  });
  const encoded = JSON.stringify(body);
  expect(encoded).toContain("철회할 사진 5장");
  expect(encoded).toContain("포트폴리오에 올라 있음");
  expect(encoded).toContain("18:30까지 눌러 주세요");
  expect(encoded).not.toMatch(/customerId|orderId|consentIds|storage_key/);
});
it("아직 올리지 않은 사진도 게시 여부를 정확히 보인다", () => {
  expect(JSON.stringify(render({ ...normal, publishedCount: 0 }))).toContain("포트폴리오에 올라 있지 않음");
});
it.each([
  ["stale", "내용이 바뀌었어요. 새 카드를 확인해 주세요"],
  ["expired", "시간이 지나 새 카드를 보내 드려요"],
] as const)("%s에서는 현재 값의 새 카드 앞에 정한 안내를 보인다", (state, notice) => {
  const body = render({ ...normal, state });
  expect(JSON.stringify(body)).toContain(notice);
  expect(JSON.stringify(body)).toContain(normal.cardKey);
});
it.each([
  [{ state: "done", outcome: "consent_withdrawn" }, "사진 게시 동의를 철회했어요. 5분 안에 사진이 내려가요"],
  [{ state: "done", outcome: "declined" }, "알겠어요. 더 궁금한 것이 있으면 말씀해 주세요"],
  [{ state: "stale", reason: "no_consented_photos" }, "지금은 할 수 없어요: 게시에 동의한 사진이 없어요"],
  [{ state: "permission", reason: "card_not_yours" }, "이 버튼은 카드를 받은 분만 누를 수 있어요"],
  [
    { state: "permission", reason: "not_accepting", contactPhone: "02-000-0000" },
    "아직 상담을 받지 않아요. 가게로 연락해 주세요: 02-000-0000",
  ],
  [{ state: "error", reason: "retry_needed" }, "다시 눌러 주세요"],
  [{ state: "error", reason: "server_error" }, "잠시 뒤 다시 말씀해 주세요"],
] as const)("$0.state의 문구가 명세와 같다", (view, expected) => {
  expect(render(view).template.outputs).toEqual([{ simpleText: { text: expected } }]);
});
it("반복은 서버에 남은 처음 결과의 문구를 그대로 보인다", () => {
  expect(
    render({ state: "done", outcome: "consent_withdrawn", firstResultText: "처음 철회 결과" }).template.outputs,
  ).toEqual([{ simpleText: { text: "처음 철회 결과" } }]);
});
it("이전 후기 사진의 동의까지 여러 장이어도 표시할 수 있다", () => {
  expect(JSON.stringify(render({ ...normal, reviewPhotoCount: 12, publishedCount: 6 }))).toContain("후기 사진 12장");
});
it.each([
  { ...normal, completionPhotoCount: 0, reviewPhotoCount: 0, publishedCount: 0 },
  { ...normal, completionPhotoCount: -1 },
  { ...normal, reviewPhotoCount: 1.5 },
  { ...normal, publishedCount: 6 },
  { ...normal, publishedCount: -1 },
  { ...normal, completionPhotoCount: Number.MAX_SAFE_INTEGER },
  { ...normal, orderNo: "다른 주문" },
  { ...normal, cardKey: "bad" },
  { ...normal, blockId: "\0" },
  { ...normal, expiresAt: "not-a-date" },
  { ...normal, timeZone: "not-a-time-zone" },
  { ...normal, state: "unknown" },
  { state: "stale", reason: "unknown" },
  { state: "done", outcome: "unknown" },
  { state: "done", outcome: "declined", firstResultText: "\0" },
  { state: "permission", reason: "not_accepting", contactPhone: "0".repeat(41) },
  { state: "error", reason: "unknown" },
  null,
])("틀린 표시 값은 빈 카드나 성공으로 바꾸지 않는다(%#)", (view) => {
  expect(() => kakaoConsentWithdrawalMessage(view as KakaoConsentWithdrawalView)).toThrow(RangeError);
});
