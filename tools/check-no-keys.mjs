#!/usr/bin/env node
// 키 꼴의 값이 저장소 파일이나 로그에 있는지 찾는다(11단계 계약, REQ-135, TASK-015).
//
// 사용
//   node tools/check-no-keys.mjs --repo          git이 추적하는 파일 전부(저장소 뿌리 기준)
//   node tools/check-no-keys.mjs <파일>...        주어진 파일(CI의 시험·빌드 로그)
//   node tools/check-no-keys.mjs --self-test     검사기가 키 꼴을 잡는지 스스로 확인
// 끝 상태: 찾으면 1, 깨끗하면 0, 쓰는 법이 틀리거나 파일을 못 읽으면 2.
//
// 찾은 값은 출력하지 않는다. '파일:줄: 꼴 이름'만 쓴다(로그에 값이 다시 남지 않게).
// 시험용 가짜 키는 코드에서 실행 중에 이어 붙여 만들고 글로 적지 않는다.
// 일부러 둔 예시 줄은 같은 줄에 'check-no-keys: allow'와 까닭을 적는다.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const PATTERNS = [
  ["anthropic_key", /sk-ant-[A-Za-z0-9_-]{20,}/],
  ["openai_key", /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/],
  ["github_token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/],
  ["aws_access_key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["slack_token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["google_api_key", /\bAIza[0-9A-Za-z_-]{35}/],
  ["private_key", /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/],
  ["supabase_secret", /\bsb_secret_[A-Za-z0-9_-]{20,}/],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}/],
  ["stripe_secret", /\b[rs]k_live_[A-Za-z0-9]{20,}/],
  [
    "assigned_secret",
    /\b[A-Z0-9_]*(?:API_KEY|API_TOKEN|SECRET_KEY|SECRET|ACCESS_KEY|PRIVATE_KEY|PASSWORD|AUTH_TOKEN)\b\s*[:=]\s*["']?[A-Za-z0-9_\-/+=.]{20,}/,
  ],
];

const ALLOW = "check-no-keys: allow";
const MAX_BYTES = 5 * 1024 * 1024;

function scanText(text) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(ALLOW)) continue;
    for (const [name, re] of PATTERNS) {
      if (re.test(line)) hits.push({ line: i + 1, name });
    }
  }
  return hits;
}

function readTextFile(file) {
  const st = statSync(file);
  if (!st.isFile()) return null;
  if (st.size > MAX_BYTES) return { skipped: "too_large" };
  const buf = readFileSync(file);
  if (buf.subarray(0, 8000).includes(0)) return { skipped: "binary" };
  return { text: buf.toString("utf8") };
}

function scanFiles(files, base) {
  let hitCount = 0;
  let scanned = 0;
  const skipped = [];
  for (const rel of files) {
    const file = base ? path.join(base, rel) : rel;
    let content;
    try {
      content = readTextFile(file);
    } catch (e) {
      console.error(`check-no-keys: cannot read ${rel} (${e.code ?? e.name})`);
      return 2;
    }
    if (content === null) continue;
    if (content.skipped) {
      skipped.push(`${rel} (${content.skipped})`);
      continue;
    }
    scanned++;
    for (const hit of scanText(content.text)) {
      hitCount++;
      console.log(`${rel}:${hit.line}: ${hit.name}`);
    }
  }
  for (const s of skipped) console.log(`check-no-keys: skipped ${s}`);
  console.log(`check-no-keys: ${scanned} files scanned, ${hitCount} key-shaped values found`);
  return hitCount > 0 ? 1 : 0;
}

function repoFiles() {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { root, files: out.split("\0").filter((f) => f !== "") };
}

function selfTest() {
  // 키 꼴의 값을 실행 중에만 만든다. 이 파일의 글에는 키 꼴이 없다.
  const body = (n) => "Q7w".repeat(Math.ceil(n / 3)).slice(0, n);
  const samples = {
    anthropic_key: `sk-${"ant"}-api03-${body(40)}`,
    openai_key: `sk-${"proj"}-${body(48)}`,
    github_token: `gh${"p"}_${body(36)}`,
    aws_access_key: `AK${"IA"}${"QZ7Y".repeat(4)}`,
    slack_token: `xo${"xb"}-${body(24)}`,
    google_api_key: `AI${"za"}${body(35)}`,
    private_key: `-----BEGIN ${"RSA"} PRIVATE ${"KEY"}-----`,
    supabase_secret: `sb_${"secret"}_${body(32)}`,
    jwt: `ey${"J"}${body(20)}.ey${"J"}${body(20)}.${body(30)}`,
    stripe_secret: `sk_${"live"}_${body(24)}`,
    assigned_secret: `ANTHROPIC_API_${"KEY"}=${body(40)}`,
  };
  let failed = 0;
  for (const [name] of PATTERNS) {
    const sample = samples[name];
    const found = sample === undefined ? [] : scanText(`x ${sample} y`).map((h) => h.name);
    if (!found.includes(name)) {
      console.log(`self-test: ${name} not detected`);
      failed++;
    }
  }
  const clean = [
    "ANTHROPIC_API_KEY=",
    "APP_ENV=development",
    "traceId: 0123456789abcdef0123456789abcdef",
    "secrets: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
    "npm run lint && npm test",
  ];
  for (const line of clean) {
    if (scanText(line).length > 0) {
      console.log(`self-test: false positive on clean line ${JSON.stringify(line)}`);
      failed++;
    }
  }
  const allowed = scanText(`${samples.openai_key} # ${ALLOW}: example`).length === 0;
  if (!allowed) {
    console.log("self-test: allow marker ignored");
    failed++;
  }
  console.log(`check-no-keys self-test: ${PATTERNS.length} patterns, ${failed} failed`);
  return failed > 0 ? 1 : 0;
}

function main(argv) {
  if (argv.length === 1 && argv[0] === "--self-test") return selfTest();
  if (argv.length === 1 && argv[0] === "--repo") {
    const { root, files } = repoFiles();
    return scanFiles(files, root);
  }
  if (argv.length === 0 || argv.some((a) => a.startsWith("--"))) {
    console.error("usage: check-no-keys.mjs --repo | --self-test | <file>...");
    return 2;
  }
  return scanFiles(argv, null);
}

process.exitCode = main(process.argv.slice(2));
