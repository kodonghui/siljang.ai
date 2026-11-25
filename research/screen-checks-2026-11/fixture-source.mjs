import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import {
	lstat,
	mkdir,
	mkdtemp,
	realpath,
	rename,
	rm,
	rmdir,
} from "node:fs/promises";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import { fileURLToPath } from "node:url";

// 의존성 설치는 lock으로 고정하고, 실제 번들/검사기/자료 생성에 쓰는 저장소 입력을 확인한다.
const INPUTS = [
	"app/web",
	"app/package.json",
	"app/package-lock.json",
	"app/tsconfig.base.json",
	"api/openapi.yaml",
	"tools/corthex/page-check.js",
	"research/screen-checks-2026-11",
];

export function assertFixtureSource(root, expected) {
	const git = (...args) =>
		execFileSync("git", args, {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	const source = git("rev-parse", "HEAD");
	const changed = git(
		"status",
		"--porcelain",
		"--untracked-files=all",
		"--",
		...INPUTS,
	);
	if (changed !== "" || (expected !== undefined && source !== expected))
		throw new Error(
			"FIXTURE_SOURCE_CHANGED: commit fixture inputs before generation",
		);
	return source;
}

const pathKey = (value) =>
	process.platform === "win32" ? value.toLowerCase() : value;

/** 실행한 생성기·보조 파일·입력 저장소가 같은 작업 트리여야 한다. */
export function fixtureRepository(moduleUrl, providedRoot) {
	const scriptRoot = realpathSync(fileURLToPath(new URL("../..", moduleUrl)));
	const root = realpathSync(resolve(providedRoot ?? "."));
	if (pathKey(root) !== pathKey(scriptRoot))
		throw new Error(
			"FIXTURE_SOURCE_ROOT_MISMATCH: run the generator from its input repository",
		);
	return root;
}

function contains(parent, child) {
	const part = relative(pathKey(parent), pathKey(child));
	return (
		part === "" ||
		(!isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`))
	);
}
function checkOutput(root, target) {
	if (
		dirname(target) === target ||
		contains(root, target) ||
		contains(target, root)
	)
		throw new Error(
			"FIXTURE_OUTPUT_INVALID: use a directory outside the source repository",
		);
}
async function existing(path) {
	try {
		return await lstat(path);
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}

/** 모든 결과/manifest와 원본 검사를 마친 뒤 교체한다. 이전 결과는 복구용으로 남긴다. */
export async function publishFixture(root, destination, generate) {
	const source = assertFixtureSource(root);
	const requested = resolve(destination);
	checkOutput(root, requested);
	await mkdir(dirname(requested), { recursive: true });
	const target = join(await realpath(dirname(requested)), basename(requested));
	checkOutput(root, target);
	const before = await existing(target);
	if (before && !before.isDirectory())
		throw new Error("FIXTURE_OUTPUT_INVALID: output must be a directory");
	const staging = await mkdtemp(
		join(dirname(target), `.${basename(target)}.stage-`),
	);
	let previousOutput = null;
	try {
		const result = await generate({ source, out: staging });
		assertFixtureSource(root, source);
		const current = await existing(target);
		if (current) {
			if (!current.isDirectory())
				throw new Error(
					"FIXTURE_OUTPUT_INVALID: output changed during generation",
				);
			previousOutput = await mkdtemp(
				join(dirname(target), `.${basename(target)}.previous-`),
			);
			await rmdir(previousOutput);
			await rename(target, previousOutput);
		}
		try {
			await rename(staging, target);
		} catch (error) {
			if (previousOutput) {
				try {
					await rename(previousOutput, target);
				} catch (restoreError) {
					throw new AggregateError(
						[error, restoreError],
						`FIXTURE_PUBLISH_FAILED: previous output kept at ${previousOutput}`,
					);
				}
			}
			throw error;
		}
		return { ...result, out: target, previousOutput };
	} finally {
		// 이 호출이 만든 비공개 임시 결과만 지운다. 이전 출력 보관 폴더는 남긴다.
		await rm(staging, { recursive: true, force: true });
	}
}
