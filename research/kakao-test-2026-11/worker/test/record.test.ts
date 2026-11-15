// 기록 만들기 단위 시험: 헤더 마스킹, 같은 요청 거르기 후보 키, 기록 본문
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { type Json } from "../src/mask.ts";
import { cfInfo, dedupBucket, dedupCandidate, maskHeaders, recordKey, safeEqual, skillRecordBase } from "../src/record.ts";

const KEY = "unit-test-hash-key";
const raw = readFileSync(new URL("./fixtures/skill-basic.json", import.meta.url), "utf8");
const payload = JSON.parse(raw) as Record<string, Json>;

test("safeEqual", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal(safeEqual("", ""), true);
  assert.equal(safeEqual("", "a"), false);
});

test("maskHeaders: 스킬 키는 맞는지만, 인증·쿠키는 길이만, IP는 스킬 요청에서만", async () => {
  const h = new Headers({
    "Siljang-Skill-Key": "right-key",
    authorization: "KakaoAK secret",
    cookie: "a=b",
    "content-type": "application/json",
    "user-agent": "AHC/2.1",
    "cf-connecting-ip": "203.0.113.7",
    "x-forwarded-for": "203.0.113.7",
    "x-request-id": "6f1c2b3a-0000-4000-8000-000000000001",
  });
  const withIp = await maskHeaders(KEY, h, { keepIp: true, skillKey: "right-key" });
  assert.equal(withIp["siljang-skill-key"], "present:matches");
  assert.equal(withIp.authorization, "omitted:14");
  assert.equal(withIp.cookie, "omitted:3");
  assert.equal(withIp["content-type"], "application/json");
  assert.equal(withIp["user-agent"], "AHC/2.1");
  assert.equal(withIp["cf-connecting-ip"], "203.0.113.7");
  assert.match(withIp["x-request-id"], /^b64url36:[0-9a-f]{12}$/);
  const noIp = await maskHeaders(KEY, h, { keepIp: false, skillKey: "other" });
  assert.equal(noIp["siljang-skill-key"], "present:differs");
  assert.equal(noIp["cf-connecting-ip"], undefined);
  assert.equal(noIp["x-forwarded-for"], undefined);
  assert.ok(!JSON.stringify(withIp).includes("secret"));
});

test("cfInfo: 고른 값만", () => {
  assert.deepEqual(cfInfo({ colo: "ICN", country: "KR", asn: 9764, asOrganization: "Kakao Corp", httpProtocol: "HTTP/1.1", tlsVersion: "TLSv1.3", clientTcpRtt: 3, latitude: "37.5" }), {
    colo: "ICN",
    country: "KR",
    asn: 9764,
    asOrganization: "Kakao Corp",
    httpProtocol: "HTTP/1.1",
    tlsVersion: "TLSv1.3",
    clientTcpRtt: 3,
  });
  assert.equal(cfInfo(undefined).colo, null);
});

test("dedupCandidate: 같은 2초 묶음 안의 같은 말은 같은 키, 말이나 묶음 번호가 다르면 다른 키", async () => {
  const t = Date.UTC(2026, 10, 15, 1, 0, 0);
  const a = await dedupCandidate(KEY, payload, t);
  assert.match(a, /^dk:[0-9a-f]{12}$/);
  assert.equal(a, await dedupCandidate(KEY, payload, t + 1999));
  assert.notEqual(a, await dedupCandidate(KEY, payload, t + 2000));
  const other = JSON.parse(raw) as Record<string, any>;
  other.userRequest.utterance = "다른 말";
  assert.notEqual(a, await dedupCandidate(KEY, other, t));
});

test("2초 묶음 경계: 2ms 차이로도 묶음 번호와 후보 키가 다를 수 있고, 시각을 뺀 키는 같음(PR 검토 지적)", async () => {
  const edge = Date.UTC(2026, 10, 15, 1, 0, 0) + 1999; // 묶음 끝
  assert.equal(dedupBucket(edge) + 1, dedupBucket(edge + 2));
  assert.notEqual(await dedupCandidate(KEY, payload, edge), await dedupCandidate(KEY, payload, edge + 2));
  const n = await dedupCandidate(KEY, payload, edge, false);
  assert.match(n, /^dn:[0-9a-f]{12}$/);
  assert.equal(n, await dedupCandidate(KEY, payload, edge + 2, false));
  assert.equal(n, await dedupCandidate(KEY, payload, edge + 60_000, false));
  const other = JSON.parse(raw) as Record<string, any>;
  other.userRequest.utterance = "다른 말";
  assert.notEqual(n, await dedupCandidate(KEY, other, edge, false));
});

test("skillRecordBase: 마스킹한 본문·키 목록·해시, 손님 값 없음", async () => {
  const rec = await skillRecordBase({
    hashKey: KEY,
    skillKey: "right-key",
    receivedMs: Date.UTC(2026, 10, 15, 1, 0, 0),
    route: "/skill",
    headers: new Headers({ "content-type": "application/json", "Siljang-Skill-Key": "right-key", "cf-connecting-ip": "203.0.113.7" }),
    cf: { colo: "ICN" },
    raw,
    payload,
  });
  assert.equal(rec.receivedAt, "2026-11-15T01:00:00.000Z");
  assert.equal(rec.bodyBytes, new TextEncoder().encode(raw).length);
  assert.match(rec.bodyHash, /^bh:[0-9a-f]{12}$/);
  assert.ok(rec.keys.includes("userRequest.user.properties.plusfriendUserKey"));
  assert.deepEqual(rec.newIdLikePaths, []);
  assert.equal(rec.headers["cf-connecting-ip"], "203.0.113.7");
  const s = JSON.stringify(rec);
  for (const v of ["fakeBotUserKey", "fakePlusfriendKey01", "1234567890", "c00000000000000000000001", "010-1234-5678", "right-key"]) assert.ok(!s.includes(v), `남은 값: ${v}`);
});

test("recordKey: rec:<ISO>:<4자>", () => {
  assert.match(recordKey(Date.UTC(2026, 10, 15, 1, 0, 0)), /^rec:2026-11-15T01:00:00\.000Z:[0-9a-f]{4}$/);
});
