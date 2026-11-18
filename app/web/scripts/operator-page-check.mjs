import assert from "node:assert/strict";

const LOGIN = "/operator/login";
const DEEP = "/operator/shops/shop-1?tab=licenses";
const IDENTITY = { operatorId: "00000000-0000-4000-8000-000000000001", displayName: "운영자 예시" };
const TRACE = "0123456789abcdef0123456789abcdef";
const CASES = [
  { status: 401, code: "operator_login_failed", text: "로그인 정보가 맞지 않아요" },
  { status: 422, code: "validation_failed", text: "입력한 내용을 확인해 주세요" },
  { status: 429, code: "too_many_attempts", text: "잠시 뒤 다시 로그인해 주세요" },
  { status: 503, code: "auth_unavailable", text: "로그인 서비스에 연결하지 못했어요. 잠시 뒤 다시 해 주세요" },
  { status: 500, code: "internal", text: "문제가 생겼어요. 다시 시도해 주세요" },
];

export async function checkOperatorPage(browser, base, width, snap) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, locale: "ko-KR" });
  const page = await context.newPage();
  const consoleErrors = [];
  const requestBodies = [];
  let submissionResult = CASES[0];
  let allowed = false;
  let releaseSession;
  let logouts = 0;
  const initialSession = new Promise((resolve) => {
    releaseSession = resolve;
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // 예상한 모의 HTTP 오류는 아래에서 응답 상태와 화면을 대조한다.
    if (/Failed to load resource.*(?:401|422|429|500|503)/.test(message.text())) return;
    consoleErrors.push(message.text());
  });

  try {
    await page.route("**/api/operator/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.endsWith("/me") && request.method() === "GET") {
        await initialSession;
        if (allowed) await route.fulfill({ json: IDENTITY });
        else await route.fulfill({ status: 401, json: { code: "unauthenticated" } });
        return;
      }
      assert.ok(path.endsWith("/session"));
      if (request.method() === "DELETE") {
        logouts += 1;
        allowed = false;
        await route.fulfill({ status: 204 });
        return;
      }
      assert.equal(request.method(), "POST");
      requestBodies.push(request.postDataJSON());
      if (submissionResult === null) {
        allowed = true;
        await route.fulfill({ json: IDENTITY });
        return;
      }
      const { status, code, text } = submissionResult;
      if ([401, 429, 503].includes(status)) await new Promise((resolve) => setTimeout(resolve, 2000));
      const errors = status === 422 ? [{ field: "/otp", code: "bad_format" }] : undefined;
      await route.fulfill({
        status,
        headers: { "content-type": "application/problem+json", ...(status === 429 ? { "retry-after": "3" } : {}) },
        json: {
          type: `/problems/${code}`,
          status,
          code,
          title: text,
          traceId: TRACE,
          detail: text,
          instance: "/operator/session",
          errors,
        },
      });
    });

    const href = (path) => new URL(path, base).href;
    const get = (name) => page.getByLabel(name, { exact: true });
    const button = (name) => page.getByRole("button", { name, exact: true });
    const loginButton = () => page.locator('form button[type="submit"]');
    const fill = async () => {
      await get("이메일").fill("ops@example.org");
      await get("비밀번호").fill("sample-password");
      await get("2단계 인증 번호").fill("001234");
    };

    await page.goto(href(LOGIN));
    await button("로그인").waitFor();
    await snap(page, "operator-normal", consoleErrors);
    await page.goto(href(DEEP));
    await page.getByText("로그인 상태를 확인하고 있어요").waitFor({ state: "attached" });
    assert.equal(await page.locator(".ui-layout--operator").count(), 0);
    releaseSession();
    await page.waitForURL(href(LOGIN));
    await page.getByText("로그인하면 보던 화면으로 돌아가요").waitFor();
    assert.equal(await get("2단계 인증 번호").getAttribute("autocomplete"), "one-time-code");
    assert.equal(await get("2단계 인증 번호").getAttribute("inputmode"), "numeric");
    assert.equal(Math.round((await loginButton().boundingBox()).height), 48);
    if (width === 1280) assert.equal(Math.round((await page.locator(".ui-login__card").boundingBox()).width), 400);
    await snap(page, "operator-return", consoleErrors);

    for (const result of CASES) {
      submissionResult = result;
      await fill();
      const count = requestBodies.length;
      if (result.status === 401) {
        await page.locator("form").evaluate((form) => {
          form.requestSubmit();
          form.requestSubmit();
        });
        await button("로그인하고 있어요").waitFor();
        assert.equal(await get("비밀번호").isDisabled(), true);
        await snap(page, "operator-submitting", consoleErrors);
      } else {
        await loginButton().click();
      }
      await page.getByRole("alert").getByText(result.text).waitFor();
      assert.equal(requestBodies.length - count, 1);
      assert.deepEqual(requestBodies.at(-1), { email: "ops@example.org", password: "sample-password", otp: "001234" });
      if (result.status === 401) {
        assert.equal(await get("이메일").inputValue(), "");
        assert.equal(await get("비밀번호").inputValue(), "");
        assert.equal(await get("2단계 인증 번호").inputValue(), "");
      }
      if (result.status === 422) {
        assert.equal(await get("2단계 인증 번호").getAttribute("aria-invalid"), "true");
        assert.equal(await get("비밀번호").inputValue(), "");
      }
      if (result.status === 503) {
        assert.equal(await get("이메일").inputValue(), "ops@example.org");
        assert.equal(await get("비밀번호").inputValue(), "");
        assert.equal(await get("2단계 인증 번호").inputValue(), "");
        await button("다시 시도").waitFor();
      }
      if (result.status === 500) await page.getByText(`추적 ID ${TRACE}`).waitFor();
      if (result.status === 429) {
        assert.equal(await loginButton().isDisabled(), true);
        await page.getByRole("timer").waitFor();
      }
      await snap(page, `operator-${result.status}`, consoleErrors);
      if (result.status === 429)
        await page.waitForFunction(() => !document.querySelector('form button[type="submit"]').disabled);
    }

    submissionResult = null;
    await fill();
    await loginButton().click();
    await page.waitForURL(href(DEEP));
    await page.getByRole("heading", { name: "영업 신고 확인" }).waitFor();
    assert.equal(await page.locator(".ui-layout--operator").count(), 1);
    assert.ok(await page.getByText(IDENTITY.displayName, { exact: true }).count());

    // 서버가 옛 쿠키를 더 이상 받지 않는 응답을 재현한다.
    allowed = false;
    await page.reload();
    await page.waitForURL(href(LOGIN));
    assert.equal(await page.locator(".ui-layout--operator").count(), 0);
    await fill();
    await loginButton().click();
    await page.waitForURL(href(DEEP));
    await page.getByRole("heading", { name: "영업 신고 확인" }).waitFor();
    if (width === 360) {
      await page.getByRole("link", { name: "뒤로", exact: true }).click();
      await page.waitForURL(href("/operator/shops"));
      await page.getByRole("button", { name: "메뉴 열기" }).click();
    }
    await button("로그아웃").click();
    await page.waitForURL(href(LOGIN));
    assert.equal(logouts, 1);
    assert.equal(await page.locator(".ui-layout--operator").count(), 0);
  } finally {
    await context.close();
  }
}
