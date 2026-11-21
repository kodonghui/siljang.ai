import type { ImageBinding } from "../../app/server/src/photo-normalizer";

export const PHOTO_PROBE_PREFIX = "/__task183_resource";
export interface PhotoProbeBindings {
  readonly PHOTO_RESOURCE_PROBE_KEY?: string;
  readonly IMAGES?: ImageBinding;
}
interface Probe {
  fetch(request: Request, env: { IMAGES: ImageBinding; PROBE_TOKEN?: string }): Promise<Response>;
}
interface FetchHandler<Env, Context> {
  fetch(request: Request, env: Env, context: Context): Response | Promise<Response>;
}

/** 기존 시험 기능을 위임하고 별도 인증된 합성 경로만 측정한다. */
export function withPhotoProbe<Env, Context, Rest extends object>(
  base: Rest & FetchHandler<Env, Context>,
  probe: Probe,
) {
  return {
    ...base,
    async fetch(request: Request, env: Env & PhotoProbeBindings, context: Context): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname !== PHOTO_PROBE_PREFIX && !url.pathname.startsWith(`${PHOTO_PROBE_PREFIX}/`))
        return base.fetch(request, env, context);
      const key = env.PHOTO_RESOURCE_PROBE_KEY;
      if (!key || request.headers.get("authorization") !== `Bearer ${key}`) return new Response(null, { status: 401 });
      if (env.IMAGES === undefined) return new Response(null, { status: 503 });
      url.pathname = url.pathname.slice(PHOTO_PROBE_PREFIX.length) || "/";
      return probe.fetch(new Request(url, request), { IMAGES: env.IMAGES, PROBE_TOKEN: key });
    },
  };
}
