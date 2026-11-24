import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { buildOperatingRules } from "./build-operating-rules.mjs";

const repository = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const directory = await mkdtemp(join(tmpdir(), "siljang-rules-contract-"));
after(async () => rm(directory, { recursive: true, force: true }));
const { entry } = await buildOperatingRules(repository, directory);
const require = createRequire(join(repository, "app/package.json"));
const { build } = require("esbuild");
const { parse } = require("yaml");
const api = parse(await readFile(join(repository, "api/openapi.yaml"), "utf8"));
const compiled = await build({
	entryPoints: [join(repository, "app/web/src/operating-rules-form.ts")],
	bundle: true,
	write: false,
	platform: "node",
	format: "cjs",
	define: { "import.meta.env.VITE_API_BASE": '"/api"' },
});
const formModule = { exports: {} };
vm.runInNewContext(compiled.outputFiles[0].text, {
	module: formModule,
	exports: formModule.exports,
	crypto,
	structuredClone,
});
const bodyFor = (current) =>
	formModule.exports.rulesPayload(
		current,
		formModule.exports.rulesForm(current),
	);
const route = "/api/owner/operating-rules";

// 생성된 모의 응답 코드를 그대로 실행한다. 브라우저/React/실제 서비스는 사용하지 않는다.
function fixture() {
	const core = entry.slice(
		entry.indexOf("const normal="),
		entry.indexOf("function Fixture()"),
	);
	const context = vm.createContext({ Response, Headers, structuredClone });
	vm.runInContext(
		core +
			`
    globalThis.fixture={
      select(name){scenario=name;current=structuredClone(name==='template'?template:normal);reads=sends=0;shopGone=false;firstKey=sameKey=null;},
      request(input,init){return fetch(input,init);}
    };
  `,
		context,
	);
	return context.fixture;
}
const save = (f, body) =>
	f.request(route + "/versions", {
		method: "POST",
		headers: { "Idempotency-Key": "synthetic-rules-key-01" },
		body: JSON.stringify(body),
	});

test("done에서도 현재 값 그대로면200/변경 없음으로 버전을 보존한다", async () => {
	const f = fixture();
	f.select("done");
	const current = await (await f.request(route)).json();
	const response = await save(f, bodyFor(current));
	assert.equal(response.status, 200);
	const result = await response.json();
	assert.equal(result.outcome, "unchanged");
	assert.equal(result.operatingRules.version, current.version);
});

test("unchanged에서도 유효한 실제 변경은201/새 버전으로 저장한다", async () => {
	const f = fixture();
	f.select("unchanged");
	const current = await (await f.request(route)).json();
	const body = bodyFor(current);
	body.paymentDueHours = 16;
	assert.notEqual(body.paymentDueHours, current.paymentDueHours);
	const response = await save(f, body);
	assert.equal(response.status, 201);
	const result = await response.json();
	assert.equal(result.outcome, "created");
	assert.equal(result.operatingRules.version, current.version + 1);
	assert.equal(result.operatingRules.paymentDueHours, 16);
});

test("조회 오류는 OpenAPI의 Problem 본문/미디어 유형을 그대로 사용한다", async () => {
	const f = fixture();
	f.select("load-error");
	const response = await f.request(route);
	assert.equal(response.status, 500);
	assert.equal(
		response.headers.get("Content-Type"),
		"application/problem+json",
	);
	const examples =
		api.paths["/owner/operating-rules"].get.responses.default.content[
			"application/problem+json"
		].examples;
	const expected = Object.values(examples).find(
		(x) => x.value.code === "internal",
	).value;
	assert.deepEqual(await response.json(), expected);
});

test("저장 응답의 규정에는 요청 전용 baseRevision/confirm을 섞지 않는다", async () => {
	const f = fixture();
	f.select("normal");
	const current = await (await f.request(route)).json();
	const body = { ...bodyFor(current), paymentDueHours: 16, confirm: [] };
	const response = await save(f, body);
	assert.equal(response.status, 201);
	const saved = (await response.json()).operatingRules;
	const properties = api.components.schemas.OperatingRules.properties;
	assert.deepEqual(
		Object.keys(saved).filter((key) => !Object.hasOwn(properties, key)),
		[],
	);
	assert.equal(Object.hasOwn(saved, "baseRevision"), false);
	assert.equal(Object.hasOwn(saved, "confirm"), false);
});
