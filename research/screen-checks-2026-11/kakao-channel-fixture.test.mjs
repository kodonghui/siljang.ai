import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { buildKakaoChannel } from "./build-kakao-channel.mjs";

const repository = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const directory = await mkdtemp(join(tmpdir(), "siljang-channel-contract-"));
after(async () => rm(directory, { recursive: true, force: true }));
const { entry } = await buildKakaoChannel(
	repository,
	join(directory, "output"),
);

// Exercise exactly the generated mock response code. No React, browser, real service, or browser-state injection.
function fixture() {
	const core = entry.slice(
		entry.indexOf("const rows="),
		entry.indexOf("function Fixture()"),
	);
	const context = vm.createContext({ Response, Headers, structuredClone });
	vm.runInContext(
		core +
			`
    globalThis.fixture = {
      select(value) { scenario=value; reads=meReads=0; writes=[]; shopGone=false; current=null; started=Date.now(); },
      row(method, path, name) { return 'row:'+rows.find(x=>x.method===method && x.path===path && x.name===name).id; },
      request(input, init) { return fetch(input, init); }
    };
  `,
		context,
	);
	return context.fixture;
}

const route = "/api/owner/kakao-channel";
test("SCR-041 done starts unregistered and shows the first-save key", async () => {
	const f = fixture();
	f.select("done");
	const before = await f.request(route);
	assert.equal(before.status, 404);
	assert.equal((await before.json()).code, "not_set");
	const response = await f.request(route, {
		method: "PUT",
		headers: { "Idempotency-Key": "00000000-0000-4000-8000-000000000054" },
		body: JSON.stringify({
			botId: "synthetic-first-bot",
			channelPublicId: null,
			blockIds: {
				card: "synthetic-card",
				ordererInfo: "synthetic-orderer",
				allergyAnswer: "synthetic-allergy",
				depositorName: "synthetic-depositor",
				review: "synthetic-review",
			},
		}),
	});
	const saved = await response.json();
	assert.equal(response.status, 200);
	assert.equal(saved.outcome, "created");
	assert.equal(saved.skillKey.headerValue.length, 43);
	assert.equal(saved.kakaoChannel.status, "pending");
	assert.equal(saved.kakaoChannel.checkExpiresAt, null);
});

test("API-032 started preserves a fresh ten-minute window in the next read", async () => {
	const f = fixture();
	f.select(f.row("post", "/owner/kakao-channel/check", "started"));
	await f.request(route);
	const before = Date.now();
	const response = await f.request(route + "/check", { method: "POST" });
	const { kakaoChannel: channel } = await response.json();
	assert.equal(response.status, 200);
	assert.equal(channel.status, "pending");
	assert.ok(Date.parse(channel.checkExpiresAt) >= before + 599_000);
	assert.ok(Date.parse(channel.checkExpiresAt) <= Date.now() + 601_000);
	assert.equal(
		Date.parse(channel.checkExpiresAt) - Date.parse(channel.checkStartedAt),
		600_000,
	);
	const read = await (await f.request(route)).json();
	assert.equal(read.checkExpiresAt, channel.checkExpiresAt);
});

test("API-032 incomplete blocks leaves an empty field for the product error", async () => {
	const f = fixture();
	f.select(
		f.row("post", "/owner/kakao-channel/check", "channel_setup_incomplete"),
	);
	const channel = await (await f.request(route)).json();
	assert.ok(
		Object.values(channel.blockIds).some(
			(value) => value === null || value === "",
		),
	);
	const response = await f.request(route + "/check", { method: "POST" });
	assert.equal(response.status, 409);
	assert.equal((await response.json()).code, "channel_setup_incomplete");
});

const require = createRequire(join(repository, "app/package.json"));
const api = require("yaml").parse(
	await readFile(join(repository, "api/openapi.yaml"), "utf8"),
);
function examples(method, path) {
	return Object.values(api.paths[path][method].responses).flatMap((response) =>
		Object.entries(
			response.content?.["application/problem+json"]?.examples ?? {},
		),
	);
}
async function assertProblem(response, expected) {
	assert.equal(response.status, expected.status);
	assert.equal(
		response.headers.get("Content-Type"),
		"application/problem+json",
	);
	assert.equal(response.headers.get("Cache-Control"), "no-store");
	assert.deepEqual(await response.json(), expected);
}
test("채널 문맥의 미등록/권한/신원 실패도 전체 Problem 예시를 사용한다", async () => {
	for (const [selected, path, code] of [
		["empty", "/owner/kakao-channel", "not_set"],
		["permission", "/owner/kakao-channel", "unauthenticated"],
		["session-failed", "/owner/me", "internal"],
	]) {
		const f = fixture();
		f.select(selected);
		await assertProblem(
			await f.request("/api" + path),
			examples("get", path).find(
				([, example]) => example.value.code === code,
			)[1].value,
		);
	}
});
test("네 채널 API의 모든 오류 예시는 본문/상태·미디어 유형/캐시 금지를 보존한다", async () => {
	for (const [method, path] of [
		["get", "/owner/kakao-channel"],
		["put", "/owner/kakao-channel"],
		["post", "/owner/kakao-channel/check"],
		["post", "/owner/kakao-channel/skill-key"],
	]) {
		for (const [label, example] of examples(method, path)) {
			const f = fixture();
			f.select(f.row(method, path, label));
			const init =
				method === "get"
					? undefined
					: {
							method: method.toUpperCase(),
							headers:
								label === "missing_idempotency_key"
									? {}
									: { "Idempotency-Key": "synthetic-channel-key-01" },
							body: JSON.stringify({}),
						};
			await assertProblem(await f.request("/api" + path, init), example.value);
		}
	}
});
