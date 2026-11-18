import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const origin = "https://example.org";
const asset = "/assets/index-test.js";

function worker(response = new Response("/* app */", { headers: { "content-type": "text/javascript" } })) {
  const events = new Map<string, (event: unknown) => void>();
  const saved = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (request: Request) => saved.get(request.url)),
    put: vi.fn(async (request: Request, value: Response) => {
      saved.set(request.url, value);
    }),
  };
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => ["siljang-assets-old", "siljang-assets-test", "another-app"]),
    delete: vi.fn(async () => true),
  };
  const fetch = vi.fn(async () => response);
  const source = readFileSync(new URL("./pwa-worker.js", import.meta.url), "utf8")
    .replace("/* build-assets */ []", JSON.stringify([asset]))
    .replace("siljang-assets-build", "siljang-assets-test");
  runInNewContext(source, {
    self: {
      location: { origin },
      addEventListener: (type: string, listener: (event: unknown) => void) => events.set(type, listener),
    },
    caches,
    fetch,
    URL,
  });
  function request(path: string, init?: RequestInit) {
    const respondWith = vi.fn<(response: Promise<Response>) => void>();
    events.get("fetch")?.({ request: new Request(new URL(path, origin), init), respondWith });
    return respondWith.mock.calls[0]?.[0];
  }
  return { request, cache, caches, fetch, events };
}

describe("TASK-176 서비스 워커", () => {
  it.each([
    ["/api", "GET"],
    ["/api/operator/me", "GET"],
    ["/api/files/test", "GET"],
    ["/api/operator/login", "POST"],
    ["/owner", "GET"],
    ["/assets/unknown.js", "GET"],
    [asset + "?refresh=1", "GET"],
    ["https://cdn.example.org" + asset, "GET"],
    [asset, "POST"],
  ])("%s %s 요청은 서비스 워커가 처리하지 않음", (path, method) => {
    const w = worker();
    expect(w.request(path, { method })).toBeUndefined();
    expect(w.caches.open).not.toHaveBeenCalled();
    expect(w.fetch).not.toHaveBeenCalled();
  });

  it("빌드 대상 정적 파일만 저장해 이후 같은 파일에 사용", async () => {
    const w = worker();
    expect(await (await w.request(asset))?.text()).toBe("/* app */");
    expect(await (await w.request(asset))?.text()).toBe("/* app */");
    expect(w.cache.put).toHaveBeenCalledOnce();
    expect(w.fetch).toHaveBeenCalledOnce();
  });

  it.each([
    new Response("<html>SPA</html>", { headers: { "content-type": "text/html" } }),
    new Response("gone", { status: 404, headers: { "content-type": "text/javascript" } }),
    new Response("private", { headers: { "content-type": "text/javascript", "cache-control": "private, no-store" } }),
  ])("HTML 대체 페이지·오류·저장 제한 응답은 그대로 전달", async (response) => {
    const w = worker(response);
    expect(await w.request(asset)).toBe(response);
    expect(w.cache.put).not.toHaveBeenCalled();
  });

  it("새 버전이 활성화되면 이전 앱 정적 캐시만 정리", async () => {
    const w = worker();
    const waitUntil = vi.fn<(task: Promise<unknown>) => void>();
    w.events.get("activate")?.({ waitUntil });
    await waitUntil.mock.calls[0]?.[0];
    expect(w.caches.delete.mock.calls).toEqual([["siljang-assets-old"]]);
  });
});
