import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OperatorAuth } from "../src/operator-auth";
import { runFileEnrollment } from "../tools/operator-enroll-file";

const email = "mvp-operator-20261124@example.com",
  user = "00000000-0000-4000-8000-000000000001",
  factor = "00000000-0000-4000-8000-000000000002";
const seed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
  password = "not-real-synthetic-password-never-output";
let root: string, privateFile: string, exchangeDir: string;
let auth: OperatorAuth;
const config = () => ({
  SUPABASE_URL: "https://synthetic.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_test",
  SYNTHETIC_OPERATOR_EMAIL: email,
  SYNTHETIC_OPERATOR_AUTH_USER_ID: user,
  SYNTHETIC_OPERATOR_PASSWORD: password,
  SYNTHETIC_OPERATOR_NAME: "합성 운영자",
});
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "siljang-operator-file-"));
  const directory = join(root, "app", "server");
  await mkdir(directory, { recursive: true });
  privateFile = join(directory, ".dev.vars");
  exchangeDir = join(root, "exchange");
  await writeFile(privateFile, JSON.stringify(config()), { mode: 0o600 });
  auth = {
    signInWithPassword: vi.fn(async () => ({ accessToken: "private-session", user: { id: user, email, factors: [] } })),
    getUser: vi.fn(async () => ({ id: user, email, factors: [] })),
    enrollTotp: vi.fn(async () => ({ factorId: factor, secret: seed, uri: `otpauth://synthetic?secret=${seed}` })),
    verifyTotp: vi.fn(async () => "private-aal2-session"),
    unenroll: vi.fn(async () => true),
    signOut: vi.fn(async () => {}),
  };
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
async function waitRead(name: string): Promise<Record<string, unknown>> {
  const until = Date.now() + 3000;
  while (Date.now() < until) {
    try {
      return JSON.parse(await readFile(join(exchangeDir, name), "utf8"));
    } catch {
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  throw new Error("합성 교환 파일이 없어요");
}
const run = (timeoutMs = 1000) => runFileEnrollment({ privateFile, exchangeDir, auth: () => auth, timeoutMs });
it("Vault 보관 확인과 실제 SQL 결과가 모두 와야 성공하며 공개 교환 자료에 비밀 없음", async () => {
  const pending = run();
  const backup = await waitRead("secret-backup-request.json");
  expect(JSON.parse(await readFile(privateFile, "utf8")).SYNTHETIC_OPERATOR_TOTP_SECRET).toBe(seed);
  expect(auth.verifyTotp).not.toHaveBeenCalled();
  await writeFile(
    join(exchangeDir, "secret-backup-confirmed.json"),
    JSON.stringify({ nonce: backup.nonce, backedUp: true }),
  );
  const request = await waitRead("sql-request.json");
  expect((await waitRead("status.json")).phase).toBe("awaiting-actual-sql-result");
  await writeFile(
    join(exchangeDir, "sql-response.json"),
    JSON.stringify({
      requestNonce: request.nonce,
      requestDigest: request.digest,
      operatorId: user,
      disabled: false,
      authUserMatches: true,
      factorMatches: true,
      factorVerified: true,
      userConfirmed: true,
    }),
  );
  await expect(pending).resolves.toEqual({ enrolled: true, disabled: false });
  expect(auth.signOut).toHaveBeenCalledWith("private-aal2-session");
  for (const name of await readdir(exchangeDir)) {
    const content = await readFile(join(exchangeDir, name), "utf8");
    for (const secret of [seed, password, "private-session", "private-aal2-session", config().SUPABASE_PUBLISHABLE_KEY])
      expect(content).not.toContain(secret);
  }
});
it("실제 SQL 결과가 오기 전에는 성공하지 않고 시간 초과도 세션을 종료", async () => {
  const pending = run(150);
  const assertion = expect(pending).rejects.toThrow("합성 운영자 등록을 확인하지 못했어요");
  const backup = await waitRead("secret-backup-request.json");
  await writeFile(
    join(exchangeDir, "secret-backup-confirmed.json"),
    JSON.stringify({ nonce: backup.nonce, backedUp: true }),
  );
  await waitRead("sql-request.json");
  await assertion;
  expect((await waitRead("status.json")).phase).toBe("failed");
  expect(auth.signOut).toHaveBeenCalledWith("private-aal2-session");
});
it("Vault 확인이 없으면 새 인증수단만 정리하고 SQL을 보내지 않음", async () => {
  await expect(run(80)).rejects.toThrow("합성 운영자 등록을 확인하지 못했어요");
  expect(auth.unenroll).toHaveBeenCalledWith("private-session", factor);
  expect(await readdir(exchangeDir)).not.toContain("sql-request.sql");
  expect(auth.signOut).toHaveBeenCalled();
});
it.each(["old-secret", "service-key", "wrong-origin", "unknown-key"])("%s 설정은 로그인 전에 거절", async (kind) => {
  const value: Record<string, unknown> = config();
  if (kind === "old-secret") value.SYNTHETIC_OPERATOR_TOTP_SECRET = seed;
  if (kind === "service-key") value.SUPABASE_PUBLISHABLE_KEY = "sb_secret_synthetic_only";
  if (kind === "wrong-origin") value.SUPABASE_URL = "https://synthetic.supabase.co/other";
  if (kind === "unknown-key") value.DATABASE_URL = "synthetic-private-connection";
  await writeFile(privateFile, JSON.stringify(value));
  await expect(run()).rejects.toThrow("합성 운영자 등록을 확인하지 못했어요");
  expect(auth.signInWithPassword).not.toHaveBeenCalled();
});
it("승인된 .dev.vars 경로 밖에서는 비밀 파일을 읽지 않음", async () => {
  await expect(
    runFileEnrollment({ privateFile: join(root, "private.json"), exchangeDir, auth: () => auth }),
  ).rejects.toThrow("합성 운영자 등록을 확인하지 못했어요");
  expect(auth.signInWithPassword).not.toHaveBeenCalled();
});
