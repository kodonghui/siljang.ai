// vite build 뒤에 운영 빌드(dist/)를 확인한다(TASK-029).
// 1) 개발용 부품 견본(samples.html, src/samples/)이 들어가지 않았는지 2) 09 토큰과 공통 부품 스타일이 첫 CSS에 실렸는지
// 3) 큰 글꼴 CSS(@font-face)가 첫 CSS(index.html이 바로 싣는 것)에 없고 따로 실리는지(src/styles/fonts.ts).
// 쓰임: npm run build -w web(빌드 끝에 자동). 따로: node scripts/check-dist.mjs [dist 경로]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const dist = process.argv[2] ?? fileURLToPath(new URL("../dist", import.meta.url));

/** 견본에만 있는 표식(하나라도 보이면 견본이 운영 빌드에 섞인 것) */
const SAMPLE_MARKERS = ["부품 견본", "__sampleRequests", "data-sample", "sampleReady"];
/** 운영 빌드의 CSS에 있어야 하는 것(토큰 하나와 공통 부품 하나) */
const REQUIRED_CSS = ["--color-paper", "--size-target", ".ui-button", ".ui-dialog"];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const problems = [];
let files;
try {
  files = walk(dist);
} catch {
  console.error(`check-dist: ${dist}가 없어요. 먼저 vite build`);
  process.exit(1);
}
const rel = (path) => relative(dist, path);
const names = files.map(rel);

if (!names.includes("index.html")) problems.push("index.html이 없음");
for (const name of names) {
  if (/(^|\/)samples(\.html|\/)/.test(name)) problems.push(`견본 파일이 들어감: ${name}`);
}

for (const path of files) {
  if (!/\.(html|js|css)$/.test(path)) continue;
  const text = readFileSync(path, "utf8");
  for (const marker of SAMPLE_MARKERS) {
    if (text.includes(marker)) problems.push(`견본 표식 "${marker}"이 ${rel(path)}에 있음`);
  }
}

// index.html이 바로 싣는 CSS(첫 그림을 막는 것)와 나머지 CSS
const html = names.includes("index.html") ? readFileSync(join(dist, "index.html"), "utf8") : "";
const firstCss = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="\/?([^"]+)"/g)].map((m) => m[1]);
if (firstCss.length === 0) problems.push("index.html이 싣는 CSS가 없음");
const read = (name) => readFileSync(join(dist, name), "utf8");
const first = firstCss
  .filter((name) => names.includes(name))
  .map(read)
  .join("\n");
const later = names
  .filter((name) => name.endsWith(".css") && !firstCss.includes(name))
  .map(read)
  .join("\n");
for (const needle of REQUIRED_CSS) {
  if (!first.includes(needle)) problems.push(`첫 CSS에 ${needle}가 없음`);
}
if (first.includes("@font-face")) problems.push("첫 CSS에 @font-face가 있음(글꼴 CSS는 src/styles/fonts.ts로 따로)");
if (!later.includes("IBM Plex Sans KR")) problems.push("따로 싣는 글꼴 CSS가 없음");

if (problems.length > 0) {
  console.error(`check-dist: ${problems.length}건\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
const kb = (text) => `${Math.round(Buffer.byteLength(text) / 1024)}KB`;
console.log(
  `check-dist: 통과(파일 ${names.length}개, 견본 없음, 첫 CSS ${kb(first)}에 토큰·공통 부품, 글꼴 CSS ${kb(later)}는 따로)`,
);
