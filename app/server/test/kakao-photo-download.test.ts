import { readFileSync } from "node:fs";
import { load } from "exifreader";
import { expect, it, vi } from "vitest";
import { downloadKakaoPhoto, KAKAO_PHOTO_MAX_BYTES } from "../src/kakao-photo-download";
import { photoNormalizer } from "../src/photo-normalizer";

const PHOTO_URL = "https://cdn.kakaocdn.net/synthetic/photo.png?credential=synthetic";
const png = new Uint8Array(readFileSync(new globalThis.URL("./fixtures/photos/metadata.png", import.meta.url)));
const photos = () =>
  photoNormalizer(() => {
    throw new Error("이 PNG는 Images를 쓰지 않음");
  });
const response = () => new Response(png.slice(), { headers: { "Content-Type": "image/png" } });

it.each([
  "http://cdn.kakaocdn.net/photo.png",
  "https://kakaocdn.net.example/photo.png",
  "https://notkakaocdn.net/photo.png",
  "https://kakaocdn.net@127.0.0.1/photo.png",
  "https://user:password@cdn.kakaocdn.net/photo.png",
  "https://cdn.kakaocdn.net:8443/photo.png",
  "https://127.0.0.1/photo.png",
  "file:///tmp/photo.png",
  "data:image/png;base64,AAAA",
])("허용된 카카오 HTTPS 사진 주소 밖에는 요청하지 않는다 %s", async (url) => {
  const send = vi.fn<typeof fetch>(async () => response());
  expect(await downloadKakaoPhoto(url, photos(), { fetch: send })).toEqual({ ok: false, reason: "rejected" });
  expect(send).not.toHaveBeenCalled();
});

it("G10을 거친 바이트와 실제 이미지 형식만 반환하고 원래 URL을 복사하지 않는다", async () => {
  const send = vi.fn<typeof fetch>(async () => new Response(png.slice(), { headers: { "Content-Type": "text/html" } }));
  const result = await downloadKakaoPhoto(PHOTO_URL, photos(), { fetch: send });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.photo.contentType).toBe("image/png");
  const original = load(png.buffer, { expanded: true });
  const cleaned = load(result.photo.bytes.slice().buffer, { expanded: true });
  expect(
    original.gps !== undefined ||
      original.xmp !== undefined ||
      Object.keys(original.exif ?? {}).some((key) => key !== "Orientation"),
  ).toBe(true);
  expect(Object.keys(cleaned.exif ?? {}).filter((key) => key !== "Orientation")).toEqual([]);
  expect(cleaned.gps).toBeUndefined();
  expect(cleaned.xmp).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain("credential");
  expect(send.mock.calls[0]?.[1]?.redirect).toBe("manual");
});

it("허용 호스트의 상대 리다이렉트도 직접 확인한다", async () => {
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: "/second.png" } }))
    .mockResolvedValueOnce(response());
  expect((await downloadKakaoPhoto(PHOTO_URL, photos(), { fetch: send })).ok).toBe(true);
  expect(send).toHaveBeenCalledTimes(2);
  expect(String(send.mock.calls[1]?.[0])).toBe("https://cdn.kakaocdn.net/second.png");
  expect(send.mock.calls.every(([, init]) => init?.redirect === "manual")).toBe(true);
});

it("밖으로 향하는 리다이렉트는 따라가거나 다시 받지 않는다", async () => {
  const send = vi.fn<typeof fetch>(
    async () => new Response(null, { status: 307, headers: { Location: "https://example.invalid/private" } }),
  );
  expect(await downloadKakaoPhoto(PHOTO_URL, photos(), { fetch: send })).toEqual({ ok: false, reason: "rejected" });
  expect(send).toHaveBeenCalledOnce();
});

it("네 번째 리다이렉트에서 멈춘다", async () => {
  let hops = 0;
  const send = vi.fn<typeof fetch>(
    async () => new Response(null, { status: 302, headers: { Location: `/hop${++hops}.png` } }),
  );
  expect(await downloadKakaoPhoto(PHOTO_URL, photos(), { fetch: send })).toEqual({ ok: false, reason: "rejected" });
  expect(send).toHaveBeenCalledTimes(4);
});

it("연결 오류는 한 번만 다시 받고 성공한 사진을 반환한다", async () => {
  const send = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new Error("합성 연결 끊김"))
    .mockResolvedValueOnce(response());
  expect((await downloadKakaoPhoto(PHOTO_URL, photos(), { fetch: send })).ok).toBe(true);
  expect(send).toHaveBeenCalledTimes(2);
});

it("두 번 내려받지 못하면 오류 원문이나 주소를 반환하지 않는다", async () => {
  const send = vi.fn<typeof fetch>(async () => new Response("합성 내부 오류", { status: 503 }));
  expect(await downloadKakaoPhoto(PHOTO_URL, photos(), { fetch: send })).toEqual({ ok: false, reason: "unavailable" });
  expect(send).toHaveBeenCalledTimes(2);
});

it("이미지라는 응답 헤더만으로 HTML을 저장하지 않는다", async () => {
  const send = vi.fn<typeof fetch>(
    async () => new Response("<html>합성 파일</html>", { headers: { "Content-Type": "image/png" } }),
  );
  expect(await downloadKakaoPhoto(PHOTO_URL, photos(), { fetch: send })).toEqual({ ok: false, reason: "rejected" });
  expect(send).toHaveBeenCalledOnce();
});

it("크기 헤더가20MB를 넘으면 본문을 취소하고 정리 모듈에 넘기지 않는다", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel });
  const normalizer = { fromBytes: vi.fn(), fromStream: vi.fn() };
  const send = vi.fn<typeof fetch>(
    async () => new Response(body, { headers: { "Content-Length": String(KAKAO_PHOTO_MAX_BYTES + 1) } }),
  );
  expect(await downloadKakaoPhoto(PHOTO_URL, normalizer, { fetch: send })).toEqual({ ok: false, reason: "rejected" });
  expect(cancel).toHaveBeenCalledOnce();
  expect(normalizer.fromBytes).not.toHaveBeenCalled();
});

it.each([undefined, "1"])("크기 헤더가 없거나 거짓이어도 실제 스트림20MB를 넘으면 취소한다 %s", async (length) => {
  const cancel = vi.fn();
  let chunk = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(chunk++ === 0 ? KAKAO_PHOTO_MAX_BYTES : 1));
    },
    cancel,
  });
  const normalizer = { fromBytes: vi.fn(), fromStream: vi.fn() };
  const send = vi.fn<typeof fetch>(
    async () => new Response(body, { headers: length === undefined ? {} : { "Content-Length": length } }),
  );
  expect(await downloadKakaoPhoto(PHOTO_URL, normalizer, { fetch: send })).toEqual({ ok: false, reason: "rejected" });
  expect(cancel).toHaveBeenCalledOnce();
  expect(normalizer.fromBytes).not.toHaveBeenCalled();
});

it("요청이 이미 취소됐으면 내려받지 않는다", async () => {
  const controller = new AbortController();
  controller.abort();
  const send = vi.fn<typeof fetch>(async () => response());
  expect(await downloadKakaoPhoto(PHOTO_URL, photos(), { fetch: send, signal: controller.signal })).toEqual({
    ok: false,
    reason: "unavailable",
  });
  expect(send).not.toHaveBeenCalled();
});
