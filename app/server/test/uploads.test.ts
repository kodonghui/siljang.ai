import { readFileSync } from "node:fs";
import { load } from "exifreader";
import { describe, expect, it } from "vitest";
import { APP_ROUTES, createApp } from "../src/app";
import { createOwnerScope, type OwnerScope } from "../src/owner-scope";
import { ApiError } from "../src/problem";
import type { RateLimiter } from "../src/rate-limit";
import { ownerRoute, type RouteDecl } from "../src/routes";
import { isUuid } from "../src/shop-scope";
import { type ObjectList, type ObjectStore, StorageUnavailableError } from "../src/storage";
import {
  CONTRACT_UPLOAD_ID,
  checkUploads,
  discardUpload,
  MAX_UPLOAD_BODY,
  newUploadId,
  parseUploadId,
  permanentKey,
  promoteUpload,
  sniffImage,
  type TakenUpload,
  tempKey,
  UNUSED_UPLOAD_LIMIT,
  UPLOAD_RULES,
  UPLOAD_TTL_MS,
  type UploadPurpose,
  unusedUploads,
} from "../src/uploads";
import { comparableProblem, expectProblem, expectSchema } from "./support/contract";
import { collectLogs, newUuid, testEnv } from "./support/db";
import * as img from "./support/images";
import { MemoryLimiter } from "./support/rate-limit";
import { brokenS3, MemoryStore } from "./support/storage";

// 사진 올리기(TASK-022; 06 API-007의 응답 201·401·413·422·429·503·default, DEC-09·DEC-16·DEC-02, SPEC-068 [입력], M18).
// 사장님 세션(TASK-020) 전이라 시험용 해석기(헤더의 사장님 ID)와 메모리 저장소·메모리 한도로 앱을 부른다.

const OWNER = "x-test-owner";
const MIB = 1024 * 1024;
/** 서울 2026-11-12 10:03(06 예시의 expiresAt 11:03 +09:00이 나오는 시각). */
const T0 = new Date("2026-11-12T01:03:00.000Z");

/** 명령이 올린 파일을 쓰는 모습(시험용 경로): 받은 ID들을 보고, 가게의 영구 위치로 옮기고, 임시 파일을 지운다. */
const USE_ROUTE = ownerRoute("POST", "/test/owner/use-uploads", async (r) => {
  const body = (await r.req.json()) as { shopId: string; uploads: { id: unknown; purpose: UploadPurpose }[] };
  const store = r.services.storage();
  const refs = body.uploads.map((u, i) => ({ field: `/uploads/${i}/uploadId`, id: u.id, purpose: u.purpose }));
  const taken = await checkUploads(store, r.owner, refs, r.services.now());
  let moved = 0;
  for (const t of taken) {
    await promoteUpload(store, t, body.shopId);
    moved += 1;
  }
  for (const t of taken) await discardUpload(store, t);
  return r.json({ moved });
});

interface Harness {
  readonly app: ReturnType<typeof createApp>;
  readonly store: MemoryStore;
  readonly limiter: MemoryLimiter;
  readonly clock: { now: Date };
}

function harness(options: { timeZone?: string; limit?: number } = {}): Harness {
  const store = new MemoryStore();
  const limiter = new MemoryLimiter(options.limit ?? 30);
  const clock = { now: T0 };
  const app = createApp({
    logSink: () => {},
    routes: [...APP_ROUTES, USE_ROUTE],
    ownerAccount: async (c) => {
      const id = c.req.header(OWNER);
      if (id === undefined || !isUuid(id)) throw new ApiError("unauthenticated");
      return createOwnerScope(id, options.timeZone);
    },
    services: { storage: store, limiters: { UPLOAD_RATE_LIMITER: limiter }, now: () => clock.now },
  });
  return { app, store, limiter, clock };
}

const photo = (bytes: Uint8Array, name = "photo.jpg", type = "image/jpeg") => new File([bytes], name, { type });

function send(h: Harness, owner: string | null, parts: readonly (readonly [string, string | File])[]) {
  const fd = new FormData();
  for (const [name, value] of parts) fd.append(name, value);
  return h.app.request(
    "/api/owner/uploads",
    { method: "POST", body: fd, headers: owner === null ? {} : { [OWNER]: owner } },
    testEnv(),
  );
}

const upload = (h: Harness, owner: string, purpose: string, bytes: Uint8Array) =>
  send(h, owner, [
    ["purpose", purpose],
    ["file", photo(bytes)],
  ]);

async function uploaded(res: Response): Promise<{ uploadId: string; [k: string]: unknown }> {
  const text = await res.text();
  expect(res.status, text).toBe(201);
  return JSON.parse(text) as { uploadId: string };
}

function use(h: Harness, owner: string, shopId: string, uploads: { id: unknown; purpose: UploadPurpose }[]) {
  return h.app.request(
    "/api/test/owner/use-uploads",
    {
      method: "POST",
      headers: { [OWNER]: owner, "content-type": "application/json" },
      body: JSON.stringify({ shopId, uploads }),
    },
    testEnv(),
  );
}

describe("API-007 201: 용도마다 받는 종류를 내용으로 보고 uploadId를 줌(06 DEC-09)", () => {
  const cases: [UploadPurpose, () => Uint8Array, string][] = [
    ["license_photo", img.jpeg, "image/jpeg"],
    ["license_photo", img.png, "image/png"],
    ["license_photo", img.heic, "image/heic"],
    ["license_photo", img.heifWithHeic, "image/heic"],
    ["design_image", img.jpeg, "image/jpeg"],
    ["design_image", img.png, "image/png"],
    ["design_image", img.heic, "image/heic"],
    ["design_image", img.webp, "image/webp"],
    ["completion_photo", img.jpeg, "image/jpeg"],
    ["completion_photo", img.png, "image/png"],
    ["completion_photo", img.heic, "image/heic"],
    ["completion_photo", img.webp, "image/webp"],
  ];
  for (const [purpose, make, type] of cases) {
    it(`${purpose} ${type}`, async () => {
      const h = harness();
      const owner = newUuid();
      const bytes = make();
      // 파일 이름·Content-Type은 보지 않는다(일부러 틀리게 보냄)
      const res = await send(h, owner, [
        ["purpose", purpose],
        ["file", photo(bytes, "x.txt", "text/plain")],
      ]);
      expect(res.headers.get("content-type")).toMatch(/^application\/json/);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = await uploaded(res);
      expectSchema("Upload", body);
      expect(body).toEqual({
        uploadId: expect.stringMatching(CONTRACT_UPLOAD_ID),
        purpose,
        contentType: type,
        byteSize: bytes.byteLength,
        expiresAt: "2026-11-12T11:03:00+09:00",
      });
      // 저장 위치는 응답에 없고(DEC-09), 임시 위치에 내용으로 본 종류로 들어감
      expect(JSON.stringify(body)).not.toContain("tmp/");
      expect(JSON.stringify(body)).not.toContain(owner);
      const key = tempKey(createOwnerScope(owner), body.uploadId);
      expect(h.store.keys()).toEqual([key]);
      expect(h.store.objects.get(key)?.contentType).toBe(type);
      expect(h.store.objects.get(key)?.body).toEqual(bytes);
    });
  }

  it("expiresAt은 사장님의 시간대(가게 시간대)로 1시간 뒤(06 DEC-15)", async () => {
    const h = harness({ timeZone: "America/New_York" });
    const body = await uploaded(await upload(h, newUuid(), "design_image", img.png()));
    expect(body.expiresAt).toBe("2026-11-11T21:03:00-05:00");
  });

  it("한도 바로 아래는 받음: 신고증 10MB, 완성 사진 20MB", async () => {
    const h = harness();
    const owner = newUuid();
    const license = await uploaded(await upload(h, owner, "license_photo", img.jpeg(10 * MIB)));
    expect(license.byteSize).toBe(UPLOAD_RULES.license_photo.maxBytes);
    const completion = await uploaded(await upload(h, owner, "completion_photo", img.jpeg(20 * MIB)));
    expect(completion.byteSize).toBe(20 * MIB);
  });
});

describe("TASK-183: API-007이 G10을 적용한 바이트만 저장", () => {
  const photos = ["jpg", "png", "heic", "webp"] as const;
  const fixture = (format: (typeof photos)[number]) =>
    readFileSync(new URL(`./fixtures/photos/metadata.${format}`, import.meta.url));

  it.each(photos)("%s: 위치·기기·촬영 시각과 XMP를 제거한 결과로 201", async (format) => {
    const original = fixture(format);
    const before = await load(original, { expanded: true, async: true });
    expect(before.exif?.Make?.description).toBe("Fictional Camera");
    expect(before.exif?.Model?.description).toBe("Synthetic Device");
    expect(before.exif?.DateTimeOriginal?.description).toBe("2001:02:03 04:05:06");
    expect(before.gps).toMatchObject({ Latitude: 1.25, Longitude: 2.5 });
    expect(before.xmp?._raw).toContain("Synthetic caption");

    const h = harness();
    const owner = newUuid();
    const body = await uploaded(await upload(h, owner, "design_image", original));
    expectSchema("Upload", body);
    const key = tempKey(createOwnerScope(owner), body.uploadId);
    const saved = h.store.objects.get(key)?.body;
    expect(saved).toBeDefined();
    if (saved === undefined) throw new Error("missing stored image");
    expect(body.byteSize).toBe(saved.length);
    const after = await load(saved.slice().buffer, { expanded: true, async: true });
    expect(after.exif).toBeUndefined();
    expect(after.gps).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    const savedText = Buffer.from(saved).toString("latin1");
    for (const marker of ["Fictional Camera", "Synthetic Device", "2001:02:03", "Synthetic caption"]) {
      expect(savedText).not.toContain(marker);
    }
  });

  it.each(photos)("%s: 시그니처 뒤가 잘린 파일에는 422, 저장 없음", async (format) => {
    const h = harness();
    const res = await upload(h, newUuid(), "design_image", fixture(format).subarray(0, 40));
    expect((await expectProblem(res, "validation_failed")).errors).toEqual([
      { field: "/file", code: "not_allowed" },
    ]);
    expect(h.store.keys()).toEqual([]);
  });
});

describe("API-007 401: 사장님 세션이 없으면 닫혀 있음", () => {
  it("해석기가 사장님을 찾지 못하면 unauthenticated이고 저장소·한도를 건드리지 않음", async () => {
    const h = harness();
    await expectProblem(await upload(h, "not-a-uuid", "license_photo", img.jpeg()), "unauthenticated");
    await expectProblem(await send(h, null, [["purpose", "license_photo"]]), "unauthenticated");
    expect(h.store.calls).toEqual([]);
    expect(h.limiter.counts.size).toBe(0);
  });

  it("사장님 해석기가 없는 앱(TASK-020 전)은 늘 401", async () => {
    const store = new MemoryStore();
    const app = createApp({
      logSink: () => {},
      services: { storage: store, limiters: { UPLOAD_RATE_LIMITER: new MemoryLimiter(30) } },
    });
    const fd = new FormData();
    fd.append("purpose", "license_photo");
    fd.append("file", photo(img.jpeg()));
    const res = await app.request(
      "/api/owner/uploads",
      { method: "POST", body: fd, headers: { [OWNER]: newUuid() } },
      testEnv(),
    );
    await expectProblem(res, "unauthenticated");
    expect(store.calls).toEqual([]);
  });

  it("흉내 낸 사장님 범위는 받지 않음(500)", async () => {
    const app = createApp({
      logSink: () => {},
      ownerAccount: async () => ({ ownerId: newUuid(), timeZone: "Asia/Seoul" }) as unknown as OwnerScope,
      services: { storage: new MemoryStore(), limiters: { UPLOAD_RATE_LIMITER: new MemoryLimiter(30) } },
    });
    const res = await app.request("/api/owner/uploads", { method: "POST" }, testEnv());
    await expectProblem(res, "internal");
  });

  it("createOwnerScope는 uuid와 IANA 시간대만 받음", () => {
    expect(() => createOwnerScope("not-a-uuid")).toThrow(TypeError);
    expect(() => createOwnerScope(newUuid(), "Mars/Base")).toThrow(TypeError);
    const id = newUuid().toUpperCase();
    expect(createOwnerScope(id).ownerId).toBe(id.toLowerCase());
    expect(createOwnerScope(id).timeZone).toBe("Asia/Seoul");
  });
});

describe("API-007 413: 용도의 한도를 넘음(file_too_large)", () => {
  it("신고증·도안 10MB, 완성 사진 20MB를 1바이트 넘으면 413이고 아무것도 남지 않음", async () => {
    const h = harness();
    const owner = newUuid();
    for (const [purpose, size] of [
      ["license_photo", 10 * MIB + 1],
      ["design_image", 10 * MIB + 1],
      ["completion_photo", 20 * MIB + 1],
    ] as const) {
      await expectProblem(await upload(h, owner, purpose, img.jpeg(size)), "file_too_large");
    }
    expect(h.store.keys()).toEqual([]);
  });

  it("선언한 길이가 본문 한도를 넘으면 읽기 전에 413(저장소를 세지 않음)", async () => {
    const h = harness();
    const req = new Request("http://localhost/api/owner/uploads", {
      method: "POST",
      headers: {
        [OWNER]: newUuid(),
        "content-type": "multipart/form-data; boundary=x",
        "content-length": String(MAX_UPLOAD_BODY + 1),
      },
      body: "--x--",
    });
    await expectProblem(await h.app.request(req, undefined, testEnv()), "file_too_large");
    expect(h.store.calls).toEqual([]);
  });

  it("길이를 선언하지 않은 본문도 읽으면서 세어 한도를 넘는 순간 413", async () => {
    const h = harness();
    const chunk = new Uint8Array(MIB);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > MAX_UPLOAD_BODY) {
          controller.close();
          return;
        }
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const req = new Request("http://localhost/api/owner/uploads", {
      method: "POST",
      headers: { [OWNER]: newUuid(), "content-type": "multipart/form-data; boundary=x" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    await expectProblem(await h.app.request(req, undefined, testEnv()), "file_too_large");
    expect(sent).toBeLessThanOrEqual(MAX_UPLOAD_BODY + 2 * MIB);
    expect(h.store.keys()).toEqual([]);
  });
});

describe("API-007 422: 입력이 UploadForm에 맞지 않음(validation_failed)", () => {
  async function errorsOf(res: Response) {
    const body = await expectProblem(res, "validation_failed");
    return body.errors;
  }

  it("06 예시: 사진이 아닌 내용은 이름·Content-Type이 사진이어도 /file not_allowed", async () => {
    const h = harness();
    const res = await send(h, newUuid(), [
      ["purpose", "license_photo"],
      ["file", photo(img.text(), "cake.jpg", "image/jpeg")],
    ]);
    expect(await errorsOf(res)).toEqual([{ field: "/file", code: "not_allowed" }]);
    expect(h.store.keys()).toEqual([]);
  });

  it("용도가 받지 않는 종류: 신고증의 WEBP, 모든 용도의 AVIF·HEIC 아닌 HEIF·GIF", async () => {
    const h = harness();
    const owner = newUuid();
    const rejected: [string, Uint8Array][] = [
      ["license_photo", img.webp()],
      ["license_photo", img.avif()],
      ["design_image", img.heifOnly()],
      ["completion_photo", img.gif()],
    ];
    for (const [purpose, bytes] of rejected) {
      expect(await errorsOf(await upload(h, owner, purpose, bytes)), purpose).toEqual([
        { field: "/file", code: "not_allowed" },
      ]);
    }
    expect(h.store.keys()).toEqual([]);
  });

  it("필드 오류를 모두 모아 알림(빠짐·모르는 용도·모르는 필드·두 번·꼴)", async () => {
    const h = harness();
    const o = newUuid();
    const f = photo(img.jpeg());
    expect(await errorsOf(await send(h, o, [["file", f]]))).toEqual([{ field: "/purpose", code: "required" }]);
    expect(await errorsOf(await send(h, o, [["purpose", "license_photo"]]))).toEqual([
      { field: "/file", code: "required" },
    ]);
    expect(
      await errorsOf(
        await send(h, o, [
          ["purpose", "menu_photo"],
          ["file", f],
          ["note", "x"],
          ["a-b", "x"],
        ]),
      ),
    ).toEqual([
      { field: "/note", code: "unknown_field" },
      { field: "/", code: "unknown_field" },
      { field: "/purpose", code: "not_allowed" },
    ]);
    expect(
      await errorsOf(
        await send(h, o, [
          ["purpose", "license_photo"],
          ["purpose", "design_image"],
          ["file", f],
          ["file", f],
        ]),
      ),
    ).toEqual([
      { field: "/purpose", code: "too_many" },
      { field: "/file", code: "too_many" },
    ]);
    expect(
      await errorsOf(
        await send(h, o, [
          ["purpose", photo(img.jpeg(), "purpose.jpg")],
          ["file", "not a file"],
        ]),
      ),
    ).toEqual([
      { field: "/purpose", code: "bad_format" },
      { field: "/file", code: "bad_format" },
    ]);
    expect(
      await errorsOf(
        await send(h, o, [
          ["purpose", "license_photo"],
          ["file", photo(new Uint8Array(0))],
        ]),
      ),
    ).toEqual([{ field: "/file", code: "required" }]);
    expect(h.store.keys()).toEqual([]);
  });

  it("multipart가 아니거나 읽을 수 없는 본문은 본문 전체(/)의 bad_format", async () => {
    const h = harness();
    const call = (contentType: string, body: string) =>
      h.app.request(
        "/api/owner/uploads",
        { method: "POST", headers: { [OWNER]: newUuid(), "content-type": contentType }, body },
        testEnv(),
      );
    expect(await errorsOf(await call("application/json", '{"purpose":"license_photo"}'))).toEqual([
      { field: "/", code: "bad_format" },
    ]);
    expect(await errorsOf(await call("multipart/form-data; boundary=zz", "not multipart at all"))).toEqual([
      { field: "/", code: "bad_format" },
    ]);
    expect(h.store.keys()).toEqual([]);
  });
});

describe("API-007 429: 사장님마다 1분 30번, 쓰지 않은 올린 파일 1시간 안 50개(06 DEC-16, RD-18)", () => {
  it("1분에 31번째는 429와 Retry-After(다른 사장님은 따로 셈)", async () => {
    const h = harness();
    const a = newUuid();
    for (let i = 0; i < 30; i += 1) await uploaded(await upload(h, a, "design_image", img.png(64)));
    const res = await upload(h, a, "design_image", img.png(64));
    expect(res.headers.get("retry-after")).toBe("60");
    const body = await expectProblem(res, "rate_limited");
    expect(body.retryAfterSeconds).toBe(60);
    expect(h.limiter.counts.get(`upload:${a}`)).toBe(31);
    // 한도에 걸린 요청은 저장하지 않음
    expect(h.store.keys(`tmp/${a}/`)).toHaveLength(30);
    await uploaded(await upload(h, newUuid(), "design_image", img.png(64)));
  });

  it("쓰지 않은 파일이 1시간 안에 50개면 51번째는 429, 가장 오래된 것이 1시간을 넘기면 다시 받음", async () => {
    const h = harness({ limit: 1000 });
    const a = newUuid();
    // 1분마다 하나씩 50개(10:03~10:52)
    for (let i = 0; i < UNUSED_UPLOAD_LIMIT; i += 1) {
      h.clock.now = new Date(T0.getTime() + i * 60_000);
      await uploaded(await upload(h, a, "completion_photo", img.jpeg(64)));
    }
    h.clock.now = new Date(T0.getTime() + 49 * 60_000 + 30_000);
    const res = await upload(h, a, "completion_photo", img.jpeg(64));
    // 가장 오래된 것(10:03)이 11:03에 1시간을 넘김: 10:52:30부터 630초
    expect(res.headers.get("retry-after")).toBe("630");
    expect((await expectProblem(res, "rate_limited")).retryAfterSeconds).toBe(630);
    // 다른 사장님은 따로 셈
    await uploaded(await upload(h, newUuid(), "completion_photo", img.jpeg(64)));
    // 1시간이 지나 가장 오래된 것은 세지 않음
    h.clock.now = new Date(T0.getTime() + UPLOAD_TTL_MS);
    await uploaded(await upload(h, a, "completion_photo", img.jpeg(64)));
  });

  it("명령이 쓴 파일(임시 위치에서 지운 것)은 세지 않음", async () => {
    const h = harness({ limit: 1000 });
    const a = newUuid();
    const ids: string[] = [];
    for (let i = 0; i < UNUSED_UPLOAD_LIMIT; i += 1) {
      ids.push((await uploaded(await upload(h, a, "design_image", img.png(64)))).uploadId);
    }
    await expectProblem(await upload(h, a, "design_image", img.png(64)), "rate_limited");
    const used = await use(h, a, newUuid(), [{ id: ids[0], purpose: "design_image" }]);
    expect(used.status).toBe(200);
    await uploaded(await upload(h, a, "design_image", img.png(64)));
  });

  it("셈: 목록이 잘리면(1000개 넘음) 3600초, 지난 파일과 다른 꼴의 키는 세지 않음", async () => {
    const owner = createOwnerScope(newUuid());
    const now = T0;
    const prefix = `tmp/${owner.ownerId}/`;
    const fresh = Array.from({ length: 1000 }, () => `${prefix}${newUploadId("design_image", now)}`);
    const truncated: ObjectStore = Object.assign(new MemoryStore(), {
      list: async (): Promise<ObjectList> => ({ keys: fresh, truncated: true }),
    });
    expect(await unusedUploads(truncated, owner, now)).toEqual({ count: 1001, retryAfterSeconds: 3600 });
    const store = new MemoryStore();
    const old = new Date(now.getTime() - UPLOAD_TTL_MS);
    await store.put(tempKey(owner, newUploadId("design_image", old)), img.png(8), "image/png");
    await store.put(`${prefix}upl_zzzz-not-ours`, img.png(8), "image/png");
    await store.put(tempKey(owner, newUploadId("design_image", now)), img.png(8), "image/png");
    expect(await unusedUploads(store, owner, now)).toEqual({ count: 1, retryAfterSeconds: null });
  });
});

describe("API-007 503: 사진 저장소가 답하지 않으면 storage_unavailable이고 아무것도 남지 않음", () => {
  for (const op of ["put", "list"] as const) {
    it(`저장소의 ${op} 실패`, async () => {
      const h = harness();
      h.store.failOn.add(op);
      const { lines, sink } = collectLogs();
      const app = createApp({
        logSink: sink,
        routes: [...APP_ROUTES],
        ownerAccount: async (c) => createOwnerScope(c.req.header(OWNER) ?? ""),
        services: { storage: h.store, limiters: { UPLOAD_RATE_LIMITER: h.limiter }, now: () => T0 },
      });
      const fd = new FormData();
      fd.append("purpose", "license_photo");
      fd.append("file", photo(img.jpeg()));
      const res = await app.request(
        "/api/owner/uploads",
        { method: "POST", body: fd, headers: { [OWNER]: newUuid() } },
        testEnv(),
      );
      await expectProblem(res, "storage_unavailable");
      expect(h.store.keys()).toEqual([]);
      const logged = lines.join("\n");
      expect(logged).toContain('"errorName":"StorageUnavailableError"');
      expect(logged).not.toContain("tmp/");
    });
  }

  it("진짜 저장소 구현(S3Store)의 목록 응답이 머리 뒤에 끊겨도 503(500 internal이 아님)", async () => {
    const { lines, sink } = collectLogs();
    const app = createApp({
      logSink: sink,
      ownerAccount: async () => createOwnerScope(newUuid()),
      services: { storage: brokenS3(), limiters: { UPLOAD_RATE_LIMITER: new MemoryLimiter(30) }, now: () => T0 },
    });
    const fd = new FormData();
    fd.append("purpose", "license_photo");
    fd.append("file", photo(img.jpeg()));
    const res = await app.request("/api/owner/uploads", { method: "POST", body: fd }, testEnv());
    await expectProblem(res, "storage_unavailable");
    expect(lines.join("\n")).toContain('"errorName":"StorageUnavailableError"');
  });
});

describe("API-007 default(500): 설정이 빠지면 internal이고 이름만 남김", () => {
  it("저장소 설정(STORAGE_*)이 없음", async () => {
    const { lines, sink } = collectLogs();
    const app = createApp({
      logSink: sink,
      ownerAccount: async () => createOwnerScope(newUuid()),
      services: { limiters: { UPLOAD_RATE_LIMITER: new MemoryLimiter(30) } },
    });
    const fd = new FormData();
    fd.append("purpose", "license_photo");
    fd.append("file", photo(img.jpeg()));
    await expectProblem(await app.request("/api/owner/uploads", { method: "POST", body: fd }, testEnv()), "internal");
    expect(lines.join("\n")).toContain('"errorName":"MissingSettingError"');
  });

  it("한도 바인딩(UPLOAD_RATE_LIMITER)이 없음", async () => {
    const app = createApp({
      logSink: () => {},
      ownerAccount: async () => createOwnerScope(newUuid()),
      services: { storage: new MemoryStore() },
    });
    await expectProblem(await app.request("/api/owner/uploads", { method: "POST" }, testEnv()), "internal");
  });

  it("Workers 바인딩이 있으면 그것으로 셈(키는 upload:<사장님 ID>)", async () => {
    const keys: string[] = [];
    const owner = newUuid();
    const app = createApp({
      logSink: () => {},
      ownerAccount: async () => createOwnerScope(owner),
      services: { storage: new MemoryStore() },
    });
    const binding = {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        return { success: false };
      },
    };
    const res = await app.request(
      "/api/owner/uploads",
      { method: "POST" },
      { ...testEnv(), UPLOAD_RATE_LIMITER: binding },
    );
    await expectProblem(res, "rate_limited");
    expect(keys).toEqual([`upload:${owner}`]);
  });
});

describe("명령이 쓰는 올린 파일(06 DEC-02·DEC-09, SPEC-068 [입력], 설계 재검토 M18)", () => {
  it("다른 사장님의 uploadId는 없는 ID·1시간 지난 ID와 같은 upload_not_found이고 남는 것 0", async () => {
    const h = harness();
    const a = newUuid();
    const b = newUuid();
    const shopB = newUuid();
    const x = (await uploaded(await upload(h, a, "license_photo", img.jpeg()))).uploadId;
    const before = h.store.keys();
    const other = await use(h, b, shopB, [{ id: x, purpose: "license_photo" }]);
    const otherBody = await expectProblem(other, "validation_failed");
    expect(otherBody.errors).toEqual([{ field: "/uploads/0/uploadId", code: "upload_not_found" }]);
    // 우리가 낸 꼴이지만 없는 ID, 계약 꼴이지만 우리가 내지 않은 ID(06 예시), 1시간 지난 자기 ID
    const never = newUploadId("license_photo", T0);
    const foreign = "upl_b207891516294931d8277285";
    const own = (await uploaded(await upload(h, b, "license_photo", img.jpeg()))).uploadId;
    const snapshot = h.store.keys();
    for (const id of [never, foreign]) {
      const res = await use(h, b, shopB, [{ id, purpose: "license_photo" }]);
      expect(comparableProblem(await expectProblem(res, "validation_failed")), id).toEqual(
        comparableProblem(otherBody),
      );
    }
    h.clock.now = new Date(T0.getTime() + UPLOAD_TTL_MS);
    const expired = await use(h, b, shopB, [{ id: own, purpose: "license_photo" }]);
    expect(comparableProblem(await expectProblem(expired, "validation_failed"))).toEqual(comparableProblem(otherBody));
    // 남는 것 0: 영구 위치에 아무것도 없고, A의 임시 파일은 그대로
    expect(h.store.keys("shops/")).toEqual([]);
    expect(h.store.keys()).toEqual(snapshot);
    expect(before.every((k) => snapshot.includes(k))).toBe(true);
  });

  it("자기 ID는 영구 위치로 옮기고 임시 파일을 지움(다시 쓰면 upload_not_found)", async () => {
    const h = harness();
    const a = newUuid();
    const shop = newUuid();
    const bytes = img.heic();
    const x = (await uploaded(await upload(h, a, "license_photo", bytes))).uploadId;
    const res = await use(h, a, shop, [{ id: x, purpose: "license_photo" }]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ moved: 1 });
    const key = `shops/${shop}/license_photo/${x}`;
    expect(h.store.keys()).toEqual([key]);
    expect(h.store.objects.get(key)?.contentType).toBe("image/heic");
    expect(h.store.objects.get(key)?.body).toEqual(bytes);
    const again = await use(h, a, shop, [{ id: x, purpose: "license_photo" }]);
    expect((await expectProblem(again, "validation_failed")).errors).toEqual([
      { field: "/uploads/0/uploadId", code: "upload_not_found" },
    ]);
  });

  it("1시간 직전까지는 쓸 수 있고 1시간이 되면 upload_not_found", async () => {
    const h = harness();
    const a = newUuid();
    const x = (await uploaded(await upload(h, a, "design_image", img.png()))).uploadId;
    const y = (await uploaded(await upload(h, a, "design_image", img.png()))).uploadId;
    h.clock.now = new Date(T0.getTime() + UPLOAD_TTL_MS - 1);
    expect((await use(h, a, newUuid(), [{ id: x, purpose: "design_image" }])).status).toBe(200);
    h.clock.now = new Date(T0.getTime() + UPLOAD_TTL_MS);
    const late = await use(h, a, newUuid(), [{ id: y, purpose: "design_image" }]);
    expect((await expectProblem(late, "validation_failed")).errors).toEqual([
      { field: "/uploads/0/uploadId", code: "upload_not_found" },
    ]);
  });

  it("다른 용도·꼴이 틀린 ID·같은 ID 두 번을 필드마다 모아 알리고 아무것도 옮기지 않음", async () => {
    const h = harness();
    const a = newUuid();
    const design = (await uploaded(await upload(h, a, "design_image", img.png()))).uploadId;
    const done = (await uploaded(await upload(h, a, "completion_photo", img.jpeg()))).uploadId;
    const res = await use(h, a, newUuid(), [
      { id: done, purpose: "completion_photo" },
      { id: design, purpose: "license_photo" },
      { id: "not-an-upload", purpose: "design_image" },
      { id: 42, purpose: "design_image" },
      { id: done, purpose: "completion_photo" },
    ]);
    expect((await expectProblem(res, "validation_failed")).errors).toEqual([
      { field: "/uploads/1/uploadId", code: "upload_wrong_purpose" },
      { field: "/uploads/2/uploadId", code: "bad_format" },
      { field: "/uploads/3/uploadId", code: "bad_format" },
      { field: "/uploads/4/uploadId", code: "duplicate" },
    ]);
    expect(h.store.keys("shops/")).toEqual([]);
    expect(h.store.keys(`tmp/${a}/`)).toHaveLength(2);
  });

  it("옮기다 저장소가 답하지 않으면 503이고 영구 위치에 남는 것 0, 임시 파일은 그대로", async () => {
    const h = harness();
    const a = newUuid();
    const x = (await uploaded(await upload(h, a, "license_photo", img.jpeg()))).uploadId;
    h.store.failOn.add("copy");
    await expectProblem(await use(h, a, newUuid(), [{ id: x, purpose: "license_photo" }]), "storage_unavailable");
    expect(h.store.keys("shops/")).toEqual([]);
    expect(h.store.keys(`tmp/${a}/`)).toHaveLength(1);
  });

  it("보고 난 뒤 임시 파일이 없어지면 그 필드의 upload_not_found, 임시 파일 지우기 실패는 명령을 막지 않음", async () => {
    const store = new MemoryStore();
    const owner = createOwnerScope(newUuid());
    const id = newUploadId("design_image", T0);
    await store.put(tempKey(owner, id), img.png(), "image/png");
    const [taken] = await checkUploads(
      store,
      owner,
      [{ field: "/designs/0/uploadId", id, purpose: "design_image" }],
      T0,
    );
    if (taken === undefined) throw new Error("no upload");
    expect(taken).toEqual({
      field: "/designs/0/uploadId",
      uploadId: id,
      purpose: "design_image",
      contentType: "image/png",
      byteSize: 2048,
      tempKey: tempKey(owner, id),
    });
    store.failOn.add("delete");
    await expect(discardUpload(store, taken)).resolves.toBeUndefined();
    store.failOn.clear();
    await store.delete(taken.tempKey);
    const err = await promoteUpload(store, taken, newUuid()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).extras.errors).toEqual([{ field: "/designs/0/uploadId", code: "upload_not_found" }]);
    expect(() => permanentKey("not-a-shop", "design_image", id)).toThrow(TypeError);
  });

  it("진짜 저장소 구현(S3Store)에서 응답 머리 뒤에 몸체가 끊기면: 옮기기는 503, 임시 파일 지우기는 명령을 막지 않음", async () => {
    const owner = createOwnerScope(newUuid());
    const id = newUploadId("license_photo", T0);
    const taken: TakenUpload = {
      field: "/uploads/0/uploadId",
      uploadId: id,
      purpose: "license_photo",
      contentType: "image/jpeg",
      byteSize: 1024,
      tempKey: tempKey(owner, id),
    };
    const err = await promoteUpload(brokenS3(), taken, newUuid()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StorageUnavailableError);
    await expect(discardUpload(brokenS3(), taken)).resolves.toBeUndefined();
  });
});

describe("uploadId와 내용으로 본 종류", () => {
  it("uploadId는 계약의 꼴이고, 올린 시각과 용도를 담으며 매번 다름", () => {
    const ids = new Set<string>();
    for (const purpose of ["license_photo", "design_image", "completion_photo"] as const) {
      const id = newUploadId(purpose, T0);
      expect(id).toMatch(CONTRACT_UPLOAD_ID);
      expect(id.length).toBeGreaterThanOrEqual(24);
      expect(parseUploadId(id)).toEqual({ id, createdAt: T0.getTime(), purpose });
      ids.add(id);
      ids.add(newUploadId(purpose, T0));
    }
    expect(ids.size).toBe(6);
    expect(parseUploadId(`upl_${"0".repeat(12)}x${"A".repeat(22)}`)).toBeNull();
    expect(parseUploadId("upl_b207891516294931d8277285")).toBeNull();
    expect(parseUploadId(42)).toBeNull();
  });

  it("시그니처: JPEG·PNG·WEBP·HEIC(주 브랜드나 mif1의 호환 브랜드)만", () => {
    expect(sniffImage(img.jpeg())).toBe("image/jpeg");
    expect(sniffImage(img.png())).toBe("image/png");
    expect(sniffImage(img.webp())).toBe("image/webp");
    expect(sniffImage(img.heic())).toBe("image/heic");
    expect(sniffImage(img.heifWithHeic())).toBe("image/heic");
    for (const bytes of [
      img.avif(),
      img.heifOnly(),
      img.gif(),
      img.text(),
      new Uint8Array(0),
      new Uint8Array([0xff, 0xd8]),
    ]) {
      expect(sniffImage(bytes)).toBeNull();
    }
    // ftyp 상자 크기가 말이 안 되면 받지 않음
    const broken = img.heic();
    broken.set([0, 0, 0, 8], 0);
    expect(sniffImage(broken)).toBeNull();
  });
});

describe("한도 바인딩의 어댑터", () => {
  it("MemoryLimiter는 키마다 셈(시험용 한도가 진짜 바인딩과 같은 약속)", async () => {
    const l: RateLimiter = new MemoryLimiter(2);
    expect([await l.limit("a"), await l.limit("a"), await l.limit("a"), await l.limit("b")]).toEqual([
      true,
      true,
      false,
      true,
    ]);
  });
});

describe("저장소 오류는 어느 경로에서나 503(onError)", () => {
  it("StorageUnavailableError를 던진 경로는 storage_unavailable", async () => {
    const failing = ownerRoute("GET", "/test/owner/storage-fails", async (r) => {
      await r.services.storage().head("tmp/x");
      return r.json({});
    });
    const store = new MemoryStore();
    store.failOn.add("head");
    const app = createApp({
      logSink: () => {},
      routes: [failing] as readonly RouteDecl[],
      ownerAccount: async () => createOwnerScope(newUuid()),
      services: { storage: store },
    });
    await expectProblem(await app.request("/api/test/owner/storage-fails", {}, testEnv()), "storage_unavailable");
  });
});
