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
import { estimateRun, formatKrw, krwCents, type RunEstimate, upperCallCents } from "./estimate";
import { idealResponder, mockFetch, type Responder } from "./mock";
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
  readonly stopped: {
    readonly reason: "cost_cap" | "provider_failures";
    readonly beforeCase: string;
    readonly model: string;
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
    | "bad_failure_limit";

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

  const startedAt = now();
  const runId = o.runId ?? newRunId(startedAt);
  const responder = o.responder ?? idealResponder;
  const total = o.cases.length * o.targets.length;
  const results: CaseResult[] = [];
  let spent = 0n;
  let stopped: RunResult["stopped"] = null;

  run: for (const target of o.targets) {
    const name = targetName(target);
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
      if (maxFailures !== null && failures >= maxFailures) {
        stopped = { reason: "provider_failures", beforeCase: c.id, model: name };
        break run;
      }
      if (cap !== null && spent + upperCallCents(subject, c, target, o.fx) > cap) {
        stopped = { reason: "cost_cap", beforeCase: c.id, model: name };
        break run;
      }
      const fetchFn =
        o.mode === "real"
          ? (o.fetch ?? globalThis.fetch.bind(globalThis))
          : mockFetch(target, responder(c, target, subject.requestText(c)));
      const turn = await subject.respond(c, { ai, fetch: fetchFn, runId, now });
      if (turn.failure !== null) failures += 1;
      for (const call of turn.calls) {
        const krw = call.cost_krw;
        if (typeof krw === "string") spent += krwCents(krw);
      }
      results.push({
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
        calls: turn.calls,
      });
      o.onProgress?.(results.length, total);
    }
  }

  return {
    runId,
    mode: o.mode,
    startedAt: startedAt.toISOString(),
    casesVersion: EVAL_CASES_VERSION,
    subject: { name: subject.name, promptVersion: subject.promptVersion, sendsNotice: subject.sendsNotice },
    models: o.targets.map(targetName),
    estimate,
    maxKrw: cap === null ? null : formatKrw(cap),
    maxFailures,
    spentKrw: formatKrw(spent),
    stopped,
    results,
  };
}
