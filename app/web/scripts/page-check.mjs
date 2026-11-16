// 공통 부품 견본을 실제 브라우저로 잰다(TASK-029). 이 컴퓨터에서만 돈다: CI에는 브라우저가 없어 node 시험만 돈다(app/README.md).
// 1) vite 개발 서버로 samples.html(개발용 견본, 운영 빌드에 없음)을 띄우고
// 2) 미리 설치된 Playwright Chromium으로 상태마다 360·1280(높이 800, deviceScaleFactor 1)을 열어
//    corthex-uxui page-check.js(오류 0), 가로 넘침 없음, 콘솔 오류 없음, 실린 글꼴을 보고 스크린샷을 남긴다.
// 3) 키보드·요청 키 흐름을 누른다: 확인 창(첫 포커스 '돌아가기', Tab 가둠, Esc로 닫고 포커스 돌려줌, 확인하면 새 키와
//    confirm 값), 서버 실패 뒤 '다시 시도'(같은 키), 두 번 눌러도 요청 하나.
// 결과: <out>/report.json과 <out>/<상태>-<너비>.png. 하나라도 어긋나면 끝 상태 1.
// 쓰임(app/에서): npm run check:pages -w web -- [--out 폴더] [--page-check page-check.js 경로]
//   page-check.js는 --page-check, PAGE_CHECK, 아니면 tools/stage-checks.sh와 같은 곳
//   (${CORTHEX_PLUGINS:-~/.claude/plugins/synced}/*/corthex/skills/corthex-uxui/scripts/page-check.js)에서 찾는다.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

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
];
/** 06 IdempotencyKey */
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function findPageCheck() {
  const given = arg("--page-check") ?? process.env.PAGE_CHECK;
  if (given) return given;
  const plugins = process.env.CORTHEX_PLUGINS ?? join(homedir(), ".claude/plugins/synced");
  if (!existsSync(plugins)) return null;
  for (const dir of readdirSync(plugins).sort()) {
    const path = join(plugins, dir, "corthex/skills/corthex-uxui/scripts/page-check.js");
    if (existsSync(path)) return path;
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

// ── 1. 상태마다 360·1280 ──
for (const state of STATES) {
  for (const width of WIDTHS) {
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

async function flow(name, width, steps) {
  const { context, page, consoleErrors } = await open(name, width);
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
