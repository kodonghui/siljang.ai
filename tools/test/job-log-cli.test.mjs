import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("../staging-monitor/read-job-logs.mjs", import.meta.url));

function runFake(stdout, stderr) {
  const directory = mkdtempSync(join(tmpdir(), "siljang-tail-test-"));
  try {
    writeFileSync(join(directory, "npx"), `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(stdout)});\nprocess.stderr.write(${JSON.stringify(stderr)});\nprocess.exitCode=1;\n`, { mode: 0o700 });
    const result = spawnSync(process.execPath, [runner], {
      env: { ...process.env, PATH: directory + delimiter + process.env.PATH },
      encoding: "utf8", timeout: 5000, maxBuffer: 65536,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    return result.stdout;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test("요청 주소의 숫자를 제공자 오류로 내보내지 않는다", () => {
  const output = runFake(JSON.stringify({ scriptName: "siljang-staging", logs: [], event: { request: { url: "https://example.com/private-value/[code:4321]" } } }), "");
  assert.deepEqual(JSON.parse(output), { diagnostic: "worker_job_logs", observed: 1, failures: 0, verified: false, exitCode: 1 });
  assert.doesNotMatch(output, /4321|private-value|example\.com/);
});

test("표준 오류에서는 제공자 코드만 남긴다", () => {
  const output = runFake("", "[ERROR] private-value https://example.com/private-value [code:10000]\n");
  assert.deepEqual(JSON.parse(output), { diagnostic: "worker_job_logs", observed: 0, failures: 0, verified: false, exitCode: 1, kind: "provider_error", providerCode: 10000 });
  assert.doesNotMatch(output, /private-value|example\.com/);
});
