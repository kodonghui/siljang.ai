import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const relay = fileURLToPath(new URL("../staging-monitor/notify-failure.sh", import.meta.url));
const service = new URL("../staging-monitor/siljang-staging-health.service", import.meta.url);

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "siljang-monitor-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = join(directory, "bin");
  await mkdir(bin);
  const calls = join(directory, "calls.jsonl");
  await writeFile(join(bin, "gh"), `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_CALLS, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.env.TEST_DISPATCH_FAIL === "1") process.exit(1);
`, { mode: 0o700 });
  await writeFile(join(bin, "date"), '#!/bin/sh\nprintf "%s\\n" "$TEST_NOW"\n', { mode: 0o700 });
  const env = {
    PATH: `${bin}:${process.env.PATH}`,
    STATE_DIRECTORY: join(directory, "state"),
    TEST_CALLS: calls,
    TEST_NOW: "2000000000",
  };
  return {
    env,
    state: env.STATE_DIRECTORY,
    async calls() {
      try { return (await readFile(calls, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse); }
      catch (error) { if (error.code === "ENOENT") return []; throw error; }
    },
    run(args = [], extra = {}) {
      return new Promise((resolve, reject) => {
        const child = spawn("bash", [relay, ...args], { env: { ...env, ...extra } });
        let stdout = "", stderr = "";
        child.stdout.on("data", chunk => { stdout += chunk; });
        child.stderr.on("data", chunk => { stderr += chunk; });
        child.on("error", reject);
        child.on("close", code => resolve({ code, stdout, stderr }));
      });
    },
  };
}

test("상태 점검 실패는 알림 단위를 시작하고 정상 점검은 사건 상태를 지운다", async () => {
  const text = await readFile(service, "utf8");
  assert.match(text, /^OnFailure=siljang-staging-alert\.service$/m);
  assert.match(text, /^ExecStartPost=.*notify-failure\.sh --recovered$/m);
});

test("첫 실패는 기존 gh 인증으로 정해진 저장소/워크플로를 한 번 실행한다", async t => {
  const f = await fixture(t);
  const result = await f.run();
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await f.calls(), [["workflow", "run", "staging-health-alert.yml", "--repo", "kodonghui/siljang.ai", "--ref", "main", "-f", "source=external"]]);
  assert.equal((await readFile(join(f.state, "last-notified"), "utf8")).trim(), f.env.TEST_NOW);
});

test("계속 실패해도 1시간 안에는 중복을 억제하고 1시간 뒤에는 다시 알린다", async t => {
  const f = await fixture(t);
  assert.equal((await f.run()).code, 0);
  assert.equal((await f.run([], { TEST_NOW: "2000003599" })).code, 0);
  assert.equal((await f.calls()).length, 1);
  assert.equal((await f.run([], { TEST_NOW: "2000003600" })).code, 0);
  assert.equal((await f.calls()).length, 2);
});

test("정상 복구 뒤 새 실패는 이전 알림으로부터 1시간 안이어도 알린다", async t => {
  const f = await fixture(t);
  assert.equal((await f.run()).code, 0);
  assert.equal((await f.run(["--recovered"])).code, 0);
  assert.equal((await f.run([], { TEST_NOW: "2000000060" })).code, 0);
  assert.equal((await f.calls()).length, 2);
});

test("gh 실행 실패를 보낸 것으로 기록하지 않아 다음 점검 때 다시 시도한다", async t => {
  const f = await fixture(t);
  assert.equal((await f.run([], { TEST_DISPATCH_FAIL: "1" })).code, 1);
  assert.equal((await f.run()).code, 0);
  assert.equal((await f.calls()).length, 2);
});

test("동시 실패 둘도 파일 잠금 아래 한 번만 보낸다", async t => {
  const f = await fixture(t);
  const results = await Promise.all([f.run(), f.run()]);
  assert.deepEqual(results.map(r => r.code), [0, 0]);
  assert.equal((await f.calls()).length, 1);
});

test("잘못된 상태 파일을 셸 식으로 해석하지 않고 새 실패를 알린다", async t => {
  const f = await fixture(t);
  await mkdir(f.state);
  await writeFile(join(f.state, "last-notified"), "invalid[$(exit 7)]");
  assert.equal((await f.run()).code, 0);
  assert.equal((await f.calls()).length, 1);
});
