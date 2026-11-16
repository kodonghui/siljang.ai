/**
 * 평가 결과 표와 결과 파일(TASK-027).
 *
 * - summary.md(결과 표): 모델마다 다섯 잣대의 실패 수(매긴 사례 수, 겨눈 사례의 실패), 사람 검토 수, 재지 않은 부분,
 *   REQ-146 바꾸기 시도에서 바뀐 것, 출력 없음(실패 종류별), 넘김 맞음(보조 지표), 토큰·금액(1,000차례당)·시간(P50·P95).
 *   답 글은 싣지 않는다. 저장소에 남기는 것은 이 파일 하나다(app/README.md 74).
 * - results.jsonl: 사례·모델마다 한 줄. 손님에게 나간 글과 출력(모두 합성 글), 잣대별 판정, ai_calls 꼴 행(내용 없음).
 * - review.md: 사람 검토 표본. 기계가 review로 둔 것 전부와, 모델마다 사례 10개에 하나(기계가 지나게 한 답을 사람이 보는 몫).
 * - run.json: 실행 정보(대상·프롬프트 버전·사례 버전·어림·상한·쓴 금액·멈춤).
 * - 결과 폴더(app/server/eval-results/)는 저장소에 올리지 않는다(.gitignore).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EVAL_CASES } from "./cases";
import { formatKrw, krwCents } from "./estimate";
import type { CaseResult, RunResult } from "./run";
import { CRITERIA, CRITERION_LABELS, type Criterion } from "./types";

export interface CriterionSummary {
  readonly criterion: Criterion;
  readonly fail: number;
  readonly review: number;
  readonly pass: number;
  readonly na: number;
  readonly noOutput: number;
  /** 기계로 매긴 사례(pass + fail + review). */
  readonly scored: number;
  /** 이 잣대를 겨눈 사례(출력 없음 포함)와 그 가운데 실패. */
  readonly targeted: number;
  readonly targetedFail: number;
  /** 이 대상에서 재지 못한 부분(예: server_notice)과 그 사례 수. */
  readonly notMeasured: Readonly<Record<string, number>>;
}

export interface ModelSummary {
  readonly model: string;
  readonly cases: number;
  readonly criteria: readonly CriterionSummary[];
  /** REQ-146: 바꾸기 시도 사례 가운데 어느 잣대든 실패한 사례(출력 없음은 바뀐 것이 아님). */
  readonly changeAttempts: { readonly total: number; readonly changed: number };
  readonly noOutput: Readonly<Record<string, number>>;
  readonly handoff: { readonly ok: number; readonly missing: number; readonly unexpected: number };
  readonly calls: number;
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
  };
  readonly krw: string;
  /** 1,000차례(손님 메시지 1,000개)당 금액. 상담 하나는 여러 차례라 상담당 값은 TASK-162가 정한다. */
  readonly krwPer1000Turns: string;
  readonly totalMs: { readonly p50: number | null; readonly p95: number | null };
  readonly firstTokenMs: { readonly p50: number | null; readonly p95: number | null };
}

/** 순위로 고른 백분위(가장 가까운 순위). 값이 없으면 null. */
export function percentile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(q * sorted.length));
  return sorted[rank - 1] ?? null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function summarizeModel(model: string, rows: readonly CaseResult[]): ModelSummary {
  const criteria = CRITERIA.map((criterion): CriterionSummary => {
    const counts = { fail: 0, review: 0, pass: 0, na: 0, noOutput: 0, targeted: 0, targetedFail: 0 };
    const notMeasured: Record<string, number> = {};
    for (const r of rows) {
      const v = r.verdicts.find((x) => x.criterion === criterion);
      if (v === undefined) continue;
      if (v.verdict === "fail") counts.fail += 1;
      else if (v.verdict === "review") counts.review += 1;
      else if (v.verdict === "pass") counts.pass += 1;
      else if (v.verdict === "n/a") counts.na += 1;
      else counts.noOutput += 1;
      if (r.targets.includes(criterion)) {
        counts.targeted += 1;
        if (v.verdict === "fail") counts.targetedFail += 1;
      }
      for (const part of v.notMeasured ?? []) notMeasured[part] = (notMeasured[part] ?? 0) + 1;
    }
    return { criterion, ...counts, scored: counts.pass + counts.fail + counts.review, notMeasured };
  });
  const attempts = rows.filter((r) => r.category === "change_attempt");
  const noOutput: Record<string, number> = {};
  for (const r of rows) if (r.failure !== null) noOutput[r.failure] = (noOutput[r.failure] ?? 0) + 1;
  const calls = rows.flatMap((r) => r.calls);
  const sum = (col: string): number => calls.reduce((acc, c) => acc + (num(c[col]) ?? 0), 0);
  const cents = calls.reduce((acc, c) => acc + (typeof c.cost_krw === "string" ? krwCents(c.cost_krw) : 0n), 0n);
  const per1000 = rows.length === 0 ? 0n : (cents * 1000n + BigInt(rows.length) - 1n) / BigInt(rows.length);
  const ms = (col: string): number[] => calls.map((c) => num(c[col])).filter((v): v is number => v !== null);
  return {
    model,
    cases: rows.length,
    criteria,
    changeAttempts: {
      total: attempts.length,
      changed: attempts.filter((r) => r.verdicts.some((v) => v.verdict === "fail")).length,
    },
    noOutput,
    handoff: {
      ok: rows.filter((r) => r.handoff === "ok").length,
      missing: rows.filter((r) => r.handoff === "missing").length,
      unexpected: rows.filter((r) => r.handoff === "unexpected").length,
    },
    calls: calls.length,
    tokens: {
      input: sum("input_tokens"),
      output: sum("output_tokens"),
      cacheRead: sum("cache_read_tokens"),
      cacheWrite: sum("cache_write_tokens"),
    },
    krw: formatKrw(cents),
    krwPer1000Turns: formatKrw(per1000),
    totalMs: { p50: percentile(ms("total_ms"), 0.5), p95: percentile(ms("total_ms"), 0.95) },
    firstTokenMs: { p50: percentile(ms("first_token_ms"), 0.5), p95: percentile(ms("first_token_ms"), 0.95) },
  };
}

export function summarize(run: RunResult): ModelSummary[] {
  return run.models.map((m) =>
    summarizeModel(
      m,
      run.results.filter((r) => r.model === m),
    ),
  );
}

const NOT_MEASURED_LABELS: Readonly<Record<string, string>> = {
  server_notice: "서버가 첫 답보다 먼저 보내는 AI 상담 고지(SPEC-018, TASK-064). 이 대상에는 서버 경로가 없음",
};

const ms = (v: number | null): string => (v === null ? "-" : String(v));
const count = (r: Readonly<Record<string, number>>): string =>
  Object.keys(r).length === 0
    ? "0"
    : Object.entries(r)
        .map(([k, v]) => `${k} ${v}`)
        .join(", ");

/** 결과 표(summary.md). 답 글은 싣지 않는다. */
export function summaryMarkdown(run: RunResult): string {
  const s = summarize(run);
  const head = `| 항목 | ${s.map((m) => m.model).join(" | ")} |\n| --- |${s.map(() => " --- |").join("")}`;
  const row = (label: string, f: (m: ModelSummary) => string): string => `| ${label} | ${s.map(f).join(" | ")} |`;
  const crit = (m: ModelSummary, k: Criterion): CriterionSummary =>
    m.criteria.find((x) => x.criterion === k) as CriterionSummary;
  const notMeasured = new Map<string, number>();
  for (const m of s) {
    for (const c of m.criteria) {
      for (const [part, n] of Object.entries(c.notMeasured))
        notMeasured.set(part, Math.max(notMeasured.get(part) ?? 0, n));
    }
  }
  const mode =
    run.mode === "mock"
      ? "모의(mock): 모델 회사로 요청을 보내지 않음. 답은 사례가 기대하는 행동대로 만든 모의 응답이고 토큰·금액은 어림"
      : "실제(real): 모델 회사 API를 호출함(유료)";
  const lines = [
    `# AI 평가 결과 표 ${run.runId}`,
    "",
    `- 실행: ${run.startedAt}, ${mode}`,
    `- 대상: ${run.subject.name}(프롬프트 ${run.subject.promptVersion}), 사례 ${run.casesVersion} ${s[0]?.cases ?? 0}개(모델마다)`,
    `- 모델: ${run.models.join(", ")}`,
    `- 금액 기준: 환율 ${run.estimate.fx.rate}원(${run.estimate.fx.date}), 요금표 src/ai-prices.ts`,
    `- 어림(시작 전): 전형 ${run.estimate.typicalKrw}원, 위 끝 ${run.estimate.upperKrw}원 · 상한 ${run.maxKrw === null ? "없음" : `${run.maxKrw}원`} · 쓴 금액 ${run.spentKrw}원`,
    `- 멈춤: ${run.stopped === null ? "없음(모든 사례를 돌림)" : `비용 상한으로 ${run.stopped.model}의 ${run.stopped.beforeCase} 앞에서 멈춤`}`,
    "",
    "## REQ-145 다섯 잣대: 실패 수 / 기계로 매긴 사례 (겨눈 사례의 실패 / 겨눈 사례)",
    "",
    head,
    ...CRITERIA.map((k) =>
      row(CRITERION_LABELS[k], (m) => {
        const c = crit(m, k);
        return `${c.fail} / ${c.scored} (${c.targetedFail} / ${c.targeted})`;
      }),
    ),
    row("사람 검토로 둔 판정", (m) => String(m.criteria.reduce((a, c) => a + c.review, 0))),
    row("출력 없음(호출 실패, 사례 수)", (m) => count(m.noOutput)),
    row("기계 채점 실패 합계", (m) => String(m.criteria.reduce((a, c) => a + c.fail, 0))),
    "",
    "- 실패 0과 사람 검토 0이 함께여야 그 잣대가 0건이다. 사람 검토는 review.md의 표본을 사람이 보고 정한다.",
    "- 출력 없음은 운영에서 정해진 문장과 에스컬레이션으로 끝나 다섯 잣대를 어기지 않지만, 모델 고르기(TASK-162)를 위해 따로 센다.",
    "",
    "## REQ-146 바꾸기 시도에서 바뀐 것(어느 잣대든 실패한 사례)",
    "",
    head,
    row("바뀐 것 / 바꾸기 시도", (m) => `${m.changeAttempts.changed} / ${m.changeAttempts.total}`),
    "",
    "## 보조 지표(REQ-145 잣대가 아님)",
    "",
    head,
    row(
      "넘김 맞음 / 빠짐 / 넘기지 않아야 하는데 넘김",
      (m) => `${m.handoff.ok} / ${m.handoff.missing} / ${m.handoff.unexpected}`,
    ),
    "",
    "## 토큰·금액·시간",
    "",
    head,
    row("호출", (m) => String(m.calls)),
    row("입력 / 출력 토큰", (m) => `${m.tokens.input} / ${m.tokens.output}`),
    row("캐시 읽기 / 쓰기 토큰", (m) => `${m.tokens.cacheRead} / ${m.tokens.cacheWrite}`),
    row("금액(원)", (m) => m.krw),
    row("1,000차례당(원)", (m) => m.krwPer1000Turns),
    row("전체 시간 P50 / P95(ms)", (m) => `${ms(m.totalMs.p50)} / ${ms(m.totalMs.p95)}`),
    row("첫 토큰 P50 / P95(ms)", (m) => `${ms(m.firstTokenMs.p50)} / ${ms(m.firstTokenMs.p95)}`),
    "",
    "## 재지 않은 것",
    "",
    ...(notMeasured.size === 0
      ? ["- 없음"]
      : [...notMeasured].map(([part, n]) => `- ${NOT_MEASURED_LABELS[part] ?? part}: 사례 ${n}개`)),
    "",
  ];
  return lines.join("\n");
}

/** 사람 검토 표본(review.md). 합성 글이라 손님 말과 답을 그대로 싣는다. */
export function reviewMarkdown(run: RunResult): string {
  const byId = new Map(EVAL_CASES.map((c) => [c.id, c]));
  const reply = (r: CaseResult): string => r.sent.map((m) => `[${m.kind}] ${m.text}`).join(" / ");
  const lines = [`# 사람 검토 표본 ${run.runId}`, "", "## 기계가 review로 둔 판정", ""];
  const reviews = run.results.flatMap((r) => r.verdicts.filter((v) => v.verdict === "review").map((v) => ({ r, v })));
  if (reviews.length === 0) lines.push("- 없음");
  for (const { r, v } of reviews) {
    lines.push(
      `### ${r.caseId} · ${r.model} · ${CRITERION_LABELS[v.criterion]} (${v.reasons.join(", ")})`,
      "",
      `- 손님: ${byId.get(r.caseId)?.message ?? ""}`,
      `- 답: ${reply(r)}`,
      "- 사람 판정: (실패 / 문제없음)",
      "",
    );
  }
  lines.push("## 기계가 지나게 한 답의 표본(모델마다 사례 10개에 하나)", "");
  for (const m of run.models) {
    const rows = run.results.filter((r) => r.model === m);
    rows.forEach((r, i) => {
      if (i % 10 !== 0) return;
      lines.push(`- ${r.caseId} · ${m}: 손님 '${byId.get(r.caseId)?.message ?? ""}' → 답 '${reply(r)}'`);
    });
  }
  lines.push("");
  return lines.join("\n");
}

/** 결과 파일 넷을 dir에 쓰고 경로를 돌려준다. */
export function writeResultFiles(dir: string, run: RunResult): Readonly<Record<string, string>> {
  mkdirSync(dir, { recursive: true });
  const paths = {
    summary: join(dir, "summary.md"),
    results: join(dir, "results.jsonl"),
    review: join(dir, "review.md"),
    run: join(dir, "run.json"),
  };
  writeFileSync(paths.summary, summaryMarkdown(run), "utf8");
  writeFileSync(
    paths.results,
    `${run.results.map((r) => JSON.stringify({ runId: run.runId, ...r })).join("\n")}\n`,
    "utf8",
  );
  writeFileSync(paths.review, reviewMarkdown(run), "utf8");
  const meta = {
    runId: run.runId,
    mode: run.mode,
    startedAt: run.startedAt,
    casesVersion: run.casesVersion,
    subject: run.subject,
    models: run.models,
    estimate: run.estimate,
    maxKrw: run.maxKrw,
    spentKrw: run.spentKrw,
    stopped: run.stopped,
    resultRows: run.results.length,
  };
  writeFileSync(paths.run, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  return paths;
}
