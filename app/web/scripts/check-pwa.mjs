// 설치 가능 여부와 정적 캐시의 동작을 로컬 운영 빌드에서 검사한다.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { preview } from "vite";

const { chromium } = createRequire(import.meta.url)("playwright");
const root = fileURLToPath(new URL("..", import.meta.url));
let apiRequests = 0;
const server = await preview({
  root,
  logLevel: "error",
  preview: { host: "127.0.0.1", port: 0 },
  plugins: [
    {
      name: "pwa-check-api",
      configurePreviewServer({ middlewares }) {
        middlewares.use("/api/pwa-check", (_req, res) => {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ number: ++apiRequests }));
        });
      },
    },
  ],
});

try {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const base = server.resolvedUrls.local[0];
    await page.goto(new URL("/owner", base).href);
    const cdp = await context.newCDPSession(page);
    const install = await cdp.send("Page.getInstallabilityErrors");
    assert.deepEqual(install.installabilityErrors, []);
    const manifest = await page.evaluate(async () => {
      const link = document.querySelector('link[rel="manifest"]');
      return (await fetch(link.href)).json();
    });
    assert.equal(manifest.start_url, "/owner");
    assert.equal(manifest.display, "standalone");
    assert.deepEqual(
      manifest.icons.map(({ sizes }) => sizes),
      ["192x192", "512x512"],
    );
    await page.evaluate(() => {
      return Promise.race([
        navigator.serviceWorker.ready.then(() => true),
        new Promise((_, reject) => setTimeout(() => reject(new Error("service worker 준비 시간 초과")), 5000)),
      ]);
    });
    await page.reload();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

    const observed = await page.evaluate(async () => {
      const read = async () => (await (await fetch("/api/pwa-check")).json()).number;
      const before = [await read(), await read()];
      const asset = document.querySelector('script[type="module"][src]').src;
      await fetch(asset);
      const entries = await Promise.all(
        (await caches.keys()).map(async (name) =>
          (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname),
        ),
      );
      return { before, asset, paths: entries.flat() };
    });
    assert.deepEqual(observed.before, [1, 2]);
    assert.ok(observed.paths.includes(new URL(observed.asset).pathname));
    assert.ok(observed.paths.every((path) => path.startsWith("/assets/")));

    await context.setOffline(true);
    const offline = await page.evaluate(async (asset) => {
      const staticResponse = await fetch(asset);
      const apiAvailable = await fetch("/api/pwa-check").then(
        () => true,
        () => false,
      );
      return { static: staticResponse.ok, api: apiAvailable };
    }, observed.asset);
    assert.deepEqual(offline, { static: true, api: false });
    console.log("check-pwa: Chromium 설치 오류 0 · 정적 캐시 통과 · API 캐시 0건");
  } finally {
    await browser.close();
  }
} finally {
  await new Promise((resolve, reject) => server.httpServer.close((error) => (error ? reject(error) : resolve())));
}
