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
const NOW = new Date("2026-11-23T04:31:00.123Z");
const END = new Date("2026-11-23T04:35:00Z");
const objectKey = () => `shops/${newUuid()}/completion_photo/example.png`;
function parts(url: string) {
  const u = new URL(url);
  return {
    token: u.pathname.split("/").at(-1) ?? "",
    exp: u.searchParams.get("exp") ?? undefined,
    sig: u.searchParams.get("sig") ?? undefined,
  };
}

it("공개 포트폴리오는 같은5분 구간/다른 손님·실행기의 주소가 같고 구간 끝을 넘지 않음", async () => {
  const a = fileUrlSigner(new Secret(KEY)),
    b = fileUrlSigner(new Secret(KEY));
  const key = objectKey();
  const first = await a.signPublic(key, ORIGIN, NOW);
  expect(new URL(first).pathname).toMatch(/^\/api\/files\/public\/v1\//);
  expect(await b.signPublic(key, ORIGIN, new Date(END.getTime() - 1))).toBe(first);
  expect(Number(parts(first).exp)).toBe(END.getTime() / 1000);
  expect(first).not.toContain(key);
  expect(first.length).toBeLessThanOrEqual(2048);
  expect(await a.signPublic(key, ORIGIN, END)).not.toBe(first);
});

it("공개 전용 암호화/서명/IV 키를 분리하고 저장 위치나 구간이 다르면 IV도 달라짐", async () => {
  const urls = fileUrlSigner(new Secret(KEY)),
    key = objectKey();
  const first = parts(await urls.signPublic(key, ORIGIN, NOW));
  const other = parts(await urls.signPublic(objectKey(), ORIGIN, NOW));
  const next = parts(await urls.signPublic(key, ORIGIN, END));
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
  expect(await urls.openPublic(a.token, a.exp, a.sig, END)).toBeNull();
  expect(await urls.openPublic(a.token, String(Number(a.exp) + 300), a.sig, NOW)).toBeNull();
  expect(await urls.openPublic(a.token, a.exp, b.sig, NOW)).toBeNull();
  expect(await fileUrlSigner(new Secret(`${KEY}-other`)).openPublic(a.token, a.exp, a.sig, NOW)).toBeNull();
});

it("공개 사진만 남은 기한 이내로 공개 캐시하고 기한에는404임", async () => {
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
  clock.now = END;
  await expectProblem(await app.request(url, {}, env), "not_found");
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
    clock = { now: new Date(END.getTime() - 50) };
  const key = objectKey();
  await store.put(key, new Uint8Array([1]), "image/png");
  const get = store.get.bind(store);
  vi.spyOn(store, "get").mockImplementation(async (value) => {
    const result = await get(value);
    clock.now = END;
    return result;
  });
  const app = createApp({
    logSink: () => {},
    services: { storage: store, now: () => clock.now, limiters: { FILE_RATE_LIMITER: new MemoryLimiter(600) } },
  });
  const url = await fileUrlSigner(new Secret(KEY)).signPublic(key, ORIGIN, NOW);
  await expectProblem(await app.request(url, {}, testEnv({ FILE_URL_KEY: KEY })), "not_found");
  expect(store.calls).toContain("get");
});
