import { describe, expect, it } from "vitest";
import { fromBase64Url, toBase64Url } from "../src/encoding";
import { LEDGER_COOKIE, LEDGER_OAUTH_SECONDS, startLedgerOAuth, verifyLedgerOAuth } from "../src/ledger-oauth";
import { cookie, loginState, readCookie, verifyLoginState } from "../src/owner-oauth";
import { Secret } from "../src/settings";

const scope = { shopId: "10000000-0000-4000-8000-000000000001", ownerId: "20000000-0000-4000-8000-000000000001" };
const redirect = "https://siljang.example/owner/ledger/callback";
const now = new Date("2026-11-26T10:00:00.000Z");
const key = () => new Secret(crypto.randomUUID() + crypto.randomUUID());

describe("장부 OAuth의 사장님/가게/브라우저/돌아올 주소/10분 기한", () => {
  it("서명 state와 PKCE challenge를 만들고 정상 쿠키로 verifier를 돌려준다", async () => {
    const secret = key(),
      issued = await startLedgerOAuth(secret, scope, redirect, now);
    expect(issued.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.state).toMatch(/^\d{13}\.[A-Za-z0-9_-]{43}$/);
    expect(issued.expiresAt.toISOString()).toBe("2026-11-26T10:10:00.000Z");
    const verifier = await verifyLedgerOAuth(secret, scope, issued.state, issued.nonce, redirect, now);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.challenge).toBe(
      toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier as string)))),
    );
    expect(issued.state).not.toContain(issued.nonce);
    expect(issued.state).not.toContain(scope.ownerId);
  });
  it("시작할 때마다 브라우저 nonce와 state가 달라진다", async () => {
    const secret = key(),
      a = await startLedgerOAuth(secret, scope, redirect, now),
      b = await startLedgerOAuth(secret, scope, redirect, now);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.state).not.toBe(b.state);
    expect(a.challenge).not.toBe(b.challenge);
  });
  for (const [label, altered] of [
    ["다른 가게", { ...scope, shopId: "10000000-0000-4000-8000-000000000002" }],
    ["다른 사장님", { ...scope, ownerId: "20000000-0000-4000-8000-000000000002" }],
  ] as const)
    it(`${label}에서는 열지 않는다`, async () => {
      const secret = key(),
        issued = await startLedgerOAuth(secret, scope, redirect, now);
      expect(await verifyLedgerOAuth(secret, scope, issued.state, issued.nonce, redirect, now)).not.toBeNull();
      expect(await verifyLedgerOAuth(secret, altered, issued.state, issued.nonce, redirect, now)).toBeNull();
    });
  it.each([null, "", "a".repeat(43), "a".repeat(42), "a".repeat(44)])(
    "다른/없는/잘못된 브라우저 쿠키 %s는 닫는다",
    async (nonce) => {
      const secret = key(),
        issued = await startLedgerOAuth(secret, scope, redirect, now);
      expect(await verifyLedgerOAuth(secret, scope, issued.state, issued.nonce, redirect, now)).not.toBeNull();
      expect(await verifyLedgerOAuth(secret, scope, issued.state, nonce, redirect, now)).toBeNull();
    },
  );
  it("서명과 기한 한 글자의 변조를 닫는다", async () => {
    const secret = key(),
      issued = await startLedgerOAuth(secret, scope, redirect, now);
    const [expiry, signature] = issued.state.split(".");
    expect(await verifyLedgerOAuth(secret, scope, issued.state, issued.nonce, redirect, now)).not.toBeNull();
    for (const state of [
      `${Number(expiry) + 1}.${signature}`,
      `${expiry}.${signature?.[0] === "A" ? "B" : "A"}${signature?.slice(1)}`,
    ])
      expect(await verifyLedgerOAuth(secret, scope, state, issued.nonce, redirect, now)).toBeNull();
  });
  it("기한 직전은 열고 정확히 만료/그 뒤/미래 시계는 닫는다", async () => {
    const secret = key(),
      issued = await startLedgerOAuth(secret, scope, redirect, now),
      end = now.getTime() + LEDGER_OAUTH_SECONDS * 1000;
    expect(
      await verifyLedgerOAuth(secret, scope, issued.state, issued.nonce, redirect, new Date(end - 1)),
    ).not.toBeNull();
    for (const time of [end, end + 1, now.getTime() - 1])
      expect(await verifyLedgerOAuth(secret, scope, issued.state, issued.nonce, redirect, new Date(time))).toBeNull();
  });
  it("돌아올 주소의 경로/쿼리/호스트를 바꾸면 닫는다", async () => {
    const secret = key(),
      issued = await startLedgerOAuth(secret, scope, redirect, now);
    expect(await verifyLedgerOAuth(secret, scope, issued.state, issued.nonce, redirect, now)).not.toBeNull();
    for (const url of [`${redirect}2`, `${redirect}?x=1`, redirect.replace("siljang.example", "other.example")])
      expect(await verifyLedgerOAuth(secret, scope, issued.state, issued.nonce, url, now)).toBeNull();
  });
  it("로그인 state와 장부 state/verifier는 서로 쓰지 못한다", async () => {
    const secret = key(),
      issued = await startLedgerOAuth(secret, scope, redirect, now),
      owner = await loginState(secret, redirect, now);
    const verifier = await verifyLedgerOAuth(secret, scope, issued.state, issued.nonce, redirect, now);
    expect(verifier).not.toBeNull();
    expect(verifier).not.toBe(await verifyLoginState(secret, owner.state, owner.nonce, redirect, now));
    expect(await verifyLedgerOAuth(secret, scope, owner.state, owner.nonce, redirect, now)).toBeNull();
    expect(await verifyLoginState(secret, issued.state, issued.nonce, redirect, now)).toBeNull();
  });
  it("다른 서버 키와 비표준 base64 서명을 닫는다", async () => {
    const secret = key(),
      issued = await startLedgerOAuth(secret, scope, redirect, now);
    expect(await verifyLedgerOAuth(secret, scope, issued.state, issued.nonce, redirect, now)).not.toBeNull();
    expect(await verifyLedgerOAuth(key(), scope, issued.state, issued.nonce, redirect, now)).toBeNull();
    const [expiry, signature] = issued.state.split(".");
    const bytes = fromBase64Url(signature as string);
    expect(bytes).not.toBeNull();
    expect(await verifyLedgerOAuth(secret, scope, `${expiry}.${signature}=`, issued.nonce, redirect, now)).toBeNull();
  });
  it("전용 HttpOnly/Secure/Lax 쿠키는10분이고 같은 이름 중복은 받지 않는다", async () => {
    const issued = await startLedgerOAuth(key(), scope, redirect, now),
      value = cookie(LEDGER_COOKIE, issued.nonce, LEDGER_OAUTH_SECONDS);
    expect(value).toContain("HttpOnly; Secure; SameSite=Lax; Max-Age=600");
    expect(readCookie(value, LEDGER_COOKIE)).toBe(issued.nonce);
    expect(readCookie(`${value}; ${LEDGER_COOKIE}=${issued.nonce}`, LEDGER_COOKIE)).toBeNull();
  });
});
