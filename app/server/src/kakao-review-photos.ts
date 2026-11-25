import type { KakaoPhotoOutcome } from "./kakao-photo-context";
import { kakaoPhotoUrl } from "./kakao-photo-download";

/** API072 보안 이미지 플러그인의 주소는 게시 동의와 구분하며, 원문은 반환/기록하지 않습니다. */
export function kakaoReviewPhotoUrls(raw: unknown, receivedAt: Date): readonly string[] | KakaoPhotoOutcome {
  if (typeof raw !== "string" || raw.length > 24_000) return "review_invalid";
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return "review_invalid";
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("privacyAgreement" in value) ||
    value.privacyAgreement !== "Y" ||
    !("imageQuantity" in value) ||
    typeof value.imageQuantity !== "string" ||
    !/^[1-5]$/.test(value.imageQuantity) ||
    !("secureUrls" in value) ||
    typeof value.secureUrls !== "string" ||
    !("expire" in value) ||
    typeof value.expire !== "string"
  )
    return "review_invalid";
  const list = /^List\((.+)\)$/.exec(value.secureUrls);
  if (list?.[1] === undefined) return "review_invalid";
  const values = list[1].split(",").map((v) => v.trim());
  if (values.length !== Number(value.imageQuantity)) return "review_invalid";
  const urls: string[] = [];
  for (const item of values) {
    const url = kakaoPhotoUrl(item);
    if (url === null) return "review_invalid";
    urls.push(url.toString());
  }
  const date = value.expire;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?$/.test(date)) return "review_invalid";
  const expiry = Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(date) ? date : `${date}+09:00`);
  if (!Number.isFinite(expiry)) return "review_invalid";
  return expiry <= receivedAt.getTime() || expiry > receivedAt.getTime() + 600_000 ? "photo_download_failed" : urls;
}
