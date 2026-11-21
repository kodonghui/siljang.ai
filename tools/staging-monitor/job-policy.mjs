/** 현재 앱의 일 실패 모니터를 보완한다. 인증 값·대상 주소·SQL 원문은 출력하지 않는다. */
import { isDeepStrictEqual } from "node:util";

export const JOB_FAILURE_EVENTS = [
  "job_run_failed", "job_find_failed", "job_start_failed", "job_sweep_failed",
  "job_item_failed", "job_act_failed", "purge_failed", "purge_file_failed",
];

export const JOB_MONITOR_NAME = "Siljang staging job failures";

export function jobMonitorBody(policy) {
  const filters = policy?.filters;
  const sql = filters?.selectors?.[0];
  const prefix = /^SELECT COUNT\(\*\) AS value FROM logs\.workersLogs WHERE accountTag = '[a-f0-9]{32}' AND attributes\['\$workers\.scriptName'\] = 'siljang-staging' AND /;
  if (policy?.name !== JOB_MONITOR_NAME || policy.alert_type !== "custom_analytics" ||
      typeof policy.enabled !== "boolean" || !policy.mechanisms ||
      filters?.source?.length !== 1 || filters.source[0] !== "sql_api" ||
      !Array.isArray(filters.selectors) || filters.selectors.length !== 1 || typeof sql !== "string" || !prefix.test(sql) ||
      filters.execution_interval?.[0] !== "15m" || filters.alert_trigger_preferences?.[0] !== "threshold" ||
      filters.alert_trigger_preferences_operator?.[0] !== ">=" || filters.alert_trigger_preferences_value?.[0] !== "1")
    throw new Error("job_monitor_shape_invalid");
  const before = sql.match(prefix)[0];
  const suffix = sql.slice(before.length);
  if (!/^\(attributes\['event'\] = '[a-z_]+_failed'(?: OR attributes\['event'\] = '[a-z_]+_failed')*\)$/.test(suffix) ||
      [...suffix.matchAll(/= '([a-z_]+_failed)'/g)].some(match => !JOB_FAILURE_EVENTS.includes(match[1])))
    throw new Error("job_monitor_shape_invalid");
  const condition = JOB_FAILURE_EVENTS.map(event => `attributes['event'] = '${event}'`).join(" OR ");
  return {
    name: policy.name,
    description: policy.description ?? "",
    enabled: policy.enabled,
    alert_type: policy.alert_type,
    alert_interval: policy.alert_interval,
    mechanisms: structuredClone(policy.mechanisms),
    filters: { ...structuredClone(filters), selectors: [`${before}(${condition})`], alert_trigger_preferences_short_window: ["15m"] },
  };
}

export async function configureJobMonitor(adapter) {
  const matches = (await adapter.policies()).filter(p => p.name === JOB_MONITOR_NAME);
  if (matches.length !== 1 || typeof matches[0].id !== "string") throw new Error("job_monitor_not_unique");
  const original = matches[0];
  const body = jobMonitorBody(original);
  await adapter.put(original.id, body);
  const current = await adapter.get(original.id);
  if (current.enabled !== body.enabled ||
      !isDeepStrictEqual(current.mechanisms, body.mechanisms) ||
      !isDeepStrictEqual(current.filters, body.filters))
    throw new Error("job_monitor_verification_failed");
  return { name: JOB_MONITOR_NAME, events: JOB_FAILURE_EVENTS.length, interval: "15m", window: "15m", enabled: body.enabled };
}
