const cachePrefix = "siljang-assets-";
const cacheName = "siljang-assets-build";
const assets = new Set(/* build-assets */ []);

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((name) => name.startsWith(cachePrefix) && name !== cacheName).map((name) => caches.delete(name)),
        ),
      ),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    request.mode === "navigate" ||
    request.cache === "no-store" ||
    request.headers.has("range") ||
    url.origin !== self.location.origin ||
    url.search ||
    !assets.has(url.pathname)
  ) {
    return;
  }
  event.respondWith(staticResponse(request));
});

async function staticResponse(request) {
  const cache = await caches.open(cacheName).catch(() => undefined);
  const cached = await cache?.match(request).catch(() => undefined);
  if (cached) return cached;
  const response = await fetch(request);
  const type = response.headers.get("content-type") ?? "";
  const cacheControl = response.headers.get("cache-control") ?? "";
  if (
    cache &&
    response.status === 200 &&
    !response.redirected &&
    /^(?:text\/(?:css|javascript)\b|application\/(?:javascript|wasm|font-woff)\b|font\/|image\/)/i.test(type) &&
    !/\b(?:no-store|private)\b/i.test(cacheControl)
  ) {
    await cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}
