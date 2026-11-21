import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DUE_SOURCE_NAMES, type DueSourceName } from "../src/due-sources";
import type { ItemHandler } from "../src/job-runner";
import { JOB_HANDLERS, JOBS, runnableJobs } from "../src/jobs";
import { OPS_EVENT_KINDS } from "../src/ops-events";
import { contract } from "./support/contract";

// 서버 안의 일 등록부(TASK-023)가 06 README 10절(openapi components.x-corthex.jobs)의 13개와 같고, 맡는 작업이 WBS에 있는지 본다.
// 06에 일이 더해지거나 빠지면 이 시험이 실패한다(등록부를 함께 고침).

const readme06 = readFileSync(new URL("../../../docs/06-api/README.md", import.meta.url), "utf8");
const wbs = readFileSync(new URL("../../../docs/10-wbs/wbs.md", import.meta.url), "utf8");

const contractJobs = (
  (contract as unknown as { components: { "x-corthex": { jobs: { spec: string }[] } } }).components["x-corthex"].jobs ??
  []
).map((j) => j.spec);

/** 06 README 10절의 생성 표(서버 안의 일)의 SPEC. */
function readmeJobs(): string[] {
  const start = readme06.indexOf("<!-- BEGIN generated:jobs -->");
  const end = readme06.indexOf("<!-- END generated:jobs -->");
  expect(start).toBeGreaterThan(0);
  return [...readme06.slice(start, end).matchAll(/^\| (SPEC-\d{3}) \|/gm)].map((m) => m[1] as string);
}

interface TaskRow {
  readonly specs: readonly string[];
  readonly deps: readonly string[];
}

/** WBS 작업 행: | TASK | 제목 | 기능 명세·규칙 | 닿는 것 | 앞선 작업 | … */
function wbsTasks(): Map<string, TaskRow> {
  const out = new Map<string, TaskRow>();
  for (const line of wbs.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (!/^TASK-\d{3}$/.test(cells[1] ?? "")) continue;
    out.set(cells[1] as string, {
      specs: [...(cells[3] ?? "").matchAll(/SPEC-\d{3}/g)].map((m) => m[0]),
      deps: [...(cells[5] ?? "").matchAll(/TASK-\d{3}/g)].map((m) => m[0]),
    });
  }
  return out;
}

function reaches(tasks: Map<string, TaskRow>, from: string, target: string): boolean {
  const seen = new Set<string>();
  const stack = [...(tasks.get(from)?.deps ?? [])];
  while (stack.length > 0) {
    const t = stack.pop() as string;
    if (t === target) return true;
    if (seen.has(t)) continue;
    seen.add(t);
    stack.push(...(tasks.get(t)?.deps ?? []));
  }
  return false;
}

describe("서버 안의 일 등록부(06 10절과 견줌)", () => {
  it("06 계약과 README 10절의 13개가 등록부와 같은 차례로 같음", () => {
    expect(contractJobs).toHaveLength(13);
    expect(JOBS.map((j) => j.spec)).toEqual(contractJobs);
    expect(readmeJobs()).toEqual(contractJobs);
  });

  it("이름은 소문자·숫자·_이고 겹치지 않음", () => {
    const names = JOBS.map((j) => j.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9_]{0,59}$/);
  });

  it("맡는 작업이 WBS에 그 SPEC으로 있고, 실행기를 쓰는 일은 TASK-023 뒤에 옴", () => {
    const tasks = wbsTasks();
    expect(tasks.get("TASK-023")?.specs).toEqual([]);
    for (const j of JOBS) {
      const row = tasks.get(j.task);
      expect(row, j.task).toBeDefined();
      expect(row?.specs, `${j.task} ${j.spec}`).toContain(j.spec);
      if (j.runs.every !== "request") expect(reaches(tasks, j.task, "TASK-023"), j.task).toBe(true);
    }
  });

  it("찾는 곳은 모두 어느 한 일이 쓰고, 두 일이 한 곳을 나누지 않음", () => {
    const used = JOBS.flatMap((j) => j.sources);
    expect(new Set(used).size).toBe(used.length);
    expect([...used].sort()).toEqual([...DUE_SOURCE_NAMES].sort());
  });

  it("하루 한 번은 지난 기록 지우기(SPEC-065) 03:00 Asia/Seoul뿐, 요청 안의 일은 접속기록(SPEC-074)뿐", () => {
    const daily = JOBS.filter((j) => j.runs.every === "day");
    expect(daily.map((j) => j.spec)).toEqual(["SPEC-065"]);
    expect(daily[0]?.runs).toEqual({ every: "day", at: "03:00", timeZone: "Asia/Seoul", marker: "purge_run" });
    expect(OPS_EVENT_KINDS).toContain("purge_run");
    expect(JOBS.filter((j) => j.runs.every === "request").map((j) => j.spec)).toEqual(["SPEC-074"]);
    expect(JOBS.find((j) => j.spec === "SPEC-074")?.sources).toEqual([]);
    for (const j of JOBS) expect(j.note.length, j.name).toBeGreaterThan(10);
  });

  it("처리가 붙은 지우기를 실행기에 넘기고 요청 안의 일은 넘기지 않음", () => {
    expect(Object.keys(JOB_HANDLERS)).toEqual(["purge"]);
    expect(runnableJobs()).toMatchObject([{ name: "purge", every: "day", handler: { mode: "sweep" } }]);
    const handler: ItemHandler = { mode: "transaction", run: async () => {} };
    const cutoff = (_s: DueSourceName, now: Date) => new Date(now.getTime() - 7 * 86_400_000);
    const got = runnableJobs(JOBS, {
      owner_wait: { handler, cutoff },
      purge: { handler },
      access_log: { handler },
    });
    expect(got.map((j) => j.name)).toEqual(["owner_wait", "purge"]);
    expect(got[0]).toMatchObject({ every: "minute", sources: ["owner_task_wait", "handoff_open"], cutoff });
    expect(got[1]).toMatchObject({ every: "day", at: "03:00", timeZone: "Asia/Seoul", marker: "purge_run" });
    expect(got[1]).not.toHaveProperty("cutoff");
  });
});
