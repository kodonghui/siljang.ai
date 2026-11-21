import assert from "node:assert/strict";
import test from "node:test";
import { activeVersionId, versionConfiguration } from "./active-version.mjs";

test("새 rollback 배포가 오래된 버전을 가리켜도 배포 생성 시각으로 고른다", () => {
  const rows = [
    { created_on: "2026-11-21T17:10:00Z", versions: [{ version_id: "newer-upload", percentage: 100 }] },
    { created_on: "2026-11-21T17:11:00Z", versions: [{ version_id: "original-version", percentage: 100 }] },
  ];
  assert.equal(activeVersionId({ deployments: rows }), "original-version");
  assert.equal(activeVersionId([...rows].reverse()), "original-version");
  assert.throws(() => activeVersionId([{ created_on: "bad", versions: [] }]), /deployments_invalid/);
  assert.throws(() => activeVersionId([{ created_on: rows[0].created_on, versions: [{ version_id: "a", percentage: 50 }, { version_id: "b", percentage: 50 }] }]), /mixed_versions/);
});

test("마지막 업로드의 측정 바인딩을 활성 원본에 남은 것으로 오판하지 않는다", () => {
  const original = [{ name: "RECORDS", type: "kv_namespace", namespace_id: "synthetic-namespace" }];
  const active = { resources: { bindings: original, script_runtime: { compatibility_date: "2026-10-01" } } };
  const latest = { bindings: [...original, { name: "IMAGES", type: "images" }, { name: "PHOTO_RESOURCE_PROBE_KEY", type: "secret_text" }] };
  const result = versionConfiguration(active, latest);
  assert.strictEqual(result.bindings, original);
  assert.deepEqual(result.compatibility_flags, []);
  assert.equal(latest.bindings.length, 3);
  assert.throws(() => versionConfiguration({ resources: { bindings: [] } }), /version_configuration_missing/);
});

test("바인딩 메타데이터의 비밀 값 속성을 읽어 설정을 복구하지 않는다", () => {
  let reads = 0;
  const secret = { name: "SKILL_KEY", type: "secret_text" };
  Object.defineProperty(secret, "text", { get() { reads += 1; throw new Error("must not read"); } });
  const result = versionConfiguration({ resources: { bindings: [secret], script_runtime: { compatibility_date: "2026-10-01" } } });
  assert.equal(result.bindings[0].name, "SKILL_KEY");
  assert.equal(reads, 0);
});
