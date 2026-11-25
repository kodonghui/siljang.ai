/** SPEC019·DEC28: 허용된 카카오 HTTPS에서만 받고 G10 정리를 마친 사진만 돌려줍니다. */
import { declaredOver, readBytesLimited } from "./body";
import { MAX_PHOTO_BYTES, type NormalizedPhoto, type PhotoNormalizer } from "./photo-normalizer";

export const KAKAO_PHOTO_MAX_BYTES = MAX_PHOTO_BYTES;
// research/kakao-test-2026-11의 확인용 목록. 운영에서는 HTTPS만 허용하고 추가 호스트 설정은 받지 않습니다.
const HOSTS = ["kakaocdn.net", "kakao.com", "kakao.co.kr", "daumcdn.net"] as const;
const REDIRECTS = [301, 302, 303, 307, 308];
const REJECTED = { ok: false, reason: "rejected" } as const;
const UNAVAILABLE = { ok: false, reason: "unavailable" } as const;
export type KakaoPhotoDownload =
  | { readonly ok: true; readonly photo: NormalizedPhoto }
  | typeof REJECTED
  | typeof UNAVAILABLE;

export function kakaoPhotoUrl(raw: string): URL | null {
  if (raw.length > 2048 || [...raw].some((c) => c.charCodeAt(0) <= 0x20)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return url.toString().length <= 2048 &&
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    url.hash === "" &&
    HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
    ? url
    : null;
}
class TooLarge extends Error {
  override readonly name = "KakaoPhotoTooLarge";
}
async function cancel(response: Response) {
  await response.body?.cancel().catch(() => {});
}

/** 원래 주소나 오류 본문은 반환하지 않습니다. 통신 실패만 한 번 다시 받고 형식/안전성/크기 거절은 반복하지 않습니다. */
export async function downloadKakaoPhoto(
  raw: string,
  photos: PhotoNormalizer,
  options: { readonly fetch?: typeof fetch; readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): Promise<KakaoPhotoDownload> {
  const initial = kakaoPhotoUrl(raw);
  if (initial === null) return REJECTED;
  const timeout = options.timeoutMs ?? 6000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 6000) throw new RangeError("invalid photo timeout");
  const send = options.fetch ?? fetch;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (options.signal?.aborted) return UNAVAILABLE;
    const timer = AbortSignal.timeout(timeout);
    const signal = options.signal === undefined ? timer : AbortSignal.any([timer, options.signal]);
    let current = initial;
    try {
      for (let hop = 0; hop <= 3; hop++) {
        const response = await send(current, { method: "GET", redirect: "manual", signal });
        if (REDIRECTS.includes(response.status)) {
          await cancel(response);
          const location = response.headers.get("Location");
          if (location === null) throw new Error("photo redirect missing");
          let target: URL | null;
          try {
            target = kakaoPhotoUrl(new URL(location, current).toString());
          } catch {
            return REJECTED;
          }
          if (target === null || hop === 3) return REJECTED;
          current = target;
          continue;
        }
        if (!response.ok) {
          await cancel(response);
          throw new Error("photo download unavailable");
        }
        if (declaredOver(response, KAKAO_PHOTO_MAX_BYTES)) {
          await cancel(response);
          return REJECTED;
        }
        const bytes = await readBytesLimited(response, KAKAO_PHOTO_MAX_BYTES, () => new TooLarge("photo limit"));
        if (signal.aborted) throw new Error("photo download expired");
        let photo: NormalizedPhoto | null;
        try {
          photo = await photos.fromBytes(bytes);
        } catch {
          return UNAVAILABLE;
        }
        return photo !== null && photo.bytes.byteLength <= KAKAO_PHOTO_MAX_BYTES ? { ok: true, photo } : REJECTED;
      }
    } catch (error) {
      if (error instanceof TooLarge) return REJECTED;
      if (options.signal?.aborted) return UNAVAILABLE;
    }
  }
  return UNAVAILABLE;
}
