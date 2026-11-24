import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFile, mkdtemp, rm, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildOperatingRules } from "./build-operating-rules.mjs";

const repository = resolve(fileURLToPath(new URL("../..", import.meta.url)));

test("운영규정 생성기도 실행한 저장소와 입력 작업 트리가 다르면 거절한다", async () => {
	const container = await mkdtemp(join(tmpdir(), "siljang-rules-source-"));
	const foreignRoot = join(container, "repository");
	const deps = join(foreignRoot, "app/node_modules");
	const git = (...args) => execFileSync("git", args, {
		encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
	});
	try {
		git("clone", "--quiet", "--shared", repository, foreignRoot);
		git("-C", foreignRoot, "config", "user.name", "Fixture Test");
		git("-C", foreignRoot, "config", "user.email", "fixture@example.org");
		await appendFile(join(foreignRoot, "research/screen-checks-2026-11/support/qa.css"), "\n/* 다른 합성 작업 트리 */\n");
		git("-C", foreignRoot, "add", "research/screen-checks-2026-11/support/qa.css");
		git("-C", foreignRoot, "commit", "--quiet", "-m", "foreign support fixture");
		await symlink(join(repository, "app/node_modules"), deps, process.platform === "win32" ? "junction" : "dir");
		await assert.rejects(
			buildOperatingRules(foreignRoot, join(container, "output")),
			/FIXTURE_SOURCE_ROOT_MISMATCH/,
		);
	} finally {
		await unlink(deps).catch(() => {});
		await rm(container, { recursive: true, force: true });
	}
});
