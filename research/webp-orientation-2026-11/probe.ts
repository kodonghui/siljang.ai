import { readBytesLimited } from "../../app/server/src/body";
import { sanitizePhoto } from "../../app/server/src/photo-metadata";

interface ImageInput {
  transform(options: { rotate: number }): ImageInput;
  output(options: { format: "image/webp"; quality: number; anim: boolean }): Promise<{ response(): Response }>;
}

/** 버리는 Wrangler 원격 미리보기 전용. 앱의 API나 저장소에는 연결하지 않는다. */
export default {
  async fetch(request: Request, env: { IMAGES: { input(stream: ReadableStream<Uint8Array>): ImageInput } }) {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const input = await readBytesLimited(request, 20 * 1024 * 1024, () => new Error("input too large"));
    const clean = sanitizePhoto(input);
    if (clean === null || clean.contentType !== "image/webp") return new Response(null, { status: 422 });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(clean.bytes);
        controller.close();
      },
    });
    // 먼저 기존 EXIF 방향만 넘겨 Images의 자동 방향 보정을 확인한다.
    const result = await env.IMAGES.input(stream).transform({ rotate: 0 }).output({
      format: "image/webp",
      quality: 100,
      anim: true,
    });
    const output = sanitizePhoto(new Uint8Array(await result.response().arrayBuffer()));
    if (output === null) return new Response(null, { status: 502 });
    return new Response(output.bytes, { headers: { "Content-Type": "image/webp", "Cache-Control": "no-store" } });
  },
};
