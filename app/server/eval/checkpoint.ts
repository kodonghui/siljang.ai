/** 평가의 합성 결과와 미확정 호출 예약만 저장한다. 인증 정보는 받지 않는다. */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunResult } from "./run";

export interface EvalCheckpoint {
  readonly version: 1;
  readonly run: RunResult;
  readonly pending: { readonly caseId: string; readonly model: string } | null;
  readonly pacing: Readonly<Record<string, string | null>>;
}

export class EvalCheckpointError extends Error {
  override readonly name = "EvalCheckpointError";
  constructor() {
    super("eval checkpoint invalid");
  }
}

/** 임시 파일을 동기화한 뒤 한 번에 바꿔, 끊긴 JSON을 다음 실행이 정상 자료로 읽지 않게 한다. */
export function saveCheckpoint(dir: string, checkpoint: EvalCheckpoint): void {
  mkdirSync(dir, { recursive: true });
  const temporary = join(dir, `checkpoint-${randomBytes(8).toString("hex")}.tmp`);
  try {
    writeFileSync(temporary, `${JSON.stringify(checkpoint)}\n`, { flag: "wx", mode: 0o600, flush: true });
    renameSync(temporary, join(dir, "checkpoint.json"));
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validRow(value: unknown): boolean {
  if (
    !record(value) ||
    typeof value.caseId !== "string" ||
    typeof value.model !== "string" ||
    !Array.isArray(value.calls) ||
    !value.calls.every(record) ||
    !Array.isArray(value.verdicts) ||
    !Array.isArray(value.targets) ||
    !Array.isArray(value.sent) ||
    !value.sent.every((s) => record(s) && typeof s.text === "string") ||
    (value.failure !== null &&
      !["timeout", "unavailable", "key_missing", "limit_reached", "schema_invalid"].includes(String(value.failure)))
  )
    return false;
  return value.failure === null ? record(value.output) : value.output === null;
}

/** 이전 실행기의 run.json/results.jsonl도 읽는다. 받은 결과의 runId와 행 수가 같아야 한다. */
export function loadCheckpoint(dir: string): EvalCheckpoint {
  try {
    let state: unknown;
    if (existsSync(join(dir, "checkpoint.json")))
      state = JSON.parse(readFileSync(join(dir, "checkpoint.json"), "utf8"));
    else {
      const meta: unknown = JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
      if (!record(meta) || typeof meta.runId !== "string") throw new EvalCheckpointError();
      const rows = readFileSync(join(dir, "results.jsonl"), "utf8")
        .split("\n")
        .filter((line) => line.trim());
      if (meta.resultRows !== rows.length) throw new EvalCheckpointError();
      const results = rows.map((line) => {
        const row: unknown = JSON.parse(line);
        if (!record(row) || row.runId !== meta.runId) throw new EvalCheckpointError();
        const { runId: _runId, ...result } = row;
        return result;
      });
      const { resultRows: _resultRows, ...run } = meta;
      state = { version: 1, run: { ...run, results }, pending: null, pacing: {} };
    }
    if (
      !record(state) ||
      state.version !== 1 ||
      !record(state.run) ||
      !Array.isArray(state.run.results) ||
      !state.run.results.every(validRow) ||
      typeof state.run.runId !== "string" ||
      typeof state.run.startedAt !== "string" ||
      !Number.isFinite(Date.parse(state.run.startedAt)) ||
      typeof state.run.spentKrw !== "string" ||
      !/^[0-9]+(?:\.[0-9]{1,2})?$/.test(state.run.spentKrw) ||
      !record(state.run.subject) ||
      !record(state.run.estimate) ||
      !record(state.run.estimate.fx) ||
      !Array.isArray(state.run.models) ||
      !state.run.models.every((m) => typeof m === "string") ||
      !record(state.pacing) ||
      (state.pending !== null &&
        (!record(state.pending) ||
          typeof state.pending.caseId !== "string" ||
          typeof state.pending.model !== "string")) ||
      Object.values(state.pacing).some(
        (value) => value !== null && (typeof value !== "string" || !Number.isFinite(Date.parse(value))),
      )
    )
      throw new EvalCheckpointError();
    return state as unknown as EvalCheckpoint;
  } catch {
    throw new EvalCheckpointError();
  }
}
