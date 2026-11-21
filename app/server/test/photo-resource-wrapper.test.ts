import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import realProbe from "../../../research/webp-orientation-2026-11/runtime-probe";
import { PHOTO_PROBE_PREFIX, withPhotoProbe } from "../../../research/webp-orientation-2026-11/wrap-existing-worker";
import type { ImageBinding } from "../src/photo-normalizer";

const images: ImageBinding = {
  input: () => {
    throw new Error("unexpected image call");
  },
};
const context = { marker: "same context" };
const env = { PHOTO_RESOURCE_PROBE_KEY: "fake-probe", IMAGES: images };
const authorized = { authorization: `Bearer ${env.PHOTO_RESOURCE_PROBE_KEY}` };

function fixture() {
  const base = {
    fetch: vi.fn(async (_request: Request, _env: object, _context: object) => new Response("base")),
    queue: vi.fn(async (_value: unknown) => {}),
    sentinel: "base metadata",
  };
  const probe = {
    fetch: vi.fn(
      async (_request: Request, _env: { IMAGES: ImageBinding; PROBE_TOKEN?: string }) => new Response("probe"),
    ),
  };
  return { base, probe, worker: withPhotoProbe(base, probe) };
}

describe("TASK-183 기존 시험 Worker의 별도 측정 경로", () => {
  it.each(["stream", "multipart"] as const)(
    "%s는 실제 공통 모듈/처리기와 메모리 저장까지 돌고 DB/S3 설정을 요구하지 않는다",
    async (mode) => {
      const original = new Uint8Array(readFileSync(new URL("./fixtures/photos/pixel-source.webp", import.meta.url)));
      const normalized = new Uint8Array(readFileSync(new URL("./fixtures/photos/pixel-result.webp", import.meta.url)));
      let conversions = 0;
      const binding: ImageBinding = {
        input() {
          const builder = {
            transform: () => builder,
            async output() {
              conversions += 1;
              return { response: () => new Response(normalized, { headers: { "content-type": "image/webp" } }) };
            },
          };
          return builder;
        },
      };
      const base = { fetch: vi.fn(async (_request: Request, _env: object, _context: object) => new Response("base")) };
      const worker = withPhotoProbe(base, realProbe);
      let body: FormData | Uint8Array<ArrayBuffer>;
      if (mode === "multipart") {
        const form = new FormData();
        form.set("purpose", "completion_photo");
        form.set("file", new File([original], "synthetic.webp", { type: "image/webp" }));
        body = form;
      } else body = original;
      const response = await worker.fetch(
        new Request(`https://worker.example.test${PHOTO_PROBE_PREFIX}/${mode}`, {
          method: "POST",
          headers: authorized,
          body,
        }),
        { PHOTO_RESOURCE_PROBE_KEY: env.PHOTO_RESOURCE_PROBE_KEY, IMAGES: binding },
        context,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/webp");
      if (mode === "multipart") expect(response.headers.get("x-upload-status")).toBe("201");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(normalized);
      expect(conversions).toBe(1);
      expect(base.fetch).not.toHaveBeenCalled();
    },
  );

  it.each(["/health", "/skill", "/login/start", "/__task183_resource-other/stream"])(
    "%s는 같은 요청·환경·문맥으로 기존 기능을 부른다",
    async (path) => {
      const { base, probe, worker } = fixture();
      const request = new Request(`https://worker.example.test${path}`);
      expect(await (await worker.fetch(request, env, context)).text()).toBe("base");
      expect(base.fetch).toHaveBeenCalledExactlyOnceWith(request, env, context);
      expect(probe.fetch).not.toHaveBeenCalled();
    },
  );

  it("기존 큐 핸들러와 다른 내보내기는 같은 참조로 유지한다", async () => {
    const { base, worker } = fixture();
    expect(worker.queue).toBe(base.queue);
    expect(worker.sentinel).toBe(base.sentinel);
    const batch = { marker: "same queue" };
    await worker.queue(batch);
    expect(base.queue).toHaveBeenCalledExactlyOnceWith(batch);
  });

  it("측정 키가 없으면 기존 처리기와 외부 이미지를 부르지 않고401", async () => {
    const { base, probe, worker } = fixture();
    const response = await worker.fetch(
      new Request(`https://worker.example.test${PHOTO_PROBE_PREFIX}/stream`, { method: "POST" }),
      {},
      context,
    );
    expect(response.status).toBe(401);
    expect(base.fetch).not.toHaveBeenCalled();
    expect(probe.fetch).not.toHaveBeenCalled();
  });

  it("키가 다르면 기존 처리기나 측정기로 요청을 넘기지 않는다", async () => {
    const { base, probe, worker } = fixture();
    const response = await worker.fetch(
      new Request(`https://worker.example.test${PHOTO_PROBE_PREFIX}/stream`, {
        method: "POST",
        headers: { authorization: "Bearer other" },
      }),
      env,
      context,
    );
    expect(response.status).toBe(401);
    expect(base.fetch).not.toHaveBeenCalled();
    expect(probe.fetch).not.toHaveBeenCalled();
  });

  it("인증됐어도 Images가 없으면503이며 기존 처리기로 되돌아가지 않는다", async () => {
    const { base, probe, worker } = fixture();
    const response = await worker.fetch(
      new Request(`https://worker.example.test${PHOTO_PROBE_PREFIX}/stream`, { method: "POST", headers: authorized }),
      { PHOTO_RESOURCE_PROBE_KEY: env.PHOTO_RESOURCE_PROBE_KEY },
      context,
    );
    expect(response.status).toBe(503);
    expect(base.fetch).not.toHaveBeenCalled();
    expect(probe.fetch).not.toHaveBeenCalled();
  });

  it("바이트·형식·쿼리를 보존하고 측정기에 필요한 바인딩만 넘긴다", async () => {
    const { base, probe, worker } = fixture();
    const body = new Uint8Array([1, 2, 3, 4]);
    probe.fetch.mockImplementationOnce(async (request, received) => {
      expect(new URL(request.url).pathname).toBe("/stream");
      expect(new URL(request.url).search).toBe("?case=1");
      expect(request.headers.get("content-type")).toBe("image/webp");
      expect(Object.keys(received).sort()).toEqual(["IMAGES", "PROBE_TOKEN"]);
      expect(received.IMAGES).toBe(images);
      expect(received.PROBE_TOKEN).toBe(env.PHOTO_RESOURCE_PROBE_KEY);
      return new Response(await request.arrayBuffer());
    });
    const response = await worker.fetch(
      new Request(`https://worker.example.test${PHOTO_PROBE_PREFIX}/stream?case=1`, {
        method: "POST",
        headers: { ...authorized, "content-type": "image/webp" },
        body,
      }),
      env,
      context,
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(body);
    expect(base.fetch).not.toHaveBeenCalled();
  });

  it("사장님 multipart의 경계·용도·파일 바이트가 측정기까지 유지된다", async () => {
    const { base, probe, worker } = fixture();
    const body = new FormData();
    body.set("purpose", "completion_photo");
    body.set("file", new File([new Uint8Array([7, 8, 9])], "synthetic.webp", { type: "image/webp" }));
    probe.fetch.mockImplementationOnce(async (request) => {
      expect(new URL(request.url).pathname).toBe("/multipart");
      const form = await request.formData();
      expect(form.get("purpose")).toBe("completion_photo");
      const file = form.get("file");
      expect(file).toBeInstanceOf(File);
      if (!(file instanceof File)) throw new Error("missing file");
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([7, 8, 9]));
      return new Response(null, { status: 201 });
    });
    const response = await worker.fetch(
      new Request(`https://worker.example.test${PHOTO_PROBE_PREFIX}/multipart`, {
        method: "POST",
        headers: authorized,
        body,
      }),
      env,
      context,
    );
    expect(response.status).toBe(201);
    expect(base.fetch).not.toHaveBeenCalled();
  });
});
