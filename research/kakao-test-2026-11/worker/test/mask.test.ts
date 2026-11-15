// 마스킹 단위 시험. 견본은 카카오 문서의 요청 모양에 가짜 값을 넣은 test/fixtures(출처는 fixtures/README.md)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { idToken, keyPaths, maskJson, maskText, maskUrl, shapeOf, unknownIdLikePaths, userToken, type Json } from "../src/mask.ts";

const KEY = "unit-test-hash-key";
const load = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as Json;

// 견본에 넣은 가짜 손님 값. 마스킹한 결과 어디에도 그대로 남으면 안 됨
const RAW_VALUES = [
  "fakeBotUserKey0000000000000000000000000000000000000000000000000001",
  "fakePlusfriendKey01",
  "1234567890",
  "c00000000000000000000001",
  "b00000000000000000000001",
  "010-1234-5678",
  "010 9876 5432",
  "FAKEcredential00000000000000000000",
  "FAKEsignature",
  "FAKEcallbackToken000000000000000000",
];

test("shapeOf: 글자 종류·길이, 끝의 ! 표시", () => {
  assert.equal(shapeOf("5b3c85911073e946641ebb6d"), "hex24");
  assert.equal(shapeOf("5b3c85911073e946641ebb6d!"), "hex24!");
  assert.equal(shapeOf("1234567890"), "digits10");
  assert.equal(shapeOf("ABCDEF12"), "HEX8");
  assert.equal(shapeOf("fakeKey01"), "alnum9");
  assert.equal(shapeOf("ab_-Z9"), "b64url6");
  assert.equal(shapeOf("가나다"), "mixed3");
  assert.equal(shapeOf(""), "empty0");
});

test("userToken·idToken: 같은 키·값이면 같고, 키나 값이 다르면 다름", async () => {
  const a = await userToken(KEY, "fakePlusfriendKey01");
  assert.match(a, /^uk:alnum19:[0-9a-f]{12}$/);
  assert.equal(a, await userToken(KEY, "fakePlusfriendKey01"));
  assert.notEqual(a, await userToken("other-key", "fakePlusfriendKey01"));
  assert.notEqual(a, await userToken(KEY, "fakePlusfriendKey02"));
  // 사용자 키와 일반 ID는 같은 값이어도 다른 표시(섞여 견줘지지 않게)
  assert.notEqual(a.slice(-12), (await idToken(KEY, "fakePlusfriendKey01")).slice(-12));
});

test("maskUrl: 호스트와 경로 꼴만, 쿼리는 이름만(expires 값은 둠)", () => {
  assert.equal(
    maskUrl("http://secure.kakaocdn.net/dna/O5UOr/K6auLPnoAf/XXX/img.jpg?credential=FAKEcredential00000000000000000000&expires=1542358548&allow_ip=&allow_referer=&signature=FAKEsignature%2F0000000000000%3D"),
    "http://secure.kakaocdn.net/dna/{5}/{10}/{3}/img.jpg?credential&expires=1542358548&allow_ip&allow_referer&signature",
  );
  assert.equal(maskUrl("https://bot-api.kakao.com/v1/callback/FAKEcallbackToken000000000000000000?expires=1763200000"), "https://bot-api.kakao.com/v1/callback/{35}?expires=1763200000");
  assert.equal(maskUrl("https://siljang-kakao-test.someone01.workers.dev/login/start?mode=pkce"), "https://{worker}.workers.dev/login/start?mode");
  assert.equal(maskUrl("not a url"), "{url9}");
});

test("maskText: 숫자 7개 이상·이메일·주소만 바꾸고 짧은 숫자·날짜는 둠", () => {
  assert.equal(maskText("전화 010-1234-5678, 메일 a.b@example.com"), "전화 ###-####-####, 메일 {email15}");
  assert.equal(maskText("계좌 110 123 456789"), "계좌 ### ### ######");
  assert.equal(maskText("주문 3개, 12시 30분, 123456"), "주문 3개, 12시 30분, 123456");
  assert.equal(maskText("1234567"), "#######");
  assert.equal(maskText("만료 2026-11-15T10:00:00+0900 전"), "만료 2026-11-15T10:00:00+0900 전");
  assert.equal(maskText("사진 https://example.com/a/B12345678/p.png?sig=abc 보냄"), "사진 https://example.com/a/{9}/p.png?sig 보냄");
});

test("maskJson: 기본 스킬 요청의 사용자 키·ID·발화 숫자를 바꾸고 구조는 그대로", async () => {
  const raw = load("skill-basic.json");
  const m = (await maskJson(KEY, raw)) as Record<string, any>;
  assert.deepEqual(keyPaths(m), keyPaths(raw));
  assert.match(m.userRequest.user.id, /^uk:alnum66:[0-9a-f]{12}$/);
  assert.equal(m.userRequest.user.id, m.userRequest.user.properties.botUserKey);
  assert.match(m.userRequest.user.properties.plusfriendUserKey, /^uk:/);
  assert.match(m.userRequest.user.properties.appUserId, /^uk:digits10:/);
  assert.equal(m.userRequest.user.properties.isFriend, true);
  assert.match(m.bot.id, /^id:hex24:[0-9a-f]{12}$/);
  assert.match(m.userRequest.block.id, /^id:hex24:/);
  assert.equal(m.userRequest.block.name, "폴백 블록");
  assert.equal(m.userRequest.utterance, "시험 시작 ###-####-####");
  assert.equal(m.userRequest.params.surface, "BuilderBotTest");
  assert.equal(m.action.clientExtra, null);
  const s = JSON.stringify(m);
  for (const v of RAW_VALUES) assert.ok(!s.includes(v), `남은 값: ${v}`);
});

test("maskJson: 보안 이미지 플러그인 값(JSON 글) 안의 주소도 마스킹", async () => {
  const raw = load("skill-review.json");
  const m = (await maskJson(KEY, raw)) as Record<string, any>;
  const photos = JSON.parse(m.action.params.photos);
  assert.equal(photos.privacyAgreement, "Y");
  assert.equal(photos.imageQuantity, "1");
  assert.equal(photos.expire, "1970-01-19T05:25:58+0900");
  assert.equal(photos.secureUrls, "List(http://secure.kakaocdn.net/dna/{5}/{10}/{3}/img.jpg?credential&expires=1542358548&allow_ip&allow_referer&signature)");
  assert.match(m.action.detailParams.photos.origin, /^List\(http:\/\/secure\.kakaocdn\.net\/dna\/\{5\}/);
  assert.equal(m.action.params.review_text, "케이크가 맛있었어요. 연락처 ### #### ####");
  const s = JSON.stringify(m);
  for (const v of RAW_VALUES) assert.ok(!s.includes(v), `남은 값: ${v}`);
});

test("maskJson: 콜백 주소는 토큰 경로를 꼴로, Kakao taskId는 그대로", async () => {
  const raw = load("skill-callback.json");
  const m = (await maskJson(KEY, raw)) as Record<string, any>;
  assert.equal(m.userRequest.callbackUrl, "https://bot-api.kakao.com/v1/callback/{35}?expires=1763200000");
  const res = (await maskJson(KEY, { taskId: "3b1e5f0e-0000-4000-8000-000000000000", status: "SUCCESS", message: "", timestamp: 1763200000000 })) as Record<string, any>;
  assert.equal(res.taskId, "3b1e5f0e-0000-4000-8000-000000000000");
  assert.equal(res.timestamp, 1763200000000);
});

test("maskJson: Event API 결과의 userID도 사용자 키로", async () => {
  const m = (await maskJson(KEY, { fail: { count: 1, list: [{ userID: "fakePlusfriendKey01", reqUserType: "botUserKey", errorMsg: "Invalid user key." }] } })) as Record<string, any>;
  assert.match(m.fail.list[0].userID, /^uk:/);
  assert.equal(m.fail.list[0].reqUserType, "botUserKey");
});

test("unknownIdLikePaths: 문서에 없는 ID 같은 경로만(OPEN-1의 메시지 ID 후보)", () => {
  const paths = ["bot.id", "userRequest.block.id", "userRequest.user.id", "userRequest.messageId", "userRequest.requestKey", "action.clientExtra.orderNo", "flow.lastBlock.id"];
  assert.deepEqual(unknownIdLikePaths(paths), ["userRequest.messageId", "userRequest.requestKey"]);
});
