import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import childProcess, { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
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
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const folder = dirname(fileURLToPath(import.meta.url));
const repository = resolve(folder, "../..");
const inputs = [
	"app/web/src",
	"app/package.json",
	"app/package-lock.json",
	"app/tsconfig.base.json",
	"app/web/tsconfig.json",
	"app/web/package.json",
	"api/openapi.yaml",
	"tools/corthex/page-check.js",
	"research/screen-checks-2026-11",
];
async function fixture(run) {
	const container = await mkdtemp(join(tmpdir(), "siljang-owner-source-"));
	const root = join(container, "repository");
	await mkdir(root);
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
		const out = join(container, "output"),
			script = join(
				root,
				"research/screen-checks-2026-11/build-owner-tasks.mjs",
			);
		const execute = (file) =>
			spawnSync(process.execPath, [file, root, out], {
				encoding: "utf8",
				timeout: 60000,
			});
		const build = () => execute(script),
			foreignBuild = () => execute(join(folder, "build-owner-tasks.mjs"));
		const load = async () =>
			(await import(pathToFileURL(script).href)).buildOwnerTasks;
		await run({
			root,
			out,
			container,
			git,
			build,
			foreignBuild,
			load,
			source: git("rev-parse", "HEAD"),
		});
	} finally {
		await unlink(deps).catch(() => {});
		await rm(container, { recursive: true, force: true });
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

test("실행한 생성기와 인수의 저장소가 다르면 보조 파일을 섞지 않는다", async () => {
	await fixture(async ({ root, git, foreignBuild }) => {
		await writeFile(
			join(root, "research/screen-checks-2026-11/support/qa.css"),
			"/* 다른 원본의 합성 CSS */\n",
		);
		git("add", "--", "research/screen-checks-2026-11/support/qa.css");
		git("commit", "--quiet", "-m", "different source support");
		const result = foreignBuild();
		assert.notEqual(result.status, 0, result.stdout);
		assert.match(result.stderr, /FIXTURE_SOURCE_ROOT_MISMATCH/);
	});
});

test("새 번들 생성 뒤 입력이 바뀌어 실패해도 이전 번들과 manifest를 함께 보존한다", async () => {
	await fixture(async ({ root, out, container, git, build, load }) => {
		const first = build();
		assert.equal(first.status, 0, first.stderr);
		const previousJs = await readFile(join(out, "main.js")),
			previousManifest = await readFile(join(out, "manifest.json"));
		const screen = join(root, "app/web/src/OwnerTasksScreen.tsx");
		await writeFile(
			screen,
			(await readFile(screen, "utf8")).replaceAll(
				"열린 할 일",
				"새 원본의 합성 제목",
			),
		);
		git("add", "--", "app/web/src/OwnerTasksScreen.tsx");
		git("commit", "--quiet", "-m", "next fixture source");
		const generate = await load(),
			original = childProcess.execFileSync;
		const pathKey = (value) =>
			process.platform === "win32"
				? resolve(value).toLowerCase()
				: resolve(value);
		let checks = 0,
			compiled = false;
		childProcess.execFileSync = function (command, args, options) {
			if (
				command === "git" &&
				pathKey(options?.cwd ?? "") === pathKey(root) &&
				args[0] === "status" &&
				++checks === 2
			) {
				compiled = readdirSync(container, { withFileTypes: true })
					.filter((x) => x.isDirectory() && x.name !== "repository")
					.some((x) => {
						const js = join(container, x.name, "main.js");
						return existsSync(js) && !readFileSync(js).equals(previousJs);
					});
				assert.equal(
					compiled,
					true,
					"새 번들이 실제 생성된 뒤 실패를 넣어야 한다",
				);
				appendFileSync(screen, "\n// 생성 도중 바뀐 합성 입력\n");
			}
			return original(command, args, options);
		};
		syncBuiltinESMExports();
		try {
			await assert.rejects(generate(root, out), /FIXTURE_SOURCE_CHANGED/);
		} finally {
			childProcess.execFileSync = original;
			syncBuiltinESMExports();
		}
		assert.equal(compiled, true);
		assert.equal(
			(await readFile(join(out, "main.js"))).equals(previousJs),
			true,
			"이전 번들 바이트 보존",
		);
		assert.equal(
			(await readFile(join(out, "manifest.json"))).equals(previousManifest),
			true,
			"이전 manifest 바이트 보존",
		);
	});
});

test("완성된 새 결과로 교체할 때 이전 결과를 복구 가능한 폴더에 보존한다", async () => {
	await fixture(async ({ root, out, git, build }) => {
		const first = build();
		assert.equal(first.status, 0, first.stderr);
		const previousJs = await readFile(join(out, "main.js")),
			previousManifest = await readFile(join(out, "manifest.json"));
		const screen = join(root, "app/web/src/OwnerTasksScreen.tsx");
		await writeFile(
			screen,
			(await readFile(screen, "utf8")).replaceAll(
				"열린 할 일",
				"교체한 합성 제목",
			),
		);
		git("add", "--", "app/web/src/OwnerTasksScreen.tsx");
		git("commit", "--quiet", "-m", "next complete fixture");
		const next = build();
		assert.equal(next.status, 0, next.stderr);
		const metadata = JSON.parse(next.stdout);
		assert.equal(typeof metadata.previousOutput, "string");
		assert.equal(
			(await readFile(join(metadata.previousOutput, "main.js"))).equals(
				previousJs,
			),
			true,
			"보관 번들 바이트",
		);
		assert.equal(
			(await readFile(join(metadata.previousOutput, "manifest.json"))).equals(
				previousManifest,
			),
			true,
			"보관 manifest 바이트",
		);
		assert.equal(
			JSON.parse(await readFile(join(out, "manifest.json"), "utf8"))
				.localProductSourceCommit,
			git("rev-parse", "HEAD"),
		);
		assert.equal(
			(await readFile(join(out, "main.js"))).equals(previousJs),
			false,
			"새 번들로 교체",
		);
	});
});

test("상속한 TypeScript 설정의 미커밋 변경으로 기존 SHA의 번들을 만들지 않는다", async () => {
	await fixture(async ({ root, out, build }) => {
		const first = build();
		assert.equal(first.status, 0, first.stderr);
		const digest = () =>
			createHash("sha256")
				.update(readFileSync(join(out, "main.js")))
				.digest("hex");
		const before = digest();
		const path = join(root, "app/tsconfig.base.json"),
			value = JSON.parse(readFileSync(path, "utf8"));
		value.compilerOptions.useDefineForClassFields = false;
		await writeFile(path, JSON.stringify(value, null, 2) + "\n");
		const result = build();
		assert.notEqual(
			result.status,
			0,
			JSON.stringify({
				beforeBundle: before,
				afterBundle: digest(),
				stdout: result.stdout,
			}),
		);
		assert.match(result.stderr, /FIXTURE_SOURCE_CHANGED/);
		assert.equal(digest(), before);
	});
});
