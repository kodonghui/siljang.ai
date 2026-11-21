// 공통 부품 견본을 실제 브라우저로 잰다(TASK-029). 이 컴퓨터에서만 돈다: CI에는 브라우저가 없어 node 시험만 돈다(app/README.md).
// 1) vite 개발 서버로 samples.html(개발용 견본, 운영 빌드에 없음)을 띄우고
// 2) 미리 설치된 Playwright Chromium으로 상태마다 360·1280(높이 800, deviceScaleFactor 1)을 열어
//    corthex-uxui page-check.js(오류 0), 가로 넘침 없음, 콘솔 오류 없음, 실린 글꼴을 보고 스크린샷을 남긴다.
//    레이아웃 견본(TASK-182)은 LAYOUT_WIDTHS(그 사이 너비와 넓고 좁음을 가르는 너비 양쪽)에서도 연다.
// 3) 키보드·요청 키 흐름을 누른다: 확인 창(첫 포커스 '돌아가기', Tab 가둠, Esc로 닫고 포커스 돌려줌, 확인하면 새 키와
//    confirm 값), 서버 실패 뒤 '다시 시도'(같은 키), 두 번 눌러도 요청 하나. TASK-182는 너비마다 왼쪽 메뉴·메뉴 열기·
//    표·카드 중 보이는 것과 좁은 화면의 메뉴 플로우(열기·포커스·Tab 가둠·닫기 넷·넓어지면 닫힘)를 본다.
// 결과: <out>/report.json과 <out>/<상태>-<너비>.png. 하나라도 어긋나면 끝 상태 1.
// 쓰임(app/에서): npm run check:pages -w web -- [--out 폴더] [--page-check page-check.js 경로]
//   page-check.js는 --page-check, PAGE_CHECK, 저장소 사본 tools/corthex/page-check.js(tools/corthex/README.md),
//   아니면 ${CORTHEX_PLUGINS:-~/.claude/plugins/synced}/*/corthex*/skills/corthex-uxui/scripts/page-check.js 차례로 찾는다
//   (tools/stage-checks.sh와 같은 차례).
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { checkOperatorPage } from "./operator-page-check.mjs";
import { checkOwnerPage } from "./owner-page-check.mjs";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const WIDTHS = [360, 1280];
const HEIGHT = 800;
/** 08 공통 상태와 부품마다 하나(src/samples/Samples.tsx의 SAMPLE_STATES와 같아야 함: 아래에서 대조) */
const STATES = [
  "loading",
  "empty",
  "load-failed",
  "not-found",
  "permission",
  "stale",
  "as-of",
  "field-error",
  "save-failed",
  "submitting",
  "done",
  "rate-limited",
  "already-done",
  "not-allowed",
  "confirm",
  "confirm-notify",
  "flow",
  "flow-retry",
  "layout-owner",
  "layout-owner-sub",
  "layout-owner-list-states",
  "layout-operator",
  "layout-operator-sub",
  "layout-setup",
  "layout-login",
  "flow-menu",
];
/**
 * 레이아웃 견본(TASK-182)은 08·09가 그린 360·1280에 더해 그 사이 너비(768 태블릿 세로, 1024 태블릿 가로)와
 * 넓고 좁음을 가르는 너비 바로 아래·위(src/styles/layout.css의 @media, size.menu + size.content)에서도 연다.
 */
const BREAKPOINT = (() => {
  const tokens = JSON.parse(readFileSync(join(WEB, "../../design/base.tokens.json"), "utf8"));
  return tokens.size.menu.$value.value + tokens.size.content.$value.value;
})();
const LAYOUT_WIDTHS = [360, 768, 1024, BREAKPOINT - 1, BREAKPOINT, 1280];
const widthsOf = (state) => (state.startsWith("layout-") || state === "flow-menu" ? LAYOUT_WIDTHS : WIDTHS);
/** 06 IdempotencyKey */
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function findPageCheck() {
  const given = arg("--page-check") ?? process.env.PAGE_CHECK;
  if (given) return given;
  const copy = join(WEB, "../../tools/corthex/page-check.js");
  if (existsSync(copy)) return copy;
  const plugins = process.env.CORTHEX_PLUGINS ?? join(homedir(), ".claude/plugins/synced");
  if (!existsSync(plugins)) return null;
  // 플러그인 폴더 이름은 버전에 따라 바뀐다(corthex, corthex~g2 등): 'corthex'로 시작하는 폴더를 모두 본다.
  for (const dir of readdirSync(plugins).sort()) {
    const base = join(plugins, dir);
    if (!statSync(base, { throwIfNoEntry: false })?.isDirectory()) continue;
    for (const sub of readdirSync(base).sort()) {
      if (!sub.startsWith("corthex")) continue;
      const path = join(base, sub, "skills/corthex-uxui/scripts/page-check.js");
      if (existsSync(path)) return path;
    }
  }
  return null;
}

const pageCheckPath = findPageCheck();
if (pageCheckPath === null || !existsSync(pageCheckPath)) {
  console.error("page-check: corthex-uxui의 page-check.js를 찾지 못함(--page-check 경로 또는 PAGE_CHECK)");
  process.exit(2);
}
const pageCheckSource = readFileSync(pageCheckPath, "utf8");
const out = arg("--out") ?? join(tmpdir(), "siljang-page-check");
mkdirSync(out, { recursive: true });

// 견본 목록과 이 스크립트의 목록이 같은지(견본을 더하고 여기서 빠뜨리지 않게)
const samplesSource = readFileSync(join(WEB, "src/samples/Samples.tsx"), "utf8");
const declared = [...samplesSource.slice(samplesSource.indexOf("SAMPLE_STATES = {")).matchAll(/^\s+"?([a-z-]+)"?: "/gm)]
  .map((m) => m[1])
  .filter((s) => s !== undefined);
const missing = declared.filter((s) => !STATES.includes(s));
if (missing.length > 0) {
  console.error(`page-check: Samples.tsx에 있고 여기에 없는 상태: ${missing.join(", ")}`);
  process.exit(2);
}

// 미리 설치된 Playwright(다시 설치하지 않음)
const { chromium } = createRequire(import.meta.url)("playwright");

const server = await createServer({
  root: WEB,
  configFile: join(WEB, "vite.config.ts"),
  logLevel: "error",
  server: { port: 5199, strictPort: false, host: "127.0.0.1" },
});
await server.listen();
const base = server.resolvedUrls?.local[0] ?? "http://127.0.0.1:5199/";
const browser = await chromium.launch();

const report = {
  tool: "app/web/scripts/page-check.mjs",
  pageCheck: pageCheckPath.replace(homedir(), "~"),
  at: new Date().toISOString(),
  widths: WIDTHS,
  height: HEIGHT,
  deviceScaleFactor: 1,
  pages: [],
  flows: [],
};
const failures = [];

async function open(state, width) {
  const context = await browser.newContext({
    viewport: { width, height: HEIGHT },
    deviceScaleFactor: 1,
    locale: "ko-KR",
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  await page.goto(`${base}samples.html?state=${state}`);
  await page.waitForFunction((s) => document.documentElement.dataset.sampleReady === s, state);
  await page.evaluate(() => document.fonts.ready);
  return { context, page, consoleErrors };
}

async function measure(page) {
  const check = await page.evaluate(pageCheckSource);
  const extra = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    fonts: [...new Set([...document.fonts].filter((f) => f.status === "loaded").map((f) => `${f.family} ${f.weight}`))],
  }));
  return { check, ...extra };
}

function summarize(name, width, m, consoleErrors, shot) {
  const errors = m.check.issues.filter((i) => i.level === "error");
  const warns = m.check.issues.filter((i) => i.level === "warn");
  const row = {
    state: name,
    width,
    pass: m.check.pass && m.scrollWidth <= m.innerWidth && consoleErrors.length === 0,
    counts: m.check.counts,
    byCheck: m.check.byCheck,
    overflowX: m.scrollWidth > m.innerWidth ? m.scrollWidth - m.innerWidth : 0,
    consoleErrors,
    fonts: m.fonts,
    errors,
    warns,
    screenshot: shot,
  };
  report.pages.push(row);
  if (!row.pass)
    failures.push(
      `${name}@${width}: page-check 오류 ${errors.length}, 가로 넘침 ${row.overflowX}px, 콘솔 오류 ${consoleErrors.length}`,
    );
  return row;
}

async function shoot(page, name, width) {
  const file = `${name}-${width}.png`;
  await page.screenshot({ path: join(out, file), fullPage: true });
  return file;
}

// ── 1. 상태마다 360·1280(레이아웃 견본은 LAYOUT_WIDTHS) ──
for (const state of STATES) {
  for (const width of widthsOf(state)) {
    const { context, page, consoleErrors } = await open(state, width);
    const m = await measure(page);
    summarize(state, width, m, consoleErrors, await shoot(page, state, width));
    await context.close();
  }
}

// ── 2. 흐름(키보드·요청 키) ──
const requests = (page) => page.evaluate(() => window.__sampleRequests ?? []);
const focused = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return {
      text: el?.textContent?.trim() ?? "",
      sample: el instanceof HTMLElement ? (el.dataset.sample ?? null) : null,
      inDialog: Boolean(el?.closest("dialog[open]")),
    };
  });
const announced = (page, level) =>
  page.evaluate((l) => document.querySelector(`[data-announcer="${l}"]`)?.textContent ?? "", level);

async function flow(name, width, steps, state = name) {
  const { context, page, consoleErrors } = await open(state, width);
  const seen = [];
  const problems = [];
  const expect = (ok, what) => {
    seen.push(`${ok ? "맞음" : "어긋남"}: ${what}`);
    if (!ok) problems.push(what);
  };
  try {
    await steps(page, expect, async (label) => {
      const file = await shoot(page, `${name}-${label}`, width);
      const m = await measure(page);
      summarize(`${name}-${label}`, width, m, consoleErrors, file);
    });
  } catch (error) {
    problems.push(`흐름이 멈춤: ${String(error).split("\n")[0]}`);
  }
  if (consoleErrors.length > 0) problems.push(`콘솔 오류 ${consoleErrors.length}`);
  report.flows.push({ flow: name, width, ok: problems.length === 0, steps: seen, problems });
  if (problems.length > 0) failures.push(`${name}@${width}: ${problems.join("; ")}`);
  await context.close();
}

for (const width of WIDTHS) {
  // 확인 창: 두 번 눌러도 하나 → 409 확인 → 첫 포커스·Tab 가둠 → Esc(아무것도 안 바뀜, 포커스 돌아옴)
  // → 다시 누름(새 키) → 확인(새 키 + confirm 값) → 됨
  await flow("flow", width, async (page, expect, snap) => {
    const submit = page.locator('[data-sample="submit"]');
    await submit.dblclick();
    await page.waitForSelector('[data-sample="submit"][aria-disabled="true"]', { timeout: 300 }).then(
      () => expect(true, "보내는 동안 버튼이 aria-disabled이고 '처리하고 있어요'"),
      () => expect(false, "보내는 동안 버튼이 aria-disabled"),
    );
    await page.waitForSelector("dialog[open]");
    let reqs = await requests(page);
    expect(reqs.length === 1, `두 번 눌러도 요청 하나(${reqs.length})`);
    let f = await focused(page);
    expect(f.inDialog && f.text === "돌아가기", `창이 열리면 포커스가 '돌아가기'(${f.text})`);
    await snap("dialog");
    await page.keyboard.press("Tab");
    f = await focused(page);
    expect(f.inDialog && f.text === "휴무로 바꾸기", `Tab → 액션 버튼(${f.text})`);
    await page.keyboard.press("Tab");
    f = await focused(page);
    expect(f.inDialog && f.text === "돌아가기", `Tab이 창 안에서 돎(${f.text})`);
    await page.keyboard.press("Shift+Tab");
    f = await focused(page);
    expect(f.inDialog && f.text === "휴무로 바꾸기", `Shift+Tab도 창 안에서 돎(${f.text})`);
    await page.keyboard.press("Escape");
    await page.waitForSelector("dialog[open]", { state: "detached", timeout: 2000 }).catch(() => {});
    const stillOpen = await page.evaluate(() => document.querySelector("dialog[open]") !== null);
    expect(!stillOpen, "Esc로 창이 닫힘");
    f = await focused(page);
    expect(f.sample === "submit", `닫히면 포커스가 누른 버튼으로 돌아옴(${f.sample ?? f.text})`);
    reqs = await requests(page);
    expect(reqs.length === 1, `Esc는 아무것도 보내지 않음(${reqs.length})`);
    await page.keyboard.press("Enter");
    await page.waitForSelector("dialog[open]");
    reqs = await requests(page);
    expect(reqs.length === 2 && reqs[1].key !== reqs[0].key, "다시 누르면 새 요청 키");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.getByText("휴무로 바꿨어요").first().waitFor();
    reqs = await requests(page);
    const last = reqs[2];
    expect(
      reqs.length === 3 && last.key !== reqs[1].key && last.body?.confirm?.includes("closed_day_with_orders"),
      "확인하면 같은 본문에 confirm 값을 담아 새 요청 키로 보냄",
    );
    expect(
      reqs.every((r) => KEY_PATTERN.test(r.key)),
      `요청 키가 06 꼴(${reqs.map((r) => r.key.length).join("·")}자)`,
    );
    f = await focused(page);
    expect(f.sample === "submit", `확인 뒤에도 포커스가 누른 버튼으로(${f.sample ?? f.text})`);
    expect((await announced(page, "polite")).includes("휴무로 바꿨어요"), "됨을 polite로 알림");
    await snap("done");
  });

  // 서버 실패 → '다시 시도'는 같은 키 → 됨
  await flow("flow-retry", width, async (page, expect, snap) => {
    await page.locator('[data-sample="submit"]').dblclick();
    await page.getByRole("button", { name: "다시 시도" }).waitFor();
    let reqs = await requests(page);
    expect(reqs.length === 1, `두 번 눌러도 요청 하나(${reqs.length})`);
    expect((await announced(page, "assertive")).length > 0, "실패를 assertive로 알림");
    await snap("failed");
    await page.getByRole("button", { name: "다시 시도" }).click();
    await page.getByText("저장했어요").first().waitFor();
    reqs = await requests(page);
    expect(reqs.length === 2 && reqs[1].key === reqs[0].key, "'다시 시도'는 같은 요청 키");
    await snap("done");
  });
}

// ── 3. 레이아웃(TASK-182): 너비마다 보이는 쪽, 360 메뉴 열기·닫기 ──
/** 화면에 보이는(display가 none이 아닌) 요소인지 */
const shown = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el !== null && el.getClientRects().length > 0;
  }, selector);
const menuState = (page) =>
  page.evaluate(() => {
    const button = document.querySelector('button[aria-label="메뉴 열기"]');
    const dialog = document.querySelector("dialog.ui-sheet");
    const el = document.activeElement;
    return {
      expanded: button?.getAttribute("aria-expanded") ?? null,
      open: dialog?.open ?? false,
      focus: el?.textContent?.trim() ?? "",
      focusInSheet: Boolean(el?.closest("dialog.ui-sheet")),
      focusIsButton: el === button,
      current: el?.getAttribute?.("aria-current") ?? null,
      nav: window.__sampleNav ?? [],
    };
  });

for (const width of LAYOUT_WIDTHS) {
  const wide = width >= BREAKPOINT;
  await flow(
    "layout-widths",
    width,
    async (page, expect) => {
      expect((await shown(page, "nav.ui-layout__side")) === wide, `왼쪽 메뉴가 ${wide ? "보임" : "안 보임"}`);
      expect(
        (await shown(page, 'button[aria-label="메뉴 열기"]')) === !wide,
        `'메뉴 열기'가 ${wide ? "안 보임" : "보임"}`,
      );
      expect((await shown(page, "table.ui-list__table")) === wide, `목록 표가 ${wide ? "보임" : "안 보임"}`);
      expect((await shown(page, "ul.ui-list__cards")) === !wide, `목록 카드가 ${wide ? "안 보임" : "보임"}`);
      const names = await page.evaluate(() =>
        [...document.querySelectorAll("nav[aria-label], dialog[aria-label]")]
          .filter((el) => el.getClientRects().length > 0)
          .map((el) => el.getAttribute("aria-label")),
      );
      expect(names.length === (wide ? 1 : 0), `보이는 메뉴 ${names.length}개(${names.join("·")})`);
      const current = await page.evaluate(() =>
        [...document.querySelectorAll(".ui-menu__item[aria-current]")]
          .filter((el) => el.getClientRects().length > 0)
          .map((el) => `${el.textContent?.trim()}=${el.getAttribute("aria-current")}`),
      );
      expect(
        wide ? current.join() === "주문=page" : current.length === 0,
        `지금 1뎁스 표시(${current.join() || "없음"})`,
      );
    },
    "layout-owner",
  );
}

for (const width of LAYOUT_WIDTHS.filter((w) => w < BREAKPOINT)) {
  // 360 열린 메뉴: 열면 지금 1뎁스 항목에 포커스 → Tab 가둠 → Esc로 닫고 '메뉴 열기'로 → 다시 열어 항목 누르면 닫힘 → 바깥 누르면 닫힘
  await flow("flow-menu", width, async (page, expect, snap) => {
    const open = page.getByRole("button", { name: "메뉴 열기" });
    await open.click();
    await page.waitForSelector("dialog.ui-sheet[open]");
    let m = await menuState(page);
    expect(m.expanded === "true", `열면 aria-expanded=true(${m.expanded})`);
    expect(m.focusInSheet && m.current === "page", `열면 지금 1뎁스 항목에 포커스(${m.focus})`);
    await snap("open");
    const count = await page.evaluate(
      () => document.querySelectorAll("dialog.ui-sheet [href], dialog.ui-sheet button").length,
    );
    for (let i = 0; i < count; i++) await page.keyboard.press("Tab");
    m = await menuState(page);
    expect(m.focusInSheet, `Tab이 열린 메뉴 안에서 돎(${m.focus})`);
    await page.keyboard.press("Shift+Tab");
    m = await menuState(page);
    expect(m.focusInSheet, `Shift+Tab도 열린 메뉴 안(${m.focus})`);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("dialog.ui-sheet")?.open, null, { timeout: 2000 });
    m = await menuState(page);
    expect(!m.open && m.expanded === "false", "Esc로 닫히고 aria-expanded=false");
    expect(m.focusIsButton, `닫히면 포커스가 '메뉴 열기'로 돌아옴(${m.focus})`);
    await page.keyboard.press("Enter");
    await page.waitForSelector("dialog.ui-sheet[open]");
    await page.locator("dialog.ui-sheet").getByRole("link", { name: "입금 대조" }).click();
    await page.waitForFunction(() => !document.querySelector("dialog.ui-sheet")?.open, null, { timeout: 2000 });
    m = await menuState(page);
    expect(!m.open && m.nav.at(-1) === "/owner/payment-requests", `항목을 누르면 닫히고 그 주소로(${m.nav.at(-1)})`);
    await open.click();
    await page.waitForSelector("dialog.ui-sheet[open]");
    await page.mouse.click(width - 8, 400);
    await page.waitForFunction(() => !document.querySelector("dialog.ui-sheet")?.open, null, { timeout: 2000 });
    m = await menuState(page);
    expect(!m.open, "바깥(scrim)을 누르면 닫힘");
    await open.click();
    await page.waitForSelector("dialog.ui-sheet[open]");
    await page.locator("dialog.ui-sheet").getByRole("button", { name: "메뉴 닫기" }).click();
    await page.waitForFunction(() => !document.querySelector("dialog.ui-sheet")?.open, null, { timeout: 2000 });
    m = await menuState(page);
    expect(!m.open && m.focusIsButton, `'메뉴 닫기'로 닫히고 포커스가 '메뉴 열기'로(${m.focus})`);
    // 열린 채 넓은 화면이 되면 닫힘
    await open.click();
    await page.waitForSelector("dialog.ui-sheet[open]");
    await page.setViewportSize({ width: 1280, height: HEIGHT });
    await page
      .waitForFunction(() => !document.querySelector("dialog.ui-sheet")?.open, null, { timeout: 2000 })
      .catch(() => {});
    m = await menuState(page);
    expect(!m.open, "열린 채 넓은 화면이 되면 닫힘");
  });
}

for (const width of WIDTHS) {
  try {
    await checkOperatorPage(browser, base, width, async (page, state, consoleErrors) => {
      await page.evaluate(() => document.fonts.ready);
      const measured = await measure(page);
      summarize(state, width, measured, consoleErrors, await shoot(page, state, width));
    });
    report.flows.push({ name: "operator-login", width, pass: true });
  } catch (error) {
    report.flows.push({ name: "operator-login", width, pass: false });
    failures.push(`운영자 로그인@${width}: ${String(error)}`);
  }
}

for (const width of WIDTHS) {
  try {
    await checkOwnerPage(browser, base, width, async (page, state, consoleErrors) => {
      await page.evaluate(() => document.fonts.ready);
      const measured = await measure(page);
      summarize(state, width, measured, consoleErrors, await shoot(page, state, width));
    });
    report.flows.push({ name: "owner-login", width, pass: true });
  } catch (error) {
    report.flows.push({ name: "owner-login", width, pass: false });
    failures.push(`사장님 로그인@${width}: ${String(error)}`);
  }
}

await browser.close();
await server.close();

report.pass = failures.length === 0;
report.failures = failures;
writeFileSync(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
const pages = report.pages.length;
const flows = report.flows.length;
console.log(
  `page-check: 화면 ${pages}개(상태×너비), 흐름 ${flows}개 → ${report.pass ? "통과" : `어긋남 ${failures.length}건`}`,
);
console.log(`page-check: 결과 ${join(out, "report.json")}, 스크린샷 ${out}`);
for (const f of failures) console.error(`- ${f}`);
process.exit(report.pass ? 0 : 1);
