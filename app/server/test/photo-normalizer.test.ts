import { readFileSync } from "node:fs";
import { load } from "exifreader";
import { describe, expect, it } from "vitest";
import { type ImageBinding, MAX_PHOTO_BYTES, PhotoNormalizationError, photoNormalizer } from "../src/photo-normalizer";
import { photoFixture } from "./support/images";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/photos/pixel-${name}.webp`, import.meta.url)));

function binding(response: () => Response | Promise<Response>) {
  const inputs: Uint8Array<ArrayBuffer>[] = [];
  const transforms: unknown[] = [];
  const outputs: unknown[] = [];
  const images: ImageBinding = {
    input(stream) {
      const builder = {
        transform(options: { rotate: 0 }) {
          transforms.push(options);
          return builder;
        },
        async output(options: { format: "image/webp"; quality: 100; anim: true }) {
          outputs.push(options);
          inputs.push(new Uint8Array(await new Response(stream).arrayBuffer()));
          const result = await response();
          return { response: () => result };
        },
      };
      return builder;
    },
  };
  return { images, inputs, transforms, outputs };
}

describe("사진 정규화 공통 모듈(TASK-183)", () => {
  it.each(["bytes", "stream"] as const)(
    "%s 수신이 외부 처리 전후 촬영 정보를 지우고 같은 픽셀 결과를 반환",
    async (mode) => {
      const original = fixture("source");
      const expected = fixture("result");
      const mock = binding(() => new Response(expected, { headers: { "content-type": "image/webp" } }));
      const processor = photoNormalizer(() => mock.images);
      const photo =
        mode === "bytes"
          ? await processor.fromBytes(original)
          : await processor.fromStream(new Response(original), 1024);
      expect(photo).toEqual({ contentType: "image/webp", bytes: expected });
      expect(mock.inputs).toHaveLength(1);
      const sent = await load(mock.inputs[0]?.buffer as ArrayBuffer, { expanded: true, async: true });
      expect(Object.keys(sent.exif ?? {})).toEqual(["Orientation"]);
      expect(sent.exif?.Orientation?.value).toBe(6);
      expect(sent.gps).toBeUndefined();
      expect(sent.xmp).toBeUndefined();
      expect(mock.transforms).toEqual([{ rotate: 0 }]);
      expect(mock.outputs).toEqual([{ format: "image/webp", quality: 100, anim: true }]);
      expect((await load(original.buffer, { expanded: true, async: true })).gps).toBeDefined();
    },
  );

  it.each(["jpg", "png", "heic", "webp"] as const)(
    "%s의 픽셀 회전이 필요 없으면 외부 바인딩 없이 촬영 정보만 제거",
    async (format) => {
      const original = photoFixture(format, "metadata");
      const processor = photoNormalizer(() => {
        throw new Error("외부 처리하면 안 됨");
      });
      const photo = await processor.fromBytes(original);
      expect(photo?.contentType).toBe(format === "jpg" ? "image/jpeg" : `image/${format}`);
      if (photo === null) throw new Error("사진 없음");
      const after = await load(photo.bytes.slice().buffer as ArrayBuffer, { expanded: true, async: true });
      expect(after.gps).toBeUndefined();
      expect(after.exif).toBeUndefined();
      expect(after.xmp).toBeUndefined();
    },
  );

  it("깨진 입력은 외부로 보내지 않음", async () => {
    const processor = photoNormalizer(() => {
      throw new Error("외부 처리하면 안 됨");
    });
    expect(await processor.fromBytes(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("입력 크기는 바이트 경로에서도 제한", async () => {
    await expect(
      photoNormalizer(() => {
        throw new Error("외부 처리하면 안 됨");
      }).fromBytes(new Uint8Array(MAX_PHOTO_BYTES + 1)),
    ).rejects.toMatchObject({ kind: "too_large" });
  });

  it("다운로드가 선언한 길이를 믿지 않고 초과 시 스트림을 취소", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(fixture("source"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const processor = photoNormalizer(() => {
      throw new Error("외부 처리하면 안 됨");
    });
    await expect(
      processor.fromStream(new Response(stream, { headers: { "content-length": "1" } }), 100),
    ).rejects.toMatchObject({ kind: "too_large" });
    expect(cancelled).toBe(true);
  });

  it.each([
    ["bytes", "처리 실패"],
    ["bytes", "CPU 한도"],
    ["stream", "처리 실패"],
    ["stream", "CPU 한도"],
  ] as const)("%s 수신의 %s를 원본 반환으로 바꾸거나 오류 내용을 노출하지 않음", async (mode, cause) => {
    const mock = binding(() => {
      throw new Error(cause === "CPU 한도" ? "Worker exceeded CPU time limit" : "https://example.com/private-image");
    });
    const processor = photoNormalizer(() => mock.images);
    const result =
      mode === "bytes" ? processor.fromBytes(fixture("source")) : processor.fromStream(new Response(fixture("source")));
    await expect(result).rejects.toMatchObject({
      name: "PhotoNormalizationError",
      kind: "unavailable",
      message: "photo normalization failed",
    });
  });

  it.each([
    () => new Response("not an image", { headers: { "content-type": "image/webp" } }),
    () => new Response(fixture("source"), { headers: { "content-type": "image/webp" } }),
    () => new Response(fixture("result"), { headers: { "content-type": "image/png" } }),
    () => new Response(null, { status: 502 }),
  ])("잘못된 출력·남은 방향·다른 형식·실패 응답은 저장 가능한 사진으로 반환하지 않음", async (response) => {
    const mock = binding(response);
    await expect(photoNormalizer(() => mock.images).fromBytes(fixture("source"))).rejects.toMatchObject({
      kind: "invalid_output",
    });
  });

  it("출력도 크기를 제한하고 초과 시 취소", async () => {
    let cancelled = false;
    const mock = binding(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(MAX_PHOTO_BYTES + 1));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { "content-type": "image/webp", "content-length": "1" } },
        ),
    );
    await expect(photoNormalizer(() => mock.images).fromBytes(fixture("source"))).rejects.toBeInstanceOf(
      PhotoNormalizationError,
    );
    expect(cancelled).toBe(true);
  });
});
