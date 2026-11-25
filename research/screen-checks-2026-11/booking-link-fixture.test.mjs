import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { buildBookingLink } from "./build-booking-link.mjs";

const repository = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const directory = await mkdtemp(
	join(tmpdir(), "siljang-booking-link-contract-"),
);
after(async () => rm(directory, { recursive: true, force: true }));
const { entry } = await buildBookingLink(repository, join(directory, "output"));
const require = createRequire(join(repository, "app/package.json"));
const api = require("yaml").parse(
	await readFile(join(repository, "api/openapi.yaml"), "utf8"),
);
const route = "/owner/booking-link";
const samples =
	api.paths[route].get.responses[200].content["application/json"].examples;

// 생성한 모의 응답을 실행한다. 실제 브라우저/클립보드/서비스를 사용하지 않는다.
function fixture(selected) {
	const context = vm.createContext({ Response, Headers, URL, structuredClone });
	vm.runInContext(
		entry.slice(
			entry.indexOf("const bookingExamples="),
			entry.indexOf("function Fixture()"),
		) +
			`\nselectScenario(${JSON.stringify(selected)});globalThis.fixture={request(input,init){return fetch(input,init);}};`,
		context,
	);
	return context.fixture;
}
function problem(path, code) {
	return Object.values(api.paths[path].get.responses)
		.flatMap((response) =>
			Object.values(
				response.content?.["application/problem+json"]?.examples ?? {},
			),
		)
		.find((example) => example.value.code === code).value;
}
async function check(response, expected, status = 200) {
	assert.equal(response.status, status);
	assert.equal(
		response.headers.get("Content-Type"),
		status === 200 ? "application/json" : "application/problem+json",
	);
	assert.equal(response.headers.get("Cache-Control"), "no-store");
	assert.deepEqual(await response.json(), expected);
}

test("예약 링크5응답은 전체 API037 본문과 미디어 유형/캐시 금지를 지킨다", async () => {
	await check(
		await fixture("normal").request("/api" + route),
		samples.issued.value,
	);
	await check(
		await fixture("empty").request("/api" + route),
		samples.not_ready.value,
	);
	for (const [selected, code] of [
		["permission", "unauthenticated"],
		["shop-missing", "shop_not_registered"],
		["error", "internal"],
	]) {
		const expected = problem(route, code);
		await check(
			await fixture(selected).request("/api" + route),
			expected,
			expected.status,
		);
	}
});

test("오래된 정보 조건은 정상 주소를 받은 뒤 두 번째 조회부터 명세 오류를 보낸다", async () => {
	const f = fixture("stale");
	await check(await f.request("/api" + route), samples.issued.value);
	const expected = problem(route, "internal");
	await check(await f.request("/api" + route), expected, expected.status);
});

test("발급 뒤 준비 조건이 사라져도 같은 예약 주소와 발급 시각을 유지한다", async () => {
  for (const selected of ["becomes-not-ready", "conditions-removed"]) {
    const f = fixture(selected);
    await check(await f.request("/api" + route), samples.issued.value);
    await check(await f.request("/api" + route), samples.issued.value);
    const shop = await (await f.request("/api/owner/shop")).json();
    assert.equal(shop.bookingUrl, samples.issued.value.url);
    assert.equal(shop.settingsSummary.paymentConfigured, false);
    assert.equal(shop.licenseStatus, "verified");
    const expected = problem("/owner/payment-destination", "not_set");
    await check(await f.request("/api/owner/payment-destination"), expected, 404);
  }
});

test("발급 전 조건을 채우면 신원/가게와 함께 처음 발급된 주소를 제공한다", async () => {
  const f = fixture("becomes-issued");
  await check(await f.request("/api" + route), samples.not_ready.value);
  await check(await f.request("/api" + route), samples.issued.value);
  const me = await (await f.request("/api/owner/me")).json();
  const shop = await (await f.request("/api/owner/shop")).json();
  assert.equal(me.shop.licenseStatus, "verified");
  assert.equal(shop.licenseStatus, "verified");
  assert.equal(shop.bookingUrl, samples.issued.value.url);
});

test("발급 뒤 픽업 장소가 비어도 주소와 시각을 유지하고 권고와 가게 설정을 일치시킨다", async () => {
  const f = fixture("issued-no-pickup");
  await check(await f.request("/api" + route), { ...samples.issued.value, recommended: ["pickup_address"] });
  const shop = await (await f.request("/api/owner/shop")).json();
  assert.equal(shop.pickupAddress, null);
  assert.equal(shop.bookingUrl, samples.issued.value.url);
  assert.equal(shop.licenseStatus, "verified");
});

test("7조건이 모두 남으면 각 설정 진입의 조회도 미충족 상태를 제공한다", async () => {
	const f = fixture("missing-all");
	const booking = await (await f.request("/api" + route)).json();
	assert.equal(booking.status, "not_ready");
	assert.equal(new Set(booking.missing).size, 7);
	for (const path of [
		"/owner/price-list",
		"/owner/calendar",
		"/owner/payment-destination",
		"/owner/kakao-channel",
	]) {
		const expected = problem(path, "not_set");
		await check(await f.request("/api" + path), expected, expected.status);
	}
	const rules =
		api.paths["/owner/operating-rules"].get.responses[200].content[
			"application/json"
		].examples.template.value;
	await check(await f.request("/api/owner/operating-rules"), rules);
	const shop =
		api.paths["/owner/shop"].get.responses[200].content["application/json"]
			.examples.pending.value;
	await check(await f.request("/api/owner/shop"), shop);
});

test("정상 준비 상태의 설정 진입은 현재 자료와 완료 상태를 보존한다", async () => {
	const f = fixture("normal");
	for (const [path, label] of [
		["/owner/shop", "verified"],
		["/owner/price-list", "current"],
		["/owner/operating-rules", "current"],
		["/owner/calendar", "settings"],
		["/owner/payment-destination", "account"],
		["/owner/kakao-channel", "linked"],
	]) {
		const expected = structuredClone(
			api.paths[path].get.responses[200].content["application/json"].examples[
				label
			].value,
		);
		if (path === "/owner/shop") {
			expected.settingsSummary.priceListVersion =
				api.paths["/owner/price-list"].get.responses[200].content[
					"application/json"
				].examples.current.value.version;
			expected.settingsSummary.operatingRulesVersion =
				api.paths["/owner/operating-rules"].get.responses[200].content[
					"application/json"
				].examples.current.value.version;
		}
		await check(await f.request("/api" + path), expected);
	}
});

test("추가 긴 링크도 예약된 합성 HTTPS 도메인과 정상 준비 조건을 유지한다", async () => {
	const response = await fixture("long-url").request("/api" + route);
	const value = await response.json();
	assert.equal(response.status, 200);
	assert.equal(value.status, "issued");
	assert.deepEqual(value.missing, []);
	assert.ok(value.url.startsWith("https://siljang.example/s/"));
	assert.ok(value.url.length > 1900 && value.url.length <= 2048);
});
