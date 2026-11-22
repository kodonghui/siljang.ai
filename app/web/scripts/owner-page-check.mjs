import assert from "node:assert/strict";

const LOGIN = "/owner/login";
const CALLBACK = "/owner/login/callback";
const DEEP = "/owner/orders/example-order?tab=history#event";
const STATE = "example-signed-state-123";
const TRACE = "0123456789abcdef0123456789abcdef";
const OWNER = {
  ownerId: "00000000-0000-4000-8000-000000000001",
  alertChannelFriend: false,
  createdAt: "2026-11-21T16:00:00+09:00",
};
const SHOP = { shopId: "00000000-0000-4000-8000-000000000002", name: "합성 시험 가게", licenseStatus: "verified" };
const RETURNING = { owner: OWNER, shop: SHOP, next: "open_tasks" };
const CASES = [
  { status: 401, code: "kakao_login_failed", text: "카카오 로그인을 다시 해 주세요" },
  { status: 422, code: "validation_failed", text: "카카오 로그인을 다시 해 주세요" },
  { status: 429, code: "rate_limited", text: "잠시 뒤 다시 시도해 주세요" },
  { status: 503, code: "kakao_unavailable", text: "카카오에 연결하지 못했어요. 잠시 뒤 다시 해 주세요" },
  { status: 500, code: "internal", text: "문제가 생겼어요. 다시 시도해 주세요" },
];

export async function checkOwnerPage(browser, base, width, snap) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, locale: "ko-KR" });
  const page = await context.newPage();
  const href = (path) => new URL(path, base).href;
  const redirectUri = href(CALLBACK);
  const consoleErrors = [];
  const exchanges = [];
  const starts = [];
  let result = RETURNING;
  let startResult = null;
  let allowed = false;
  let profile = RETURNING;
  let releaseExchange;
  let exchangeGate = Promise.resolve();
  let logoutFails = false;
  let logouts = 0;
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource.*(?:401|422|429|500|502|503)/.test(message.text()))
      consoleErrors.push(message.text());
  });
  async function problem(route, failure) {
    await route.fulfill({
      status: failure.status,
      headers: {
        "content-type": "application/problem+json",
        ...(failure.status === 429 ? { "retry-after": "2" } : {}),
      },
      json: {
        type: `/problems/${failure.code}`,
        status: failure.status,
        code: failure.code,
        title: failure.text,
        detail: failure.text,
        traceId: TRACE,
        instance: "/owner/session",
      },
    });
  }
  const loginButton = () => page.locator(".owner-login-form > button");
  const callback = (code = "example-code") => href(`${CALLBACK}?code=${code}&state=${STATE}`);
  try {
    await page.route("**/api/owner/**", async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname;
      if (path.endsWith("/authorization")) {
        assert.equal(request.method(), "POST");
        assert.deepEqual(request.postDataJSON(), { redirectUri });
        starts.push(request.postDataJSON());
        await new Promise((resolve) => setTimeout(resolve, 60));
        if (startResult !== null) {
          await problem(route, startResult);
          return;
        }
        const url = new URL("https://kauth.kakao.com/oauth/authorize");
        url.search = new URLSearchParams({
          client_id: "example-client",
          redirect_uri: redirectUri,
          response_type: "code",
          state: STATE,
          code_challenge: "a".repeat(43),
          code_challenge_method: "S256",
        }).toString();
        await route.fulfill({
          json: { authorizationUrl: url.href, state: STATE, expiresAt: "2026-11-21T16:10:00+09:00" },
        });
        return;
      }
      if (path.endsWith("/me")) {
        if (allowed) await route.fulfill({ json: { owner: profile.owner, shop: profile.shop, banners: [] } });
        else await problem(route, { status: 401, code: "unauthenticated", text: "다시 로그인해 주세요" });
        return;
      }
      assert.ok(path.endsWith("/session"));
      if (request.method() === "DELETE") {
        logouts += 1;
        if (logoutFails) await problem(route, CASES[3]);
        else {
          allowed = false;
          await route.fulfill({ status: 204 });
        }
        return;
      }
      assert.equal(request.method(), "POST");
      const body = request.postDataJSON();
      assert.deepEqual(Object.keys(body).sort(), ["kakaoCode", "redirectUri", "state"]);
      assert.equal(body.redirectUri, redirectUri);
      assert.equal(body.state, STATE);
      exchanges.push(body);
      await exchangeGate;
      if ("status" in result) await problem(route, result);
      else {
        allowed = true;
        profile = result;
        await route.fulfill({ json: result });
      }
    });
    await page.route("https://kauth.kakao.com/oauth/authorize?*", async (route) => {
      const url = new URL(route.request().url());
      assert.equal(url.searchParams.get("redirect_uri"), redirectUri);
      assert.equal(url.searchParams.get("state"), STATE);
      assert.equal(url.searchParams.get("code_challenge_method"), "S256");
      await route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>카카오 로그인 시험</title><p>합성 인가 화면</p>",
      });
    });

    await page.goto(href(LOGIN));
    await page.getByRole("heading", { name: "사장님 로그인" }).waitFor();
    assert.equal(await loginButton().count(), 1);
    assert.equal(Math.round((await loginButton().boundingBox()).height), 48);
    const kakaoImage = loginButton().getByRole("img", { name: "카카오 로그인", exact: true });
    assert.equal(await kakaoImage.count(), 1, "카카오 공식 버튼 이미지를 표시함");
    await page.waitForFunction(() => {
      const image = document.querySelector(".owner-login-form > button img");
      return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
    });
    const imageRatio = await kakaoImage.evaluate((image) => {
      const box = image.getBoundingClientRect();
      return { original: image.naturalWidth / image.naturalHeight, rendered: box.width / box.height };
    });
    assert.ok(Math.abs(imageRatio.original - imageRatio.rendered) < 0.01, "공식 이미지의 비율을 보존함");
    if (width === 1280) assert.equal(Math.round((await page.locator(".ui-login__card").boundingBox()).width), 400);
    await snap(page, "owner-normal", consoleErrors);

    for (const failure of [CASES[1], CASES[2], CASES[4]]) {
      await page.goto(href(LOGIN));
      startResult = failure;
      const before = starts.length;
      await loginButton().evaluate((button) => {
        button.click();
        button.click();
      });
      await page.getByRole("alert").getByText(failure.text, { exact: true }).waitFor();
      assert.equal(starts.length - before, 1);
      if (failure.status === 429) {
        assert.equal(await loginButton().isDisabled(), true);
        await snap(page, "owner-start-rate-limited", consoleErrors);
        await loginButton().waitFor({ state: "visible" });
        await page.waitForFunction(() => !document.querySelector(".owner-login-form > button").disabled);
      } else await snap(page, `owner-start-${failure.status}`, consoleErrors);
      if (failure.status === 500) await page.getByText(`추적 ID ${TRACE}`).waitFor();
    }
    startResult = null;

    // 보호된 내용은 세션 확인 뒤에만 표시하고, 인가를 거쳐 같은 주소로 돌아간다.
    await page.goto(href(DEEP));
    await page.waitForURL(href(LOGIN));
    await page.getByText("로그인하면 보던 화면으로 돌아가요").waitFor();
    await snap(page, "owner-return", consoleErrors);
    await loginButton().click();
    await page.waitForURL("https://kauth.kakao.com/oauth/authorize?*");
    exchangeGate = new Promise((resolve) => {
      releaseExchange = resolve;
    });
    const before = exchanges.length;
    await page.goto(callback());
    await page.getByRole("button", { name: "로그인하고 있어요" }).waitFor();
    await page.waitForURL(href(CALLBACK));
    await snap(page, "owner-loading", consoleErrors);
    releaseExchange();
    exchangeGate = Promise.resolve();
    await page.waitForURL(href(DEEP));
    await page.getByRole("button", { name: "로그아웃", exact: true }).waitFor();
    assert.equal(exchanges.length - before, 1, "StrictMode에서도 인가 코드 교환은 한 번");
    assert.equal(await page.evaluate(() => sessionStorage.getItem("siljang.owner.returnTo")), null);

    logoutFails = true;
    await page.getByRole("button", { name: "로그아웃", exact: true }).click();
    await page.getByRole("alert").getByText("로그아웃하지 못했어요. 다시 시도해 주세요").waitFor();
    logoutFails = false;
    await page.getByRole("button", { name: "로그아웃", exact: true }).click();
    await page.waitForURL(href(LOGIN));
    assert.equal(logouts, 2);

    for (const failure of CASES) {
      result = failure;
      await page.goto(callback(`example-${failure.status}`));
      await page.waitForURL(href(CALLBACK));
      await page.getByRole("alert").getByText(failure.text, { exact: true }).waitFor();
      await snap(page, `owner-callback-${failure.status}`, consoleErrors);
      if (failure.status === 429) {
        assert.equal(await loginButton().isDisabled(), true);
        await page.waitForFunction(() => !document.querySelector(".owner-login-form > button").disabled);
      }
      assert.equal((await page.locator("body").textContent()).includes(STATE), false);
    }

    const count = exchanges.length;
    await page.goto(href(`${CALLBACK}?error=access_denied&error_description=example-private-error`));
    await page.getByRole("alert").getByText(CASES[0].text, { exact: true }).waitFor();
    assert.equal(exchanges.length, count);
    assert.equal(page.url(), href(CALLBACK));
    assert.equal((await page.locator("body").textContent()).includes("example-private-error"), false);

    for (const [session, destination] of [
      [{ owner: OWNER, shop: null, next: "register_shop" }, "/owner/shop/new"],
      [{ owner: OWNER, shop: { ...SHOP, licenseStatus: "on_hold" }, next: "resubmit_license" }, "/owner/shop/license"],
      [RETURNING, "/owner"],
    ]) {
      result = session;
      await page.evaluate(() => sessionStorage.setItem("siljang.owner.returnTo", "https://example.org/owner"));
      await page.goto(callback(`example-${session.next}`));
      await page.waitForURL(href(destination));
      await page.getByRole("button", { name: "로그아웃", exact: true }).waitFor();
    }
    allowed = false;
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await page.waitForURL(href(LOGIN));
    assert.equal(await page.getByText("준비 중입니다.").count(), 0);
    assert.deepEqual(consoleErrors, []);
  } finally {
    releaseExchange?.();
    await context.close();
  }
}
