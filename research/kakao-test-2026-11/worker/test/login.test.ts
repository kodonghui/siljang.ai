// 카카오 로그인 PKCE 시험(K-11)의 순수 함수 단위 시험
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TICKET_TTL_SEC,
  authorizeUrl,
  makeState,
  makeTicket,
  outcomeOf,
  randomB64url,
  resultPage,
  s256,
  stateValid,
  summarizeToken,
  ticketValid,
  tokenForm,
  verdict,
} from "../src/login.ts";

test("s256: RFC 7636 부록 B의 예", async () => {
  assert.equal(await s256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("randomB64url: verifier 길이 43자(RFC 7636의 43~128자), 허용 글자만", () => {
  const v = randomB64url(32);
  assert.equal(v.length, 43);
  assert.match(v, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(v, randomB64url(32));
});

test("authorizeUrl: challenge가 있을 때만 code_challenge·S256", () => {
  const withC = new URL(authorizeUrl({ clientId: "fake-rest-key", redirectUri: "https://example.workers.dev/login/callback", state: "st", challenge: "ch" }));
  assert.equal(withC.origin + withC.pathname, "https://kauth.kakao.com/oauth/authorize");
  assert.equal(withC.searchParams.get("response_type"), "code");
  assert.equal(withC.searchParams.get("state"), "st");
  assert.equal(withC.searchParams.get("code_challenge"), "ch");
  assert.equal(withC.searchParams.get("code_challenge_method"), "S256");
  const plain = new URL(authorizeUrl({ clientId: "fake-rest-key", redirectUri: "https://example.workers.dev/login/callback", state: "st" }));
  assert.equal(plain.searchParams.has("code_challenge"), false);
  assert.equal(plain.searchParams.has("code_challenge_method"), false);
});

test("tokenForm: client_secret·code_verifier는 있을 때만", () => {
  const f = tokenForm({ clientId: "k", redirectUri: "https://e/cb", code: "c", clientSecret: "s", verifier: "v" });
  assert.equal(f.get("grant_type"), "authorization_code");
  assert.equal(f.get("client_secret"), "s");
  assert.equal(f.get("code_verifier"), "v");
  const g = tokenForm({ clientId: "k", redirectUri: "https://e/cb", code: "c" });
  assert.equal(g.has("client_secret"), false);
  assert.equal(g.has("code_verifier"), false);
});

test("summarizeToken: 토큰 값은 남기지 않고 있었는지만", () => {
  const ok = summarizeToken(200, { access_token: "FAKE_ACCESS_TOKEN_123", token_type: "bearer", refresh_token: "FAKE_REFRESH", id_token: "FAKE_ID_TOKEN", expires_in: 21599 });
  assert.equal(ok.ok, true);
  assert.equal(ok.hasAccessToken, true);
  assert.equal(ok.hasIdToken, true);
  assert.equal(ok.tokenType, "bearer");
  assert.ok(!JSON.stringify(ok).includes("FAKE_"));
  const bad = summarizeToken(400, { error: "invalid_grant", error_description: "PKCE verification failed.", error_code: "KOE320" });
  assert.equal(bad.ok, false);
  assert.equal(bad.errorCode, "KOE320");
  assert.equal(bad.error, "invalid_grant");
  assert.equal(summarizeToken(500, null).ok, false);
});

test("outcomeOf: invalid_grant(4xx)만 거절, 다른 실패는 알 수 없음", () => {
  assert.equal(outcomeOf(summarizeToken(200, { access_token: "x", token_type: "bearer" })), "ok");
  assert.equal(outcomeOf(summarizeToken(400, { error: "invalid_grant", error_code: "KOE320" })), "rejected");
  assert.equal(outcomeOf(summarizeToken(401, { error: "invalid_client", error_code: "KOE010" })), "inconclusive");
  assert.equal(outcomeOf(summarizeToken(400, { error: "invalid_request" })), "inconclusive");
  assert.equal(outcomeOf(summarizeToken(500, { error: "server_error" })), "inconclusive");
  assert.equal(outcomeOf(summarizeToken(400, null)), "inconclusive");
  assert.equal(outcomeOf(null), "inconclusive");
});

test("verdict: ①·②의 결과로 PKCE를 검사하는지", () => {
  assert.match(verdict({ pkce: "ok" }), /모두 해야/);
  assert.match(verdict({ pkce: "ok", pkce_wrong: "rejected" }), /PKCE를 씀/);
  assert.match(verdict({ pkce: "ok", pkce_wrong: "ok" }), /보지 않음/);
  assert.match(verdict({ pkce: "rejected", pkce_wrong: "rejected" }), /①이 안 됨/);
  assert.match(verdict({ pkce: "inconclusive", pkce_wrong: "ok" }), /①이 안 됨/);
  // ①은 되고 ②가 PKCE와 관계없는 오류(서버 오류)면 'PKCE를 씀'으로 판단하지 않음(PR 검토 지적)
  const v = verdict({ pkce: "ok", pkce_wrong: outcomeOf(summarizeToken(500, { error: "server_error" })) });
  assert.doesNotMatch(v, /PKCE를 씀/);
  assert.match(v, /판단하지 않아요/);
});

test("resultPage: 글을 HTML로 이스케이프", () => {
  const h = resultPage("제목<script>", ['a "b" & <c>']);
  assert.ok(!h.includes("<script>"));
  assert.ok(h.includes("&lt;script&gt;"));
  assert.ok(h.includes("a &quot;b&quot; &amp; &lt;c&gt;"));
});

test("로그인 시험 표: 같은 키로 만든 30분 안의 표만 맞음", async () => {
  const now = Date.UTC(2026, 10, 15, 12, 0, 0);
  const t = await makeTicket("k1", now);
  assert.match(t, /^\d{10}-[0-9a-f]{32}$/);
  assert.equal(Number(t.split("-")[0]), now / 1000 + TICKET_TTL_SEC);
  assert.equal(await ticketValid("k1", t, now), true);
  assert.equal(await ticketValid("k1", t, now + (TICKET_TTL_SEC - 1) * 1000), true);
  assert.equal(await ticketValid("k1", t, now + (TICKET_TTL_SEC + 1) * 1000), false);
  assert.equal(await ticketValid("k2", t, now), false);
  const [exp, sig] = t.split("-");
  assert.equal(await ticketValid("k1", `${Number(exp) + 600}-${sig}`, now), false);
  assert.equal(await ticketValid("k1", null, now), false);
  assert.equal(await ticketValid("k1", "", now), false);
  assert.equal(await ticketValid("k1", `${t}x`, now), false);
});

test("state: 서버가 같은 키로 만든 것만 맞음", async () => {
  const s = await makeState("k1");
  assert.match(s, /^[A-Za-z0-9_-]{22}[0-9a-f]{24}$/);
  assert.equal(await stateValid("k1", s), true);
  assert.equal(await stateValid("k2", s), false);
  assert.equal(await stateValid("k1", `${s.slice(0, 21)}${s[21] === "A" ? "B" : "A"}${s.slice(22)}`), false);
  assert.equal(await stateValid("k1", "AAAAAAAAAAAAAAAAAAAAAA"), false);
  assert.notEqual(await makeState("k1"), s);
});
