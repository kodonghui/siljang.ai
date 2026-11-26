import { expect, it } from "vitest";
import { parseOperatorRecordList, parseOperatorRecordPage, parseOriginalOpen } from "../src/operator-record-input";
import { ApiError } from "../src/problem";

const id = crypto.randomUUID();
it("기록 목록의 기본값과 상한은 orders·20개·최대100개", () => {
  expect(parseOperatorRecordList({})).toEqual({ kind: "orders", limit: 20, cursor: null });
  expect(parseOperatorRecordList({ kind: "consultations", limit: "100", cursor: "sample_cursor" })).toEqual({
    kind: "consultations",
    limit: 100,
    cursor: "sample_cursor",
  });
  expect(parseOperatorRecordPage({ limit: "1" })).toEqual({ limit: 1, cursor: null });
});
it.each(["masked_value", "order_contact", "refund_account", "kept_record", "consultation_text"] as const)(
  "%s 열기는 대상 하나와 사유만 받는다",
  (targetKind) => {
    const input = {
      targetKind,
      targetId: id,
      reason: "  손님 문의: 픽업 연락 확인  ",
      ...(targetKind === "consultation_text" ? { cursor: "example_text_page_cursor" } : {}),
    };
    expect(parseOriginalOpen(input)).toEqual({ ...input, reason: input.reason.trim() });
  },
);
it("대화 글에만 페이지 커서를 받으며 번호 원문·첨부 경로는 입력에 없다", () => {
  expect(
    parseOriginalOpen({
      targetKind: "consultation_text",
      targetId: id,
      reason: "대화 안내 확인",
      cursor: "sample_cursor",
    }),
  ).toMatchObject({ cursor: "sample_cursor" });
});
it.each([
  null,
  [],
  {},
  { targetKind: "masked_value", targetId: id },
  { targetKind: "masked_value", targetId: id, reason: "    " },
  { targetKind: "masked_value", targetId: id, reason: "짧음" },
  { targetKind: "masked_value", targetId: id, reason: "가".repeat(201) },
  { targetKind: "masked_value", targetId: id, reason: "가나다라\0마" },
  { targetKind: "masked_value", targetId: "missing", reason: "손님 문의 확인" },
  { targetKind: "allergy", targetId: id, reason: "손님 문의 확인" },
  { targetKind: "order_contact", targetId: id, reason: "손님 문의 확인", cursor: "page" },
  { targetKind: "consultation_text", targetId: id, reason: "손님 문의 확인", cursor: "x".repeat(201) },
  { targetKind: "consultation_text", targetId: id, reason: "손님 문의 확인", cursor: "bad=" },
  { targetKind: "masked_value", targetId: id, reason: "손님 문의 확인", value: "합성 원문" },
])("잘못된 원본 열기 입력은 값 없는 422다(%j)", (input) => {
  try {
    parseOriginalOpen(input);
    throw new Error("거절하지 않았어요");
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("validation_failed");
    expect(JSON.stringify(error)).not.toContain("합성 원문");
  }
});
it.each([
  { limit: "0" },
  { limit: "101" },
  { limit: "1.5" },
  { limit: "NaN" },
  { limit: "1e2" },
  { cursor: "" },
  { cursor: "bad=" },
  { kind: "contacts" },
])("잘못된 목록 페이지를 거절한다(%j)", (query) => {
  expect(() => parseOperatorRecordList(query)).toThrow(ApiError);
});
