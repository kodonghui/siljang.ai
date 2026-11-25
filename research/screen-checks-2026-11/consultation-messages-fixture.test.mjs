import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { buildConsultationMessages } from "./build-consultation-messages.mjs";

const repository = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const directory = await mkdtemp(join(tmpdir(), "siljang-consultation-contract-"));
after(async () => rm(directory, { recursive: true, force: true }));
const { entry, out } = await buildConsultationMessages(repository, join(directory, "output"));
const require = createRequire(join(repository, "app/package.json"));
const { parse } = require("yaml");
const api = parse(await readFile(join(repository, "api/openapi.yaml"), "utf8"));
const operation = api.paths["/owner/consultations/{consultationId}/messages"].get;
const examples = operation.responses[200].content["application/json"].examples;
const shop = api.paths["/owner/me"].get.responses[200].content["application/json"].examples.mvp.value.shop.shopId;
const path = `/api/owner/consultations/${examples.messages.value.consultationId}/messages?limit=20`;
const options = { headers: { "X-Expected-Shop-Id": shop } };

// 생성한 합성 응답 코드만 Node VM에서 실행한다. 실제 브라우저/서비스를 호출하지 않는다.
function fixture(selected) {
  const context = vm.createContext({ Response, Headers, URL, structuredClone, DOMException });
  vm.runInContext(
    entry.slice(entry.indexOf("const meExamples="), entry.indexOf("function Fixture()")) +
      `\nstate=${JSON.stringify(selected)};globalThis.fixture={request(input,init){return fetch(input,init);}};`,
    context,
  );
  return context.fixture;
}

test("상담 합성 자료가 SCR018의 일곱 응답과 여섯 상태를 준비하되 화면 성공으로 세지 않는다", async () => {
  const manifest = JSON.parse(await readFile(join(out, "manifest.json"), "utf8"));
  const screen = await readFile(join(repository, "docs/08-screens/SCR-018.md"), "utf8");
  const rows = [...screen.matchAll(/^\| (API-043#[^|]+) \| (SCR-018#[^|]+) \|/gm)].map((m) => ({
    response: m[1].trim(),
    state: m[2].trim(),
  }));
  assert.deepEqual(manifest.responseCases, rows);
  assert.equal(manifest.primaryStates, 6);
  assert.equal(manifest.responseRows, 7);
  assert.deepEqual(manifest.widthsPrepared, [360, 1280]);
  assert.equal(manifest.browserRun, false);
  assert.equal(manifest.outsideServices, 0);
  assert.match(entry, /\/app\/web\/src\/App/);
  assert.match(await readFile(join(out, "main.css"), "utf8"), /consultation-bubble/);
});

test("상담 합성 정상/사장님 답/삭제와 네 오류는 원래 OpenAPI 예시·캐시 금지를 지킨다", async () => {
  for (const [state, name] of [
    ["normal", "messages"],
    ["owner-reply", "with_owner_reply"],
    ["empty", "deleted"],
  ]) {
    const response = await fixture(state).request(path, options);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), examples[name].value);
  }
  for (const [state, status, code] of [
    ["permission", 401, "unauthenticated"],
    ["not-found", 404, "not_found"],
    ["validation", 422, "validation_failed"],
    ["error", 500, "internal"],
  ]) {
    const response = await fixture(state).request(path, options);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Content-Type"), "application/problem+json");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const expected =
      operation.responses[status === 500 ? "default" : status].content["application/problem+json"].examples[code].value;
    assert.deepEqual(await response.json(), expected);
  }
});

test("합성 자료는 가게 기대값을 확인하고 외부 요청과 업무 쓰기를 막는다", async () => {
  const mock = fixture("normal");
  assert.equal((await mock.request(path)).status, 401);
  await assert.rejects(mock.request("https://outside.example/private", options), /blocks outside/);
  await assert.rejects(mock.request(path, { ...options, method: "POST" }), /no business writes/);
  const first = await fixture("more-error").request(path, options);
  assert.equal((await first.json()).nextCursor, "older_page");
});
