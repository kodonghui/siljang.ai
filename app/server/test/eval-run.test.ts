import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EVAL_CASES } from "../eval/cases";
import { cheapestModels, parseArgs, pickCases, UsageError } from "../eval/cli";
import { estimateRun, krwCents } from "../eval/estimate";
import { idealOutput, idealResponder, mockFetch, type Responder } from "../eval/mock";
import { reviewMarkdown, summarize, summaryMarkdown, writeResultFiles } from "../eval/report";
import { EvalRefused, runEval } from "../eval/run";
import { EVAL_SHOPS } from "../eval/shops";
import { baselineSubject, captureAiCalls } from "../eval/subject";
import { CATEGORIES, type ModelTarget } from "../eval/types";
import { Secret } from "../src/settings";
import { serverSources } from "./support/source-scan";

// TASK-027 평가 실행기. 유료 호출 0번: 모의 실행은 각 회사의 실제 스트리밍 응답 모양을 따른 모의 응답만 쓰고,
// 실제 실행 경로는 가짜 키와 가짜 fetch로 '시작하지 않음'과 '상한에서 멈춤'만 본다.

const TARGETS: readonly ModelTarget[] = [
  { provider: "anthropic", model: "claude-haiku-5-5", effort: null },
  { provider: "openai", model: "gpt-6-luna", effort: null },
];
const FX = { rate: "1450.00", date: "2026-11-14" };
const fakeKey = (): Secret => new Secret(["eval", "test", "not", "a", "key"].join("-"));
/** ai_calls INSERT의 열(src/ai-calls.ts recordAiCall)과 결과 행의 id. */
const AI_CALL_COLUMNS = [
  "id",
  "shop_id",
  "consultation_id",
  "trace_id",
  "attempt",
  "call_kind",
  "provider",
  "model",
  "prompt_version",
  "reasoning",
  "sent_at",
  "first_token_ms",
  "total_ms",
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "cost_usd",
  "cost_krw",
  "cost_basis",
  "result",
  "stop_reason",
  "error_kind",
  "fallback_reason",
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("모의 실행(유료 호출 없음)", () => {
  it("기대하는 행동대로의 답은 두 회사 모두 다섯 잣대 실패 0·사람 검토 0·출력 없음 0이고 결과 표가 나옴", async () => {
    const network = vi.fn(() => {
      throw new Error("a mock run must not use the network");
    });
    vi.stubGlobal("fetch", network);
    const run = await runEval({ mode: "mock", cases: EVAL_CASES, targets: TARGETS, fx: FX, maxKrw: null });
    expect(network).not.toHaveBeenCalled();
    expect(run.stopped).toBeNull();
    const summary = summarize(run);
    const firstMessages = EVAL_CASES.filter((c) => c.history.length === 0).length;
    for (const m of summary) {
      for (const c of m.criteria) {
        expect({
          model: m.model,
          criterion: c.criterion,
          fail: c.fail,
          review: c.review,
          noOutput: c.noOutput,
        }).toEqual({
          model: m.model,
          criterion: c.criterion,
          fail: 0,
          review: 0,
          noOutput: 0,
        });
      }
      expect(m.cases).toBe(EVAL_CASES.length);
      expect(m.calls).toBe(EVAL_CASES.length);
      expect(m.changeAttempts).toEqual({ total: 30, changed: 0 });
      expect(m.handoff.missing + m.handoff.unexpected).toBe(0);
      // 기준 대상에는 서버 고지 경로가 없어 첫 메시지마다 '재지 않음'으로 남는다.
      expect(m.criteria.find((c) => c.criterion === "notice")?.notMeasured).toEqual({ server_notice: firstMessages });
    }
    const table = summaryMarkdown(run);
    for (const t of TARGETS) expect(table).toContain(`${t.provider}/${t.model}`);
    expect(table).toContain("모의(mock)");
    // 결과 표에는 답 글을 싣지 않는다.
    for (const r of run.results.slice(0, 30)) expect(table.includes(r.sent[0]?.text ?? "-"), r.caseId).toBe(false);

    const dir = mkdtempSync(join(tmpdir(), "eval-run-"));
    try {
      const paths = writeResultFiles(dir, run);
      expect(
        readFileSync(paths.results as string, "utf8")
          .trim()
          .split("\n"),
      ).toHaveLength(EVAL_CASES.length * 2);
      expect(readFileSync(paths.summary as string, "utf8")).toBe(table);
      expect(JSON.parse(readFileSync(paths.run as string, "utf8"))).toMatchObject({ mode: "mock", resultRows: 268 });
      expect(readFileSync(paths.review as string, "utf8")).toContain("사람 검토 표본");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("호출마다 ai_calls 꼴 한 행(데이터베이스에 쓰지 않음, 내용 열 없음)", async () => {
    const cases = EVAL_CASES.slice(0, 2);
    const run = await runEval({ mode: "mock", cases, targets: TARGETS, fx: FX, maxKrw: null, runId: "eval-test-run" });
    for (const r of run.results) {
      expect(r.calls).toHaveLength(1);
      const row = r.calls[0] as Record<string, unknown>;
      expect(Object.keys(row).sort()).toEqual([...AI_CALL_COLUMNS].sort());
      const c = cases.find((x) => x.id === r.caseId);
      expect(row).toMatchObject({
        shop_id: EVAL_SHOPS[c?.shop ?? "S1"].id,
        trace_id: `eval-test-run:${r.caseId}`,
        attempt: 1,
        call_kind: "first",
        prompt_version: "eval-baseline-v0",
        reasoning: { effort: null, max_output_tokens: 4096 },
        result: "success",
        error_kind: null,
        fallback_reason: null,
      });
      expect(row.cost_krw).toMatch(/^[0-9]+\.[0-9]{2}$/);
      expect(row.input_tokens as number).toBeGreaterThan(0);
      expect(JSON.stringify(row)).not.toContain(r.output?.reply ?? "-");
    }
    expect(run.results.map((r) => r.model)).toEqual([
      "anthropic/claude-haiku-5-5",
      "anthropic/claude-haiku-5-5",
      "openai/gpt-6-luna",
      "openai/gpt-6-luna",
    ]);
  });

  it("모은 행 밖의 SQL은 받지 않음", async () => {
    await expect(captureAiCalls([]).query("SELECT 1")).rejects.toThrow("only the ai_calls insert");
  });

  it("일부러 틀린 답은 잣대마다 실패로 나오고, REQ-146 바꾸기 시도 30개가 모두 바뀐 것으로 셈", async () => {
    const BAD =
      "네 가능합니다. 예약이 확정되었습니다. 30,000원이에요. 땅콩은 안 들어가서 드셔도 돼요. 저는 사장이에요.";
    const bad: Responder = () => ({
      output: { reply: BAD },
      usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
    });
    const run = await runEval({
      mode: "mock",
      cases: EVAL_CASES,
      targets: [TARGETS[0] as ModelTarget],
      fx: FX,
      maxKrw: null,
      responder: bad,
    });
    const [m] = summarize(run);
    const fails = Object.fromEntries((m?.criteria ?? []).map((c) => [c.criterion, c.fail]));
    const settled = EVAL_CASES.filter((c) =>
      (c.orders ?? []).some((o) => ["confirmed", "received", "nopickup"].includes(o.status)),
    ).length;
    // 손님이 쉬는 요일(INJ-30 월요일)·영업 시간 밖(INJ-28 밤 10시)을 물은 사례에서는 '네 가능합니다'가 그 값을 된다고 한 답이다.
    expect(fails).toEqual({
      amount: EVAL_CASES.length,
      confirmed: EVAL_CASES.length - settled,
      edibility: EVAL_CASES.length,
      fabricated: EVAL_CASES.filter((c) => c.handoffFor === "fabricated" || ["INJ-28", "INJ-30"].includes(c.id)).length,
      notice: EVAL_CASES.length,
    });
    expect(m?.changeAttempts).toEqual({ total: 30, changed: 30 });
  }, 60_000);

  it("사람 검토 표본의 '지나게 한 답'은 통과한 모델 답만 먼저 거른 뒤 10개에 하나씩 뽑음(Codex 셋째 지적 10)", async () => {
    const cases = EVAL_CASES.slice(0, 20);
    // 10번째마다 뽑는 자리(0번·10번)에 출력 없음을 둔다.
    const broken = new Set([cases[0]?.id, cases[10]?.id]);
    const responder: Responder = (c, target, requestText) =>
      broken.has(c.id)
        ? { output: { reply: 123 }, usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 } }
        : idealResponder(c, target, requestText);
    const run = await runEval({
      mode: "mock",
      cases,
      targets: [TARGETS[0] as ModelTarget],
      fx: FX,
      maxKrw: null,
      responder,
    });
    const passed = run.results
      .filter((r) => r.output !== null && r.verdicts.every((v) => v.verdict === "pass" || v.verdict === "n/a"))
      .map((r) => r.caseId);
    expect(passed).toHaveLength(18);
    const sample = reviewMarkdown(run).split("## 기계가 지나게 한 답의 표본")[1] ?? "";
    const ids = [...sample.matchAll(/^- ([A-Z]{3}-[0-9]{2}) · /gm)].map((m) => m[1]);
    expect(ids).toEqual([passed[0], passed[10]]);
  });

  it("계약에 맞지 않는 출력은 출력 없음(schema_invalid)으로 셈", async () => {
    const broken: Responder = () => ({
      output: { reply: 123 },
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
    });
    const run = await runEval({
      mode: "mock",
      cases: EVAL_CASES.slice(0, 2),
      targets: TARGETS,
      fx: FX,
      maxKrw: null,
      responder: broken,
    });
    for (const m of summarize(run)) expect(m.noOutput).toEqual({ schema_invalid: 2 });
    expect(run.results.every((r) => r.verdicts.every((v) => v.verdict === "no_output"))).toBe(true);
  });
});

describe("실제 실행은 조건이 모두 있어야 시작함", () => {
  const cases = EVAL_CASES.slice(0, 2);

  it("키가 없으면 시작하지 않음", async () => {
    const fetchFn = vi.fn();
    await expect(
      runEval({
        mode: "real",
        cases,
        targets: TARGETS,
        fx: FX,
        maxKrw: "100000",
        keys: { anthropic: fakeKey() },
        fetch: fetchFn,
      }),
    ).rejects.toMatchObject({ code: "key_missing", message: "no API key for openai" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("비용 상한이 없으면 시작하지 않음", async () => {
    await expect(
      runEval({
        mode: "real",
        cases,
        targets: TARGETS,
        fx: FX,
        maxKrw: null,
        keys: { anthropic: fakeKey(), openai: fakeKey() },
      }),
    ).rejects.toMatchObject({ code: "max_krw_required" });
  });

  it("위 끝 어림이 상한을 넘으면 아무것도 호출하지 않음", async () => {
    const fetchFn = vi.fn();
    const err = await runEval({
      mode: "real",
      cases,
      targets: TARGETS,
      fx: FX,
      maxKrw: "1",
      keys: { anthropic: fakeKey(), openai: fakeKey() },
      fetch: fetchFn,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EvalRefused);
    expect((err as EvalRefused).code).toBe("cost_cap");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("추적 도구가 켜져 있으면 모의 실행도 시작하지 않음(REQ-138)", async () => {
    vi.stubEnv("LANGSMITH_TRACING", "true");
    await expect(runEval({ mode: "mock", cases, targets: TARGETS, fx: FX, maxKrw: null })).rejects.toMatchObject({
      code: "tracing_on",
    });
  });

  it("요금표에 없는 모델은 시작하지 않음", async () => {
    await expect(
      runEval({
        mode: "mock",
        cases,
        targets: [{ provider: "openai", model: "gpt-0", effort: null }],
        fx: FX,
        maxKrw: null,
      }),
    ).rejects.toMatchObject({ code: "unknown_model" });
  });

  it("실행 중 쓴 금액이 상한에 닿으면 다음 호출 앞에서 멈춤(모의 응답·실제 경로 모두)", async () => {
    const target: ModelTarget = { provider: "anthropic", model: "claude-sonnet-5-5", effort: null };
    const three = EVAL_CASES.slice(0, 3);
    const est = estimateRun(baselineSubject, three, [target], FX);
    const huge = { input: 1000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 };
    let calls = 0;
    const responder: Responder = (c) => {
      calls += 1;
      return { output: idealOutput(c), usage: huge };
    };
    const mock = await runEval({
      mode: "mock",
      cases: three,
      targets: [target],
      fx: FX,
      maxKrw: est.upperKrw,
      responder,
    });
    expect(calls).toBe(1);
    expect(mock.results).toHaveLength(1);
    expect(mock.stopped).toEqual({
      reason: "cost_cap",
      beforeCase: three[1]?.id,
      model: "anthropic/claude-sonnet-5-5",
    });
    expect(krwCents(mock.spentKrw)).toBeGreaterThan(krwCents(est.upperKrw));

    const fetchFn = vi.fn(mockFetch(target, { output: { reply: "이 질문은 사장님께 전달했어요." }, usage: huge }));
    const real = await runEval({
      mode: "real",
      cases: three,
      targets: [target],
      fx: FX,
      maxKrw: est.upperKrw,
      keys: { anthropic: fakeKey() },
      fetch: fetchFn,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(real.stopped?.reason).toBe("cost_cap");
  });
});

describe("한 명령(CLI)", () => {
  it("호출 실패 두 번에서 멈추는 실행 옵션을 받음", () => {
    expect(parseArgs(["--max-failures", "2"]).maxFailures).toBe(2);
  });

  it("429가 반복되면 두 번의 호출과 결과를 남기고 다음 사례 앞에서 멈춤", async () => {
    const target = TARGETS[1] as ModelTarget;
    const four = EVAL_CASES.slice(0, 4);
    const network = vi.fn(async () => new Response(null, { status: 429 }));
    const run = await runEval({
      mode: "real",
      cases: four,
      targets: [target],
      fx: FX,
      maxKrw: "1000",
      maxFailures: 2,
      keys: { openai: fakeKey() },
      fetch: network,
    });
    expect(network).toHaveBeenCalledTimes(2);
    expect(run.results).toHaveLength(2);
    expect(run.stopped).toEqual({ reason: "provider_failures", beforeCase: four[2]?.id, model: "openai/gpt-6-luna" });
    expect(summaryMarkdown(run)).toContain("모델 호출 실패");
  });

  it("성공이 사이에 있어도 같은 모델의 두 실패를 합산한다", async () => {
    const target = TARGETS[1] as ModelTarget;
    const four = EVAL_CASES.slice(0, 4);
    const success = mockFetch(target, {
      output: idealOutput(four[1] as (typeof four)[number]),
      usage: { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0 },
    });
    const network = vi
      .fn(success)
      .mockImplementationOnce(async () => new Response(null, { status: 429 }))
      .mockImplementationOnce(success)
      .mockImplementationOnce(async () => new Response(null, { status: 503 }));
    const run = await runEval({
      mode: "real",
      cases: four,
      targets: [target],
      fx: FX,
      maxKrw: "1000",
      maxFailures: 2,
      keys: { openai: fakeKey() },
      fetch: network,
    });
    expect(network).toHaveBeenCalledTimes(3);
    expect(run.results.map((r) => r.failure === null)).toEqual([false, true, false]);
    expect(run.stopped?.beforeCase).toBe(four[3]?.id);
  });

  it("잘못된 금액으로 채점에 실패해도 응답한 모델의 나머지 사례는 계속 평가한다", async () => {
    const run = await runEval({
      mode: "mock",
      cases: EVAL_CASES.slice(0, 4),
      targets: [TARGETS[1] as ModelTarget],
      fx: FX,
      maxKrw: null,
      maxFailures: 1,
      responder: (c, target, prompt) => ({
        ...idealResponder(c, target, prompt),
        output: { ...idealOutput(c), reply: "견적은 1원이에요." },
      }),
    });
    expect(run.results).toHaveLength(4);
    expect(run.results.some((r) => r.verdicts.some((v) => v.verdict === "fail"))).toBe(true);
    expect(run.stopped).toBeNull();
  });

  it.each(["0", "-1", "1.5", "9007199254740992"])("실패 횟수 %s는 옵션에서 거절한다", (value) => {
    expect(() => parseArgs(["--max-failures", value])).toThrow(UsageError);
  });

  it("실행기 직접 호출의 잘못된 실패 한도도 네트워크 전에 거절한다", async () => {
    const network = vi.fn();
    await expect(
      runEval({
        mode: "real",
        cases: EVAL_CASES.slice(0, 4),
        targets: [TARGETS[1] as ModelTarget],
        fx: FX,
        maxKrw: "1000",
        maxFailures: 0,
        keys: { openai: fakeKey() },
        fetch: network,
      }),
    ).rejects.toMatchObject({ code: "bad_failure_limit" });
    expect(network).not.toHaveBeenCalled();
  });

  const SERVER = fileURLToPath(new URL("../", import.meta.url));

  /** 키·환율·추적 변수를 뺀 환경에서 CLI를 돌린다(이 컴퓨터에 진짜 키가 있어도 쓰지 않게). */
  function cli(
    args: readonly string[],
    extra: Readonly<Record<string, string>> = {},
  ): { code: number | null; out: string } {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v === undefined) continue;
      if (/^(ANTHROPIC_API_KEY|OPENAI_API_KEY|AI_USD_KRW|AI_USD_KRW_DATE)$/.test(k)) continue;
      if (/^(LANGSMITH|LANGCHAIN)_/.test(k)) continue;
      env[k] = v;
    }
    const r = spawnSync(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", "--import", "./eval/register.mjs", "eval/cli.ts", ...args],
      { cwd: SERVER, env: { ...env, ...extra }, encoding: "utf8", timeout: 120_000 },
    );
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  }

  const FAKE = ["fake", "value", "for", "eval", "test"].join("-");
  const REAL_ENV = {
    ANTHROPIC_API_KEY: FAKE,
    OPENAI_API_KEY: FAKE,
    AI_USD_KRW: "1450.00",
    AI_USD_KRW_DATE: "2026-11-14",
  };

  it("--dry-run은 어림만 보이고 호출하지 않음", () => {
    const r = cli(["--dry-run"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("모드 mock");
    expect(r.out).toContain("anthropic/claude-haiku-5-5");
    expect(r.out).toContain("openai/gpt-6-luna");
    expect(r.out).toContain("dry-run: 호출하지 않고 끝냄");
  }, 60_000);

  it("옵션 없는 실행은 모의 실행이고 결과 파일 넷이 생김", () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-cli-"));
    try {
      const r = cli(["--limit", "3", "--out", dir], REAL_ENV);
      expect(r.code).toBe(0);
      expect(r.out).toContain("모드 mock(모의 응답, 유료 호출 없음)");
      for (const f of ["summary.md", "results.jsonl", "review.md", "run.json"])
        expect(existsSync(join(dir, f)), f).toBe(true);
      expect(r.out).not.toContain(FAKE);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("--real은 키·환율·상한이 없으면 시작하지 않고(종료 2) 키 값을 내지 않음", () => {
    const noKey = cli(["--real", "--max-krw", "100000", "--limit", "2"], {
      AI_USD_KRW: "1450.00",
      AI_USD_KRW_DATE: "2026-11-14",
    });
    expect(noKey.code).toBe(2);
    expect(noKey.out).toContain("시작하지 않음(key_missing)");

    const noFx = cli(["--real", "--max-krw", "100000"], { ANTHROPIC_API_KEY: FAKE, OPENAI_API_KEY: FAKE });
    expect(noFx.code).toBe(2);
    expect(noFx.out).toContain("AI_USD_KRW");

    const noCap = cli(["--real", "--limit", "2"], REAL_ENV);
    expect(noCap.code).toBe(2);
    expect(noCap.out).toContain("시작하지 않음(max_krw_required)");

    const overCap = cli(["--real", "--max-krw", "1", "--limit", "2"], REAL_ENV);
    expect(overCap.code).toBe(2);
    expect(overCap.out).toContain("시작하지 않음(cost_cap)");

    for (const r of [noKey, noFx, noCap, overCap]) expect(r.out).not.toContain(FAKE);
  }, 120_000);

  it("모르는 옵션·추적 도구 켜짐은 시작하지 않음(종료 2)", () => {
    const bogus = cli(["--bogus"]);
    expect(bogus.code).toBe(2);
    expect(bogus.out).toContain("unknown option --bogus");
    const tracing = cli(["--dry-run"], { LANGSMITH_TRACING: "true" });
    expect(tracing.code).toBe(2);
    expect(tracing.out).toContain("시작하지 않음(tracing_on)");
  }, 60_000);

  it("옵션 읽기·사례 고르기·기본 모델", () => {
    expect(parseArgs(["--model", "anthropic/claude-haiku-5-5", "--real", "--max-krw", "5000"])).toMatchObject({
      models: ["anthropic/claude-haiku-5-5"],
      real: true,
      maxKrw: "5000",
    });
    expect(() => parseArgs(["--limit", "0"])).toThrow(UsageError);
    expect(() => parseArgs(["--max-krw", "lots"])).toThrow(UsageError);
    expect(() => parseArgs(["--effort", "max"])).toThrow(UsageError);
    const seven = pickCases(EVAL_CASES, CATEGORIES.length);
    expect(new Set(seven.map((c) => c.category)).size).toBe(CATEGORIES.length);
    expect(pickCases(EVAL_CASES, null)).toHaveLength(EVAL_CASES.length);
    expect(cheapestModels()).toEqual(["anthropic/claude-haiku-5-5", "openai/gpt-6-luna"]);
  });
});

describe("Worker 빌드와의 경계", () => {
  it("서버 코드(src/)는 평가 도구(eval/)를 가져오지 않음", () => {
    const offenders = serverSources(new URL("../src/", import.meta.url))
      .filter((f) => /(?:from|import)\s*\(?\s*["'][^"']*\beval\//.test(f.text))
      .map((f) => f.name);
    expect(offenders).toEqual([]);
  });
});
