import { expect, it } from "vitest";
import { OPERATOR_ENROLLMENT_SQL } from "../tools/operator-enroll";
import { enrollmentDb, enrollmentRequest, renderEnrollmentSql, totpCode } from "../tools/operator-enroll-bridge";

// RFC6238 Appendix B SHA-1의8자리 결과에서 마지막6자리를 대조한다.
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // check-no-keys: allow RFC6238 공개 시험 벡터이며 실제 자격 증명이 아님
it.each([
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
  [20000000000, "353130"],
] as const)("표준 TOTP 벡터 %s초", (seconds, expected) => expect(totpCode(SECRET, seconds * 1000)).toBe(expected));
it.each(["", "not-a-base32-secret", "A".repeat(200)])("잘못된 새 TOTP 비밀은 코드로 만들지 않음(%s)", (secret) =>
  expect(() => totpCode(secret, 0)).toThrow(),
);
it.each([-1, NaN, Infinity])("잘못된 시각은 코드로 만들지 않음(%s)", (time) =>
  expect(() => totpCode(SECRET, time)).toThrow(),
);

const target = { email: "mvp-operator-20261124@example.com", authUserId: "11111111-1111-4111-8111-111111111111" };
const factor = "22222222-2222-4222-8222-222222222222";
const params = [target.email, "합성 '시험 운영자", target.authUserId, factor, new Date("2026-11-24T00:00:00Z")];
it("다른 계정이나 다른 SQL을 관리자 전달 요청으로 만들지 않음", () => {
  expect(() => enrollmentRequest("DELETE FROM operators", params, target)).toThrow();
  expect(() => enrollmentRequest(OPERATOR_ENROLLMENT_SQL, ["other@example.com", ...params.slice(1)], target)).toThrow();
  expect(() =>
    enrollmentRequest(OPERATOR_ENROLLMENT_SQL, [...params.slice(0, 2), factor, ...params.slice(3)], target),
  ).toThrow();
});
it("합성 계정만 허용하고 표시 이름의 따옴표는 SQL 글자로 보존", () => {
  const request = enrollmentRequest(OPERATOR_ENROLLMENT_SQL, params, target, "a".repeat(32));
  expect(request.params[4]).toBe("2026-11-24T00:00:00.000Z");
  expect(request.digest).toMatch(/^[a-f0-9]{64}$/);
  const sql = renderEnrollmentSql(request);
  expect(sql).toContain("합성 ''시험 운영자");
  expect(sql).toContain("public.operators");
  expect(sql).not.toContain("OPERATOR_PASSWORD");
});
it.each(["requestNonce", "requestDigest", "authUserMatches", "factorMatches", "factorVerified", "userConfirmed"])(
  "잘못된 DB 확인 %s는 성공 행으로 반환하지 않음",
  async (field) => {
    const db = enrollmentDb({
      ...target,
      exchange: async (request) => ({
        requestNonce: request.nonce,
        requestDigest: request.digest,
        operatorId: "33333333-3333-4333-8333-333333333333",
        disabled: false,
        authUserMatches: true,
        factorMatches: true,
        factorVerified: true,
        userConfirmed: true,
        [field]: false,
      }),
    });
    await expect(db.query(OPERATOR_ENROLLMENT_SQL, params)).rejects.toThrow();
  },
);
it("요청에 맞는 실제 결과 모양을 확인한 경우에만 원래 도구의 행을 반환", async () => {
  const db = enrollmentDb({
    ...target,
    exchange: async (request) => ({
      requestNonce: request.nonce,
      requestDigest: request.digest,
      operatorId: "33333333-3333-4333-8333-333333333333",
      disabled: true,
      authUserMatches: true,
      factorMatches: true,
      factorVerified: true,
      userConfirmed: true,
    }),
  });
  expect(await db.query(OPERATOR_ENROLLMENT_SQL, params)).toEqual({
    rowCount: 1,
    rows: [{ id: "33333333-3333-4333-8333-333333333333", disabled: true }],
  });
});
