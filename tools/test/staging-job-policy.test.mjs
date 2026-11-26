import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { configureJobMonitor, jobMonitorBody, JOB_MONITOR_NAME } from "../staging-monitor/job-policy.mjs";

function policy() {
  return {
    id: "synthetic-monitor", name: JOB_MONITOR_NAME, description: "일 실패 알림",
    enabled: true, alert_type: "custom_analytics", alert_interval: "1h",
    mechanisms: { email: [{ id: "operator@example.com" }] },
    filters: {
      source: ["sql_api"], execution_interval: ["15m"],
      alert_trigger_preferences: ["threshold"], alert_trigger_preferences_operator: [">="],
      alert_trigger_preferences_value: ["1"], alert_trigger_preferences_short_window: ["1m"],
      selectors: [`SELECT COUNT(*) AS value FROM logs.workersLogs WHERE accountTag = '${"a".repeat(32)}' AND attributes['$workers.scriptName'] = 'siljang-staging' AND (attributes['event'] = 'job_run_failed' OR attributes['event'] = 'job_find_failed')`],
    },
  };
}

test("현재 실행기/지우기의 모든 실패 로그를 포함하고 성공 로그는 실패로 세지 않는다", async () => {
  const body = jobMonitorBody(policy());
  const sql = body.filters.selectors[0];
  const emitted = new Set();
  for (const source of ["job-runner.ts", "purge-runner.ts", "scheduled.ts"]) {
    const text = await readFile(new URL(`../../app/server/src/${source}`, import.meta.url), "utf8");
    for (const match of text.matchAll(/"((?:job_|purge_)[a-z_]*failed)"/g)) emitted.add(match[1]);
  }
  assert.ok(emitted.size >= 8);
  for (const event of emitted) assert.ok(sql.includes(`attributes['event'] = '${event}'`), event);
  for (const event of ["job_polled", "job_done", "job_started"]) assert.ok(!sql.includes(`= '${event}'`));
  assert.ok(!sql.includes("LIKE"));
});

test("실행15분과 조회15분을 맞추고 대상·계정·Worker·반복 간격을 보존한다", () => {
  const input = policy(), original = structuredClone(input);
  const body = jobMonitorBody(input);
  assert.deepEqual(input, original);
  assert.deepEqual(body.mechanisms, original.mechanisms);
  assert.equal(body.alert_interval, "1h");
  assert.deepEqual(body.filters.execution_interval, ["15m"]);
  assert.deepEqual(body.filters.alert_trigger_preferences_short_window, ["15m"]);
  assert.ok(body.filters.selectors[0].includes(`accountTag = '${"a".repeat(32)}'`));
  assert.ok(body.filters.selectors[0].includes("= 'siljang-staging'"));
  assert.deepEqual(jobMonitorBody({ ...input, ...body }), body);
});

test("모양·범위가 다른 정책을 덮어쓰지 않는다", () => {
  for (const input of [
    { ...policy(), name: "다른 서비스" },
    { ...policy(), alert_type: "billing_usage_alert" },
    { ...policy(), filters: { ...policy().filters, execution_interval: ["1m"] } },
    { ...policy(), filters: { ...policy().filters, selectors: undefined } },
    { ...policy(), filters: { ...policy().filters, selectors: [policy().filters.selectors[0].replace("siljang-staging", "siljang-production")] } },
    { ...policy(), filters: { ...policy().filters, selectors: [policy().filters.selectors[0] + " AND attributes['job'] = 'purge'"] } },
  ]) assert.throws(() => jobMonitorBody(input), /job_monitor_shape_invalid/);
});

test("정책이 유일할 때만 쓰고 다시 읽은 대상·조건이 같아야 통과한다", async () => {
  const initial = policy(); let saved;
  const result = await configureJobMonitor({
    policies: async () => [initial],
    put: async (id, body) => { assert.equal(id, initial.id); saved = structuredClone(body); },
    get: async id => { assert.equal(id, initial.id); return { id, ...saved }; },
  });
  assert.equal(result.events, 9);
  assert.equal(result.enabled, true);
  await assert.rejects(configureJobMonitor({ policies: async () => [initial, initial] }), /job_monitor_not_unique/);
  await assert.rejects(configureJobMonitor({ policies: async () => [initial], put: async () => {}, get: async () => initial }), /job_monitor_verification_failed/);
});
