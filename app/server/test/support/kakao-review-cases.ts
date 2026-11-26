/** SCR012 표시 자료. 업무 저장·사진 내려받기·카카오 발신은 실행하지 않는다. */
import { kakaoReply } from "../../src/kakao-reply";
import { KAKAO_REVIEW_QUESTIONS, kakaoReviewMessage } from "../../src/kakao-review-message";
import type { ShopRequest } from "../../src/routes";

const responder: Pick<ShopRequest, "json"> = {
  json: (body, status = 200, headers = {}) => Response.json(body, { status, headers }),
};
export function reviewSamples() {
  return [
    { state: "normal", body: kakaoReviewMessage({ state: "normal", orderNo: "AB1234CD" }) },
    { state: "done", body: kakaoReviewMessage({ state: "done" }) },
    { state: "permission", body: kakaoReviewMessage({ state: "permission", reason: "review_not_allowed" }) },
    { state: "error", body: kakaoReviewMessage({ state: "error", reason: "photo_download_failed" }) },
  ];
}
export function reviewQuestionSamples() {
  return KAKAO_REVIEW_QUESTIONS.map(({ name }) => ({
    state: "normal",
    question: name,
    body: kakaoReviewMessage({ state: "normal", question: name, orderNo: "AB1234CD" }),
  }));
}
interface ResponseCase {
  readonly response: string;
  readonly state: string | null;
  readonly display: "skill" | "kakao-client" | "not-shown";
  readonly body: unknown;
}
export async function reviewResponseCases(): Promise<readonly ResponseCase[]> {
  const rows: ResponseCase[] = [];
  for (const [outcome, state] of [
    ["review_saved", "done"],
    ["review_not_allowed", "permission"],
    ["review_invalid", "error"],
    ["photo_download_failed", "error"],
    ["duplicate", "done"],
  ] as const)
    rows.push({
      response: `API-072#200:${outcome}`,
      state,
      display: "skill",
      body: await kakaoReply(responder, outcome, { repeatReview: true }).json(),
    });
  for (const outcome of ["block_verified", "channel_linked"])
    rows.push({ response: `API-072#200:${outcome}`, state: null, display: "not-shown", body: null });
  rows.push({
    response: "API-072#200:not_accepting",
    state: "permission",
    display: "skill",
    body: await kakaoReply(responder, "not_accepting", { contactPhone: "02-000-0000", repeatReview: true }).json(),
  });
  rows.push({
    response: "API-072#200:server_error",
    state: "error",
    display: "skill",
    body: await kakaoReply(responder, "server_error").json(),
  });
  for (const response of ["401:skill_key_invalid", "422:validation_failed", "default:internal"])
    rows.push({ response: `API-072#${response}`, state: "error", display: "kakao-client", body: null });
  return rows;
}
