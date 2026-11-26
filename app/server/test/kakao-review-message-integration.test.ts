import { expect, it } from "vitest";
import { kakaoReply } from "../src/kakao-reply";
import { type KakaoReviewView, kakaoReviewMessage } from "../src/kakao-review-message";
import type { ShopRequest } from "../src/routes";
import { expectSchema } from "./support/contract";

const responder: Pick<ShopRequest, "json"> = {
  json: (body, status = 200, headers = {}) => Response.json(body, { status, headers }),
};
it.each([
  ["review_saved", { state: "done" }],
  ["review_not_allowed", { state: "permission", reason: "review_not_allowed" }],
  ["review_invalid", { state: "error", reason: "review_invalid" }],
  ["photo_download_failed", { state: "error", reason: "photo_download_failed" }],
  ["server_error", { state: "error", reason: "server_error" }],
  ["not_accepting", { state: "permission", reason: "not_accepting", contactPhone: "02-000-0000" }],
] as const)("실제 API 응답의 %s가 SCR012 표시와 같다", async (outcome, view) => {
  const response = kakaoReply(responder, outcome, { contactPhone: "02-000-0000", repeatReview: true });
  expect(response.status).toBe(200);
  expect(response.headers.get("Siljang-Outcome")).toBe(outcome);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const body = await response.json();
  expectSchema("SkillTemplateResponse", body);
  expect(body).toEqual(kakaoReviewMessage(view));
});
it.each([undefined, "사진을 확인하고 있어요", "사진을 받지 못했어요. 다시 보내 주세요"])(
  "API072 반복의 첫 답 %s를 그대로 보존한다",
  async (firstResultText) => {
    const response = kakaoReply(responder, "duplicate", {
      repeatReview: true,
      ...(firstResultText === undefined ? {} : { repeatReviewText: firstResultText }),
    });
    expect(response.headers.get("Siljang-Outcome")).toBe("duplicate");
    const view: KakaoReviewView = {
      state: "done",
      ...(firstResultText === undefined ? {} : { firstResultText }),
    };
    expect(await response.json()).toEqual(kakaoReviewMessage(view));
  },
);
it("기존에 먼저 전할 내용이 있으면 후기 결과 앞에 보존한다", async () => {
  expect(await kakaoReply(responder, "review_saved", { previous: ["앞서 전할 합성 안내"] }).json()).toMatchObject({
    template: {
      outputs: [
        { simpleText: { text: "앞서 전할 합성 안내" } },
        { simpleText: { text: "후기를 남겨 주셔서 고마워요" } },
      ],
    },
  });
});
it("일반 API070의 반복은 후기 성공으로 바꾸지 않는다", async () => {
  expect(await kakaoReply(responder, "duplicate").json()).toMatchObject({ template: { outputs: [] } });
});
