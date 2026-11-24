import { execFileSync } from "node:child_process";

// 의존성 설치는 lock으로 고정하고, 실제 번들/검사기/자료 생성에 쓰는 저장소 입력을 확인한다.
const INPUTS = [
	"app/web",
	"app/package.json",
	"app/package-lock.json",
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
