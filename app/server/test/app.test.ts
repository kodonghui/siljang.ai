import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { MAX_JSON_BYTES, readJsonBody } from "../src/body";
import worker from "../src/index";

const TRACE_ID = /^[0-9a-f]{32}$/;

function collectLogs() {
  const lines: string[] = [];
  return { lines, sink: (line: string) => lines.push(line) };
}

describe("기반 시설 경로", () => {
  it("GET /api/healthz는 200과 status ok, 캐시하지 않음", async () => {
    const app = createApp({ logSink: () => {} });
    const res = await app.request("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("Worker 진입점이 같은 앱을 내보낸다", async () => {
    const res = await worker.request("/api/healthz");
    expect(res.status).toBe(200);
  });
});

describe("오류 응답(06 Problem)", () => {
  it("없는 /api 경로는 404 not_found Problem", async () => {
    const app = createApp({ logSink: () => {} });
    const res = await app.request("/api/owner/no-such-thing?x=1");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "/problems/not_found",
      title: "찾을 수 없어요",
      status: 404,
      code: "not_found",
      instance: "/api/owner/no-such-thing",
    });
    expect(String(body.traceId)).toMatch(TRACE_ID);
  });

  it("예상하지 못한 오류는 500 internal이고, 오류 내용은 응답에도 로그에도 싣지 않는다", async () => {
    const secretLike = `sk-ant-api03-${"Wv5".repeat(16)}`;
    const personal = "010-1234-5678";
    const { lines, sink } = collectLogs();
    const app = createApp({ logSink: sink });
    app.get("/boom", () => {
      throw new TypeError(`failed for ${personal} with ${secretLike}`);
    });
    const res = await app.request("/api/boom");
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    const text = await res.text();
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "/problems/internal",
      title: "문제가 생겼어요. 다시 시도해 주세요",
      status: 500,
      code: "internal",
    });
    expect(text).not.toContain(secretLike);
    expect(text).not.toContain(personal);
    const errorLines = lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.level === "error");
    expect(errorLines).toHaveLength(1);
    expect(errorLines[0]).toEqual({
      level: "error",
      event: "unhandled_error",
      traceId: body.traceId,
      errorName: "TypeError",
      status: 500,
    });
    for (const line of lines) {
      expect(line).not.toContain(secretLike);
      expect(line).not.toContain(personal);
    }
  });

  it("첫 요청에서 빠진 비밀 값의 이름만 한 번 남긴다", async () => {
    const { lines, sink } = collectLogs();
    const app = createApp({ logSink: sink });
    const key = `sk-proj-${"Kd3".repeat(16)}`;
    await app.request("/api/healthz", {}, { OPENAI_API_KEY: key });
    await app.request("/api/healthz", {}, { OPENAI_API_KEY: key });
    const starts = lines.filter((l) => l.includes('"settings_loaded"'));
    expect(starts).toHaveLength(1);
    expect(JSON.parse(starts[0] ?? "{}")).toEqual({
      level: "info",
      event: "settings_loaded",
      names: ["ANTHROPIC_API_KEY", "DATABASE_URL", "REQUEST_HASH_KEY"],
    });
    expect(lines.join("\n")).not.toContain(key);
  });

  it("틀린 APP_ENV는 500 internal이고 그 값을 싣지 않는다", async () => {
    const { lines, sink } = collectLogs();
    const app = createApp({ logSink: sink });
    const res = await app.request("/api/healthz", {}, { APP_ENV: "prod-Q9x" });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("prod-Q9x");
    expect(lines.join("\n")).not.toContain("prod-Q9x");
    expect(lines.join("\n")).toContain('"errorName":"SettingsError"');
  });
});

describe("경로는 있지만 방법이 없음(06 DEC-02)", () => {
  it("405 method_not_allowed와 그 경로의 방법을 Allow에", async () => {
    const app = createApp({ logSink: () => {} });
    app.get("/owner/orders/:orderId", (c) => c.json({}));
    app.patch("/owner/orders/:orderId", (c) => c.json({}));
    const res = await app.request("/api/owner/orders/8f7c?x=1", { method: "DELETE" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, PATCH");
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(await res.json()).toMatchObject({
      code: "method_not_allowed",
      status: 405,
      instance: "/api/owner/orders/8f7c",
    });
  });

  it("없는 경로는 방법과 상관없이 404(있는지 알리지 않음)", async () => {
    const app = createApp({ logSink: () => {} });
    app.get("/owner/orders/:orderId", (c) => c.json({}));
    for (const path of ["/api/owner/orders/1/extra", "/api/owner/order/1"]) {
      const res = await app.request(path, { method: "DELETE" });
      expect(res.status).toBe(404);
      expect(res.headers.get("allow")).toBeNull();
    }
  });
});

describe("JSON 본문 읽기", () => {
  function bodyApp() {
    const app = createApp({ logSink: () => {} });
    app.post("/echo", async (c) => c.json({ got: await readJsonBody(c) }));
    return app;
  }

  it("JSON은 그대로 읽음", async () => {
    const res = await bodyApp().request("/api/echo", { method: "POST", body: '{"a":[1,"둘"]}' });
    expect(await res.json()).toEqual({ got: { a: [1, "둘"] } });
  });

  for (const [what, body, reason] of [
    ["빈 본문", "", "bad_json"],
    ["JSON이 아님", "{a:1", "bad_json"],
    ["크기 한도 넘음", `"${"x".repeat(MAX_JSON_BYTES)}"`, "too_long"],
  ] as const) {
    it(`${what} → 422 ${reason}(/), 넣은 값은 응답에 없음`, async () => {
      const res = await bodyApp().request("/api/echo", { method: "POST", body });
      expect(res.status).toBe(422);
      const text = await res.text();
      expect(JSON.parse(text)).toMatchObject({ code: "validation_failed", errors: [{ field: "/", code: reason }] });
      if (body.length > 0) expect(text).not.toContain(body.slice(0, 4));
    });
  }

  it("Content-Length 없이 조각으로 오는 본문도 한도를 넘는 순간 멈추고 too_long", async () => {
    const piece = new TextEncoder().encode("x".repeat(64 * 1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        if (sent > 64) controller.close();
        else controller.enqueue(piece);
      },
    });
    const init = { method: "POST", body: stream, duplex: "half" } as RequestInit;
    const res = await bodyApp().request("/api/echo", init);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ errors: [{ field: "/", code: "too_long" }] });
    // 한도(256 KiB)를 조금 넘긴 곳에서 멈춤: 64조각(4 MiB)을 다 읽지 않음.
    expect(sent).toBeLessThan(10);
  });

  it("Content-Length가 한도보다 크면 읽기 전에 too_long", async () => {
    const req = new Request("http://localhost/api/echo", {
      method: "POST",
      headers: { "content-length": String(MAX_JSON_BYTES + 1) },
      body: "{}",
    });
    const res = await bodyApp().request(req);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ errors: [{ field: "/", code: "too_long" }] });
  });

  it("UTF-8이 아닌 본문 → bad_json", async () => {
    const res = await bodyApp().request("/api/echo", { method: "POST", body: new Uint8Array([0x22, 0xff, 0x22]) });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ errors: [{ field: "/", code: "bad_json" }] });
  });
});
