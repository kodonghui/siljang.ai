import { expect, it } from "vitest";
import { reviewAvailability, reviewPayload, reviewReasonIssue } from "./operator-shop-review-form";

it.each([
  ["", "too_short"],
  [" \n ", "too_short"],
  ["가".repeat(201), "too_long"],
  ["합성\u0000사유", "bad_format"],
  ["가".repeat(200), null],
  ["😀".repeat(200), null],
  [" 합성 이유 ", null],
] as const)("보류 이유 경계 %#", (value, expected) => expect(reviewReasonIssue(value)).toBe(expected));
it("명령에는 본 버전과 결정만,보류일 때만 이유 원문을 넣는다", () => {
  expect(reviewPayload("synthetic-revision", "verified", "지난 이유")).toEqual({
    baseRevision: "synthetic-revision",
    decision: "verified",
  });
  expect(reviewPayload("synthetic-revision", "applied", "지난 이유")).toEqual({
    baseRevision: "synthetic-revision",
    decision: "applied",
  });
  expect(reviewPayload("synthetic-revision", "on_hold", " 합성 이유 ")).toEqual({
    baseRevision: "synthetic-revision",
    decision: "on_hold",
    holdReason: " 합성 이유 ",
  });
});
it.each([
  ["pending", true, false, true, true],
  ["on_hold", true, false, true, true],
  ["verified", true, false, false, false],
  ["pending", false, false, false, true],
  ["pending", true, true, false, true],
  ["verified", true, true, false, false],
] as const)(
  "영업 신고/계좌/변경 대기에 맞게 액션을 정한다 %#",
  (licenseStatus, hasAccount, hasChange, canVerify, canHold) => {
    expect(reviewAvailability({ licenseStatus, hasAccount, hasPendingChange: hasChange })).toEqual({
      canVerify,
      canHold,
      canReviewIdentity: hasChange,
    });
  },
);
