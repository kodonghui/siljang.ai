import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OperatorAuth } from "../src/operator-auth";
import { OPERATOR_ENROLLMENT_SQL } from "../tools/operator-enroll";
import { enrollmentRequest, renderEnrollmentSql } from "../tools/operator-enroll-bridge";
import { runFileEnrollment } from "../tools/operator-enroll-file";

const email = "mvp-operator-20261124@example.com",
  user = "00000000-0000-4000-8000-000000000001",
  factor = "00000000-0000-4000-8000-000000000002",
  other = "00000000-0000-4000-8000-000000000003";
const seed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
let root: string, privateFile: string, exchangeDir: string, auth: OperatorAuth;
const intent = () =>
  enrollmentRequest(
    OPERATOR_ENROLLMENT_SQL,
    [email, "합성 재개 운영자", user, factor, new Date("2026-11-24T00:00:00Z")],
    { email, authUserId: user },
    "a".repeat(32),
  );
const config = () => ({
  SUPABASE_URL: "https://synthetic.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_not_real_test",
  SYNTHETIC_OPERATOR_EMAIL: email,
  SYNTHETIC_OPERATOR_AUTH_USER_ID: user,
  SYNTHETIC_OPERATOR_PASSWORD: "not-real-synthetic-password",
  SYNTHETIC_OPERATOR_NAME: "합성 재개 운영자",
  SYNTHETIC_OPERATOR_TOTP_SECRET: seed,
  SYNTHETIC_OPERATOR_MFA_FACTOR_ID: factor,
});
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "siljang-enroll-resume-"));
  await mkdir(join(root, "app", "server"), { recursive: true });
  privateFile = join(root, "app", "server", ".dev.vars");
  exchangeDir = join(root, "exchange");
  await mkdir(exchangeDir);
  await writeFile(privateFile, JSON.stringify(config()), { mode: 0o600 });
  await writeFile(
    join(exchangeDir, "secret-backup-request.json"),
    JSON.stringify({ schemaVersion: 1, nonce: "b".repeat(32) }),
  );
  await writeFile(
    join(exchangeDir, "secret-backup-confirmed.json"),
    JSON.stringify({ nonce: "b".repeat(32), backedUp: true }),
  );
  await writeFile(join(exchangeDir, "sql-request.json"), JSON.stringify(intent()));
  await writeFile(join(exchangeDir, "sql-request.sql"), renderEnrollmentSql(intent()));
  await writeFile(join(exchangeDir, "status.json"), JSON.stringify({ schemaVersion: 1, phase: "failed" }));
  auth = {
    signInWithPassword: vi.fn(async () => ({
      accessToken: "not-real-session",
      user: { id: user, email, factors: null },
    })),
    getUser: vi.fn(async () => ({ id: user, email, factors: [{ id: factor, type: "totp", status: "verified" }] })),
    enrollTotp: vi.fn(async () => null),
    verifyTotp: vi.fn(async () => "not-real-aal2-session"),
    unenroll: vi.fn(async () => true),
    signOut: vi.fn(async () => {}),
  };
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
const run = () => runFileEnrollment({ privateFile, exchangeDir, auth: () => auth, timeoutMs: 3000 });
async function waitRead(name: string) {
  const until = Date.now() + 2500;
  while (Date.now() < until) {
    try {
      return JSON.parse(await readFile(join(exchangeDir, name), "utf8")) as Record<string, unknown>;
    } catch {
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  throw new Error("합성 재개 요청이 없어요");
}
const proof = (nonce: unknown) => ({
  deliveryNonce: nonce,
  requestNonce: intent().nonce,
  requestDigest: intent().digest,
  operatorId: user,
  disabled: false,
  authUserMatches: true,
  factorMatches: true,
  factorVerified: true,
  userConfirmed: true,
});
it("SQL 결과 유실 뒤 같은 사용자/인증수단/요청을 재확인하며 옛 응답은 성공으로 재사용하지 않음", async () => {
  const prior = "c".repeat(32);
  await writeFile(join(exchangeDir, `sql-response-${prior}.json`), JSON.stringify(proof(prior)));
  const original = await readFile(privateFile, "utf8");
  let settled = false;
  const pending = run().then(
    (value) => {
      settled = true;
      return { ok: true, value };
    },
    (error) => {
      settled = true;
      return { ok: false, error };
    },
  );
  const delivery = await waitRead("sql-delivery.json");
  expect(delivery.deliveryNonce).not.toBe(prior);
  expect(settled).toBe(false);
  expect(await waitRead("sql-request.json")).toEqual(intent());
  await writeFile(
    join(exchangeDir, `sql-response-${String(delivery.deliveryNonce)}.json`),
    JSON.stringify(proof(delivery.deliveryNonce)),
  );
  expect(await pending).toEqual({ ok: true, value: { enrolled: true, disabled: false } });
  expect(auth.enrollTotp).not.toHaveBeenCalled();
  expect(auth.unenroll).not.toHaveBeenCalled();
  expect(auth.verifyTotp).toHaveBeenCalledWith("not-real-session", factor, expect.stringMatching(/^[0-9]{6}$/));
  expect(auth.signOut).toHaveBeenCalledWith("not-real-aal2-session");
  expect(await readFile(privateFile, "utf8")).toBe(original);
});
it.each(["request-user", "request-factor", "request-digest", "backup"])(
  "%s 재개 자료 불일치는 로그인 전에 거절",
  async (kind) => {
    const request = intent();
    if (kind === "backup")
      await writeFile(
        join(exchangeDir, "secret-backup-confirmed.json"),
        JSON.stringify({ nonce: "wrong", backedUp: true }),
      );
    else {
      const changed = JSON.parse(JSON.stringify(request));
      if (kind === "request-user") changed.params[2] = other;
      if (kind === "request-factor") changed.params[3] = other;
      if (kind === "request-digest") changed.digest = "d".repeat(64);
      await writeFile(join(exchangeDir, "sql-request.json"), JSON.stringify(changed));
    }
    await expect(run()).rejects.toThrow("합성 운영자 등록을 확인하지 못했어요");
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(auth.unenroll).not.toHaveBeenCalled();
  },
);
it("재개 TOTP 확인 실패 때 원래 수단을 지우지 않고 세션 종료", async () => {
  auth.verifyTotp = vi.fn(async () => null);
  await expect(run()).rejects.toThrow("합성 운영자 등록을 확인하지 못했어요");
  expect(auth.verifyTotp).toHaveBeenCalled();
  expect(auth.unenroll).not.toHaveBeenCalled();
  expect(auth.signOut).toHaveBeenCalled();
});
it("새 전달 nonce와 다른 SQL 증거는 성공으로 받지 않음", async () => {
  const pending = run().then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  );
  const delivery = await waitRead("sql-delivery.json");
  await writeFile(
    join(exchangeDir, `sql-response-${String(delivery.deliveryNonce)}.json`),
    JSON.stringify(proof("e".repeat(32))),
  );
  expect(await pending).toMatchObject({ ok: false });
  expect(auth.signOut).toHaveBeenCalled();
});

it.each(["other-factor", "unverified", "extra-factor"])(
  "현재 Auth의 %s는 재개에서도 바꾸지 않고 거절",
  async (kind) => {
    auth.getUser = vi.fn(async () => ({
      id: user,
      email,
      factors:
        kind === "extra-factor"
          ? [
              { id: factor, type: "totp", status: "verified" },
              { id: other, type: "totp", status: "verified" },
            ]
          : [
              {
                id: kind === "other-factor" ? other : factor,
                type: "totp",
                status: kind === "unverified" ? "unverified" : "verified",
              },
            ],
    }));
    await expect(run()).rejects.toThrow("합성 운영자 등록을 확인하지 못했어요");
    expect(auth.verifyTotp).not.toHaveBeenCalled();
    expect(auth.enrollTotp).not.toHaveBeenCalled();
    expect(auth.unenroll).not.toHaveBeenCalled();
    expect(auth.signOut).toHaveBeenCalled();
  },
);
