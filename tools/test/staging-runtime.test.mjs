import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  CALLBACK_QUEUES,
  GENERATED_SECRETS,
  prepareStaging,
  verifyStaging,
} from "../staging-runtime.mjs";

const fakeValue = ["test", "x".repeat(38)].join("-");
function preparation(queues = [], secrets = []) {
  const calls = [],
    logs = [];
  return {
    calls,
    logs,
    options: {
      queueNames: async () => queues,
      secretNames: async () => secrets,
      run: async (args, input) => {
        calls.push({ args, input });
        return "";
      },
      newSecret: () => fakeValue,
      log: (entry) => logs.push(entry),
    },
  };
}

test("현재 자원은 건드리지 않고 필요한 큐·비밀 값만 한 번 생성", async () => {
  const f = preparation(
    ["unrelated-test-queue", CALLBACK_QUEUES[0]],
    ["FIELD_KEY_CURRENT", "FIELD_KEY_V1", "FILE_URL_KEY"],
  );
  assert.deepEqual(await prepareStaging(f.options), {
    queuesCreated: [CALLBACK_QUEUES[1]],
    secretsCreated: ["REQUEST_HASH_KEY"],
  });
  assert.deepEqual(
    f.calls.map((c) => c.args),
    [
      ["queues", "create", CALLBACK_QUEUES[1]],
      ["secret", "put", "REQUEST_HASH_KEY"],
    ],
  );
  assert.equal(f.calls[1].input, `${fakeValue}\n`);
  assert.equal(
    JSON.stringify(f.calls.map((c) => c.args)).includes(fakeValue),
    false,
  );
  assert.equal(JSON.stringify(f.logs).includes(fakeValue), false);
});
test("모든 자원이 있으면 새 값 생성·수정·큐 비우기를 하지 않음", async () => {
  const f = preparation(CALLBACK_QUEUES, GENERATED_SECRETS);
  f.options.newSecret = () => {
    throw new Error("must not regenerate");
  };
  assert.deepEqual(await prepareStaging(f.options), {
    queuesCreated: [],
    secretsCreated: [],
  });
  assert.deepEqual(f.calls, []);
});
test("메타데이터 조회 실패 뒤에는 변경하지 않고 오류 메시지의 값을 내보내지 않음", async () => {
  const f = preparation();
  f.options.secretNames = async () => {
    throw new Error(fakeValue);
  };
  await assert.rejects(
    prepareStaging(f.options),
    (e) =>
      e.message === "staging_metadata_failed" &&
      !String(e.stack).includes(fakeValue),
  );
  assert.deepEqual(f.calls, []);
});
test("CLI 실패의 비밀 값·본문을 출력하지 않고 다음 변경을 하지 않음", async () => {
  const f = preparation(CALLBACK_QUEUES, []);
  f.options.run = async (args, input) => {
    f.calls.push({ args, input });
    throw new Error(fakeValue);
  };
  await assert.rejects(
    prepareStaging(f.options),
    (e) =>
      e.message === "staging_secret_put_failed" &&
      !String(e.stack).includes(fakeValue),
  );
  assert.equal(f.calls.length, 1);
  assert.equal(JSON.stringify(f.logs).includes(fakeValue), false);
});

const expectedSha = "a".repeat(40);
function verification() {
  const old = randomUUID(),
    recent = randomUUID();
  const calls = [];
  let healthCalls = 0;
  const options = {
    expectedSha,
    run: async (args) => {
      calls.push(args);
      if (args[0] === "deployments")
        return JSON.stringify([
          {
            created_on: "2026-11-20T00:00:00Z",
            versions: [{ version_id: old, percentage: 100 }],
          },
          {
            created_on: "2026-11-21T00:00:00Z",
            versions: [{ version_id: recent, percentage: 100 }],
          },
        ]);
      assert.equal(args[2], recent);
      return JSON.stringify({ annotations: { "workers/tag": expectedSha } });
    },
    health: async () => {
      healthCalls += 1;
      return { status: 200, body: { status: "ok" } };
    },
  };
  return { options, calls, recent, healthCalls: () => healthCalls };
}
test("배포 목록의 첫 항목 대신 최신 시각·활성 버전을 확인한 뒤 공개 상태를 검사", async () => {
  const f = verification();
  assert.deepEqual(await verifyStaging(f.options), {
    tag: expectedSha,
    versionId: f.recent,
    createdOn: "2026-11-21T00:00:00Z",
    healthStatus: 200,
  });
  assert.equal(f.healthCalls(), 1);
});
test("이전 버전의 정상 상태로 새 배포를 통과시키지 않음", async () => {
  const f = verification(),
    run = f.options.run;
  f.options.run = async (args) =>
    args[0] === "versions"
      ? JSON.stringify({
          metadata: { annotations: { "workers/tag": "b".repeat(40) } },
        })
      : run(args);
  await assert.rejects(verifyStaging(f.options), {
    message: "staging_tag_mismatch",
  });
  assert.equal(f.healthCalls(), 0);
});
test("예전 버전으로 나뉜 트래픽은 완전한 새 배포로 기록하지 않음", async () => {
  const f = verification();
  f.options.run = async () =>
    JSON.stringify([
      {
        created_on: "2026-11-21T00:00:00Z",
        versions: [
          { version_id: randomUUID(), percentage: 50 },
          { version_id: randomUUID(), percentage: 50 },
        ],
      },
    ]);
  await assert.rejects(verifyStaging(f.options), {
    message: "staging_mixed_versions",
  });
  assert.equal(f.healthCalls(), 0);
});
test("태그가 맞아도 공개 주소의 실패를 통과시키지 않음", async () => {
  const f = verification();
  f.options.health = async () => ({ status: 503, body: { status: "ok" } });
  await assert.rejects(verifyStaging(f.options), {
    message: "staging_health_failed",
  });
});
