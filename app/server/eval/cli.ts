/**
 * AI 평가 한 명령(TASK-027): `npm run eval -w server -- [옵션]`. 옵션은 usage()에 있고 app/README.md 74에 같은 설명이 있다.
 *
 * - 옵션이 없으면 모의 실행이다. 모의 실행은 키를 읽지 않고 모델 회사로 요청을 보내지 않는다.
 * - 실제 실행(--real)은 고른 회사의 키 환경 변수, 환율 환경 변수, 비용 상한(--max-krw)이 모두 있어야 시작한다.
 *   키 값은 화면·파일·로그에 내지 않는다(Secret으로 감싸 모델 호출 모듈에만 넘김).
 * - 모델 목록은 --model로 받고, 없으면 요금표(src/ai-prices.ts)에서 회사마다 가장 싼 모델 하나씩이다. 배포에 쓸 모델을
 *   고르는 일은 TASK-162다.
 * - 평가 도구에서 환경 변수를 읽는 곳은 이 파일 하나다. 값의 검사는 서버 설정 모듈(readSettings)을 그대로 쓴다.
 * - 종료 코드: 0 끝남, 2 시작하지 않음(옵션·키·상한·추적 도구), 3 비용 상한으로 도중에 멈춤, 1 그 밖의 오류.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AI_PRICES, AI_PROVIDERS, type AiProvider, type FxRate } from "../src/ai-prices";
import { AI_EFFORTS, type AiEffort, readSettings, type Secret, SettingsError, tracingSwitchOn } from "../src/settings";
import { EVAL_CASES } from "./cases";
import { CHECKLIST_PATH, checklistMarkdown } from "./checklist";
import { estimateRun } from "./estimate";
import { summaryMarkdown, writeResultFiles } from "./report";
import { EvalRefused, newRunId, runEval } from "./run";
import { baselineSubject } from "./subject";
import { CATEGORIES, type EvalCase, type ModelTarget, targetName } from "./types";

/** 모의 실행의 기본 환율(모델 호출 모듈 시험과 같은 값). 실제 실행은 환경 변수로만 받는다. */
const MOCK_FX: FxRate = { rate: "1450.00", date: "2026-11-14" };
const RESULTS_DIR = new URL("../eval-results/", import.meta.url);

export function usage(): string {
  return [
    "사용: npm run eval -w server -- [옵션]",
    "  (옵션 없음)          모의 실행. 사례 전부를 회사마다 가장 싼 모델에 모의 응답으로 돌림(유료 호출 없음)",
    "  --model 회사/모델    돌릴 모델(여러 번 줄 수 있음). 예: anthropic/claude-haiku-5-5, openai/gpt-6-luna",
    `  --effort 강도        추론 강도(${AI_EFFORTS.join("·")}, 없으면 회사 기본)`,
    "  --limit n            사례 n개만(갈래를 돌아가며 고름)",
    "  --out 폴더           결과 폴더(기본 app/server/eval-results/<실행 ID>)",
    "  --dry-run            토큰·금액 어림만 보이고 호출하지 않음",
    "  --real               실제 실행(유료). 키·환율 환경 변수와 --max-krw가 있어야 함",
    "  --max-krw 원         비용 상한. 위 끝 어림이 넘으면 시작하지 않고, 실행 중 넘으려 하면 멈춤",
    "  --checklist          출처 점검표(app/server/eval/source-checklist.md)를 다시 씀",
    "환경 변수(실제 실행): ANTHROPIC_API_KEY·OPENAI_API_KEY(고른 회사의 것), AI_USD_KRW(예 1450.25), AI_USD_KRW_DATE(예 2026-11-16)",
  ].join("\n");
}

export interface CliArgs {
  readonly models: readonly string[];
  readonly effort: AiEffort | null;
  readonly limit: number | null;
  readonly out: string | null;
  readonly dryRun: boolean;
  readonly real: boolean;
  readonly maxKrw: string | null;
  readonly checklist: boolean;
  readonly help: boolean;
}

export class UsageError extends Error {
  override readonly name = "UsageError";
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const models: string[] = [];
  let effort: AiEffort | null = null;
  let limit: number | null = null;
  let out: string | null = null;
  let maxKrw: string | null = null;
  const flags = { dryRun: false, real: false, checklist: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const value = (): string => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new UsageError(`${a} needs a value`);
      i += 1;
      return v;
    };
    if (a === "--model") models.push(value());
    else if (a === "--effort") {
      const v = value();
      if (!(AI_EFFORTS as readonly string[]).includes(v)) throw new UsageError(`--effort must be ${AI_EFFORTS.join(", ")}`);
      effort = v as AiEffort;
    } else if (a === "--limit") {
      const v = value();
      if (!/^[1-9][0-9]*$/.test(v)) throw new UsageError("--limit must be a positive integer");
      limit = Number(v);
    } else if (a === "--out") out = value();
    else if (a === "--max-krw") {
      const v = value();
      if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(v)) throw new UsageError("--max-krw must be won like 5000 or 5000.50");
      maxKrw = v;
    } else if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--real") flags.real = true;
    else if (a === "--checklist") flags.checklist = true;
    else if (a === "--help" || a === "-h") flags.help = true;
    else throw new UsageError(`unknown option ${a}`);
  }
  return { models, effort, limit, out, maxKrw, ...flags };
}

/** 요금표에서 회사마다 가장 싼 모델(입력·출력 값의 합). */
export function cheapestModels(): string[] {
  return AI_PROVIDERS.map((provider) => {
    const rows = AI_PRICES.filter((p) => p.provider === provider);
    const cost = (p: (typeof rows)[number]): number => Number(p.input) + Number(p.output);
    const best = rows.reduce((a, b) => (cost(b) < cost(a) ? b : a));
    return `${provider}/${best.model}`;
  });
}

/** 갈래를 돌아가며 n개를 고른다(사례 순서는 cases.ts 그대로). */
export function pickCases(cases: readonly EvalCase[], n: number | null): EvalCase[] {
  if (n === null || n >= cases.length) return [...cases];
  const queues = CATEGORIES.map((k) => cases.filter((c) => c.category === k));
  const picked = new Set<string>();
  for (let round = 0; picked.size < n; round += 1) {
    for (const q of queues) {
      const c = q[round];
      if (c !== undefined && picked.size < n) picked.add(c.id);
    }
  }
  return cases.filter((c) => picked.has(c.id));
}

interface Resolved {
  readonly targets: ModelTarget[];
  readonly fx: FxRate;
  readonly keys: Partial<Record<AiProvider, Secret>>;
}

/** 모델·환율·키를 서버 설정 모듈로 검사해 받는다. 키는 real일 때만 읽는다. */
function resolve(args: CliArgs, env: Readonly<Record<string, string | undefined>>): Resolved {
  const names = args.models.length > 0 ? args.models : cheapestModels();
  const fxFromEnv = (env.AI_USD_KRW ?? "") !== "" || (env.AI_USD_KRW_DATE ?? "") !== "";
  if (args.real && !fxFromEnv) throw new UsageError("a real run needs AI_USD_KRW and AI_USD_KRW_DATE");
  const fx: FxRate = fxFromEnv ? { rate: env.AI_USD_KRW ?? "", date: env.AI_USD_KRW_DATE ?? "" } : MOCK_FX;
  const keys: Partial<Record<AiProvider, Secret>> = {};
  const targets = names.map((name): ModelTarget => {
    const m = /^(anthropic|openai)\/([A-Za-z0-9._-]+)$/.exec(name);
    if (m === null) throw new UsageError(`--model must look like anthropic/<model> or openai/<model>: ${name}`);
    const provider = m[1] as AiProvider;
    const keyName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
    const settings = readSettings({
      APP_ENV: "development",
      AI_PROVIDER: provider,
      AI_MODEL: m[2],
      AI_EFFORT: args.effort ?? "",
      AI_USD_KRW: fx.rate,
      AI_USD_KRW_DATE: fx.date,
      ...(args.real ? { [keyName]: env[keyName] } : {}),
    }).ai;
    if (settings === null) throw new UsageError("model settings are empty");
    if (args.real && settings.apiKey !== null) keys[provider] = settings.apiKey;
    return { provider, model: settings.model, effort: settings.effort };
  });
  return { targets, fx, keys };
}

const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

export async function main(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    say(`시작하지 않음: ${e.message}\n${usage()}`);
    return 2;
  }
  if (args.help) {
    say(usage());
    return 0;
  }
  if (args.checklist) {
    writeFileSync(CHECKLIST_PATH, checklistMarkdown(), "utf8");
    say(`출처 점검표를 다시 씀: ${fileURLToPath(CHECKLIST_PATH)}`);
    return 0;
  }
  const tracing = tracingSwitchOn(env);
  if (tracing !== null) {
    say(`시작하지 않음(tracing_on): ${tracing}가 켜져 있음. 끄고 다시 실행(REQ-138)`);
    return 2;
  }
  let r: Resolved;
  try {
    r = resolve(args, env);
  } catch (e) {
    if (!(e instanceof UsageError) && !(e instanceof SettingsError)) throw e;
    say(`시작하지 않음: ${e.message}`);
    return 2;
  }
  const cases = pickCases(EVAL_CASES, args.limit);
  const mode = args.real ? "real" : "mock";
  const estimate = estimateRun(baselineSubject, cases, r.targets, r.fx);
  say(`모드 ${mode}${mode === "mock" ? "(모의 응답, 유료 호출 없음)" : "(실제 호출, 유료)"} · 사례 ${cases.length}개 · 모델 ${r.targets.map(targetName).join(", ")}`);
  say(`환율 ${r.fx.rate}원(${r.fx.date}) · 프롬프트 ${baselineSubject.promptVersion}`);
  for (const t of estimate.targets) {
    say(
      `  ${t.target}: 전형 어림 입력 ${t.typical.input}·출력 ${t.typical.output}토큰 ${t.typical.krw}원 · 위 끝 입력 ${t.upper.input}·출력 ${t.upper.output}토큰 ${t.upper.krw}원 (호출 ${t.upper.calls}번까지)`,
    );
  }
  say(`  합계: 전형 ${estimate.typicalKrw}원 · 위 끝 ${estimate.upperKrw}원`);
  if (args.dryRun) {
    say("dry-run: 호출하지 않고 끝냄");
    return 0;
  }
  const started = new Date();
  const runId = newRunId(started);
  try {
    const run = await runEval({
      mode,
      cases,
      targets: r.targets,
      fx: r.fx,
      maxKrw: args.maxKrw,
      keys: r.keys,
      runId,
      onProgress: (done, total) => {
        if (done % 20 === 0 || done === total) say(`  진행 ${done}/${total}`);
      },
    });
    const dir = args.out ?? fileURLToPath(new URL(`${runId}/`, RESULTS_DIR));
    const paths = writeResultFiles(dir, run);
    say("");
    say(summaryMarkdown(run));
    say(`결과 파일: ${Object.values(paths).join(", ")}`);
    if (run.stopped !== null) {
      say(`비용 상한으로 도중에 멈춤: ${run.stopped.model}의 ${run.stopped.beforeCase} 앞`);
      return 3;
    }
    return 0;
  } catch (e) {
    if (!(e instanceof EvalRefused)) throw e;
    say(`시작하지 않음(${e.code}): ${e.message}`);
    return 2;
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2), process.env).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      // 오류 글에 요청 내용이 섞일 수 있어 이름만 낸다(모델 호출 모듈과 같은 규칙).
      process.stderr.write(`평가 도구 오류: ${e instanceof Error ? e.name : "unknown"}\n`);
      process.exitCode = 1;
    },
  );
}
