import assert from "node:assert/strict";
import test from "node:test";
import { verifyOwnerLoginStart } from "../staging-owner-login.mjs";

const domain = "staging.siljang.example";
const origin = `https://${domain}`;
const privateValue = ["synthetic", "never-output"].join("-");
const nonce = "n".repeat(43);
const state = "synthetic.signed.state";
const attrs = ["Path=/", "HttpOnly", "Secure", "SameSite=Lax", "Max-Age=600"];
function response({ status = 200, changeUrl, cookie, cache = "no-store" } = {}) {
  const url = new URL("https://kauth.kakao.com/oauth/authorize");
  for (const [key, value] of Object.entries({
    client_id: privateValue,
    response_type: "code",
    redirect_uri: `${origin}/owner/login/callback`,
    state,
    code_challenge: "c".repeat(43),
    code_challenge_method: "S256",
    scope: "plusfriends",
  }))
    url.searchParams.set(key, value);
  changeUrl?.(url);
  return new Response(JSON.stringify({ authorizationUrl: url.href, state }), {
    status,
    headers: {
      "set-cookie": cookie ?? `siljang_login=${nonce}; ${attrs.join("; ")}`,
      "cache-control": cache,
    },
  });
}
const options = (r) => ({ domain, fetch: async () => r });

test("실제 로그인 시작만 요청하고 결과에는 인가 주소·state·쿠키를 넣지 않음", async () => {
  let calls = 0;
  const result = await verifyOwnerLoginStart({
    domain,
    fetch: async (url, init) => {
      calls += 1;
      assert.equal(url, `${origin}/api/owner/session/authorization`);
      assert.equal(init.method, "POST");
      assert.equal(init.redirect, "error");
      assert.equal(init.headers.Origin, origin);
      assert.equal(init.headers["Content-Type"], "application/json");
      assert.deepEqual(JSON.parse(init.body), { redirectUri: `${origin}/owner/login/callback` });
      assert.ok(init.signal instanceof AbortSignal);
      return response();
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { status: 200, pkce: "S256", cookieSeconds: 600 });
  for (const value of [privateValue, state, nonce]) assert.equal(JSON.stringify(result).includes(value), false);
});

test("staging 주소가 아니면 요청하지 않음", async () => {
  let calls = 0;
  for (const bad of ["siljang.example", "https://staging.siljang.example", "staging.siljang.example/path"]) {
    await assert.rejects(
      verifyOwnerLoginStart({
        domain: bad,
        fetch: async () => {
          calls += 1;
        },
      }),
      /staging_owner_domain_invalid/,
    );
  }
  assert.equal(calls, 0);
});

test("통신 오류의 원문은 다시 출력하지 않음", async () => {
  await assert.rejects(
    verifyOwnerLoginStart({
      domain,
      fetch: async () => {
        throw new Error(privateValue);
      },
    }),
    (e) => e.message === "staging_owner_start_unavailable" && !String(e.stack).includes(privateValue),
  );
});

test("상태 확인이 정상이더라도 로그인 시작 500은 통과하지 않음", async () => {
  await assert.rejects(
    verifyOwnerLoginStart(options(new Response(privateValue, { status: 500 }))),
    /staging_owner_start_failed/,
  );
});

test("잘못된 JSON 본문의 값도 오류에 넣지 않음", async () => {
  await assert.rejects(
    verifyOwnerLoginStart(options(new Response(privateValue))),
    (e) => e.message === "staging_owner_start_invalid" && !String(e.stack).includes(privateValue),
  );
});

test("다른 호스트·콜백·state·PKCE·권한을 담은 인가 주소를 막음", async () => {
  for (const changeUrl of [
    (u) => {
      u.hostname = "other.example";
    },
    (u) => {
      u.pathname = "/other";
    },
    (u) => {
      u.searchParams.set("redirect_uri", "https://other.example/callback");
    },
    (u) => {
      u.searchParams.set("state", "different");
    },
    (u) => {
      u.searchParams.set("code_challenge_method", "plain");
    },
    (u) => {
      u.searchParams.set("code_challenge", "short");
    },
    (u) => {
      u.searchParams.set("scope", "other");
    },
  ])
    await assert.rejects(verifyOwnerLoginStart(options(response({ changeUrl }))), /staging_owner_start_invalid/);
});

test("로그인 시작 nonce 쿠키가 없거나 비어 있으면 막음", async () => {
  for (const cookie of [`other=${nonce}; ${attrs.join("; ")}`, `siljang_login=; ${attrs.join("; ")}`])
    await assert.rejects(verifyOwnerLoginStart(options(response({ cookie }))), /staging_owner_cookie_invalid/);
});

for (const missing of ["HttpOnly", "Secure", "SameSite=Lax", "Max-Age=600"])
  test(`로그인 쿠키의 ${missing} 누락을 막음`, async () => {
    const cookie = `siljang_login=${nonce}; ${attrs.filter((a) => a !== missing).join("; ")}`;
    await assert.rejects(verifyOwnerLoginStart(options(response({ cookie }))), /staging_owner_cookie_invalid/);
  });

test("공유 캐시에 인가 주소를 남길 수 있는 응답을 막음", async () => {
  await assert.rejects(verifyOwnerLoginStart(options(response({ cache: "public" }))), /staging_owner_start_invalid/);
});
