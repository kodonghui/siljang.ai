import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertConversationSource, buildKakaoConversation, renderConversationFrame } from "./build-kakao-consultation.mjs";

test("대화 자료는 서버 글을 HTML로 실행하지 않고 09 토큰과 두 폭을 보존한다", () => {
  const sample = { state: "normal", body: { version: "2.0", template: { outputs: [{ simpleText: { text: '<img src=x onerror="fetch(1)">' } }] } } };
  for (const width of [360, 1280]) {
    const html = renderConversationFrame(sample, width, ":root{--color-paper:#F5F3EE}");
    assert.ok(html.includes(`data-width="${width}"`));
    assert.ok(html.includes("&lt;img"));
    assert.ok(!html.includes("<img"));
    assert.ok(!html.includes("<script"));
    assert.ok(html.includes("var(--size-target)"));
    assert.ok(html.includes("default-src 'none'"));
  }
  assert.throws(() => renderConversationFrame(sample, 640, ""));
  assert.throws(() => renderConversationFrame(sample, 360, "@import 'https://example.com/font'"));
});

test("다른 입력 작업 폴더는 번들 생성 전에 거절한다", async () => {
  await assert.rejects(buildKakaoConversation(tmpdir(), join(tmpdir(), "unused-qa085-output")), /FIXTURE_SOURCE_ROOT_MISMATCH/);
});

test("서버/화면의 미커밋·미추적 입력과 다른 HEAD는 자료 원본으로 받지 않는다", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "qa085-source-test-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    await fs.mkdir(join(root, "app/server/src"), { recursive: true });
    await fs.mkdir(join(root, "docs/08-screens"), { recursive: true });
    const sourceFile = join(root, "app/server/src/fixture.ts"), screenFile = join(root, "docs/08-screens/SCR-003.md");
    await fs.writeFile(sourceFile, "export const synthetic = true;\n"); await fs.writeFile(screenFile, "합성 화면\n");
    git("init", "-q"); git("config", "user.name", "Synthetic Fixture"); git("config", "user.email", "fixture@example.com");
    git("add", "."); git("-c", "commit.gpgsign=false", "commit", "-qm", "synthetic inputs");
    const head = git("rev-parse", "HEAD");
    assertConversationSource(root, head);
    await fs.appendFile(sourceFile, "// changed\n"); assert.throws(() => assertConversationSource(root, head), /CONVERSATION_SOURCE_CHANGED/);
    git("restore", "--", "app/server/src/fixture.ts");
    await fs.appendFile(screenFile, "바뀐 화면\n"); assert.throws(() => assertConversationSource(root, head), /CONVERSATION_SOURCE_CHANGED/);
    git("restore", "--", "docs/08-screens/SCR-003.md");
    const untracked = join(root, "app/server/src/new.ts"); await fs.writeFile(untracked, "export {};\n"); assert.throws(() => assertConversationSource(root, head), /CONVERSATION_SOURCE_CHANGED/); await fs.rm(untracked);
    assert.throws(() => assertConversationSource(root, "0".repeat(40)), /CONVERSATION_SOURCE_CHANGED/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
