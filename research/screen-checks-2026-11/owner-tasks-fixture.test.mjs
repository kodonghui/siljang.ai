import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { buildOwnerTasks } from "./build-owner-tasks.mjs";

const repository = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const directory = await mkdtemp(join(tmpdir(), "siljang-home-contract-"));
after(async () => rm(directory, { recursive: true, force: true }));
const { entry } = await buildOwnerTasks(repository, join(directory, "output"));
const require = createRequire(join(repository, "app/package.json"));
const { parse } = require("yaml");
const api = parse(await readFile(join(repository, "api/openapi.yaml"), "utf8"));

// 생성한 모의 응답 부분을 그대로 실행한다. 브라우저/실제 서비스는 사용하지 않는다.
function fixture(selected) {
	const context = vm.createContext({
		Response, Headers, URL, structuredClone, DOMException,
	});
	vm.runInContext(
		entry.slice(entry.indexOf("const meExamples="), entry.indexOf("function IdentityProbe()")) +
			`\nstate=${JSON.stringify(selected)};globalThis.fixture={request(input,init){return fetch(input,init);}};`,
		context,
	);
	return context.fixture;
}

async function checkProblem(response, operation, code, status) {
	assert.equal(response.status, status);
	assert.equal(response.headers.get("Content-Type"), "application/problem+json");
	assert.equal(response.headers.get("Cache-Control"), "no-store");
	const examples = Object.values(operation.responses).flatMap((response) =>
		Object.values(response.content?.["application/problem+json"]?.examples ?? {}),
	);
	const expected = examples.find((example) => example.value.code === code)?.value;
	assert.ok(expected, `명세에 ${code} 오류 예시가 있어야 함`);
	assert.deepEqual(await response.json(), expected);
}

test("내 정보 합성 오류는 API002의 전체 Problem 계약과 캐시 금지를 지킨다", async () => {
	for (const [selected, code, status] of [
		["me-error", "internal", 500],
		["me-permission", "unauthenticated", 401],
	]) {
		const response = await fixture(selected).request("/api/owner/me");
		await checkProblem(response, api.paths["/owner/me"].get, code, status);
	}
});

test("할 일 합성 오류는 API040의 전체 Problem 계약과 캐시 금지를 지킨다", async () => {
	for (const [selected, code, status] of [
		["error", "internal", 500],
		["permission", "unauthenticated", 401],
		["task-no-shop", "shop_not_registered", 404],
		["validation", "validation_failed", 422],
		["session-race", "unauthenticated", 401],
	]) {
		const response = await fixture(selected).request("/api/owner/tasks?status=open", {
			headers: { "X-Expected-Shop-Id": "00000000-0000-4000-8000-000000000001" },
		});
		await checkProblem(response, api.paths["/owner/tasks"].get, code, status);
	}
});
