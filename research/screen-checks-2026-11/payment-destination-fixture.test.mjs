import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { buildPaymentDestination } from "./build-payment-destination.mjs";

const repository = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const directory = await mkdtemp(join(tmpdir(), "siljang-payment-contract-"));
after(async () => rm(directory, { recursive: true, force: true }));
const { entry } = await buildPaymentDestination(
	repository,
	join(directory, "output"),
);
const require = createRequire(join(repository, "app/package.json"));
const { build } = require("esbuild"),
	{ parse } = require("yaml");
const api = parse(await readFile(join(repository, "api/openapi.yaml"), "utf8"));
const operation = api.paths["/owner/payment-destination"];
const original =
	operation.get.responses[200].content["application/json"].examples.account
		.value;
const compiled = await build({
	entryPoints: [join(repository, "app/web/src/payment-destination-form.ts")],
	bundle: true,
	write: false,
	platform: "node",
	format: "cjs",
	define: { "import.meta.env.VITE_API_BASE": '"/api"' },
});
const form = { exports: {} };
vm.runInNewContext(compiled.outputFiles[0].text, {
	module: form,
	exports: form.exports,
	crypto,
	structuredClone,
});
const bodyFor = (current) =>
	form.exports.paymentPayload(current, form.exports.paymentForm(current));

// 실제 생성한 모의 응답을 실행하며 요청은 실제 웹 양식 함수로 만든다.
function fixture(selected) {
	const context = vm.createContext({
		Response,
		Headers,
		structuredClone,
		DOMException,
	});
	vm.runInContext(
		entry.slice(
			entry.indexOf("const original="),
			entry.indexOf("function Fixture()"),
		) +
			`\nselectScenario(${JSON.stringify(selected)});globalThis.fixture={request(input,init){return fetch(input,init);}};`,
		context,
	);
	return context.fixture;
}
const route = "/api/owner/payment-destination";
const save = (f, body, key = "synthetic-payment-key-01") =>
	f.request(route, {
		method: "PUT",
		body: JSON.stringify(body),
		headers: key === null ? {} : { "Idempotency-Key": key },
	});
function problemExample(method, label) {
	return Object.values(operation[method].responses)
		.map(
			(response) =>
				response.content?.["application/problem+json"]?.examples?.[label]
					?.value,
		)
		.find(Boolean);
}
async function problem(response, method, label) {
	const expected = problemExample(method, label);
	assert.ok(expected);
	assert.equal(response.status, expected.status);
	assert.equal(
		response.headers.get("Content-Type"),
		"application/problem+json",
	);
	assert.equal(response.headers.get("Cache-Control"), "no-store");
	assert.deepEqual(await response.json(), expected);
}

test("계좌 조회5응답은 API024의 전체 본문/Problem 계약을 보존한다", async () => {
	const response = await fixture("normal").request(route);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("Cache-Control"), "no-store");
	assert.deepEqual(await response.json(), original);
	for (const [selected, label] of [
		["permission", "unauthenticated"],
		["read-no-shop", "shop_not_registered"],
		["empty", "not_set"],
		["load-failed", "internal"],
	])
		await problem(await fixture(selected).request(route), "get", label);
});

test("저장 오류8개는 API025의 전체 예시를 사용하고 진행 중에는1초 대기를 알린다", async () => {
	for (const [selected, label] of [
		["save-401", "unauthenticated"],
		["save-no-shop", "shop_not_registered"],
		["stale", "version_conflict"],
		["save-holder", "holder_not_verified"],
		["save-progress", "request_in_progress"],
		["error", "validation_failed"],
		["save-key", "idempotency_key_reused"],
		["save-500", "internal"],
	]) {
		const response = await save(fixture(selected), bodyFor(original));
		if (selected === "save-progress")
			assert.equal(response.headers.get("Retry-After"), "1");
		await problem(response, "put", label);
	}
});

test("요청 키 없는 추가 헤더 조건도 별도 OpenAPI 예시로 거절한다", async () => {
	await problem(
		await save(fixture("normal"), bodyFor(original), null),
		"put",
		"missing_idempotency_key",
	);
});

test("done의 같은 값은 unchanged이고 unchanged의 실제 변경은 created이다", async () => {
	const first = fixture("done");
	const unchanged = await (await save(first, bodyFor(original))).json();
	assert.equal(unchanged.outcome, "unchanged");
	assert.equal(unchanged.paymentDestination.revision, original.revision);
	const second = fixture("unchanged");
	const body = { ...bodyFor(original), accountNumber: "0000000000000000" };
	const response = await save(second, body);
	assert.equal(response.status, 200);
	const created = await response.json();
	assert.equal(created.outcome, "created");
	assert.equal(created.paymentDestination.accountNumber, body.accountNumber);
	assert.notEqual(created.paymentDestination.revision, original.revision);
	const fields = api.components.schemas.PaymentDestination.properties;
	assert.deepEqual(
		Object.keys(created.paymentDestination).filter(
			(key) => !Object.hasOwn(fields, key),
		),
		[],
	);
});

test("다른 예금주의 실제 확인과 같은 키 재시도는 저장 결과를 보존한다", async () => {
	const f = fixture("confirm"),
		body = { ...bodyFor(original), holderName: "다른 합성 예금주" };
	await problem(await save(f, body), "put", "confirmation_required");
	const accepted = { ...body, confirm: ["holder_mismatch"] };
	const response = await save(f, accepted, "synthetic-payment-confirm-02");
	assert.equal(response.status, 200);
	const result = await response.json();
	assert.equal(result.outcome, "created");
	assert.equal(result.paymentDestination.holderMismatchConfirmed, true);
	assert.equal(result.paymentDestination.holderName, body.holderName);
	const retry = await save(f, accepted, "synthetic-payment-confirm-02");
	assert.deepEqual(await retry.json(), result);
	await problem(
		await save(
			f,
			{ ...accepted, bankName: "다른 합성 은행" },
			"synthetic-payment-confirm-02",
		),
		"put",
		"idempotency_key_reused",
	);
});

test("아직 등록하지 않은 계좌는 실제 빈 양식의 baseRevision null로 첫 저장한다", async () => {
	const f = fixture("empty");
	await problem(await f.request(route), "get", "not_set");
	const fields = {
		...form.exports.paymentForm(null),
		...form.exports.paymentForm(original),
	};
	const body = form.exports.paymentPayload(null, fields);
	assert.equal(body.baseRevision, null);
	const response = await save(f, body);
	assert.equal(response.status, 200);
	const result = await response.json();
	assert.equal(result.outcome, "created");
	assert.deepEqual(
		await (await f.request(route)).json(),
		result.paymentDestination,
	);
});
