// 대본 항목 고르기와 항목별 답 단위 시험
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CALLBACK_DELAYS,
  botIdReply,
  callbackDelay,
  callbackReplies,
  classify,
  emptyVariant,
  findUrls,
  loginCard,
  menuReply,
  reviewAskCard,
  reviewReply,
  secureImageUrls,
  startReply,
  type Payload,
} from "../src/items.ts";
import { LIMITS, type Button, type QuickReply, type SkillResponse } from "../src/kakao.ts";

const load = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as Payload;
const withUtterance = (u: string, base = "skill-basic.json") => {
  const p = load(base);
  p.userRequest!.utterance = u;
  return p;
};

/** 응답이 카카오 한도 안인지(바로가기 10개·버튼 3개·이름 14자·출력 3개) */
function assertWithinLimits(r: SkillResponse) {
  const outs = r.template?.outputs ?? [];
  assert.ok(outs.length >= 1 && outs.length <= LIMITS.outputs);
  const q: QuickReply[] = r.template?.quickReplies ?? [];
  assert.ok(q.length <= LIMITS.quickReplies);
  const labels = q.map((x) => x.label);
  for (const o of outs) {
    if ("textCard" in o) {
      const b: Button[] = o.textCard.buttons ?? [];
      assert.ok(b.length <= LIMITS.buttons);
      labels.push(...b.map((x) => x.label));
    }
    if ("simpleText" in o) assert.ok([...o.simpleText.text].length <= LIMITS.simpleText);
  }
  for (const l of labels) assert.ok([...l].length <= LIMITS.buttonLabel, `이름이 김: ${l}`);
}

test("classify: 대본의 말마다 항목", () => {
  const cases: [string, string][] = [
    ["시험 시작", "K-01"],
    ["시험 메뉴", "K-01"],
    ["같은 말", "K-02"],
    ["  같은   말 ", "K-02"],
    ["늦게 4", "K-03a"],
    ["늦게 6", "K-03b"],
    ["빈 응답 1", "K-04-1"],
    ["빈 응답 2", "K-04-2"],
    ["빈 응답 3", "K-04-3"],
    ["빈 응답 4", "K-04-4"],
    ["콜백 시험", "K-05"],
    ["콜백 50초", "K-05"],
    ["후기 시험", "K-07-setup"],
    ["후기 부탁", "K-08"],
    ["봇 ID", "K-09"],
    ["이벤트 시험", "K-10"],
    ["로그인 시험", "K-11"],
    ["http://dn-m.talk.kakao.com/talkm/abc/img.jpg", "K-06"],
    ["아무 말", "K-00"],
    ["", "K-00"],
  ];
  for (const [u, item] of cases) assert.equal(classify(withUtterance(u)), item, u);
});

test("classify: 콜백 주소·후기 파라미터·extra·이벤트 params가 말보다 먼저", () => {
  assert.equal(classify(load("skill-callback.json")), "K-05");
  assert.equal(classify(load("skill-review.json")), "K-07");
  const b = load("skill-review.json");
  b.action!.clientExtra = { orderNo: "T-1A2B" };
  assert.equal(classify(b), "K-08b");
  const e = withUtterance("시험 시작");
  e.userRequest!.params = { check: "event", sentAt: "2026-11-15T10:00:00.000Z" };
  assert.equal(classify(e), "K-10b");
  const d = withUtterance("아무 말");
  d.action!.clientExtra = { delay: 20 };
  assert.equal(classify(d), "K-05");
});

test("emptyVariant: 빈 응답 네 가지(OPEN-4)", () => {
  assert.deepEqual(emptyVariant("K-04-1"), { status: 200, body: '{"version":"2.0","template":{"outputs":[]}}' });
  assert.deepEqual(emptyVariant("K-04-2"), { status: 200, body: "" });
  assert.deepEqual(emptyVariant("K-04-3"), { status: 200, body: '{"version":"2.0"}' });
  assert.deepEqual(emptyVariant("K-04-4"), { status: 204, body: null });
  assert.equal(emptyVariant("K-01"), null);
});

test("callbackDelay: extra가 먼저, 없으면 말의 숫자, 없으면 3초, 0~600초", () => {
  assert.equal(callbackDelay(withUtterance("콜백 시험")), 3);
  assert.equal(callbackDelay(withUtterance("콜백 50초")), 50);
  const p = withUtterance("콜백 50초");
  p.action!.clientExtra = { delay: 280 };
  assert.equal(callbackDelay(p), 280);
  p.action!.clientExtra = { delay: 9999 };
  assert.equal(callbackDelay(p), 600);
  p.action!.clientExtra = { delay: -5 };
  assert.equal(callbackDelay(p), 0);
});

test("callbackReplies: 블록 ID를 알면 블록 바로가기+extra.delay, 모르면 말", () => {
  const withBlock = callbackReplies("b00000000000000000000002");
  assert.deepEqual(withBlock.map((q) => q.extra?.delay), CALLBACK_DELAYS);
  assert.ok(withBlock.every((q) => q.action === "block" && q.blockId === "b00000000000000000000002"));
  assert.ok(callbackReplies(null).every((q) => q.action === "message" && q.messageText?.startsWith("콜백 ")));
  // 280초는 문서의 5분 안, 320초는 밖
  assert.ok(CALLBACK_DELAYS.includes(280) && CALLBACK_DELAYS.includes(320));
});

test("findUrls: 사진 주소를 찾고 콜백 주소는 빼고 같은 주소는 한 번", () => {
  const p = withUtterance("http://dn-m.talk.kakao.com/a.jpg");
  p.userRequest!.params = { media: "http://dn-m.talk.kakao.com/a.jpg" };
  const found = findUrls(p);
  assert.equal(found.length, 1);
  assert.equal(found[0].url, "http://dn-m.talk.kakao.com/a.jpg");
  assert.deepEqual(findUrls(load("skill-callback.json")), []);
  assert.equal(findUrls(load("skill-review.json")).length, 1);
});

test("secureImageUrls: 보안 이미지 값의 List(...)에서 주소", () => {
  const p = load("skill-review.json");
  const urls = secureImageUrls(p.action!.params!.photos);
  assert.equal(urls.length, 1);
  assert.ok(urls[0].startsWith("http://secure.kakaocdn.net/dna/"));
  assert.deepEqual(secureImageUrls(undefined), []);
  assert.deepEqual(secureImageUrls("List(http://a.example/1.jpg, http://a.example/2.jpg)"), ["http://a.example/1.jpg", "http://a.example/2.jpg"]);
});

test("botIdReply: 대화창 답에는 끝 4자, 기록용 답에는 없음", () => {
  const { reply, recorded } = botIdReply("c00000000000000000000abc!");
  const t = (r: SkillResponse) => (r.template!.outputs[0] as { simpleText: { text: string } }).simpleText.text;
  assert.match(t(reply), /hex24!/);
  assert.match(t(reply), /0abc/);
  assert.doesNotMatch(t(recorded), /0abc/);
  assert.match(t(recorded), /\*\*\*\*/);
});

test("답들이 카카오 한도 안", () => {
  assertWithinLimits(startReply({ recordKey: "rec:2026-11-15T00:00:00.000Z:abcd", ms: 3, colo: "ICN", isFriend: true, hasAppUserId: false }));
  assertWithinLimits(menuReply(true));
  assertWithinLimits(reviewAskCard("b00000000000000000000003", "T-1A2B"));
  assertWithinLimits(loginCard("https://example.workers.dev"));
  assertWithinLimits(reviewReply("K-08b", { textLen: 10, photos: ["200 · image/jpeg"], consent: "예", extraKeys: ["orderNo"], orderNo: "T-1A2B", pending: true }));
  const card = reviewAskCard("b00000000000000000000003", "T-1A2B").template!.outputs[0] as { textCard: { buttons: Button[] } };
  assert.deepEqual(card.textCard.buttons[0], { label: "후기 남기기", action: "block", blockId: "b00000000000000000000003", extra: { orderNo: "T-1A2B" } });
  const login = loginCard("https://example.workers.dev").template!.outputs[0] as { textCard: { buttons: Button[] } };
  assert.deepEqual(
    login.textCard.buttons.map((b) => b.webLinkUrl),
    ["pkce", "pkce_wrong", "plain"].map((m) => `https://example.workers.dev/login/start?mode=${m}`),
  );
});
