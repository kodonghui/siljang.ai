import { expect, it } from "vitest";
import { isKakaoPhotoUtterance } from "../src/kakao-photo-inbound";
import { kakaoReviewPhotoUrls } from "../src/kakao-review-photos";

const now = new Date("2026-11-25T00:00:00Z");
function plugin(url: string, expire = "2026-11-25T09:05:00+0900") {
  return JSON.stringify({ privacyAgreement: "Y", imageQuantity: "1", secureUrls: `List(${url})`, expire });
}

it("공식 플러그인의 콜론 없는 시간대와 HTTP 보안 이미지 주소를 HTTPS로 정규화한다", () => {
  expect(
    kakaoReviewPhotoUrls(plugin("http://secure.kakaocdn.net/dna/synthetic/photo.png?signature=synthetic"), now),
  ).toEqual(["https://secure.kakaocdn.net/dna/synthetic/photo.png?signature=synthetic"]);
});

it.each(["+0900", "+09:00", ""])("같은 서울 만료 시각의 %s 표기를 받는다", (offset) => {
  const url = "https://t1.daumcdn.net/synthetic/photo.png";
  expect(kakaoReviewPhotoUrls(plugin(url, `2026-11-25T09:05:00${offset}`), now)).toEqual([url]);
});

it.each([
  "http://secure.kakaocdn.net.example/photo.png",
  "http://cdn.kakaocdn.net/photo.png",
  "http://secure.kakaocdn.net:8080/photo.png",
  "http://user:password@secure.kakaocdn.net/photo.png",
])("임의 HTTP 주소는 보안 이미지로 바꾸지 않는다 %s", (url) => {
  expect(kakaoReviewPhotoUrls(plugin(url), now)).toBe("review_invalid");
});

it.each([
  "https://example.com/design",
  "http://example.com/design",
  "https://pf.kakao.com/example",
  "https://www.kakao.com/service",
])("단독 일반 링크는 글 경로로 남긴다 %s", (url) => expect(isKakaoPhotoUtterance(url)).toBe(false));

it.each(["https://t1.daumcdn.net/synthetic/photo.png", "https://cdn.kakaocdn.net/synthetic/photo.png"])(
  "카카오 이미지 주소 한 줄만 사진 수신으로 고른다 %s",
  (url) => expect(isKakaoPhotoUtterance(url)).toBe(true),
);
