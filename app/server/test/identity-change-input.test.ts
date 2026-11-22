import { expect, it } from "vitest";
import { parseIdentityChange, parseIdentityChangeList, parseIdentityChangeReview } from "../src/identity-change-input";
import { reviewCursor } from "../src/license-review-input";
import { newUuid } from "./support/db";

const input = {
  baseRevision: "revision-1",
  businessName: "합성 제과",
  representativeName: "김합성",
  businessRegNo: "1234567891",
  evidencePhotoUploadId: `upl_${"a".repeat(35)}`,
};
it.each([
  [null, "/", "bad_format"],
  [[], "/", "bad_format"],
  [{}, "/baseRevision", "required"],
  [{ ...input, baseRevision: "" }, "/baseRevision", "too_short"],
  [{ ...input, baseRevision: ":" }, "/baseRevision", "bad_format"],
  [{ ...input, baseRevision: "r".repeat(65) }, "/baseRevision", "too_long"],
  [{ ...input, businessName: "\u3000" }, "/businessName", "too_short"],
  [{ ...input, businessName: "가".repeat(61) }, "/businessName", "too_long"],
  [{ ...input, businessName: "\0" }, "/businessName", "bad_format"],
  [{ ...input, representativeName: 1 }, "/representativeName", "bad_format"],
  [{ ...input, representativeName: "가".repeat(31) }, "/representativeName", "too_long"],
  [{ ...input, businessRegNo: "1234567890" }, "/businessRegNo", "checksum_failed"],
  [{ ...input, businessRegNo: "123456789a" }, "/businessRegNo", "bad_format"],
  [{ ...input, evidencePhotoUploadId: "bad" }, "/evidencePhotoUploadId", "too_short"],
  [{ ...input, evidencePhotoUploadId: "x".repeat(40) }, "/evidencePhotoUploadId", "bad_format"],
  [{ ...input, evidencePhotoUploadId: `upl_${"a".repeat(201)}` }, "/evidencePhotoUploadId", "too_long"],
  [{ ...input, status: "applied" }, "/status", "unknown_field"],
  [{ ...input, "a/b": "비밀 입력" }, "/", "unknown_field"],
])("사업자 변경 입력 오류는 필드/사유만 돌려줌 %#", (body, field, code) => {
  expect(() => parseIdentityChange(body)).toThrowError(
    expect.objectContaining({
      code: "validation_failed",
      extras: { errors: expect.arrayContaining([{ field, code }]) },
    }),
  );
});
it("상호60/대표자30개 유니코드와64자 버전, 최대 업로드 ID를 원문으로 받음", () => {
  const body = {
    ...input,
    businessName: "🎂".repeat(60),
    representativeName: "🎁".repeat(30),
    baseRevision: "r".repeat(64),
    evidencePhotoUploadId: `upl_${"a".repeat(200)}`,
  };
  expect(parseIdentityChange(body)).toEqual(body);
});
it("여러 입력 오류를 모으되50개를 넘기지 않고 값을 싣지 않음", () => {
  try {
    parseIdentityChange(Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`unknown${i}`, "비밀 입력"])));
    throw new Error("오류 없음");
  } catch (error) {
    expect(error).toMatchObject({ code: "validation_failed", extras: { errors: expect.any(Array) } });
    const errors = (error as { extras: { errors: unknown[] } }).extras.errors;
    expect(errors).toHaveLength(50);
    expect(JSON.stringify(errors)).not.toContain("비밀 입력");
  }
});
it.each(["pending", "applied", "on_hold"])("목록 상태 %s와 여섯 자리 마이크로초 커서를 읽음", (status) => {
  const id = newUuid(),
    at = "2026-11-22T05:00:00.123456Z";
  expect(parseIdentityChangeList({ status, limit: "100", cursor: reviewCursor(status, at, id) })).toEqual({
    status,
    limit: 100,
    after: { at, id },
  });
});
it.each([
  [{ status: "verified" }, "query:status", "not_allowed"],
  [{ limit: "0" }, "query:limit", "out_of_range"],
  [{ limit: "101" }, "query:limit", "out_of_range"],
  [{ limit: "1e2" }, "query:limit", "bad_format"],
  [{ cursor: "broken" }, "query:cursor", "bad_format"],
  [
    { status: "on_hold", cursor: reviewCursor("pending", "2026-11-22T05:00:00.000001Z", newUuid()) },
    "query:cursor",
    "bad_format",
  ],
])("사업자 변경 목록 입력 오류 %#", (query, field, code) => {
  expect(() => parseIdentityChangeList(query)).toThrowError(
    expect.objectContaining({ extras: { errors: [{ field, code }] } }),
  );
});
it.each([undefined, "", "\t\n", "\u3000", "\ufeff", "가".repeat(201)])(
  "보류 이유가 없거나 잘못되면 거절함 %#",
  (holdReason) => {
    expect(() =>
      parseIdentityChangeReview({
        baseRevision: "revision",
        decision: "on_hold",
        ...(holdReason === undefined ? {} : { holdReason }),
      }),
    ).toThrowError(expect.objectContaining({ code: "validation_failed" }));
  },
);
it("사업자 판정은 applied/on_hold만 받고 이모지200개 보류 이유를 보존함", () => {
  const holdReason = "🎂".repeat(200);
  expect(parseIdentityChangeReview({ baseRevision: "revision", decision: "on_hold", holdReason })).toMatchObject({
    holdReason,
  });
  expect(parseIdentityChangeReview({ baseRevision: "revision", decision: "applied" })).toMatchObject({
    decision: "applied",
  });
  expect(() => parseIdentityChangeReview({ baseRevision: "revision", decision: "verified" })).toThrowError(
    expect.objectContaining({ code: "validation_failed" }),
  );
});
