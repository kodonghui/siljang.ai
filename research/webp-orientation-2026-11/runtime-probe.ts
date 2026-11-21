import { AsyncLocalStorage } from "node:async_hooks";
import { createApp } from "../../app/server/src/app";
import { createOwnerScope } from "../../app/server/src/owner-scope";
import {
	type ImageBinding,
	photoNormalizer,
} from "../../app/server/src/photo-normalizer";
import { ownerRoute } from "../../app/server/src/routes";
import type { ObjectStore } from "../../app/server/src/storage";
import { createUpload } from "../../app/server/src/uploads";

// 합성 입력 전용 자원 검사. 실제 로그인·DB·S3·카카오 다운로드를 검증하지 않는다.
const captures = new AsyncLocalStorage<{
	bytes?: Uint8Array;
	contentType?: string;
}>();
const storage: ObjectStore = {
	async put(_key, body, contentType) {
		const capture = captures.getStore();
		if (capture === undefined) throw new Error("capture missing");
		capture.bytes = body.slice();
		capture.contentType = contentType;
	},
	async head() {
		return null;
	},
	async get() {
		return null;
	},
	async copy() {
		throw new Error("copy not permitted");
	},
	async delete() {
		throw new Error("delete not permitted");
	},
	async list() {
		return { keys: [], truncated: false };
	},
};
let app: ReturnType<typeof createApp> | undefined;

export default {
	async fetch(
		request: Request,
		env: { IMAGES: ImageBinding; PROBE_TOKEN?: string },
	) {
		if (
			!env.PROBE_TOKEN ||
			request.headers.get("authorization") !== `Bearer ${env.PROBE_TOKEN}`
		)
			return new Response(null, { status: 401 });
		if (request.method !== "POST") return new Response(null, { status: 405 });
		const mode = new URL(request.url).pathname;
		try {
			if (mode === "/stream") {
				const photo = await photoNormalizer(() => env.IMAGES).fromStream(
					request,
				);
				if (photo === null) return new Response(null, { status: 422 });
				return new Response(photo.bytes, {
					headers: {
						"content-type": photo.contentType,
						"cache-control": "no-store",
					},
				});
			}
			if (mode !== "/multipart") return new Response(null, { status: 404 });
			app ??= createApp({
				routes: [ownerRoute("POST", "/owner/uploads", createUpload)],
				logSink: () => {},
				ownerAccount: async () =>
					createOwnerScope("00000000-0000-4000-8000-000000000183"),
				services: {
					storage,
					images: env.IMAGES,
					limiters: { UPLOAD_RATE_LIMITER: { limit: async () => true } },
				},
			});
			return await captures.run({}, async () => {
				const response = await app!.request(
					new Request(new URL("/api/owner/uploads", request.url), request),
					undefined,
					{ APP_ENV: "development" },
				);
				const capture = captures.getStore();
				if (response.status !== 201 || capture?.bytes === undefined)
					return response;
				return new Response(capture.bytes, {
					headers: {
						"content-type": capture.contentType ?? "application/octet-stream",
						"cache-control": "no-store",
						"x-upload-status": "201",
					},
				});
			});
		} catch (error) {
			return Response.json(
				{ code: error instanceof Error ? error.name : "Error" },
				{ status: 503 },
			);
		}
	},
};
