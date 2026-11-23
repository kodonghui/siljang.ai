import { expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { fromBase64Url } from "../src/encoding";
import { fileUrlSigner } from "../src/file-url";
import { Secret } from "../src/settings";
import { expectProblem } from "./support/contract";
import { newUuid, testEnv } from "./support/db";
import { MemoryLimiter } from "./support/rate-limit";
import { MemoryStore } from "./support/storage";

const KEY = ["public", "file", "test", "z".repeat(32)].join("-");
const ORIGIN = "https://siljang.example.test";
const START = new Date("2026-11-23T04:32:30Z");
const NOW = new Date("2026-11-23T04:33:30.123Z");
const NEXT_INTERVAL = new Date("2026-11-23T04:35:00Z");
const EXPIRY = new Date("2026-11-23T04:37:30Z");
const objectKey = () => `shops/${newUuid()}/completion_photo/example.png`;
function parts(url: string) {
  const u = new URL(url);
  return {
    token: u.pathname.split("/").at(-1) ?? "",
    exp: u.searchParams.get("exp") ?? undefined,
    sig: u.searchParams.get("sig") ?? undefined,
  };
}

it.each([
  ["구간 시작 직후", new Date(START.getTime() + 1)],
  ["구간 중간", new Date(START.getTime() + 75_000)],
  ["구간 끝 1초 전", new Date(NEXT_INTERVAL.getTime() - 1_000)],
])("공개 포트폴리오 주소 수명은 %s에 발급해도 150~300초", async (_position, now) => {
  const urls = fileUrlSigner(new Secret(KEY));
  const key = objectKey();
  const { token, exp, sig } = parts(await urls.signPublic(key, ORIGIN, now));
  const lifetime = (Number(exp) * 1000 - now.getTime()) / 1000;
  expect(lifetime).toBeGreaterThanOrEqual(150);
  expect(lifetime).toBeLessThanOrEqual(300);
  expect(await urls.openPublic(token, exp, sig, now)).toEqual({ key, exp: EXPIRY.getTime() / 1000 });
});

it("공개 포트폴리오는 같은 150초 구간에 같은 주소를 내고 다음 구간에 갱신함", async () => {
  const a = fileUrlSigner(new Secret(KEY)),
    b = fileUrlSigner(new Secret(KEY));
  const key = objectKey();
  const first = await a.signPublic(key, ORIGIN, NOW);
  expect(new URL(first).pathname).toMatch(/^\/api\/files\/public\/v1\//);
  expect(await b.signPublic(key, ORIGIN, new Date(NEXT_INTERVAL.getTime() - 1))).toBe(first);
  expect(Number(parts(first).exp)).toBe(EXPIRY.getTime() / 1000);
  expect(first).not.toContain(key);
  expect(first.length).toBeLessThanOrEqual(2048);
  const next = await a.signPublic(key, ORIGIN, NEXT_INTERVAL);
  expect(next).not.toBe(first);
  expect(Number(parts(next).exp)).toBe((EXPIRY.getTime() + 150_000) / 1000);
  const { token, exp, sig } = parts(first);
  expect(await a.openPublic(token, exp, sig, NEXT_INTERVAL)).toEqual({ key, exp: Number(exp) });
  const nextParts = parts(next);
  expect(await a.openPublic(nextParts.token, nextParts.exp, nextParts.sig, NEXT_INTERVAL)).toEqual({
    key,
    exp: Number(nextParts.exp),
  });
});

it("공개 전용 암호화·서명·IV 키를 분리하고 저장 위치나 기한이 다르면 IV가 달라짐", async () => {
  const urls = fileUrlSigner(new Secret(KEY)),
    key = objectKey();
  const first = parts(await urls.signPublic(key, ORIGIN, NOW));
  const other = parts(await urls.signPublic(objectKey(), ORIGIN, NOW));
  const next = parts(await urls.signPublic(key, ORIGIN, NEXT_INTERVAL));
  const iv = (token: string) => [...(fromBase64Url(token)?.subarray(0, 12) ?? [])];
  expect(iv(first.token)).toHaveLength(12);
  expect(iv(first.token)).not.toEqual(iv(other.token));
  expect(iv(first.token)).not.toEqual(iv(next.token));
  expect(await urls.open(first.token, first.exp, first.sig, NOW)).toBeNull();
  const privateParts = parts(await urls.sign(key, ORIGIN, NOW));
  expect(await urls.openPublic(privateParts.token, privateParts.exp, privateParts.sig, NOW)).toBeNull();
  expect(await urls.openPublic(first.token, first.exp, first.sig, NOW)).toEqual({ key, exp: Number(first.exp) });
});

it("공개 주소의 만료·기한 연장·다른 사진 서명 붙이기·다른 키는 거절함", async () => {
  const urls = fileUrlSigner(new Secret(KEY));
  const a = parts(await urls.signPublic(objectKey(), ORIGIN, NOW));
  const b = parts(await urls.signPublic(objectKey(), ORIGIN, NOW));
  expect(await urls.openPublic(a.token, a.exp, a.sig, EXPIRY)).toBeNull();
  expect(await urls.openPublic(a.token, String(Number(a.exp) + 300), a.sig, NOW)).toBeNull();
  expect(await urls.openPublic(a.token, a.exp, b.sig, NOW)).toBeNull();
  expect(await fileUrlSigner(new Secret(`${KEY}-other`)).openPublic(a.token, a.exp, a.sig, NOW)).toBeNull();
});

it("공개 사진은 남은 정수 초까지만 캐시하고 기한에는 404를 반환함", async () => {
  const urls = fileUrlSigner(new Secret(KEY)),
    store = new MemoryStore(),
    clock = { now: NOW };
  const key = objectKey();
  await store.put(key, new Uint8Array([1, 2, 3]), "image/png");
  const app = createApp({
    logSink: () => {},
    services: { storage: store, now: () => clock.now, limiters: { FILE_RATE_LIMITER: new MemoryLimiter(600) } },
  });
  const env = testEnv({ FILE_URL_KEY: KEY });
  const url = await urls.signPublic(key, ORIGIN, NOW);
  const response = await app.request(url, {}, env);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("public, max-age=239, s-maxage=239, must-revalidate");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  expect(response.headers.get("expires")).toBe(EXPIRY.toUTCString());
  clock.now = EXPIRY;
  await expectProblem(await app.request(url, {}, env), "not_found");
});

it("남은 기한이 300초를 1ms라도 넘거나 기한이 150초의 배수가 아니면 404를 반환함", async () => {
  const store = new MemoryStore();
  const clock = { now: new Date(START.getTime() - 1) };
  const key = objectKey();
  await store.put(key, new Uint8Array([1]), "image/png");
  const app = createApp({
    logSink: () => {},
    services: { storage: store, now: () => clock.now, limiters: { FILE_RATE_LIMITER: new MemoryLimiter(600) } },
  });
  const env = testEnv({ FILE_URL_KEY: KEY });
  const url = await fileUrlSigner(new Secret(KEY)).signPublic(key, ORIGIN, START);
  await expectProblem(await app.request(url, {}, env), "not_found");
  expect(store.calls).not.toContain("get");

  clock.now = START;
  expect((await app.request(url, {}, env)).status).toBe(200);
  const unaligned = new URL(url);
  unaligned.searchParams.set("exp", String(EXPIRY.getTime() / 1000 - 1));
  const verify = vi.spyOn(crypto.subtle, "verify");
  try {
    await expectProblem(await app.request(unaligned.toString(), {}, env), "not_found");
    expect(verify).not.toHaveBeenCalled();
  } finally {
    verify.mockRestore();
  }
});

it("두 파일 경로는 같은IP 한도를 먼저 세고429/Retry-After를 내며 다른IP는 따로 셈", async () => {
  const limiter = new MemoryLimiter(2),
    store = new MemoryStore();
  const app = createApp({
    logSink: () => {},
    services: { storage: store, now: () => NOW, limiters: { FILE_RATE_LIMITER: limiter } },
  });
  const env = testEnv({ FILE_URL_KEY: KEY });
  const get = (path: string, ip = "192.0.2.7") => app.request(path, { headers: { "cf-connecting-ip": ip } }, env);
  await expectProblem(await get("/api/files/v1/invalid"), "not_found");
  await expectProblem(await get("/api/files/public/v1/invalid"), "not_found");
  const limited = await get("/api/files/v1/invalid");
  await expectProblem(limited, "rate_limited");
  expect(limited.headers.get("retry-after")).toBe("60");
  await expectProblem(await get("/api/files/public/v1/invalid", "192.0.2.8"), "not_found");
  expect([...limiter.counts.keys()].some((key) => key.includes("192.0.2"))).toBe(false);
  expect(store.calls).not.toContain("get");
});

it("파일 한도 바인딩이 없으면 저장소를 읽기 전에 실패함", async () => {
  const store = new MemoryStore();
  const app = createApp({ logSink: () => {}, services: { storage: store } });
  await expectProblem(
    await app.request("/api/files/public/v1/invalid", {}, testEnv({ FILE_URL_KEY: KEY })),
    "internal",
  );
  expect(store.calls).not.toContain("get");
});

it("저장소 응답 도중 만료되면 사진/공개 캐시를 내지 않음", async () => {
  const store = new MemoryStore(),
    clock = { now: new Date(EXPIRY.getTime() - 50) };
  const key = objectKey();
  await store.put(key, new Uint8Array([1]), "image/png");
  const cancelled = vi.fn();
  vi.spyOn(store, "get").mockImplementation(async () => {
    clock.now = EXPIRY;
    return { key, contentType: "image/png", size: 1, body: new ReadableStream<Uint8Array>({ cancel: cancelled }) };
  });
  const app = createApp({
    logSink: () => {},
    services: { storage: store, now: () => clock.now, limiters: { FILE_RATE_LIMITER: new MemoryLimiter(600) } },
  });
  const url = await fileUrlSigner(new Secret(KEY)).signPublic(key, ORIGIN, NOW);
  await expectProblem(await app.request(url, {}, testEnv({ FILE_URL_KEY: KEY })), "not_found");
  expect(cancelled).toHaveBeenCalledOnce();
});
