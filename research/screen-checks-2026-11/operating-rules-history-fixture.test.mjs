import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { buildOperatingRulesHistory } from "./build-operating-rules-history.mjs";

const repository = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const directory = await mkdtemp(
	join(tmpdir(), "siljang-rules-history-contract-"),
);
after(async () => rm(directory, { recursive: true, force: true }));
const { entry } = await buildOperatingRulesHistory(
	repository,
	join(directory, "output"),
);
const require = createRequire(join(repository, "app/package.json"));
const { parse } = require("yaml");
const api = parse(await readFile(join(repository, "api/openapi.yaml"), "utf8"));
const listPath = "/owner/operating-rules/versions";
const detailPath = "/owner/operating-rules/versions/{version}";

// 생성한 응답 코드를 그대로 실행한다. 브라우저나 실제 서비스가 아니다.
function fixture(selected) {
	const context = vm.createContext({
		Response,
		Headers,
		structuredClone,
		DOMException,
		sessionStorage: { getItem: () => selected },
	});
	vm.runInContext(
		entry.slice(
			entry.indexOf("const listExamples="),
			entry.indexOf("function Fixture()"),
		) +
			"\nglobalThis.fixture={request(input,init){return fetch(input,init);}};",
		context,
	);
	return context.fixture;
}

function example(operation, code) {
	return Object.values(api.paths[operation].get.responses)
		.flatMap((response) =>
			Object.values(
				response.content?.["application/problem+json"]?.examples ?? {},
			),
		)
		.find((example) => example.value.code === code).value;
}
async function check(selected, path, expected, status = 200) {
	const response = await fixture(selected).request("/api" + path);
	assert.equal(response.status, status);
	assert.equal(
		response.headers.get("Content-Type"),
		status === 200 ? "application/json" : "application/problem+json",
	);
	assert.equal(response.headers.get("Cache-Control"), "no-store");
	assert.deepEqual(await response.json(), expected);
}

test("목록의5응답은 API022의 본문/미디어 유형을 보존한다", async () => {
	const examples =
		api.paths[listPath].get.responses[200].content["application/json"].examples;
	await check("normal", listPath, examples.versions.value);
	await check("empty", listPath, examples.empty.value);
	for (const [selected, code, status] of [
		["permission", "unauthenticated", 401],
		["not-registered", "shop_not_registered", 404],
		["error", "internal", 500],
	])
		await check(selected, listPath, example(listPath, code), status);
});

test("상세4응답은 API023의 옛 규정/오류를 현재 값으로 바꾸지 않는다", async () => {
	const old =
		api.paths[detailPath].get.responses[200].content["application/json"]
			.examples.old_version.value;
	await check("normal", listPath + "/1", old);
	for (const [selected, code, status] of [
		["detail-permission", "unauthenticated", 401],
		["not-found", "not_found", 404],
		["detail-error", "internal", 500],
	])
		await check(selected, listPath + "/1", example(detailPath, code), status);
});

test("추가 최대 목록에서도 현재 버전은 첫 행 하나이고 목록 밖 옛 상세는 보존한다", async () => {
	const f = fixture("maximum");
	const { items } = await (await f.request("/api" + listPath)).json();
	assert.equal(items.length, 1000);
	assert.deepEqual(
		items
			.filter((item) => item.supersededAt === null)
			.map((item) => item.version),
		[1000],
	);
	assert.equal(
		items.every((item, index) => item.version === 1000 - index),
		true,
	);
	const response = await f.request("/api" + listPath + "/1");
	assert.equal(response.status, 200);
	const old = await response.json();
	assert.equal(old.version, 1);
	assert.equal(old.current, false);
	assert.deepEqual(
		old.clauses,
		api.paths[detailPath].get.responses[200].content["application/json"]
			.examples.old_version.value.clauses,
	);
});
