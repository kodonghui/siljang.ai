import { describe, expect, it } from "vitest";
import { assertStorageKey, parseListObjectsV2, S3Store, StorageUnavailableError } from "../src/storage";
import { brokenBody } from "./support/storage";

// 사진 저장소 모듈의 S3 구현(TASK-022). 계정이 없어(TASK-170) 진짜 저장소에는 보내지 않고, 보내는 요청의 모양만 가짜 fetch로
// 본다. Supabase Storage의 S3 호환 주소에서 실제로 도는지는 TASK-171이 확인한다(app/README.md 25).

/** 시험용 접근 키(저장소 글에 키 꼴이 남지 않게 실행 중에 만든다). */
const ACCESS_KEY_ID = ["test", "access", "id"].join("-");
const SECRET_ACCESS_KEY = ["test", "secret", "value"].join("-");
const ENDPOINT = "https://project.storage.example.test/storage/v1/s3";

interface Sent {
  readonly method: string;
  readonly url: URL;
  readonly headers: Headers;
  readonly body: Uint8Array;
}

function fakeS3(respond: (req: Sent) => Response | Promise<Response>) {
  const sent: Sent[] = [];
  const store = new S3Store({
    endpoint: `${ENDPOINT}/`,
    region: "ap-northeast-2",
    bucket: "photos",
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
    fetch: async (req) => {
      const s: Sent = {
        method: req.method,
        url: new URL(req.url),
        headers: req.headers,
        body: new Uint8Array(await req.arrayBuffer()),
      };
      sent.push(s);
      return respond(s);
    },
  });
  return { store, sent };
}

function expectSigned(s: Sent) {
  const auth = s.headers.get("authorization") ?? "";
  expect(auth).toMatch(
    /^AWS4-HMAC-SHA256 Credential=test-access-id\/\d{8}\/ap-northeast-2\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/,
  );
  expect(auth).toContain("host");
  expect(auth).toContain("x-amz-content-sha256");
  expect(auth).toContain("x-amz-date");
  expect(s.headers.get("x-amz-content-sha256")).toBe("UNSIGNED-PAYLOAD");
  expect(s.headers.get("x-amz-date")).toMatch(/^\d{8}T\d{6}Z$/);
  // 비밀 값은 요청 어디에도 그대로 실리지 않음
  expect(JSON.stringify([...s.headers])).not.toContain(SECRET_ACCESS_KEY);
  expect(s.url.toString()).not.toContain(SECRET_ACCESS_KEY);
}

const KEY = "tmp/0b9a7c6e-1f2d-4e3c-8a9b-0c1d2e3f4a5b/upl_0123456789abl0123456789abcdefABCDEF";

describe("S3Store가 보내는 요청(경로 꼴 주소, SigV4, UNSIGNED-PAYLOAD)", () => {
  it("put: PUT 버킷/키, 종류 헤더와 몸체 그대로, 200만 성공", async () => {
    const { store, sent } = fakeS3(() => new Response(null, { status: 200 }));
    const body = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
    await store.put(KEY, body, "image/jpeg");
    const [s] = sent;
    if (s === undefined) throw new Error("not sent");
    expect(s.method).toBe("PUT");
    expect(s.url.toString()).toBe(`${ENDPOINT}/photos/${KEY}`);
    expect(s.headers.get("content-type")).toBe("image/jpeg");
    expect(s.body).toEqual(body);
    expectSigned(s);
    const failing = fakeS3(() => new Response("<Error/>", { status: 500 }));
    await expect(failing.store.put(KEY, body, "image/jpeg")).rejects.toThrow(StorageUnavailableError);
  });

  it("head: 크기와 종류, 404는 null", async () => {
    const { store, sent } = fakeS3((s) =>
      s.url.pathname.endsWith("missing")
        ? new Response(null, { status: 404 })
        : new Response(null, { status: 200, headers: { "content-length": "2483120", "content-type": "image/heic" } }),
    );
    expect(await store.head(KEY)).toEqual({ key: KEY, size: 2483120, contentType: "image/heic" });
    expect(await store.head("tmp/missing")).toBeNull();
    expect(sent.map((s) => s.method)).toEqual(["HEAD", "HEAD"]);
    for (const s of sent) expectSigned(s);
  });

  it("get: 몸체를 흘려보냄, 404는 null", async () => {
    const { store } = fakeS3((s) =>
      s.url.pathname.endsWith("missing")
        ? new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 })
        : new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } }),
    );
    const got = await store.get(KEY);
    expect(got?.contentType).toBe("image/png");
    expect(new Uint8Array(await new Response(got?.body).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(await store.get("tmp/missing")).toBeNull();
  });

  it("copy: 받는 키로 PUT과 x-amz-copy-source(/버킷/원본), 원본이 없으면 false, 200이어도 Error 본문이면 실패", async () => {
    const to = "shops/2c9e1b52-7a8d-4f3e-9b6a-1d2c3e4f5a6b/license_photo/upl_0123456789abl0123456789abcdefABCDEF";
    const { store, sent } = fakeS3(
      () => new Response('<?xml version="1.0"?><CopyObjectResult><ETag>"e"</ETag></CopyObjectResult>', { status: 200 }),
    );
    expect(await store.copy(KEY, to)).toBe(true);
    const [s] = sent;
    if (s === undefined) throw new Error("not sent");
    expect(s.method).toBe("PUT");
    expect(s.url.toString()).toBe(`${ENDPOINT}/photos/${to}`);
    expect(s.headers.get("x-amz-copy-source")).toBe(`/photos/${KEY}`);
    expect(s.body.byteLength).toBe(0);
    expectSigned(s);
    const missing = fakeS3(() => new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 }));
    expect(await missing.store.copy(KEY, to)).toBe(false);
    const halfway = fakeS3(() => new Response("<Error><Code>InternalError</Code></Error>", { status: 200 }));
    await expect(halfway.store.copy(KEY, to)).rejects.toThrow(StorageUnavailableError);
  });

  it("delete: DELETE, 204·200·404는 성공", async () => {
    for (const status of [204, 200, 404]) {
      const { store, sent } = fakeS3(() => new Response(null, { status }));
      await store.delete(KEY);
      expect(sent[0]?.method).toBe("DELETE");
    }
    const failing = fakeS3(() => new Response(null, { status: 403 }));
    await expect(failing.store.delete(KEY)).rejects.toThrow("delete: status 403");
  });

  it("list: ListObjectsV2(prefix·start-after·max-keys)와 응답 읽기", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult><Name>photos</Name><Prefix>tmp/a/</Prefix><KeyCount>2</KeyCount><MaxKeys>2</MaxKeys>
<IsTruncated>true</IsTruncated>
<Contents><Key>tmp/a/upl_1</Key><Size>10</Size></Contents>
<Contents><Key>tmp/a/upl_2&amp;x</Key><Size>20</Size></Contents>
</ListBucketResult>`;
    const { store, sent } = fakeS3(() => new Response(xml, { status: 200 }));
    expect(await store.list("tmp/a/", "tmp/a/upl_0", 2)).toEqual({
      keys: ["tmp/a/upl_1", "tmp/a/upl_2&x"],
      truncated: true,
    });
    const [s] = sent;
    if (s === undefined) throw new Error("not sent");
    expect(s.method).toBe("GET");
    expect(`${s.url.origin}${s.url.pathname}`).toBe(`${ENDPOINT}/photos`);
    expect(Object.fromEntries(s.url.searchParams)).toEqual({
      "list-type": "2",
      prefix: "tmp/a/",
      "max-keys": "2",
      "start-after": "tmp/a/upl_0",
    });
    expectSigned(s);
    expect(parseListObjectsV2("<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>")).toEqual({
      keys: [],
      truncated: false,
    });
  });

  it("답이 없으면 StorageUnavailableError(동작 이름만, 다시 시도하지 않음)", async () => {
    let calls = 0;
    const store = new S3Store({
      endpoint: ENDPOINT,
      region: "ap-northeast-2",
      bucket: "photos",
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
      fetch: async () => {
        calls += 1;
        throw new TypeError("network down");
      },
    });
    const err = await store.put(KEY, new Uint8Array([1]), "image/jpeg").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StorageUnavailableError);
    expect((err as Error).message).toBe("put: no response");
    expect(calls).toBe(1);
  });

  it("머리 뒤에 몸체가 끊기면: 몸체를 읽어야 아는 목록·복사는 StorageUnavailableError, 상태 코드로 끝난 동작은 버리는 몸체의 오류를 무시", async () => {
    const broken = (status: number) => fakeS3(() => brokenBody(status)).store;
    const to = "shops/2c9e1b52-7a8d-4f3e-9b6a-1d2c3e4f5a6b/license_photo/upl_0123456789abl0123456789abcdefABCDEF";
    const listErr = await broken(200)
      .list("tmp/a/", "", 10)
      .catch((e: unknown) => e);
    expect(listErr).toBeInstanceOf(StorageUnavailableError);
    expect((listErr as Error).message).toBe("list: body not read");
    const copyErr = await broken(200)
      .copy(KEY, to)
      .catch((e: unknown) => e);
    expect(copyErr).toBeInstanceOf(StorageUnavailableError);
    expect((copyErr as Error).message).toBe("copy: body not read");
    // 넣기·지우기는 상태 코드로 끝났고, 없는 객체(404)는 없다는 답이 이미 옴
    await expect(broken(200).put(KEY, new Uint8Array([1]), "image/jpeg")).resolves.toBeUndefined();
    await expect(broken(200).delete(KEY)).resolves.toBeUndefined();
    await expect(broken(404).delete(KEY)).resolves.toBeUndefined();
    await expect(broken(404).get(KEY)).resolves.toBeNull();
    await expect(broken(404).copy(KEY, to)).resolves.toBe(false);
    await expect(broken(500).put(KEY, new Uint8Array([1]), "image/jpeg")).rejects.toThrow("put: status 500");
  });
});

describe("저장 위치의 꼴", () => {
  it("우리 코드가 만드는 꼴만 받음", () => {
    for (const ok of [KEY, "shops/x/license_photo/upl_1", "a", "a.b-c_d"]) expect(assertStorageKey(ok)).toBe(ok);
    for (const bad of [
      "",
      "/a",
      "a/",
      "a//b",
      "../a",
      "a/../b",
      "./a",
      "a/.",
      "a b",
      "a?b",
      "a#b",
      "가",
      "a".repeat(513),
    ]) {
      expect(() => assertStorageKey(bad), bad).toThrow(TypeError);
    }
  });
});
