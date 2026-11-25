import assert from "node:assert/strict";
import test from "node:test";
import { renderConversationFrame } from "./build-kakao-consultation.mjs";

test("긴 확정 안내의 텍스트 캐러셀은 원문을 안전하게 표시한다", () => {
  const html = renderConversationFrame({ state: "normal", hideUserText: true,
    body: { version: "2.0", template: { outputs: [{ carousel: { type: "textCard", items: [{ title: "확정 안내 1\n<합성>", description: "합성 원문 & 규정" }] } }] } },
  }, 360, "", "손님 알림");
  assert.ok(html.includes("&lt;합성&gt;"));
  assert.ok(html.includes("합성 원문 &amp; 규정"));
  assert.ok(!html.includes('role="img"'));
});

test("합성 알림의 사진5장은 외부 요청 없이 같은 비율로 표시하고 손님 발화를 만들지 않는다", () => {
  const output = { carousel: { type: "basicCard", items: Array.from({ length: 5 }, (_, i) => ({
    title: `완성 사진 ${i + 1}/5`,
    thumbnail: { imageUrl: `https://photos.example/synthetic/${i}`, altText: "<합성 사진>", fixedRatio: true },
  })) } };
  const html = renderConversationFrame({
    state: "photo-consent", hideUserText: true,
    body: { version: "2.0", template: { outputs: [output] } },
  }, 360, "", "손님 알림");
  assert.equal((html.match(/role="img"/g) ?? []).length, 5);
  assert.ok(html.includes("&lt;합성 사진&gt;"));
  assert.ok(!html.includes("https://photos.example"));
  assert.ok(!html.includes('class="bubble customer"'));
  assert.ok(html.includes("aspect-ratio:1"));
});
