import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assertConsentWithdrawalSource, buildKakaoConsentWithdrawal } from "./build-kakao-consent-withdrawal.mjs";

test("SCR013/서버 입력 또는 HEAD가 바뀐 자료는 원본 확인을 거절한다", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "siljang-withdrawal-source-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    git("init", "-q");
    await fs.mkdir(join(root, "docs/08-screens"), { recursive: true });
    await fs.mkdir(join(root, "app/server"), { recursive: true });
    await fs.writeFile(join(root, "docs/08-screens/SCR-013.md"), "합성 화면 원본");
    await fs.writeFile(join(root, "app/server/synthetic.ts"), "export const value = 1;");
    git("add", "."); git("-c", "user.name=synthetic", "-c", "user.email=synthetic@example.com", "commit", "-qm", "synthetic");
    const head = git("rev-parse", "HEAD");
    assertConsentWithdrawalSource(root, head);
    await fs.writeFile(join(root, "docs/08-screens/SCR-013.md"), "미커밋 변경");
    assert.throws(() => assertConsentWithdrawalSource(root, head), /SOURCE_CHANGED/);
    git("restore", "docs/08-screens/SCR-013.md");
    await fs.writeFile(join(root, "app/server/untracked.ts"), "untracked input");
    assert.throws(() => assertConsentWithdrawalSource(root, head), /SOURCE_CHANGED/);
    await fs.rm(join(root, "app/server/untracked.ts"));
    git("-c", "user.name=synthetic", "-c", "user.email=synthetic@example.com", "commit", "--allow-empty", "-qm", "moved");
    assert.throws(() => assertConsentWithdrawalSource(root, head), /SOURCE_CHANGED/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test("사진 게시 동의 철회 자료도 실행 원본과 다른 저장소 폴더를 받지 않는다", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "siljang-withdrawal-wrong-"));
  try { await assert.rejects(buildKakaoConsentWithdrawal(root, join(root, "out")), /FIXTURE_SOURCE/); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
});
