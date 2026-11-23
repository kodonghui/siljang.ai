import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { FILE_URL_TTL_SECONDS, fileUrlSigner } from "../src/file-url";
import { Secret } from "../src/settings";
import { comparableProblem, expectProblem } from "./support/contract";
import { newUuid, testEnv } from "./support/db";
import * as img from "./support/images";
import { MemoryLimiter } from "./support/rate-limit";
import { MemoryStore } from "./support/storage";

// 사진의 15분 서명 주소(TASK-022; 06 DEC-09 '저장 위치는 포함하지 않음', licensePhotoUrl 등 format uri·2048자).

/** 시험용 키(저장소 글에 키 꼴이 남지 않게 실행 중에 만든다). */
const KEY = ["file", "url", "test", "x".repeat(32)].join("-");
const OTHER_KEY = ["file", "url", "other", "y".repeat(32)].join("-");
const T0 = new Date("2026-11-12T01:03:00.000Z");
const ORIGIN = "https://siljang.example.test";

function parts(url: string) {
  const u = new URL(url);
  const token = u.pathname.split("/").at(-1) ?? "";
  return { u, token, exp: u.searchParams.get("exp") ?? undefined, sig: u.searchParams.get("sig") ?? undefined };
}

describe("서명 주소 만들기와 열기", () => {
  const urls = fileUrlSigner(new Secret(KEY));
  const shop = newUuid();
  const key = `shops/${shop}/license_photo/upl_0123456789abl${"A".repeat(22)}`;

  it("주소는 같은 주소의 /api/files/v1/<token>?exp&sig이고 저장 위치·가게 ID가 보이지 않으며 2048자 안", async () => {
    const url = await urls.sign(key, `${ORIGIN}/api/owner/shop`, T0);
    const { u, token, exp, sig } = parts(url);
    expect(u.origin).toBe(ORIGIN);
    expect(u.pathname).toBe(`/api/files/v1/${token}`);
    expect(Number(exp)).toBe(Math.floor(T0.getTime() / 1000) + FILE_URL_TTL_SECONDS);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(url.length).toBeLessThanOrEqual(2048);
    for (const hidden of [shop, "shops/", "license_photo", "upl_"]) expect(url).not.toContain(hidden);
    // 같은 저장 위치도 주소마다 다름(감싼 값이 매번 다름)
    expect(await urls.sign(key, ORIGIN, T0)).not.toBe(url);
  });

  it("맞는 주소는 15분 동안 저장 위치를 돌려주고, 15분이 되면 null", async () => {
    const { token, exp, sig } = parts(await urls.sign(key, ORIGIN, T0));
    const last = new Date(T0.getTime() + FILE_URL_TTL_SECONDS * 1000 - 1);
    expect(await urls.open(token, exp, sig, last)).toEqual({ key, exp: Number(exp) });
    expect(await urls.open(token, exp, sig, new Date(T0.getTime() + FILE_URL_TTL_SECONDS * 1000))).toBeNull();
  });

  it("기한을 늘리거나, 서명·토큰을 바꾸거나, 다른 키로 만든 주소는 null", async () => {
    const { token, exp, sig } = parts(await urls.sign(key, ORIGIN, T0));
    const other = parts(await urls.sign(`shops/${newUuid()}/design_image/x`, ORIGIN, T0));
    const flip = (s: string) => `${s.slice(0, -1)}${s.at(-1) === "0" ? "1" : "0"}`;
    const cases: [string, string | undefined, string | undefined][] = [
      [token, String(Number(exp) + 3600), sig],
      [token, exp, flip(sig ?? "")],
      [flip(token), exp, sig],
      [other.token, exp, sig],
      [token, exp, other.sig],
      [token, undefined, sig],
      [token, exp, undefined],
      [token, "0", sig],
      [token, "1e12", sig],
      [token, exp, (sig ?? "").toUpperCase()],
      ["short", exp, sig],
    ];
    for (const [t, e, s] of cases)
      expect(await urls.open(t, e, s, T0), `${t.slice(0, 8)} ${e} ${s?.slice(0, 8)}`).toBeNull();
    const foreign = fileUrlSigner(new Secret(OTHER_KEY));
    expect(await foreign.open(token, exp, sig, T0)).toBeNull();
  });

  it("우리 꼴이 아닌 저장 위치는 서명하지 않음", async () => {
    await expect(urls.sign("../etc/passwd", ORIGIN, T0)).rejects.toThrow(TypeError);
    await expect(urls.sign("a//b", ORIGIN, T0)).rejects.toThrow(TypeError);
  });
});

describe("GET /api/files/v1/:token(서명 주소로 사진 내기)", () => {
  function setup() {
    const store = new MemoryStore();
    const clock = { now: T0 };
    const app = createApp({
      logSink: () => {},
      services: { storage: store, now: () => clock.now, limiters: { FILE_RATE_LIMITER: new MemoryLimiter(600) } },
    });
    const env = testEnv({ FILE_URL_KEY: KEY });
    const urls = fileUrlSigner(new Secret(KEY));
    const get = (url: string) => app.request(new URL(url).pathname + new URL(url).search, {}, env);
    return { store, clock, app, env, urls, get };
  }

  it("맞는 주소는 사진을 내고 캐시는 그 사람 브라우저에만 남은 시간까지, nosniff", async () => {
    const { store, urls, get, clock } = setup();
    const bytes = img.jpeg(4096);
    const key = `shops/${newUuid()}/license_photo/upl_x`;
    await store.put(key, bytes, "image/jpeg");
    const url = await urls.sign(key, ORIGIN, T0);
    clock.now = new Date(T0.getTime() + 60_000);
    const res = await get(url);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    expect(Object.fromEntries(res.headers)).toMatchObject({
      "content-type": "image/jpeg",
      "content-length": "4096",
      "content-disposition": "inline",
      "cache-control": `private, max-age=${FILE_URL_TTL_SECONDS - 60}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cross-origin-resource-policy": "same-origin",
    });
  });

  it("사진이 아닌 종류로 저장된 것은 내려받기로만(브라우저가 열지 않음)", async () => {
    const { store, urls, get } = setup();
    const key = `shops/${newUuid()}/license_photo/upl_y`;
    await store.put(key, img.text(), "text/html");
    const res = await get(await urls.sign(key, ORIGIN, T0));
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toBe("attachment");
  });

  it("지난 주소·바꾼 주소·없는 파일은 모두 같은 404 not_found", async () => {
    const { store, urls, get, clock } = setup();
    const key = `shops/${newUuid()}/completion_photo/upl_z`;
    await store.put(key, img.png(), "image/png");
    const url = await urls.sign(key, ORIGIN, T0);
    const missing = await urls.sign(`shops/${newUuid()}/completion_photo/upl_none`, ORIGIN, T0);
    const bodies: Record<string, unknown>[] = [];
    bodies.push(await expectProblem(await get(url.replace(/sig=[0-9a-f]/, "sig=g")), "not_found"));
    bodies.push(await expectProblem(await get(missing), "not_found"));
    clock.now = new Date(T0.getTime() + FILE_URL_TTL_SECONDS * 1000);
    bodies.push(await expectProblem(await get(url), "not_found"));
    const first = comparableProblem(bodies[0] ?? {});
    for (const b of bodies) expect(comparableProblem(b)).toEqual(first);
  });

  it("저장소가 답하지 않으면 503, FILE_URL_KEY가 없으면 500", async () => {
    const { store, urls, get, app } = setup();
    const key = `shops/${newUuid()}/design_image/upl_w`;
    await store.put(key, img.webp(), "image/webp");
    const url = await urls.sign(key, ORIGIN, T0);
    store.failOn.add("get");
    await expectProblem(await get(url), "storage_unavailable");
    const u = new URL(url);
    await expectProblem(await app.request(u.pathname + u.search, {}, testEnv()), "internal");
  });
});
