import { beforeEach, expect, it, vi } from "vitest";
import type { Queryable } from "../src/db";
import type { OperatorAuth } from "../src/operator-auth";
import { enrollSyntheticOperator } from "../tools/operator-enroll-synthetic";

const email = "mvp-operator-20261124@example.com";
const user = "00000000-0000-4000-8000-000000000001";
const factor = "00000000-0000-4000-8000-000000000002";
const other = "00000000-0000-4000-8000-000000000003";
const seed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
let auth: OperatorAuth;
let getUser: ReturnType<typeof vi.fn<OperatorAuth["getUser"]>>;
let signOut: ReturnType<typeof vi.fn<OperatorAuth["signOut"]>>;
let unenroll: ReturnType<typeof vi.fn<OperatorAuth["unenroll"]>>;
let verify: ReturnType<typeof vi.fn<OperatorAuth["verifyTotp"]>>;
let save: ReturnType<typeof vi.fn<(value: { factorId: string; secret: string }) => Promise<void>>>;
let query: ReturnType<typeof vi.fn<Queryable["query"]>>;
beforeEach(() => {
  getUser = vi.fn(async () => ({ id: user, email, factors: [] }));
  signOut = vi.fn(async () => {});
  unenroll = vi.fn(async () => true);
  verify = vi.fn(async () => "new-session");
  save = vi.fn(async () => {});
  query = vi.fn<Queryable["query"]>();
  query.mockResolvedValue({ rows: [{ id: other, disabled: false }], rowCount: 1 });
  auth = {
    signInWithPassword: vi.fn(async () => ({ accessToken: "session", user: { id: user, email, factors: [] } })),
    getUser,
    signOut,
    unenroll,
    verifyTotp: verify,
    enrollTotp: vi.fn(async () => ({ factorId: factor, secret: seed, uri: `otpauth://totp/synthetic?secret=${seed}` })),
  };
});
const db: Queryable = {
  query: async <R>(sql: string, params?: readonly unknown[]) => {
    const result = await query(sql, params);
    return { ...result, rows: result.rows as R[] };
  },
};
const run = () =>
  enrollSyntheticOperator({
    auth,
    db,
    target: { email, authUserId: user, displayName: "합성 운영자" },
    password: "synthetic-password",
    saveNewTotp: save,
    now: () => new Date(59000),
  });
it("원래 등록 도구로 새 계정만 등록하고 새 비밀을 먼저 보관한 뒤 RFC 번호로 확인/종료", async () => {
  const result = await run();
  expect(result.totp).toBe("new");
  expect(save).toHaveBeenCalledWith({ factorId: factor, secret: seed });
  expect(verify).toHaveBeenCalledWith("session", factor, "287082");
  expect(save.mock.invocationCallOrder[0]).toBeLessThan(verify.mock.invocationCallOrder[0] ?? 0);
  expect(query).toHaveBeenCalledTimes(1);
  expect(signOut).toHaveBeenCalledWith("new-session");
});
it.each(["foreign-user", "foreign-email", "unknown-factors", "old-verified", "old-unverified"])(
  "%s이면 기존 인증 수단을 변경하지 않고 종료",
  async (kind) => {
    getUser.mockResolvedValue({
      id: kind === "foreign-user" ? other : user,
      email: kind === "foreign-email" ? "other@example.com" : email,
      factors:
        kind === "unknown-factors"
          ? null
          : kind.startsWith("old-")
            ? [{ id: other, type: "totp", status: kind === "old-verified" ? "verified" : "unverified" }]
            : [],
    });
    await expect(run()).rejects.toBeDefined();
    expect(unenroll).not.toHaveBeenCalled();
    expect(auth.enrollTotp).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalledWith("session");
  },
);
it("새 비밀 보관 실패 때 방금 만든 인증 수단만 정리하고 DB 쓰기 없음", async () => {
  save.mockRejectedValue(new Error("synthetic-private-value"));
  await expect(run()).rejects.toThrow("합성 운영자 등록을 확인하지 못했어요");
  expect(unenroll).toHaveBeenCalledWith("session", factor);
  expect(query).not.toHaveBeenCalled();
  expect(signOut).toHaveBeenCalled();
});
it("검증 실패 때 원래 도구가 방금 만든 인증 수단만 정리", async () => {
  verify.mockResolvedValue(null);
  await expect(run()).rejects.toBeDefined();
  expect(unenroll).toHaveBeenCalledWith("session", factor);
  expect(query).not.toHaveBeenCalled();
  expect(signOut).toHaveBeenCalled();
});
it("실제 SQL 결과 실패를 성공으로 바꾸지 않고 세션 종료", async () => {
  query.mockRejectedValue(new Error("private-sql-detail"));
  await expect(run()).rejects.toThrow("합성 운영자 등록을 확인하지 못했어요");
  expect(signOut).toHaveBeenCalledWith("new-session");
});
it.each(["owner@example.com", "mvp-operator-20261124@real.invalid"])(
  "허용되지 않은 %s는 로그인 전 거절",
  async (wrong) => {
    await expect(
      enrollSyntheticOperator({
        auth,
        db,
        target: { email: wrong, authUserId: user, displayName: "합성 운영자" },
        password: "synthetic-password",
        saveNewTotp: save,
        now: () => new Date(),
      }),
    ).rejects.toBeDefined();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  },
);
