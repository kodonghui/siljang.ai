import { readBytesLimited } from "./body";
import { sanitizePhoto } from "./photo-metadata";
import { webpOrientation } from "./photo-metadata/webp";

/** API-007과 카카오 사진 수신의 최대 크기. 읽는 도중에도 제한한다. */
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

export interface ImageBinding {
  input(stream: ReadableStream<Uint8Array>): ImageTransformer;
}

interface ImageTransformer {
  transform(options: { rotate: 0 }): ImageTransformer;
  output(options: { format: "image/webp"; quality: 100; anim: true }): Promise<{ response(): Response }>;
}

export class PhotoNormalizationError extends Error {
  override readonly name = "PhotoNormalizationError";
  constructor(readonly kind: "too_large" | "unavailable" | "invalid_output") {
    super("photo normalization failed");
  }
}

export type NormalizedPhoto = NonNullable<ReturnType<typeof sanitizePhoto>>;
type PhotoBody = Pick<Request, "headers" | "body">;

export interface PhotoNormalizer {
  fromBytes(bytes: Uint8Array): Promise<NormalizedPhoto | null>;
  /** 카카오 다운로드의 HTTP 응답을 넘긴다. URL을 열거나 저장소에 쓰지 않는다. */
  fromStream(response: PhotoBody, limit?: number): Promise<NormalizedPhoto | null>;
}

/** 촬영 정보는 외부 처리에 보내기 전과 받은 뒤 모두 제거한다. 회전 실패 때 원본으로 돌아가지 않는다. */
export function photoNormalizer(images: () => ImageBinding): PhotoNormalizer {
  async function fromBytes(bytes: Uint8Array): Promise<NormalizedPhoto | null> {
    if (bytes.byteLength > MAX_PHOTO_BYTES) throw new PhotoNormalizationError("too_large");
    const photo = sanitizePhoto(bytes);
    if (photo === null || photo.contentType !== "image/webp" || webpOrientation(photo.bytes) === 1) return photo;
    // 바인딩 누락은 어댑터의 설정 오류를 유지한다. 나머지 형식은 이 바인딩을 요구하지 않는다.
    const binding = images();
    try {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(photo.bytes);
          controller.close();
        },
      });
      const result = await binding.input(stream).transform({ rotate: 0 }).output({
        format: "image/webp",
        quality: 100,
        anim: true,
      });
      const response = result.response();
      if (!response.ok || response.headers.get("content-type")?.split(";", 1)[0] !== "image/webp") {
        await response.body?.cancel().catch(() => {});
        throw new PhotoNormalizationError("invalid_output");
      }
      let output: Uint8Array;
      try {
        output = await readBytesLimited(response, MAX_PHOTO_BYTES, () => new PhotoNormalizationError("too_large"));
      } catch (error) {
        await response.body?.cancel().catch(() => {});
        throw error;
      }
      const normalized = sanitizePhoto(output);
      if (normalized === null || normalized.contentType !== "image/webp" || webpOrientation(normalized.bytes) !== 1) {
        throw new PhotoNormalizationError("invalid_output");
      }
      return normalized;
    } catch (error) {
      if (error instanceof PhotoNormalizationError) throw error;
      throw new PhotoNormalizationError("unavailable");
    }
  }
  return {
    fromBytes,
    async fromStream(response, limit = MAX_PHOTO_BYTES) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PHOTO_BYTES)
        throw new RangeError("invalid photo limit");
      return fromBytes(await readBytesLimited(response, limit, () => new PhotoNormalizationError("too_large")));
    },
  };
}
