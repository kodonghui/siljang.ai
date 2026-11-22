import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EVAL_CASES } from "../eval/cases";
import { type EvalCheckpoint, loadCheckpoint, saveCheckpoint } from "../eval/checkpoint";
import { estimateRun } from "../eval/estimate";
import { idealOutput, mockFetch } from "../eval/mock";
import { writeResultFiles } from "../eval/report";
import { runEval } from "../eval/run";
import { baselineSubject } from "../eval/subject";
import type { ModelTarget } from "../eval/types";
import { Secret } from "../src/settings";

const target: ModelTarget = { provider: "openai", model: "gpt-6-luna", effort: null };
const cases = EVAL_CASES.slice(0, 3);
const options = {
  mode: "mock" as const,
  cases,
  targets: [target],
  fx: { rate: "1450.00", date: "2026-11-14" },
  maxKrw: "1000",
};
const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "siljang-eval-resume-"));
  dirs.push(dir);
  return dir;
};
const state = (run: Awaited<ReturnType<typeof runEval>>): EvalCheckpoint => ({
  version: 1,
  run,
  pending: null,
  pacing: {},
});

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("TASK-027 사례별 중간 저장과 재개", () => {
  it("완료된 사례는 다시 부르지 않고 받은 결과/호출/비용을 보존", async () => {
    const first = await runEval(options);
    const respond = vi.fn(baselineSubject.respond);
    const next = await runEval({ ...options, resume: state(first), subject: { ...baselineSubject, respond } });
    expect(respond).not.toHaveBeenCalled();
    expect(next.results).toEqual(first.results);
    expect(next.spentKrw).toBe(first.spentKrw);
    expect(next.runId).toBe(first.runId);
  });

  it("중간 저장은 다시 읽을 수 있고 기존 결과 파일도 가져옴", async () => {
    const first = await runEval(options);
    const dir = temp();
    saveCheckpoint(dir, state(first));
    expect(loadCheckpoint(dir)).toEqual(JSON.parse(JSON.stringify(state(first))));
    const legacy = temp();
    writeResultFiles(legacy, first);
    expect(loadCheckpoint(legacy)).toEqual(JSON.parse(JSON.stringify(state(first))));
  });

  it("깨진 파일은 원문을 노출하지 않고 거절", () => {
    const dir = temp();
    writeFileSync(join(dir, "checkpoint.json"), '{"private":"unfinished');
    expect(() => loadCheckpoint(dir)).toThrow("eval checkpoint invalid");
  });

  it("모델 호출 전에 예약을 저장하고 결과를 저장한 뒤에만 예약을 해제", async () => {
    const dir = temp();
    const respond = vi.fn(async (...args: Parameters<typeof baselineSubject.respond>) => {
      const saved = loadCheckpoint(dir);
      expect(saved.pending).toEqual({ caseId: args[0].id, model: "openai/gpt-6-luna" });
      return baselineSubject.respond(...args);
    });
    const run = await runEval({
      ...options,
      subject: { ...baselineSubject, respond },
      onCheckpoint: (c) => saveCheckpoint(dir, c),
    });
    expect(respond).toHaveBeenCalledTimes(3);
    expect(loadCheckpoint(dir).pending).toBeNull();
    expect(loadCheckpoint(dir).run.results).toHaveLength(3);
    expect(JSON.parse(readFileSync(join(dir, "checkpoint.json"), "utf8")).run.spentKrw).toBe(run.spentKrw);
  });

  it("모델 응답 뒤 저장이 끊기면 미확정 예약을 다시 호출하지 않음", async () => {
    const dir = temp();
    const respond = vi.fn(baselineSubject.respond);
    await expect(
      runEval({
        ...options,
        subject: { ...baselineSubject, respond },
        onCheckpoint(c) {
          if (c.pending === null && c.run.results.length === 1) throw new Error("simulated persistence failure");
          saveCheckpoint(dir, c);
        },
      }),
    ).rejects.toThrow("simulated persistence failure");
    expect(respond).toHaveBeenCalledTimes(1);
    respond.mockClear();
    await expect(
      runEval({ ...options, resume: loadCheckpoint(dir), subject: { ...baselineSubject, respond } }),
    ).rejects.toMatchObject({ code: "resume_inflight" });
    expect(respond).not.toHaveBeenCalled();
  });

  it("다른 프롬프트의 결과는 재사용하지 않음", async () => {
    const first = await runEval(options);
    const respond = vi.fn(baselineSubject.respond);
    await expect(
      runEval({
        ...options,
        resume: state(first),
        subject: { ...baselineSubject, promptVersion: "different", respond },
      }),
    ).rejects.toMatchObject({ code: "resume_mismatch" });
    expect(respond).not.toHaveBeenCalled();
  });

  it("재개해도 지난 호출의 비용이 상한에서 사라지지 않음", async () => {
    const maxKrw = estimateRun(baselineSubject, cases, [target], options.fx).upperKrw;
    const first = await runEval({
      ...options,
      maxKrw,
      responder: (c) => ({
        output: idealOutput(c),
        usage: { input: 1000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 },
      }),
    });
    expect(first.results).toHaveLength(1);
    expect(first.stopped?.reason).toBe("cost_cap");
    const respond = vi.fn(baselineSubject.respond);
    const next = await runEval({ ...options, maxKrw, resume: state(first), subject: { ...baselineSubject, respond } });
    expect(respond).not.toHaveBeenCalled();
    expect(next.spentKrw).toBe(first.spentKrw);
    expect(next.stopped?.reason).toBe("cost_cap");
  });

  it("호출 비용이 음수로 바뀐 원본은 재개 전에 거절", async () => {
    const first = await runEval(options);
    const modified = structuredClone(state(first));
    const row = modified.run.results[0];
    if (row === undefined) throw new Error("missing row");
    const changed: EvalCheckpoint = {
      ...modified,
      run: {
        ...modified.run,
        results: [
          { ...row, calls: row.calls.map((c) => ({ ...c, cost_krw: "-1.00" })) },
          ...modified.run.results.slice(1),
        ],
      },
    };
    const respond = vi.fn(baselineSubject.respond);
    await expect(
      runEval({ ...options, resume: changed, subject: { ...baselineSubject, respond } }),
    ).rejects.toMatchObject({ code: "resume_mismatch" });
    expect(respond).not.toHaveBeenCalled();
  });

  it("실패 사례만 재개하며 앞선 실패의 호출 기록도 남김", async () => {
    const success = mockFetch(target, {
      output: idealOutput(cases[0] as (typeof cases)[number]),
      usage: { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0 },
    });
    const network = vi
      .fn(success)
      .mockImplementationOnce(success)
      .mockImplementationOnce(async () => new Response(null, { status: 429 }));
    const real = {
      ...options,
      mode: "real" as const,
      keys: { openai: new Secret("eval-not-a-real-key") },
      maxFailures: 1,
    };
    const first = await runEval({ ...real, fetch: network });
    expect(first.results).toHaveLength(2);
    const nextNetwork = vi.fn(success);
    const next = await runEval({ ...real, fetch: nextNetwork, resume: state(first) });
    expect(nextNetwork).toHaveBeenCalledTimes(2);
    expect(next.results).toHaveLength(3);
    expect(next.results[0]).toEqual(first.results[0]);
    expect(next.results[1]?.calls).toHaveLength(2);
    expect(next.results.flatMap((r) => r.calls)).toHaveLength(4);
    expect(Number(next.spentKrw)).toBeGreaterThan(Number(first.spentKrw));
    expect(Number(next.unknownCostReserveKrw)).toBeGreaterThan(0);
  });

  it("긴 Retry-After의 재개 시각을 보존", async () => {
    const time = new Date("2026-11-22T13:30:00.000Z");
    const network = vi.fn(async () => new Response(null, { status: 429, headers: { "retry-after": "54000" } }));
    let saved: EvalCheckpoint | undefined;
    const run = await runEval({
      ...options,
      mode: "real",
      keys: { openai: new Secret("eval-not-a-real-key") },
      fetch: network,
      minIntervalMs: 1000,
      maxWaitMs: 60_000,
      now: () => time,
      onCheckpoint: (c) => {
        saved = c;
      },
    });
    expect(network).toHaveBeenCalledTimes(1);
    expect(run.stopped).toEqual({
      reason: "retry_after",
      beforeCase: cases[1]?.id,
      model: "openai/gpt-6-luna",
      retryAt: "2026-11-23T04:30:00.000Z",
    });
    expect(saved?.pacing.openai).toBe("2026-11-23T04:30:00.000Z");
    if (saved === undefined) throw new Error("checkpoint not saved");
    network.mockClear();
    const again = await runEval({
      ...options,
      mode: "real",
      keys: { openai: new Secret("eval-not-a-real-key") },
      fetch: network,
      minIntervalMs: 1000,
      maxWaitMs: 60_000,
      now: () => time,
      resume: saved,
    });
    expect(network).not.toHaveBeenCalled();
    expect(again.stopped?.reason).toBe("retry_after");
  });
});
