import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { fetchOperatingRulesVersion, fetchOperatingRulesVersions } from "./operating-rules-history-api";

const contract = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const versions = () =>
  structuredClone(
    contract.paths["/owner/operating-rules/versions"].get.responses[200].content["application/json"].examples.versions
      .value,
  );
const old = () =>
  structuredClone(
    contract.paths["/owner/operating-rules/versions/{version}"].get.responses[200].content["application/json"].examples
      .old_version.value,
  );
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
afterEach(() => vi.unstubAllGlobals());
it("최신 순 목록과 옛 버전은 같은 출처 GET으로 읽기만 함", async () => {
  const calls: { path: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init: RequestInit) => {
      calls.push({ path: String(input), init });
      return json(calls.length === 1 ? versions() : old());
    }),
  );
  expect(await fetchOperatingRulesVersions()).toMatchObject({ ok: true, data: versions() });
  expect(await fetchOperatingRulesVersion("1")).toMatchObject({ ok: true, data: old() });
  expect(calls.map((c) => c.path)).toEqual([
    "/api/owner/operating-rules/versions",
    "/api/owner/operating-rules/versions/1",
  ]);
  expect(calls.every((c) => c.init.credentials === "same-origin" && (!c.init.method || c.init.method === "GET"))).toBe(
    true,
  );
  expect(calls.every((c) => !new Headers(c.init.headers).has("Idempotency-Key") && c.init.cache === "no-store")).toBe(
    true,
  );
});
it.each(["빈 목록", "중복 버전", "잘못된 날짜", "문자열 버전", "1000개 초과"])(
  "%s 응답의 경계를 확인",
  async (kind) => {
    const body = versions();
    if (kind === "빈 목록") body.items = [];
    if (kind === "중복 버전") body.items.push({ ...body.items[0] });
    if (kind === "잘못된 날짜") body.items[0].createdAt = "not-a-date";
    if (kind === "문자열 버전") body.items[0].version = "4";
    if (kind === "1000개 초과")
      body.items = Array.from({ length: 1001 }, (_, i) => ({ ...body.items[0], version: 1001 - i }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(body)),
    );
    expect(await fetchOperatingRulesVersions()).toMatchObject(
      kind === "빈 목록" ? { ok: true, data: { items: [] } } : { ok: false, status: 502 },
    );
  },
);
it("순서가 틀린 목록을 거절", async () => {
  const body = versions();
  body.items.reverse();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json(body)),
  );
  expect(await fetchOperatingRulesVersions()).toMatchObject({ ok: false, status: 502 });
});
it.each(["../../operator/me", "3/other", "3?x=1", "0", "1.5", "2147483648"])(
  "버전 %s는 다른 경로를 부르지 않고 없는 버전",
  async (value) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await fetchOperatingRulesVersion(value)).toMatchObject({
      ok: false,
      status: 404,
      problem: { code: "not_found" },
    });
    expect(fetch).not.toHaveBeenCalled();
  },
);
it("고른 버전과 다른 성공 응답은 편집/상세에 쓰지 않음", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ ...old(), version: 4 })),
  );
  expect(await fetchOperatingRulesVersion("1")).toMatchObject({ ok: false, status: 502 });
});
it.each([
  [401, "unauthenticated"],
  [404, "shop_not_registered"],
  [500, "internal"],
])("목록 실패 %s/%s를 상태로 전달", async (status, code) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ code }, Number(status))),
  );
  expect(await fetchOperatingRulesVersions()).toMatchObject({ ok: false, status, problem: { code } });
});
it.each([
  [401, "unauthenticated"],
  [404, "not_found"],
  [500, "internal"],
])("버전 실패 %s/%s를 상태로 전달", async (status, code) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ code }, Number(status))),
  );
  expect(await fetchOperatingRulesVersion("1")).toMatchObject({ ok: false, status, problem: { code } });
});

it("서버가 받는 앞자리0 버전은 숫자 경로로 정규화", async () => {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (p: unknown) => {
      calls.push(String(p));
      return json(old());
    }),
  );
  expect(await fetchOperatingRulesVersion("01")).toMatchObject({ ok: true, data: { version: 1 } });
  expect(calls).toEqual(["/api/owner/operating-rules/versions/1"]);
});

it("미확정 템플릿은 버전 상세로 표시하지 않는다", async () => {
  const template =
    contract.paths["/owner/operating-rules"].get.responses[200].content["application/json"].examples.template.value;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json(template)),
  );
  expect(await fetchOperatingRulesVersion("1")).toMatchObject({ ok: false, status: 502 });
});
it("최신 버전 상세도 저장한 현재 메타데이터와 조문을 그대로 읽는다", async () => {
  const current =
    contract.paths["/owner/operating-rules"].get.responses[200].content["application/json"].examples.current.value;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json(current)),
  );
  expect(await fetchOperatingRulesVersion("2")).toMatchObject({ ok: true, data: current });
});
it("목록과 상세 조회의 취소 신호를 공통 요청에 그대로 전달한다", async () => {
  const signals: (AbortSignal | null | undefined)[] = [];
  const controller = new AbortController();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: unknown, init?: RequestInit) => {
      signals.push(init?.signal);
      return json(signals.length === 1 ? versions() : old());
    }),
  );
  await fetchOperatingRulesVersions(controller.signal);
  await fetchOperatingRulesVersion("1", controller.signal);
  expect(signals).toEqual([controller.signal, controller.signal]);
});

it("순서는 맞지만 두 번째 행도 현재인 목록을 거절", async () => {
  const body = versions();
  body.items[1].supersededAt = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json(body)),
  );
  expect(await fetchOperatingRulesVersions()).toMatchObject({ ok: false, status: 502 });
});
