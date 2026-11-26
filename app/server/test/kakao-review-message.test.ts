import { expect, it } from "vitest";
import {
  KAKAO_REVIEW_QUESTIONS,
  KAKAO_REVIEW_TEXT,
  type KakaoReviewBody,
  type KakaoReviewView,
  kakaoReviewMessage,
} from "../src/kakao-review-message";
import { expectSchema } from "./support/contract";

function check(body: KakaoReviewBody): string {
  expectSchema("SkillTemplateResponse", body);
  expect(body.template.outputs.length).toBeGreaterThan(0);
  expect(body.template.outputs.length).toBeLessThanOrEqual(3);
  for (const output of body.template.outputs) expect([...output.simpleText.text].length).toBeLessThanOrEqual(1000);
  for (const reply of body.template.quickReplies ?? []) {
    expect([...reply.label].length).toBeLessThanOrEqual(14);
    expect(reply.action).toBe("message");
  }
  return body.template.outputs.map((output) => output.simpleText.text).join("\n");
}
it("후기 블록은 글·사진·동의 순서이며 답이 없을 때 게시에 동의하지 않는다", () => {
  expect(KAKAO_REVIEW_QUESTIONS).toEqual([
    { name: "review_text", required: true, maximumCharacters: 1000 },
    { name: "review_photos", required: false, maximumImages: 5 },
    { name: "photo_consent", required: false, defaultValue: "동의 안 함" },
  ]);
  expect(check(kakaoReviewMessage({ state: "normal" }))).toContain("케이크는 어떠셨어요?");
});
it.each([
  ["review_text", "케이크는 어떠셨어요?"],
  ["review_photos", "5장"],
  ["photo_consent", "언제든 철회"],
] as const)("정상 블록의 %s 질문을 따로 표시한다", (question, text) => {
  const body = kakaoReviewMessage({ state: "normal", question, orderNo: "AB1234CD" });
  expect(check(body)).toContain(text);
  expect(check(body)).toContain("AB1234CD");
  expect(JSON.stringify(body)).not.toMatch(/clientExtra|review_text|review_photos|photo_consent/);
});
it("동의 질문은 게시 장소·철회·기본 동의 안 함과 두 바로가기만 보인다", () => {
  const body = kakaoReviewMessage({ state: "normal", question: "photo_consent" });
  const text = check(body);
  for (const phrase of ["이 사진", "가게 포트폴리오", "예약 링크 페이지", "언제든 철회", "동의 안 함"])
    expect(text).toContain(phrase);
  expect(body.template.quickReplies).toEqual([
    { label: "동의", action: "message", messageText: "동의" },
    { label: "동의 안 함", action: "message", messageText: "동의 안 함" },
  ]);
});
it("성공은 후기 원문·사진 위치 없이 정해진 감사 답만 보인다", () => {
  const body = kakaoReviewMessage({ state: "done", reviewText: "노출하면 안 되는 합성 후기" } as KakaoReviewView);
  expect(check(body)).toBe(KAKAO_REVIEW_TEXT.review_saved);
  expect(JSON.stringify(body)).not.toContain("노출하면 안 되는 합성 후기");
});
it.each(["사진을 확인하고 있어요", "사진을 받지 못했어요. 다시 보내 주세요"])(
  "반복 요청은 처음의 %s를 저장 성공으로 바꾸지 않는다",
  (firstResultText) => {
    const text = check(kakaoReviewMessage({ state: "done", firstResultText }));
    expect(text).toBe(firstResultText);
    expect(text).not.toContain(KAKAO_REVIEW_TEXT.review_saved);
  },
);
it("처음 답의 결합 문자999개가 붙은 글자도 자르지 않는다", () => {
  const text = `가${"\u0301".repeat(999)}`;
  expect(check(kakaoReviewMessage({ state: "done", firstResultText: text }))).toBe(text);
});
it("다른 사용자·받지 않은 주문은 같은 권한 안내를 보인다", () => {
  expect(check(kakaoReviewMessage({ state: "permission", reason: "review_not_allowed" }))).toBe(
    KAKAO_REVIEW_TEXT.review_not_allowed,
  );
});
it("연결되지 않은 가게는 연락처가 있을 때만 함께 보인다", () => {
  expect(check(kakaoReviewMessage({ state: "permission", reason: "not_accepting", contactPhone: "02-000-0000" }))).toBe(
    "아직 상담을 받지 않아요. 가게로 연락해 주세요: 02-000-0000",
  );
  expect(check(kakaoReviewMessage({ state: "permission", reason: "not_accepting" }))).toBe("아직 상담을 받지 않아요");
});
it.each([
  ["review_invalid", KAKAO_REVIEW_TEXT.review_invalid],
  ["photo_download_failed", "사진을 받지 못했어요. 다시 보내 주세요"],
  ["server_error", "잠시 뒤 다시 말씀해 주세요"],
] as const)("오류 %s는 정해진 말만 보인다", (reason, text) => {
  expect(check(kakaoReviewMessage({ state: "error", reason }))).toBe(text);
});
it.each([
  null,
  { state: "unknown" },
  { state: "normal", question: "unknown" },
  { state: "normal", orderNo: "" },
  { state: "normal", orderNo: "11111111-1111-4111-8111-111111111111" },
  { state: "normal", orderNo: "ABCDEFGHI" },
  { state: "done", firstResultText: "" },
  { state: "done", firstResultText: "\0" },
  { state: "done", firstResultText: "가".repeat(1001) },
  { state: "permission", reason: "unknown" },
  { state: "permission", reason: "not_accepting", contactPhone: "\0" },
  { state: "permission", reason: "not_accepting", contactPhone: "0".repeat(41) },
  { state: "error", reason: "raw_database_error" },
])("잘못된 표시 자료는 응답 본문을 만들지 않는다(%j)", (view) => {
  expect(() => kakaoReviewMessage(view as unknown as KakaoReviewView)).toThrow(RangeError);
});
