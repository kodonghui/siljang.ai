/**
 * 설정을 읽는 곳은 이 모듈 하나다(11단계 계약, tech-stack.md 4-3의 1·6).
 * - 업무 코드는 Worker의 env를 직접 읽지 않고 readSettings()의 결과를 받는다.
 * - 비밀 값은 Secret으로 감싸, 글·JSON·로그로 바꾸면 가린 꼴만 나온다. 값은 클라이언트를 만드는 곳에서만 reveal()로 꺼낸다.
 * - 실행 환경 이름이 없으면 production으로 친다. development는 개발자의 .dev.vars만 정한다.
 */

import { AI_PROVIDERS, type AiProvider, type FxRate, priceOf } from "./ai-prices";
import { type PrivacyPolicySettings, readPrivacyPolicySettings, readPublicAppOrigin } from "./privacy-policy-settings";

const MASK = "**********";

/** 비밀 값 하나. 값은 reveal()로만 꺼낸다. */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return MASK;
  }

  toJSON(): string {
    return MASK;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return `Secret(${MASK})`;
  }
}

export const APP_ENVS = ["development", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

/**
 * 서버가 읽는 비밀 값의 이름.
 * - ANTHROPIC_API_KEY·OPENAI_API_KEY: 공급사 SDK가 읽는 이름 그대로.
 * - DATABASE_URL: PostgreSQL 연결 문자열(로컬·CI). Hyperdrive 바인딩이 있으면 그 연결 문자열을 사용한다(TASK-173).
 * - PURGE_DATABASE_URL: 공용 앱과 다른 제한 역할의 정기 삭제 연결. PURGE_HYPERDRIVE가 있으면 우선하며 예약 처리기만 쓴다.
 * - REQUEST_HASH_KEY: 요청 지문(request_keys.request_hash, 06 DEC-04)을 만드는 HMAC-SHA256 키. 32자 이상.
 * - STORAGE_ACCESS_KEY_ID·STORAGE_SECRET_ACCESS_KEY: 사진 저장소(Supabase Storage의 S3 호환 주소)의 S3 접근 키(TASK-022,
 *   storage.ts). Supabase의 publishable·secret 키가 아니다(TASK-174).
 * - FILE_URL_KEY: 사진의 15분 서명 주소(file-url.ts)의 키를 뽑는 비밀 값. 32자 이상.
 */
export const SECRET_NAMES = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "DATABASE_URL",
  "PURGE_DATABASE_URL",
  "REQUEST_HASH_KEY",
  "STORAGE_ACCESS_KEY_ID",
  "STORAGE_SECRET_ACCESS_KEY",
  "FILE_URL_KEY",
] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

/** HMAC 키의 가장 짧은 길이(글자). 짧은 키는 설정 잘못으로 멈춘다. */
export const MIN_HASH_KEY_LENGTH = 32;

/** 사진 저장소의 주소(비밀 값이 아님). 세 값이 모두 있어야 한다. */
export interface StorageSettings {
  /** S3 호환 주소(https). development에서만 http://localhost·127.0.0.1을 받는다(로컬 시험 저장소). */
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
}

/** 사진 저장소 주소를 담는 변수의 이름. */
export const STORAGE_VAR_NAMES = ["STORAGE_ENDPOINT", "STORAGE_REGION", "STORAGE_BUCKET"] as const;

/**
 * 계좌번호·원래 값 암호화의 키(TASK-025; 05 A23·E20, REQ-191·135). field-crypto.ts가 쓴다.
 * - FIELD_KEY_V<버전>(비밀 값, 버전 1~999): 버전마다 무작위 32바이트의 base64url(채움 없이 43자). 암호화 키와 같은 값 찾기
 *   HMAC 키를 이 값에서 HKDF-SHA256으로 따로 뽑는다.
 * - FIELD_KEY_CURRENT(비밀 값 아님, 숫자): 새로 쓰는 봉투의 버전. 앞 버전의 키는 읽기만 하려고 남겨 둔다.
 * Workers의 비밀 값은 넣은 뒤 다시 읽을 수 없어서, 버전마다 따로 넣고(앞 키를 다시 적지 않음) 지금 버전은 따로 고른다.
 */
export interface FieldKeySettings {
  readonly current: number;
  /** 버전 → 키. current의 키는 꼭 있다. */
  readonly keys: ReadonlyMap<number, Secret>;
}

/** FIELD_KEY_V<버전>의 이름 꼴. 버전은 05의 봉투 CHECK(`v[1-9][0-9]{0,2}`)와 같은 1~999. */
const FIELD_KEY_NAME = /^FIELD_KEY_V([1-9][0-9]{0,2})$/;
/** 키 값: 32바이트의 base64url(채움 없이 43자, 마지막 글자는 남는 비트가 0인 것). */
const FIELD_KEY_VALUE = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;

/**
 * 운영자 인증 서비스(TASK-021; 06 DEC-27, TASK-003): Supabase Auth의 이메일·비밀번호와 TOTP 2단계 인증. operator-auth.ts가 쓴다.
 * - SUPABASE_URL: 프로젝트 주소(https://<프로젝트>.supabase.co). development에서만 http://localhost·127.0.0.1을 받는다.
 * - SUPABASE_PUBLISHABLE_KEY: publishable 키(sb_publishable_…). 서버만 쓰고 화면에 주지 않는다. secret 키(sb_secret_…)는
 *   모든 데이터를 여는 키라 받지 않는다(Supabase 문서 'Understanding API keys', 2026-11-18 확인: 두 키 모두 apikey 헤더로 보냄).
 * 둘 다 없으면 null(운영자 로그인만 500 internal). 하나만 있으면 시작에서 멈춘다.
 */
export const OPERATOR_AUTH_VAR_NAMES = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"] as const;

export interface OperatorAuthSettings {
  /** 프로젝트 주소(끝의 / 없음). 인증 API는 이 뒤의 /auth/v1. */
  readonly url: string;
  readonly publishableKey: Secret;
}

/** 사장님 카카오 로그인(TASK-020). 키 값은 비밀 저장소에만 둔다. */
export interface OwnerAuthSettings {
  readonly clientId: Secret;
  readonly clientSecret: Secret;
  readonly adminKey: Secret | null;
  readonly redirectUris: readonly string[];
  readonly scopes: readonly string[];
  readonly alertChannelId: string;
}

/** 사장님 채널 발신은 MVP에서 기본 중단한다. 실제 채널 연결은 출시 검토에서 켠다. */
export interface OwnerAlertSettings {
  readonly enabled: boolean;
  readonly botId: string | null;
  readonly development: boolean;
}

/**
 * 모델 호출 설정(TASK-026; REQ-266, 06 DEC-25, 04 AI-1). 회사 하나와 그 모델을 배포 설정으로 고른다(ai-model.ts).
 * - AI_PROVIDER: anthropic | openai. AI_MODEL: 요금표(ai-prices.ts)에 있는 그 회사의 모델 ID. 없는 모델은 시작에서 막는다.
 * - AI_EFFORT(고르지 않아도 됨): low | medium | high. 비우면 회사의 기본값.
 * - AI_USD_KRW·AI_USD_KRW_DATE: 원 환산 환율(예 1450.25)과 그 날짜(YYYY-MM-DD). ai_calls.cost_basis에 남는다.
 * - 키는 고른 회사의 것(ANTHROPIC_API_KEY나 OPENAI_API_KEY) 하나만 쓴다. 없으면 호출마다 실패 행(key_missing).
 * 다섯 변수가 모두 비면 null(AI 일만 쓰지 못함).
 */
export const AI_VAR_NAMES = ["AI_PROVIDER", "AI_MODEL", "AI_EFFORT", "AI_USD_KRW", "AI_USD_KRW_DATE"] as const;
export const AI_EFFORTS = ["low", "medium", "high"] as const;
export type AiEffort = (typeof AI_EFFORTS)[number];

export interface AiSettings {
  readonly provider: AiProvider;
  readonly model: string;
  readonly effort: AiEffort | null;
  readonly fx: FxRate;
  readonly apiKey: Secret | null;
}

/**
 * 추적 도구(LangSmith)와 LangChain의 자세한 기록을 켜는 변수. LangChain은 process.env에서 읽고, Workers는 호환 날짜
 * 2025-04-01 뒤로 Worker의 변수·비밀 값을 process.env에 넣는다(Cloudflare 문서 'process', 2026-11-16 확인).
 * LANGSMITH_GATEWAY는 모델 호출을 LangSmith 중계 주소로 돌리는 변수다(@langchain/core utils/gateway).
 * 운영에서는 비우거나 false여야 하고(REQ-138), 추적 도구 키도 두지 않는다. 어기면 시작에서 멈춘다.
 */
export const TRACING_SWITCH_NAMES = [
  "LANGSMITH_TRACING",
  "LANGSMITH_TRACING_V2",
  "LANGCHAIN_TRACING_V2",
  "LANGCHAIN_TRACING",
  "LANGCHAIN_VERBOSE",
  "LANGSMITH_GATEWAY",
] as const;
export const TRACING_KEY_NAMES = ["LANGSMITH_API_KEY", "LANGCHAIN_API_KEY", "LANGSMITH_GATEWAY_API_KEY"] as const;

export interface Settings {
  readonly appEnv: AppEnv;
  readonly secrets: Readonly<Record<SecretName, Secret | null>>;
  /** 값이 없는 비밀 값의 이름. 시작 로그에는 이 이름만 남긴다. */
  readonly missingSecrets: readonly SecretName[];
  /** 사진 저장소의 주소. 세 변수가 모두 없으면 null(저장소가 필요한 요청만 500 internal). */
  readonly storage: StorageSettings | null;
  /** 계좌번호·원래 값 암호화의 키. 하나도 없으면 null(암호화가 필요한 요청만 500 internal). */
  readonly fieldKeys: FieldKeySettings | null;
  /** 모델 호출 설정. 다섯 AI_ 변수가 모두 없으면 null. */
  readonly ai: AiSettings | null;
  /** 운영자 인증 서비스(Supabase Auth). 두 변수가 모두 없으면 null. */
  readonly operatorAuth: OperatorAuthSettings | null;
  readonly ownerAuth: OwnerAuthSettings | null;
  readonly ownerAlerts: OwnerAlertSettings;
  readonly privacyPolicy: PrivacyPolicySettings | null;
  readonly publicAppOrigin: string | null;
}

export class SettingsError extends Error {
  override readonly name = "SettingsError";
}

function readAppEnv(raw: unknown): AppEnv {
  if (raw === undefined || raw === null || raw === "") {
    return "production";
  }
  if (typeof raw === "string" && (APP_ENVS as readonly string[]).includes(raw)) {
    return raw as AppEnv;
  }
  // 값은 메시지에 싣지 않는다(이름만).
  throw new SettingsError("APP_ENV must be one of development, staging, production");
}

const POSTGRES_URL = /^postgres(ql)?:\/\//;

function readDatabaseUrl(
  env: Readonly<Record<string, unknown>>,
  bindingName = "HYPERDRIVE",
  urlName = "DATABASE_URL",
): unknown {
  const binding = env[bindingName];
  if (binding === undefined) return env[urlName];

  const url =
    typeof binding === "object" && binding !== null && "connectionString" in binding
      ? binding.connectionString
      : undefined;
  if (typeof url !== "string" || !POSTGRES_URL.test(url.trim())) {
    throw new SettingsError(`${bindingName}.connectionString must start with postgres:// or postgresql://`);
  }
  return url;
}

/** Worker의 env(바인딩·변수·비밀 값)에서 설정을 읽는다. */
export function readSettings(env: Readonly<Record<string, unknown>>): Settings {
  const appEnv = readAppEnv(env.APP_ENV);
  const secrets = {} as Record<SecretName, Secret | null>;
  const missingSecrets: SecretName[] = [];
  for (const name of SECRET_NAMES) {
    const raw =
      name === "DATABASE_URL"
        ? readDatabaseUrl(env)
        : name === "PURGE_DATABASE_URL"
          ? readDatabaseUrl(env, "PURGE_HYPERDRIVE", name)
          : env[name];
    if (typeof raw === "string" && raw.trim() !== "") {
      secrets[name] = new Secret(raw.trim());
    } else {
      secrets[name] = null;
      missingSecrets.push(name);
    }
  }
  // 값은 메시지에 싣지 않는다(이름과 조건만).
  for (const name of ["DATABASE_URL", "PURGE_DATABASE_URL"] as const) {
    const db = secrets[name]?.reveal();
    if (db !== undefined && !POSTGRES_URL.test(db))
      throw new SettingsError(`${name} must start with postgres:// or postgresql://`);
  }
  for (const name of ["REQUEST_HASH_KEY", "FILE_URL_KEY"] as const) {
    const key = secrets[name]?.reveal();
    if (key !== undefined && key.length < MIN_HASH_KEY_LENGTH) {
      throw new SettingsError(`${name} must be at least ${MIN_HASH_KEY_LENGTH} characters`);
    }
  }
  checkTracing(env, appEnv);
  const ai = readAi(env, secrets);
  const ownerAuth = readOwnerAuth(env);
  return {
    appEnv,
    secrets,
    missingSecrets,
    storage: readStorage(env, appEnv),
    fieldKeys: readFieldKeys(env),
    ai,
    operatorAuth: readOperatorAuth(env, appEnv),
    ownerAuth,
    ownerAlerts: readOwnerAlerts(env, ownerAuth, appEnv),
    privacyPolicy: readPrivacyPolicySettings(env, ai?.provider),
    publicAppOrigin: readPublicAppOrigin(env.PUBLIC_APP_ORIGIN),
  };
}

function readOwnerAlerts(
  env: Readonly<Record<string, unknown>>,
  ownerAuth: OwnerAuthSettings | null,
  appEnv: AppEnv,
): OwnerAlertSettings {
  const flag = (name: string) => {
    const value = env[name];
    if (value === undefined || value === "" || value === "false") return false;
    if (value === "true") return true;
    throw new SettingsError(`${name} must be true or false`);
  };
  const enabled = flag("KAKAO_OWNER_ALERTS_ENABLED"),
    development = flag("KAKAO_OWNER_BOT_DEVELOPMENT");
  if (development && appEnv === "production")
    throw new SettingsError("KAKAO_OWNER_BOT_DEVELOPMENT must be false in production");
  const raw = env.KAKAO_OWNER_BOT_ID;
  if (raw !== undefined && raw !== "" && (typeof raw !== "string" || !/^[0-9a-f]{24}$/i.test(raw)))
    throw new SettingsError("KAKAO_OWNER_BOT_ID must be a bot ID");
  const botId = typeof raw === "string" && raw !== "" ? raw : null;
  if (enabled && (botId === null || ownerAuth === null))
    throw new SettingsError("owner alerts require owner login and KAKAO_OWNER_BOT_ID");
  if (enabled && readPublicAppOrigin(env.PUBLIC_APP_ORIGIN) === null)
    throw new SettingsError("owner alerts require PUBLIC_APP_ORIGIN");
  return { enabled, botId, development };
}

function readOwnerAuth(env: Readonly<Record<string, unknown>>): OwnerAuthSettings | null {
  const names = ["KAKAO_REST_API_KEY", "KAKAO_CLIENT_SECRET", "KAKAO_OWNER_REDIRECT_URIS"];
  const values = names.map((n) => (typeof env[n] === "string" ? (env[n] as string).trim() : ""));
  const admin = typeof env.KAKAO_ADMIN_KEY === "string" ? env.KAKAO_ADMIN_KEY.trim() : "";
  const alertChannelId = typeof env.KAKAO_ALERT_CHANNEL_ID === "string" ? env.KAKAO_ALERT_CHANNEL_ID.trim() : "";
  const scopeInput = typeof env.KAKAO_OWNER_LOGIN_SCOPES === "string" ? env.KAKAO_OWNER_LOGIN_SCOPES.trim() : "";
  if (values.every((v) => v === "") && admin === "" && alertChannelId === "" && scopeInput === "") return null;
  if (values.some((v) => v === "")) throw new SettingsError("KAKAO owner login settings must be set together");
  const [clientId, clientSecret, uris] = values as [string, string, string];
  const scopes = scopeInput === "" ? [] : [...new Set(scopeInput.split(",").map((s) => s.trim()))];
  if (scopes.length > 32 || scopes.some((s) => !/^[a-z][a-z0-9_]{0,63}$/.test(s)))
    throw new SettingsError("KAKAO_OWNER_LOGIN_SCOPES must contain comma-separated scope names");
  const redirectUris = uris.split(",").map((s) => s.trim());
  for (const raw of redirectUris) {
    let uri: URL;
    try {
      uri = new URL(raw);
    } catch {
      throw new SettingsError("KAKAO_OWNER_REDIRECT_URIS must contain URLs");
    }
    if (
      uri.protocol !== "https:" ||
      uri.username !== "" ||
      uri.password !== "" ||
      uri.hash !== "" ||
      uri.href !== raw
    ) {
      throw new SettingsError(
        "KAKAO_OWNER_REDIRECT_URIS must contain exact https URLs without credentials or fragments",
      );
    }
  }
  if ((alertChannelId !== "" || scopes.includes("plusfriends")) && !/^_[A-Za-z0-9_-]{1,100}$/.test(alertChannelId))
    throw new SettingsError("KAKAO_ALERT_CHANNEL_ID has an unexpected shape");
  return {
    clientId: new Secret(clientId),
    clientSecret: new Secret(clientSecret),
    adminKey: admin === "" ? null : new Secret(admin),
    redirectUris,
    scopes,
    alertChannelId,
  };
}

function readOperatorAuth(env: Readonly<Record<string, unknown>>, appEnv: AppEnv): OperatorAuthSettings | null {
  const read = (name: (typeof OPERATOR_AUTH_VAR_NAMES)[number]): string | null => {
    const raw = env[name];
    return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
  };
  const rawUrl = read("SUPABASE_URL");
  const rawKey = read("SUPABASE_PUBLISHABLE_KEY");
  if (rawUrl === null && rawKey === null) return null;
  // 값은 메시지에 싣지 않는다(이름과 조건만).
  if (rawUrl === null || rawKey === null) {
    throw new SettingsError("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set together");
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SettingsError("SUPABASE_URL must be a URL");
  }
  const local = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !(local && appEnv === "development")) {
    throw new SettingsError("SUPABASE_URL must use https (http only for localhost in development)");
  }
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "" || url.pathname !== "/") {
    throw new SettingsError(
      "SUPABASE_URL must be the project origin without a path, credentials, a query or a fragment",
    );
  }
  if (rawKey.startsWith("sb_secret_")) {
    throw new SettingsError("SUPABASE_PUBLISHABLE_KEY must be the publishable key, not a secret key");
  }
  if (!/^sb_publishable_[A-Za-z0-9_-]{8,200}$/.test(rawKey)) {
    throw new SettingsError("SUPABASE_PUBLISHABLE_KEY must look like sb_publishable_...");
  }
  return { url: url.origin, publishableKey: new Secret(rawKey) };
}

/** 켜진 추적 변수의 이름(없으면 null). 비었거나 false(대소문자 무관)만 꺼짐으로 본다. */
export function tracingSwitchOn(env: Readonly<Record<string, unknown>>): string | null {
  for (const name of TRACING_SWITCH_NAMES) {
    const raw = env[name];
    if (raw === undefined || raw === null) continue;
    const value = String(raw).trim().toLowerCase();
    if (value === "" || value === "false") continue;
    return name;
  }
  return null;
}

/**
 * 지금 프로세스 환경(process.env)에서 켜진 추적 변수. LangChain이 읽는 곳이라 모델 호출 직전에 한 번 더 본다(ai-model.ts).
 * 설정을 읽는 곳은 이 모듈 하나라는 규칙대로 여기에 둔다.
 */
export function tracingSwitchInProcess(): string | null {
  const env = (globalThis as { process?: { env?: Record<string, unknown> } }).process?.env;
  return env === undefined ? null : tracingSwitchOn(env);
}

function checkTracing(env: Readonly<Record<string, unknown>>, appEnv: AppEnv): void {
  if (appEnv !== "production") return;
  const on = tracingSwitchOn(env);
  // 값은 메시지에 싣지 않는다(이름과 조건만).
  if (on !== null) throw new SettingsError(`${on} must be unset or false in production (REQ-138)`);
  for (const name of TRACING_KEY_NAMES) {
    const raw = env[name];
    if (typeof raw === "string" && raw.trim() !== "") {
      throw new SettingsError(`${name} must not be set in production (REQ-138)`);
    }
  }
}

function readAi(
  env: Readonly<Record<string, unknown>>,
  secrets: Readonly<Record<SecretName, Secret | null>>,
): AiSettings | null {
  const value = (name: (typeof AI_VAR_NAMES)[number]): string => {
    const raw = env[name];
    return typeof raw === "string" ? raw.trim() : "";
  };
  if (AI_VAR_NAMES.every((name) => value(name) === "")) return null;
  // 값은 메시지에 싣지 않는다(이름과 조건만).
  const provider = value("AI_PROVIDER");
  if (!(AI_PROVIDERS as readonly string[]).includes(provider)) {
    throw new SettingsError("AI_PROVIDER must be anthropic or openai");
  }
  const chosen = provider as AiProvider;
  const model = value("AI_MODEL");
  if (priceOf(chosen, model) === undefined) {
    throw new SettingsError("AI_MODEL must be a model of AI_PROVIDER in the price table (ai-prices.ts)");
  }
  const effort = value("AI_EFFORT");
  if (effort !== "" && !(AI_EFFORTS as readonly string[]).includes(effort)) {
    throw new SettingsError("AI_EFFORT must be low, medium or high (or unset)");
  }
  const rate = value("AI_USD_KRW");
  if (!/^[1-9][0-9]{0,4}(\.[0-9]{1,2})?$/.test(rate)) {
    throw new SettingsError("AI_USD_KRW must be the KRW per USD rate like 1450.25");
  }
  const date = value("AI_USD_KRW_DATE");
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  if (parsed === null || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new SettingsError("AI_USD_KRW_DATE must be the rate date as YYYY-MM-DD");
  }
  return {
    provider: chosen,
    model,
    effort: effort === "" ? null : (effort as AiEffort),
    fx: { rate, date },
    apiKey: chosen === "anthropic" ? secrets.ANTHROPIC_API_KEY : secrets.OPENAI_API_KEY,
  };
}

function readFieldKeys(env: Readonly<Record<string, unknown>>): FieldKeySettings | null {
  const keys = new Map<number, Secret>();
  let currentRaw: unknown;
  for (const name of Object.keys(env)) {
    if (!name.startsWith("FIELD_KEY_")) continue;
    if (name === "FIELD_KEY_CURRENT") {
      currentRaw = env[name];
      continue;
    }
    const m = FIELD_KEY_NAME.exec(name);
    // 버전 꼴이 아닌 이름(V0·V01·V1000·오타)은 조용히 넘기지 않는다(키를 넣었는데 쓰이지 않는 일을 막음).
    if (m === null)
      throw new SettingsError("FIELD_KEY_ names must be FIELD_KEY_CURRENT or FIELD_KEY_V1 ~ FIELD_KEY_V999");
    const raw = env[name];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value === "") continue;
    // 값은 메시지에 싣지 않는다(이름과 조건만).
    if (!FIELD_KEY_VALUE.test(value)) {
      throw new SettingsError(`${name} must be 32 random bytes in base64url (43 characters)`);
    }
    keys.set(Number(m[1]), new Secret(value));
  }
  const current = typeof currentRaw === "string" ? currentRaw.trim() : "";
  if (current === "" && keys.size === 0) return null;
  if (!/^[1-9][0-9]{0,2}$/.test(current)) {
    throw new SettingsError("FIELD_KEY_CURRENT must be set to a version from 1 to 999 when FIELD_KEY_V<n> is set");
  }
  const version = Number(current);
  if (!keys.has(version))
    throw new SettingsError(`FIELD_KEY_CURRENT is ${version} but FIELD_KEY_V${version} is not set`);
  return { current: version, keys };
}

function readStorage(env: Readonly<Record<string, unknown>>, appEnv: AppEnv): StorageSettings | null {
  const values = STORAGE_VAR_NAMES.map((name) => {
    const raw = env[name];
    return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
  });
  if (values.every((v) => v === null)) return null;
  const [endpoint, region, bucket] = values;
  if (!endpoint || !region || !bucket) {
    throw new SettingsError("STORAGE_ENDPOINT, STORAGE_REGION and STORAGE_BUCKET must be set together");
  }
  return validateStorageSettings({ endpoint, region, bucket }, appEnv);
}

/** 저장소 공통 검사. 보조 Worker도 운영과 같은 HTTPS/이름 규칙으로 확인한다. */
export function validateStorageSettings(storage: StorageSettings, appEnv: AppEnv): StorageSettings {
  const { endpoint, region, bucket } = storage;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new SettingsError("STORAGE_ENDPOINT must be a URL");
  }
  const local = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !(local && appEnv === "development")) {
    throw new SettingsError("STORAGE_ENDPOINT must use https (http only for localhost in development)");
  }
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new SettingsError("STORAGE_ENDPOINT must not carry credentials, a query or a fragment");
  }
  if (!/^[a-z0-9-]{1,50}$/.test(region)) throw new SettingsError("STORAGE_REGION must look like ap-northeast-2");
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(bucket)) throw new SettingsError("STORAGE_BUCKET has an unexpected shape");
  return { endpoint: `${url.origin}${url.pathname.replace(/\/+$/, "")}`, region, bucket };
}
