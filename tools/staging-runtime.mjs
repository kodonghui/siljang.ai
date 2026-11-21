/** TASK-173: 스테이징 자원의 준비와 배포 뒤 검증. 업무 데이터·비밀 값은 출력하지 않는다. */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

export const CALLBACK_QUEUES = [
  "siljang-staging-kakao-callbacks-dlq",
  "siljang-staging-kakao-callbacks",
];
export const GENERATED_SECRETS = ["REQUEST_HASH_KEY", "FILE_URL_KEY"];

function failure(code) {
  return new Error(code);
}

export async function prepareStaging(options) {
  let queues, secrets;
  try {
    [queues, secrets] = await Promise.all([
      options.queueNames(),
      options.secretNames(),
    ]);
    if (
      ![queues, secrets].every(
        (names) =>
          Array.isArray(names) &&
          names.every((name) => typeof name === "string"),
      )
    )
      throw failure("bad_metadata");
  } catch {
    throw failure("staging_metadata_failed");
  }
  const queuesCreated = [],
    secretsCreated = [];
  for (const name of CALLBACK_QUEUES) {
    if (queues.includes(name)) continue;
    try {
      await options.run(["queues", "create", name]);
    } catch {
      throw failure("staging_queue_create_failed");
    }
    queuesCreated.push(name);
    options.log?.({ event: "staging_queue_created", name });
  }
  for (const name of GENERATED_SECRETS) {
    if (secrets.includes(name)) continue;
    let value;
    try {
      value = options.newSecret();
    } catch {
      throw failure("staging_secret_generation_failed");
    }
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(value))
      throw failure("staging_secret_generation_failed");
    try {
      await options.run(["secret", "put", name], `${value}\n`);
    } catch {
      throw failure("staging_secret_put_failed");
    }
    secretsCreated.push(name);
    options.log?.({ event: "staging_secret_created", name });
  }
  return { queuesCreated, secretsCreated };
}

export async function verifyStaging(options) {
  if (!/^[0-9a-f]{40}$/.test(options.expectedSha ?? ""))
    throw failure("staging_sha_invalid");
  let deployments;
  try {
    const response = JSON.parse(
      await options.run(["deployments", "list", "--json"]),
    );
    deployments = Array.isArray(response) ? response : response.deployments;
    if (
      !Array.isArray(deployments) ||
      deployments.length === 0 ||
      deployments.some((d) => !Number.isFinite(Date.parse(d.created_on)))
    )
      throw failure("bad_deployments");
  } catch {
    throw failure("staging_deployments_failed");
  }
  const latest = [...deployments].sort(
    (a, b) => Date.parse(b.created_on) - Date.parse(a.created_on),
  )[0];
  const active = (latest.versions ?? []).filter((v) => v.percentage > 0);
  if (active.length !== 1 || active[0].percentage !== 100)
    throw failure("staging_mixed_versions");
  const versionId = active[0].version_id;
  if (
    typeof versionId !== "string" ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(versionId)
  )
    throw failure("staging_version_invalid");
  let tag;
  try {
    const version = JSON.parse(
      await options.run(["versions", "view", versionId, "--json"]),
    );
    tag = (version.annotations ?? version.metadata?.annotations)?.[
      "workers/tag"
    ];
  } catch {
    throw failure("staging_version_failed");
  }
  if (tag !== options.expectedSha) throw failure("staging_tag_mismatch");
  let health;
  try {
    health = await options.health();
  } catch {
    throw failure("staging_health_failed");
  }
  if (health.status !== 200 || health.body?.status !== "ok")
    throw failure("staging_health_failed");
  return {
    tag,
    versionId,
    createdOn: latest.created_on,
    healthStatus: health.status,
  };
}

const app = fileURLToPath(new URL("../app/", import.meta.url));
const cli = fileURLToPath(
  new URL("../app/node_modules/wrangler/bin/wrangler.js", import.meta.url),
);
const config = fileURLToPath(
  new URL("../app/server/wrangler.jsonc", import.meta.url),
);

/** 인자 배열에는 비밀 값을 넣지 않는다. 출력은 메모리에서만 읽고 CLI 오류 본문을 다시 출력하지 않는다. */
function runWrangler(args, input) {
  const result = spawnSync(
    process.execPath,
    [cli, ...args, "--config", config, "--env", "staging"],
    {
      cwd: app,
      env: process.env,
      input,
      encoding: "utf8",
      timeout: 45_000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  if (result.error || result.status !== 0) throw failure("staging_cli_failed");
  return result.stdout;
}

async function queueNames() {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!/^[0-9a-f]{32}$/i.test(account ?? "") || !token)
    throw failure("staging_credentials_missing");
  // Wrangler 4.158의 listQueues/getQueue와 같은 name 조회. 다른 큐의 메시지나 설정은 가져오지 않는다.
  const result = await Promise.all(
    CALLBACK_QUEUES.map(async (name) => {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${account}/queues?name=${encodeURIComponent(name)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (response.status !== 200) throw failure("staging_queue_list_failed");
      const body = await response.json();
      if (!body.success || !Array.isArray(body.result))
        throw failure("staging_queue_list_failed");
      return body.result
        .filter((q) => q.queue_name === name)
        .map((q) => q.queue_name);
    }),
  );
  return result.flat();
}

async function main(command) {
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN)
    throw failure("staging_credentials_missing");
  if (command === "prepare") {
    const result = await prepareStaging({
      queueNames,
      secretNames: async () => {
        const value = JSON.parse(runWrangler(["secret", "list"]));
        if (
          !Array.isArray(value) ||
          value.some((s) => typeof s.name !== "string")
        )
          throw failure("staging_secret_list_failed");
        return value.map((s) => s.name);
      },
      run: runWrangler,
      newSecret: () => randomBytes(32).toString("base64url"),
      log: (entry) => console.log(JSON.stringify(entry)),
    });
    console.log(JSON.stringify(result));
  } else if (command === "verify") {
    const domain = process.env.SILJANG_STAGING_DOMAIN;
    if (!/^staging\.[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain ?? ""))
      throw failure("staging_domain_invalid");
    const result = await verifyStaging({
      expectedSha: process.env.GITHUB_SHA,
      run: runWrangler,
      health: async () => {
        const response = await fetch(`https://${domain}/api/healthz`, {
          signal: AbortSignal.timeout(15_000),
        });
        return { status: response.status, body: await response.json() };
      },
    });
    console.log(JSON.stringify(result));
  } else {
    throw failure("staging_command_invalid");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch((error) => {
    // error.cause·CLI 본문·요청 헤더·입력 값은 출력하지 않는다.
    const code =
      error instanceof Error && /^staging_[a-z_]+$/.test(error.message)
        ? error.message
        : "staging_failed";
    console.error(JSON.stringify({ event: "staging_runtime_failed", code }));
    process.exitCode = 1;
  });
}
