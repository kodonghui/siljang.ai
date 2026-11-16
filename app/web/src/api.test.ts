import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { API_BASE, apiUrl, newRequestKey, normalizeBase, REPLAYED_HEADER, REQUEST_KEY_HEADER, request } from "./api";

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

interface Seen {
  readonly url: string;
  readonly init: RequestInit;
}

/** 받은 요청을 남기고 정한 응답을 돌려주는 fetch */
function fakeFetch(respond: () => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} });
    return respond();
  }) as typeof globalThis.fetch;
  return { fetch, seen };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": status >= 400 ? "application/problem+json" : "application/json",
      ...headers,
    },
  });

describe("API 주소", () => {
  it("설정이 없으면 같은 출처의 /api", () => {
    expect(API_BASE).toBe(normalizeBase(import.meta.env.VITE_API_BASE));
    expect(normalizeBase(undefined)).toBe("/api");
    expect(normalizeBase("  ")).toBe("/api");
  });

  it("끝의 /는 떼고 계약 경로를 붙인다", () => {
    expect(normalizeBase("https://api.example.test/api/")).toBe("https://api.example.test/api");
    expect(apiUrl("/owner/session", "/api")).toBe("/api/owner/session");
    expect(apiUrl("/owner/orders", "https://api.example.test/api")).toBe("https://api.example.test/api/owner/orders");
  });

  it("계약 경로는 /로 시작해야 한다", () => {
    expect(() => apiUrl("owner/session", "/api")).toThrow();
  });
});

describe("요청 키(04 G2, 06 DEC-04)", () => {
  it("06 IdempotencyKey 꼴이고 부를 때마다 다르다", () => {
    const contract = parse(readFileSync(new URL("../../../api/openapi.yaml", import.meta.url), "utf8")) as {
      components: { parameters: { IdempotencyKey: { name: string; schema: { pattern: string } } } };
    };
    const param = contract.components.parameters.IdempotencyKey;
    expect(param.name).toBe(REQUEST_KEY_HEADER);
    const pattern = new RegExp(param.schema.pattern);
    const keys = new Set(Array.from({ length: 50 }, () => newRequestKey()));
    expect(keys.size).toBe(50);
    for (const key of keys) expect(key).toMatch(pattern);
    expect(newRequestKey((b) => b.fill(255))).toBe(`ui-${"ff".repeat(16)}`);
  });
});

describe("request", () => {
  it("명령은 JSON 본문과 요청 키 헤더를 같은 출처 쿠키와 함께 보낸다", async () => {
    const { fetch, seen } = fakeFetch(() => json(200, { saved: true }));
    const r = await request("/owner/shop", {
      method: "PUT",
      body: { name: "달빛" },
      key: "ui-0123456789abcdef",
      fetch,
    });
    expect(r).toEqual({ ok: true, status: 200, data: { saved: true }, replayed: false });
    expect(seen[0]?.url).toBe(`${API_BASE}/owner/shop`);
    expect(seen[0]?.init.method).toBe("PUT");
    expect(seen[0]?.init.credentials).toBe("same-origin");
    expect(seen[0]?.init.body).toBe(JSON.stringify({ name: "달빛" }));
    expect(seen[0]?.init.headers).toMatchObject({
      accept: "application/json, application/problem+json",
      "content-type": "application/json",
      [REQUEST_KEY_HEADER]: "ui-0123456789abcdef",
    });
  });

  it("읽기는 본문·요청 키 없이 GET", async () => {
    const { fetch, seen } = fakeFetch(() => json(200, []));
    await request("/owner/tasks", { fetch, base: "/api" });
    expect(seen[0]?.url).toBe("/api/owner/tasks");
    expect(seen[0]?.init.method).toBe("GET");
    expect(seen[0]?.init.body).toBeUndefined();
    expect(Object.keys(seen[0]?.init.headers ?? {})).toEqual(["accept"]);
  });

  it("같은 키로 다시 온 응답은 replayed", async () => {
    const { fetch } = fakeFetch(() => json(201, { id: 1 }, { [REPLAYED_HEADER]: "true" }));
    expect(await request("/owner/x", { method: "POST", body: {}, key: "ui-0123456789abcdef", fetch })).toMatchObject({
      ok: true,
      replayed: true,
    });
  });

  it("오류 응답은 06 Problem으로 읽고, 429는 Retry-After 헤더가 먼저", async () => {
    const problem = { type: "/problems/rate_limited", title: "잠시 뒤 다시 시도해 주세요", status: 429 };
    const { fetch } = fakeFetch(() =>
      json(429, { ...problem, code: "rate_limited", traceId: TRACE, retryAfterSeconds: 30 }, { "retry-after": "12" }),
    );
    const r = await request("/owner/x", { method: "POST", body: {}, key: "ui-0123456789abcdef", fetch });
    expect(r).toMatchObject({ ok: false, status: 429, retryAfterSeconds: 12, problem: { code: "rate_limited" } });
    const noHeader = fakeFetch(() => json(429, { ...problem, code: "rate_limited", retryAfterSeconds: 30 }));
    expect(await request("/owner/x", { fetch: noHeader.fetch })).toMatchObject({ retryAfterSeconds: 30 });
  });

  it("Problem이 아닌 오류·읽을 수 없는 성공 본문은 problem 없는 실패", async () => {
    const html = fakeFetch(() => new Response("<html>Bad Gateway</html>", { status: 502 }));
    expect(await request("/owner/x", { fetch: html.fetch })).toEqual({
      ok: false,
      status: 502,
      problem: null,
      retryAfterSeconds: null,
    });
    const broken = fakeFetch(() => new Response("{", { status: 200 }));
    expect(await request("/owner/x", { fetch: broken.fetch })).toMatchObject({ ok: false, status: 200, problem: null });
    const empty = fakeFetch(() => new Response(null, { status: 204 }));
    expect(await request("/owner/x", { fetch: empty.fetch })).toEqual({
      ok: true,
      status: 204,
      data: null,
      replayed: false,
    });
  });

  it("연결 실패는 던지지 않고 status 0, 멈춘(abort) 요청만 던진다", async () => {
    const down = fakeFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await request("/owner/x", { fetch: down.fetch })).toEqual({
      ok: false,
      status: 0,
      problem: null,
      retryAfterSeconds: null,
    });
    const controller = new AbortController();
    controller.abort();
    const aborted = fakeFetch(() => Promise.reject(new DOMException("aborted", "AbortError")));
    await expect(request("/owner/x", { fetch: aborted.fetch, signal: controller.signal })).rejects.toThrow("aborted");
  });
});
