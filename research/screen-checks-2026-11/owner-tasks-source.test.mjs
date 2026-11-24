import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const folder = dirname(fileURLToPath(import.meta.url));
const repository = resolve(folder, "../..");
const inputs = [
	"app/web/src",
	"app/package.json",
	"app/package-lock.json",
	"app/web/package.json",
	"api/openapi.yaml",
	"tools/corthex/page-check.js",
	"research/screen-checks-2026-11",
];
async function fixture(run) {
	const root = await mkdtemp(join(tmpdir(), "siljang-owner-source-"));
	const deps = join(root, "app/node_modules");
	const git = (...args) =>
		execFileSync("git", ["-C", root, ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	try {
		for (const name of inputs) {
			const destination = join(root, name);
			await mkdir(dirname(destination), { recursive: true });
			await cp(join(repository, name), destination, { recursive: true });
		}
		await mkdir(join(root, "docs"));
		await writeFile(join(root, "docs/note.md"), "# 합성 기록\n");
		git("init", "--quiet");
		git("config", "core.autocrlf", "false");
		git("config", "user.name", "Fixture Test");
		git("config", "user.email", "fixture@example.org");
		git("add", "--", ...inputs, "docs/note.md");
		git("commit", "--quiet", "-m", "fixture inputs");
		await symlink(
			join(repository, "app/node_modules"),
			deps,
			process.platform === "win32" ? "junction" : "dir",
		);
		const out = join(root, "fixture-output");
		const build = () =>
			spawnSync(
				process.execPath,
				[join(folder, "build-owner-tasks.mjs"), root, out],
				{ encoding: "utf8", timeout: 60000 },
			);
		await run({ root, out, build, source: git("rev-parse", "HEAD") });
	} finally {
		// Windows junction도 먼저 끊어 실제 의존성 설치를 건드리지 않는다.
		await unlink(deps).catch(() => {});
		await rm(root, { recursive: true, force: true });
	}
}

test("실제 화면 입력이 HEAD와 다르면 원본 SHA를 붙여 생성하지 않는다", async () => {
	await fixture(async ({ root, build }) => {
		const file = join(root, "app/web/src/OwnerTasksScreen.tsx");
		const text = await readFile(file, "utf8");
		assert.ok(text.includes("열린 할 일"));
		await writeFile(file, text.replaceAll("열린 할 일", "수정된 합성 제목"));
		const result = build();
		assert.notEqual(result.status, 0, result.stdout);
		assert.match(result.stderr, /FIXTURE_SOURCE_CHANGED/);
	});
});

test("아직 커밋하지 않은 화면 입력 파일도 원본 범위에 섞지 않는다", async () => {
	await fixture(async ({ root, build }) => {
		await writeFile(
			join(root, "app/web/src/untracked-source.ts"),
			"export const synthetic = true;\n",
		);
		const result = build();
		assert.notEqual(result.status, 0, result.stdout);
		assert.match(result.stderr, /FIXTURE_SOURCE_CHANGED/);
	});
});

test("입력이 깨끗하면 실제 커밋을 기록하고 임시 TSX는 남기지 않는다", async () => {
	await fixture(async ({ out, build, source }) => {
		const result = build();
		assert.equal(result.status, 0, result.stderr);
		assert.equal(
			JSON.parse(await readFile(join(out, "manifest.json"), "utf8"))
				.localProductSourceCommit,
			source,
		);
		await assert.rejects(readFile(join(out, "fixture-source.tsx")), {
			code: "ENOENT",
		});
	});
});

test("빌드 입력 밖의 기록만 바꾸면 같은 입력의 재현은 허용한다", async () => {
	await fixture(async ({ root, build }) => {
		await writeFile(join(root, "docs/note.md"), "# 바뀐 합성 기록\n");
		const result = build();
		assert.equal(result.status, 0, result.stderr);
	});
});
