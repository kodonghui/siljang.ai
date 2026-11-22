import { expect, it } from "vitest";
import { parseLicenseResubmission } from "../src/license-resubmission-input";

const input = {
  baseRevision: "revision",
  foodLicenseNo: "2026-합성-001",
  foodBusinessType: "bakery",
  licensePhotoUploadId: `upl_${"a".repeat(35)}`,
};
it.each([
  [null, "/", "bad_format"],
  [[], "/", "bad_format"],
  [{}, "/baseRevision", "required"],
  [{ ...input, baseRevision: "" }, "/baseRevision", "too_short"],
  [{ ...input, baseRevision: ":" }, "/baseRevision", "bad_format"],
  [{ ...input, baseRevision: "r".repeat(65) }, "/baseRevision", "too_long"],
  [{ ...input, foodLicenseNo: "" }, "/foodLicenseNo", "too_short"],
  [{ ...input, foodLicenseNo: "\u3000" }, "/foodLicenseNo", "too_short"],
  [{ ...input, foodLicenseNo: "\0" }, "/foodLicenseNo", "bad_format"],
  [{ ...input, foodLicenseNo: "가".repeat(31) }, "/foodLicenseNo", "too_long"],
  [{ ...input, foodBusinessType: "restaurant" }, "/foodBusinessType", "not_allowed"],
  [{ ...input, foodBusinessType: "" }, "/foodBusinessType", "not_allowed"],
  [{ ...input, foodBusinessType: "a".repeat(101) }, "/foodBusinessType", "not_allowed"],
  [{ ...input, licensePhotoUploadId: "bad" }, "/licensePhotoUploadId", "too_short"],
  [{ ...input, licensePhotoUploadId: "a".repeat(40) }, "/licensePhotoUploadId", "bad_format"],
  [{ ...input, licenseStatus: "verified" }, "/licenseStatus", "unknown_field"],
  [{ ...input, businessName: "직접 신원" }, "/businessName", "unknown_field"],
  [{ ...input, "a/b": "비밀 입력" }, "/", "unknown_field"],
])("재업로드 입력 오류는 필드/사유만 돌려줌 %#", (body, field, code) => {
  expect(() => parseLicenseResubmission(body)).toThrowError(
    expect.objectContaining({
      code: "validation_failed",
      extras: { errors: expect.arrayContaining([{ field, code }]) },
    }),
  );
});
it("신고번호30개 이모지와 두 영업 종류/최대 버전·업로드 ID를 원문으로 받음", () => {
  for (const foodBusinessType of ["bakery", "instant_sale_manufacturing"]) {
    const body = {
      ...input,
      foodLicenseNo: "🎂".repeat(30),
      foodBusinessType,
      baseRevision: "r".repeat(64),
      licensePhotoUploadId: `upl_${"a".repeat(200)}`,
    };
    expect(parseLicenseResubmission(body)).toEqual(body);
  }
});
