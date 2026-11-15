import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
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
      names: ["ANTHROPIC_API_KEY"],
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
