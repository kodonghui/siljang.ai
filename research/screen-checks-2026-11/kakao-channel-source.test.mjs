import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFile, mkdtemp, rm, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildKakaoChannel } from "./build-kakao-channel.mjs";

const repository = resolve(fileURLToPath(new URL("../..", import.meta.url)));
async function cloned(run) {
	const directory = await mkdtemp(join(tmpdir(), "siljang-channel-source-"));
	const root = join(directory, "repository"),
		deps = join(root, "app/node_modules");
	const git = (...args) =>
		execFileSync("git", args, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	try {
		git("clone", "--quiet", "--shared", repository, root);
		git("-C", root, "config", "user.name", "Fixture Test");
		git("-C", root, "config", "user.email", "fixture@example.org");
		await symlink(
			join(repository, "app/node_modules"),
			deps,
			process.platform === "win32" ? "junction" : "dir",
		);
		await run({ root, out: join(directory, "output"), git });
	} finally {
		await unlink(deps).catch(() => {});
		await rm(directory, { recursive: true, force: true });
	}
}

test("채널 생성기도 실행/입력 작업 트리가 다르면 보조 파일을 섞지 않는다", async () => {
	await cloned(async ({ root, out, git }) => {
		await appendFile(
			join(root, "research/screen-checks-2026-11/support/qa.css"),
			"\n/* 다른 합성 작업 트리 */\n",
		);
		git("-C", root, "add", "research/screen-checks-2026-11/support/qa.css");
		git("-C", root, "commit", "--quiet", "-m", "foreign support fixture");
		await assert.rejects(
			buildKakaoChannel(root, out),
			/FIXTURE_SOURCE_ROOT_MISMATCH/,
		);
	});
});

test("같은 채널 생성기도 커밋하지 않은 보조 입력에 원본 SHA를 붙이지 않는다", async () => {
	await cloned(async ({ root, out }) => {
		await appendFile(
			join(root, "research/screen-checks-2026-11/support/qa.css"),
			"\n/* 커밋하지 않은 합성 입력 */\n",
		);
		const { buildKakaoChannel: build } = await import(
			pathToFileURL(
				join(root, "research/screen-checks-2026-11/build-kakao-channel.mjs"),
			).href
		);
		await assert.rejects(build(root, out), /FIXTURE_SOURCE_CHANGED/);
	});
});
