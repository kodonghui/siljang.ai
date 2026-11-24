/** 네이티브 합성 등록의 파일 교환. 비밀 값은 app/server/.dev.vars에만 둔다. */
import { randomBytes } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { OperatorAuth } from "../src/operator-auth";
import { supabaseAuth } from "../src/operator-auth";
import { type OperatorAuthSettings, Secret } from "../src/settings";
import {
  type EnrollmentRequest,
  enrollmentDb,
  parseEnrollmentRequest,
  renderEnrollmentSql,
} from "./operator-enroll-bridge";
import { enrollSyntheticOperator, SyntheticEnrollmentError } from "./operator-enroll-synthetic";

type Config = {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SYNTHETIC_OPERATOR_EMAIL: string;
  SYNTHETIC_OPERATOR_AUTH_USER_ID: string;
  SYNTHETIC_OPERATOR_PASSWORD: string;
  SYNTHETIC_OPERATOR_NAME: string;
};
const CONFIG_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SYNTHETIC_OPERATOR_EMAIL",
  "SYNTHETIC_OPERATOR_AUTH_USER_ID",
  "SYNTHETIC_OPERATOR_PASSWORD",
  "SYNTHETIC_OPERATOR_NAME",
] as const;
const RESUME_KEYS = ["SYNTHETIC_OPERATOR_TOTP_SECRET", "SYNTHETIC_OPERATOR_MFA_FACTOR_ID"] as const;
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const fail = () => new SyntheticEnrollmentError();
async function readJson(path: string): Promise<unknown> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 16384) throw fail();
  return JSON.parse(await readFile(path, "utf8"));
}
async function waitJson(path: string, deadline: number): Promise<unknown> {
  while (Date.now() < deadline) {
    try {
      return await readJson(path);
    } catch (e) {
      if (!(record(e) && e.code === "ENOENT")) throw fail();
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw fail();
}
export async function runFileEnrollment(options: {
  readonly privateFile: string;
  readonly exchangeDir: string;
  readonly auth?: (settings: OperatorAuthSettings) => OperatorAuth;
  readonly timeoutMs?: number;
}): Promise<{ enrolled: true; disabled: boolean }> {
  let statusPath: string | null = null;
  try {
    const privateFile = resolve(options.privateFile);
    if (
      basename(privateFile) !== ".dev.vars" ||
      basename(dirname(privateFile)) !== "server" ||
      basename(dirname(dirname(privateFile))) !== "app"
    )
      throw fail();
    const info = await lstat(privateFile);
    if (!info.isFile() || info.isSymbolicLink() || (process.platform !== "win32" && (info.mode & 0o077) !== 0))
      throw fail();
    const parsed = await readJson(privateFile);
    if (!record(parsed) || CONFIG_KEYS.some((k) => typeof parsed[k] !== "string")) throw fail();
    const savedSecret = parsed.SYNTHETIC_OPERATOR_TOTP_SECRET,
      savedFactor = parsed.SYNTHETIC_OPERATOR_MFA_FACTOR_ID;
    const resuming = typeof savedSecret === "string" && typeof savedFactor === "string";
    const keys: readonly string[] = resuming ? [...CONFIG_KEYS, ...RESUME_KEYS] : CONFIG_KEYS;
    if (Object.keys(parsed).length !== keys.length || Object.keys(parsed).some((k) => !keys.includes(k))) throw fail();
    const config = parsed as Config;
    const url = new URL(config.SUPABASE_URL);
    if (
      url.protocol !== "https:" ||
      !/^[-a-z0-9]+\.supabase\.co$/.test(url.hostname) ||
      url.origin !== config.SUPABASE_URL ||
      !/^sb_publishable_[A-Za-z0-9_-]{8,200}$/.test(config.SUPABASE_PUBLISHABLE_KEY)
    )
      throw fail();
    const timeout = options.timeoutMs ?? 600000;
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 600000) throw fail();
    await realpath(privateFile);
    const exchangeDir = resolve(options.exchangeDir);
    await mkdir(exchangeDir, { recursive: true, mode: 0o700 });
    const directory = await lstat(exchangeDir),
      names = await readdir(exchangeDir);
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw fail();
    if (!resuming && names.length !== 0) throw fail();
    const target = {
      email: config.SYNTHETIC_OPERATOR_EMAIL,
      authUserId: config.SYNTHETIC_OPERATOR_AUTH_USER_ID,
      displayName: config.SYNTHETIC_OPERATOR_NAME,
    };
    let resumeRequest: EnrollmentRequest | undefined;
    if (resuming) {
      if (
        names.some(
          (name) =>
            !/^(?:(?:status|secret-backup-request|secret-backup-confirmed|sql-request|sql-delivery)\.json|sql-request\.sql|sql-response-[0-9a-f]{32}\.json)$/.test(
              name,
            ),
        )
      )
        throw fail();
      const backup = await readJson(join(exchangeDir, "secret-backup-request.json")),
        confirmed = await readJson(join(exchangeDir, "secret-backup-confirmed.json"));
      if (
        !record(backup) ||
        backup.schemaVersion !== 1 ||
        typeof backup.nonce !== "string" ||
        !/^[0-9a-f]{32}$/.test(backup.nonce) ||
        !record(confirmed) ||
        confirmed.nonce !== backup.nonce ||
        confirmed.backedUp !== true
      )
        throw fail();
      resumeRequest = parseEnrollmentRequest(await readJson(join(exchangeDir, "sql-request.json")), target);
      if (resumeRequest.params[1] !== target.displayName.trim() || resumeRequest.params[3] !== savedFactor)
        throw fail();
    }
    statusPath = join(exchangeDir, "status.json");
    const status = async (phase: string) =>
      writeFile(statusPath ?? "", `${JSON.stringify({ schemaVersion: 1, phase })}\n`, { mode: 0o600 });
    const writeNew = async (name: string, value: string) =>
      writeFile(join(exchangeDir, name), value, { flag: "wx", mode: 0o600 });
    const auth = (options.auth ?? supabaseAuth)({
      url: url.origin,
      publishableKey: new Secret(config.SUPABASE_PUBLISHABLE_KEY),
    });
    await status(resuming ? "authenticating-existing-synthetic-user" : "authenticating-new-synthetic-user");
    const result = await enrollSyntheticOperator({
      auth,
      target,
      password: config.SYNTHETIC_OPERATOR_PASSWORD,
      now: () => new Date(),
      ...(resuming ? { resume: { factorId: savedFactor, secret: savedSecret } } : {}),
      saveNewTotp: async (value) => {
        if (resuming) throw fail();
        await writeFile(
          privateFile,
          `${JSON.stringify({ ...config, SYNTHETIC_OPERATOR_TOTP_SECRET: value.secret, SYNTHETIC_OPERATOR_MFA_FACTOR_ID: value.factorId })}\n`,
          { mode: 0o600 },
        );
        const nonce = randomBytes(16).toString("hex");
        await writeNew("secret-backup-request.json", `${JSON.stringify({ schemaVersion: 1, nonce })}\n`);
        await status("awaiting-new-secret-vault-backup");
        const proof = await waitJson(join(exchangeDir, "secret-backup-confirmed.json"), Date.now() + timeout);
        if (!record(proof) || proof.nonce !== nonce || proof.backedUp !== true) throw fail();
      },
      db: enrollmentDb({
        ...target,
        ...(resumeRequest === undefined ? {} : { resumeRequest }),
        exchange: async (request) => {
          if (!resuming) await writeNew("sql-request.json", `${JSON.stringify(request)}\n`);
          const deliveryNonce = randomBytes(16).toString("hex");
          await writeFile(join(exchangeDir, "sql-request.sql"), renderEnrollmentSql(request, deliveryNonce), {
            mode: 0o600,
          });
          await writeFile(
            join(exchangeDir, "sql-delivery.json"),
            `${JSON.stringify({ schemaVersion: 1, deliveryNonce, responseFile: `sql-response-${deliveryNonce}.json` })}\n`,
            { mode: 0o600 },
          );
          await status("awaiting-actual-sql-result");
          const proof = await waitJson(join(exchangeDir, `sql-response-${deliveryNonce}.json`), Date.now() + timeout);
          if (!record(proof) || proof.deliveryNonce !== deliveryNonce) throw fail();
          return proof;
        },
      }),
    });
    await status("actual-enrollment-confirmed");
    return { enrolled: true, disabled: result.disabled };
  } catch {
    if (statusPath !== null)
      await writeFile(statusPath, `${JSON.stringify({ schemaVersion: 1, phase: "failed" })}\n`, { mode: 0o600 }).catch(
        () => {},
      );
    throw fail();
  }
}
