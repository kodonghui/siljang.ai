/**
 * 평가 실행(TASK-027). 사례마다 평가 대상(subject.ts)을 모델마다 한 번씩 부르고 다섯 잣대로 채점한다(score.ts).
 *
 * - 모의(mock)가 기본이다. 모의 실행은 모델 회사로 요청을 보내지 않는다(mock.ts의 fetch만 씀).
 * - 실제(real) 실행은 mode "real", 고른 회사마다의 키, 비용 상한(원)이 모두 있어야 한다. 하나라도 없으면 시작하지 않는다.
 * - 비용 상한: 시작 전에 위 끝 어림 합계(estimate.ts)가 상한을 넘으면 시작하지 않는다. 실행 중에는 쓴 금액(ai_calls 꼴
 *   행의 cost_krw 합)에 다음 호출의 위 끝을 더해 상한을 넘으면 그 앞에서 멈추고(stopped) 그때까지의 결과를 낸다.
 *   모의 실행도 상한을 주면 같은 규칙을 어림 금액에 쓴다.
 * - 추적 도구가 켜져 있으면 모드와 상관없이 시작하지 않는다(REQ-138, 모델 호출 모듈도 운영 설정으로 막음).
 * - 호출은 차례로 하나씩 한다(동시 호출 없음). 다시 하기는 대상이 정한다(버전 0은 없음).
 */
import { randomBytes } from "node:crypto";
import type { AiFailure } from "../src/ai-model";
import { type AiProvider, type FxRate, priceOf } from "../src/ai-prices";
import type { AiTurnOutput } from "../src/ai-turn-output";
import { type AiSettings, Secret, tracingSwitchInProcess } from "../src/settings";
import { EVAL_CASES_VERSION } from "./cases";
import type { EvalCheckpoint } from "./checkpoint";
import { estimateRun, formatKrw, krwCents, type RunEstimate, upperCallCents } from "./estimate";
import { idealResponder, mockFetch, type Responder } from "./mock";
import { createEvalPacer, type EvalPacer } from "./pacing";
import { handoffCheck, scoreTurn } from "./score";
import { baselineSubject, type Subject } from "./subject";
import {
  type AiCallRecord,
  type Category,
  type Criterion,
  type CriterionResult,
  type EvalCase,
  type ModelTarget,
  type SentMessage,
  targetName,
} from "./types";

export type RunMode = "mock" | "real";

export interface RunOptions {
  readonly mode: RunMode;
  readonly cases: readonly EvalCase[];
  readonly targets: readonly ModelTarget[];
  readonly fx: FxRate;
  /** 비용 상한(원, "5000" 꼴). 실제 실행은 꼭 있어야 한다. */
  readonly maxKrw: string | null;
  /** 같은 모델의 호출 실패가 이 수에 닿으면 다음 사례를 시작하지 않는다. 채점 실패는 세지 않는다. */
  readonly maxFailures?: number | null;
  /** 실제 실행의 키(고른 회사만). CLI가 환경 변수에서 읽어 넘긴다. */
  readonly keys?: Partial<Record<AiProvider, Secret>>;
  readonly subject?: Subject;
  /** 모의 응답(기본 idealResponder). */
  readonly responder?: Responder;
  /** 실제 실행의 fetch(기본 전역 fetch). 시험만 가짜를 넣는다. */
  readonly fetch?: typeof fetch;
  readonly runId?: string;
  readonly now?: () => Date;
  /** 사례 하나가 끝날 때마다(진행 표시). */
  readonly onProgress?: (done: number, total: number) => void;
  readonly minIntervalMs?: number;
  readonly maxWaitMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly resume?: EvalCheckpoint;
  /** 호출 전 예약과 결과를 다음 호출 전에 보존한다. */
  readonly onCheckpoint?: (checkpoint: EvalCheckpoint) => void;
}

export interface CaseResult {
  readonly caseId: string;
  readonly category: Category;
  readonly targets: readonly Criterion[];
  /** 상담의 첫 메시지인지(SPEC-018 고지 대상). */
  readonly firstMessage: boolean;
  readonly model: string;
  readonly verdicts: readonly CriterionResult[];
  readonly handoff: ReturnType<typeof handoffCheck>;
  readonly failure: AiFailure | null;
  /** 손님에게 나가는 메시지(합성 글). */
  readonly sent: readonly SentMessage[];
  readonly output: AiTurnOutput | null;
  /** ai_calls 한 행과 같은 열 이름의 값(내용 없음). */
  readonly calls: readonly AiCallRecord[];
}

export interface RunResult {
  readonly runId: string;
  readonly mode: RunMode;
  readonly startedAt: string;
  readonly casesVersion: string;
  readonly subject: { readonly name: string; readonly promptVersion: string; readonly sendsNotice: boolean };
  readonly models: readonly string[];
  readonly estimate: RunEstimate;
  readonly maxKrw: string | null;
  readonly maxFailures: number | null;
  /** ai_calls 꼴 행의 cost_krw 합(모의 실행은 어림). */
  readonly spentKrw: string;
  /** 사용량을 받지 못한 호출은 비용 상한의 여유에서 차감한다. 실제 청구액과 구분한다. */
  readonly unknownCostReserveKrw?: string;
  readonly stopped: {
    readonly reason: "cost_cap" | "provider_failures" | "retry_after";
    readonly beforeCase: string;
    readonly model: string;
    readonly retryAt?: string;
  } | null;
  readonly results: readonly CaseResult[];
}

/** 실행하지 않은 이유. code는 CLI 출력과 시험이 본다. 메시지에는 키 값을 싣지 않는다. */
export class EvalRefused extends Error {
  override readonly name = "EvalRefused";
  readonly code:
    | "tracing_on"
    | "unknown_model"
    | "max_krw_required"
    | "key_missing"
    | "cost_cap"
    | "no_cases"
    | "bad_failure_limit"
    | "resume_mismatch"
    | "resume_inflight";

  constructor(code: EvalRefused["code"], message: string) {
    super(message);
    this.code = code;
  }
}

/** 모의 실행의 키 자리(값이 있어야 모델 호출 모듈이 key_missing으로 끝내지 않음). 실제 키가 아니다. */
const MOCK_KEY = new Secret(["eval", "mock", "not", "a", "key"].join("-"));

export function newRunId(now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.[0-9]+Z$/, "Z");
  return `eval-${stamp}-${randomBytes(3).toString("hex")}`;
}

export async function runEval(o: RunOptions): Promise<RunResult> {
  const subject = o.subject ?? baselineSubject;
  const now = o.now ?? (() => new Date());
  const on = tracingSwitchInProcess();
  if (on !== null) throw new EvalRefused("tracing_on", `${on} is on; turn tracing off before an eval run (REQ-138)`);
  if (o.cases.length === 0 || o.targets.length === 0) throw new EvalRefused("no_cases", "no cases or no models to run");
  const maxFailures = o.maxFailures ?? null;
  if (maxFailures !== null && (!Number.isSafeInteger(maxFailures) || maxFailures < 1)) {
    throw new EvalRefused("bad_failure_limit", "maxFailures must be a positive safe integer");
  }
  for (const t of o.targets) {
    if (priceOf(t.provider, t.model) === undefined) {
      throw new EvalRefused("unknown_model", `${targetName(t)} is not in the price table (src/ai-prices.ts)`);
    }
  }
  const estimate = estimateRun(subject, o.cases, o.targets, o.fx);
  const cap = o.maxKrw === null ? null : krwCents(o.maxKrw);
  if (o.mode === "real") {
    if (cap === null) throw new EvalRefused("max_krw_required", "a real run needs a cost cap (--max-krw)");
    const providers = [...new Set(o.targets.map((t) => t.provider))];
    const missing = providers.filter((p) => o.keys?.[p] === undefined);
    if (missing.length > 0) throw new EvalRefused("key_missing", `no API key for ${missing.join(", ")}`);
  }
  if (cap !== null && krwCents(estimate.upperKrw) > cap) {
    throw new EvalRefused(
      "cost_cap",
      `upper estimate ${estimate.upperKrw} KRW is over the cap ${formatKrw(cap)} KRW; nothing was called`,
    );
  }

  const resume = o.resume;
  const names = o.targets.map(targetName);
  const byCase = new Map(o.cases.map((c) => [c.id, c]));
  const byModel = new Map(o.targets.map((t) => [targetName(t), t]));
  if (resume !== undefined) {
    const previous = resume.run;
    if (
      resume.version !== 1 ||
      previous.mode !== o.mode ||
      previous.casesVersion !== EVAL_CASES_VERSION ||
      previous.subject.name !== subject.name ||
      previous.subject.promptVersion !== subject.promptVersion ||
      previous.subject.sendsNotice !== subject.sendsNotice ||
      JSON.stringify(previous.models) !== JSON.stringify(names) ||
      previous.estimate.cases !== o.cases.length ||
      JSON.stringify(previous.estimate.fx) !== JSON.stringify(o.fx) ||
      !Array.isArray(previous.results) ||
      typeof previous.runId !== "string" ||
      !Number.isFinite(Date.parse(previous.startedAt))
    )
      throw new EvalRefused("resume_mismatch", "eval resume metadata does not match");
    if (resume.pending !== null)
      throw new EvalRefused("resume_inflight", "eval has an uncertain in-flight call; do not call it again");
    const seen = new Set<string>();
    for (const r of previous.results) {
      const id = `${r.model}:${r.caseId}`;
      if (!byCase.has(r.caseId) || !byModel.has(r.model) || seen.has(id) || !Array.isArray(r.calls))
        throw new EvalRefused("resume_mismatch", "eval resume rows do not match");
      seen.add(id);
    }
  }
  const startedAt = resume === undefined ? now() : new Date(resume.run.startedAt);
  const runId = resume?.run.runId ?? o.runId ?? newRunId(startedAt);
  const responder = o.responder ?? idealResponder;
  const total = o.cases.length * o.targets.length;
  const results: CaseResult[] = resume?.run.results.map((r) => ({ ...r, calls: [...r.calls] })) ?? [];
  let spent = 0n;
  let unknownReserve = 0n;
  let stopped: RunResult["stopped"] = null;
  const charge = (calls: readonly AiCallRecord[], c: EvalCase, target: ModelTarget) => {
    for (const call of calls) {
      const value = call.cost_krw;
      if (typeof value === "string" && /^[0-9]+(?:\.[0-9]{1,2})?$/.test(value)) spent += krwCents(value);
      else if (value == null) unknownReserve += upperCallCents(subject, c, target, o.fx);
      else throw new EvalRefused("resume_mismatch", "eval call cost is invalid");
    }
  };
  for (const r of results) {
    const c = byCase.get(r.caseId);
    const target = byModel.get(r.model);
    if (c === undefined || target === undefined) throw new EvalRefused("resume_mismatch", "eval rows do not match");
    charge(r.calls, c, target);
  }
  const previousReserve = resume?.run.unknownCostReserveKrw;
  if (previousReserve !== undefined) {
    if (!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(previousReserve))
      throw new EvalRefused("resume_mismatch", "eval unknown cost reserve is invalid");
    const reserved = krwCents(previousReserve);
    if (reserved > unknownReserve) unknownReserve = reserved;
  }
  if (resume !== undefined && formatKrw(spent) !== resume.run.spentKrw)
    throw new EvalRefused("resume_mismatch", "eval spent cost does not match its call ledger");
  const pacers = new Map<string, EvalPacer>();
  const snapshot = (): RunResult => ({
    runId,
    mode: o.mode,
    startedAt: startedAt.toISOString(),
    casesVersion: EVAL_CASES_VERSION,
    subject: { name: subject.name, promptVersion: subject.promptVersion, sendsNotice: subject.sendsNotice },
    models: names,
    estimate,
    maxKrw: cap === null ? null : formatKrw(cap),
    maxFailures,
    spentKrw: formatKrw(spent),
    unknownCostReserveKrw: formatKrw(unknownReserve),
    stopped,
    results: results.map((r) => ({ ...r, calls: [...r.calls] })),
  });
  const checkpoint = (pending: EvalCheckpoint["pending"]): void => {
    o.onCheckpoint?.({
      version: 1,
      run: snapshot(),
      pending,
      pacing: {
        ...resume?.pacing,
        ...Object.fromEntries([...pacers].map(([provider, p]) => [provider, p.notBefore()])),
      },
    });
  };
  checkpoint(null);

  run: for (const target of o.targets) {
    const name = targetName(target);
    let pacer = pacers.get(target.provider);
    if (pacer === undefined) {
      const intervalMs = o.minIntervalMs ?? 0;
      pacer = createEvalPacer({
        intervalMs,
        maxWaitMs: o.maxWaitMs ?? Math.max(intervalMs, 60_000),
        now,
        sleep: o.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
        notBefore: resume?.pacing[target.provider] ?? null,
      });
      pacers.set(target.provider, pacer);
    }
    let failures = 0;
    const key = o.mode === "real" ? (o.keys?.[target.provider] ?? null) : MOCK_KEY;
    const ai: AiSettings = {
      provider: target.provider,
      model: target.model,
      effort: target.effort,
      fx: o.fx,
      apiKey: key,
    };
    for (const c of o.cases) {
      const previousIndex = results.findIndex((r) => r.caseId === c.id && r.model === name);
      const previous = results[previousIndex];
      if (previous !== undefined && previous.failure === null) continue;
      if (maxFailures !== null && failures >= maxFailures) {
        stopped = { reason: "provider_failures", beforeCase: c.id, model: name };
        break run;
      }
      if (cap !== null && spent + unknownReserve + upperCallCents(subject, c, target, o.fx) > cap) {
        stopped = { reason: "cost_cap", beforeCase: c.id, model: name };
        break run;
      }
      const deferred = await pacer.beforeCall();
      if (deferred !== null) {
        stopped = { reason: "retry_after", beforeCase: c.id, model: name, retryAt: deferred.retryAt };
        break run;
      }
      const fetchFn =
        o.mode === "real"
          ? (o.fetch ?? globalThis.fetch.bind(globalThis))
          : mockFetch(target, responder(c, target, subject.requestText(c)));
      const observedFetch: typeof fetch = async (input, init) => {
        const response = await fetchFn(input, init);
        pacer.observe(response);
        return response;
      };
      checkpoint({ caseId: c.id, model: name });
      const turn = await subject.respond(c, { ai, fetch: observedFetch, runId, now });
      if (turn.failure !== null) failures += 1;
      charge(turn.calls, c, target);
      const result: CaseResult = {
        caseId: c.id,
        category: c.category,
        targets: c.targets,
        firstMessage: c.history.length === 0,
        model: name,
        verdicts: scoreTurn(c, turn, turn.input, subject.sendsNotice),
        handoff: handoffCheck(c, turn.output),
        failure: turn.failure,
        sent: turn.sent,
        output: turn.output,
        calls: [...(previous?.calls ?? []), ...turn.calls],
      };
      if (previousIndex < 0) results.push(result);
      else results[previousIndex] = result;
      checkpoint(null);
      o.onProgress?.(results.length, total);
    }
  }

  checkpoint(null);
  return snapshot();
}
