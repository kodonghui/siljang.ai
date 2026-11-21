/** rollback 뒤의 활성 설정은 마지막 업로드가 아니라 배포가 가리키는 버전에서 읽는다. */
export function activeVersionId(payload) {
  const deployments = Array.isArray(payload) ? payload : payload?.deployments;
  if (!Array.isArray(deployments) || deployments.length === 0 ||
      deployments.some(d => !Number.isFinite(Date.parse(d.created_on))))
    throw new Error("deployments_invalid");
  const latest = [...deployments].sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];
  const versions = (latest.versions ?? []).filter(v => v.percentage > 0);
  if (versions.length !== 1 || versions[0].percentage !== 100 || typeof versions[0].version_id !== "string")
    throw new Error("mixed_versions");
  return versions[0].version_id;
}

export function versionConfiguration(version, settings = {}) {
  const resources = version?.resources;
  if (!Array.isArray(resources?.bindings) || typeof resources.script_runtime?.compatibility_date !== "string")
    throw new Error("version_configuration_missing");
  return {
    ...settings,
    bindings: resources.bindings,
    compatibility_date: resources.script_runtime.compatibility_date,
    compatibility_flags: resources.script_runtime.compatibility_flags ?? [],
  };
}
