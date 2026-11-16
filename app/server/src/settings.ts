/**
 * 설정을 읽는 곳은 이 모듈 하나다(11단계 계약, tech-stack.md 4-3의 1·6).
 * - 업무 코드는 Worker의 env를 직접 읽지 않고 readSettings()의 결과를 받는다.
 * - 비밀 값은 Secret으로 감싸, 글·JSON·로그로 바꾸면 가린 꼴만 나온다. 값은 클라이언트를 만드는 곳에서만 reveal()로 꺼낸다.
 * - 실행 환경 이름이 없으면 production으로 친다. development는 개발자의 .dev.vars만 정한다.
 */

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
 * - DATABASE_URL: PostgreSQL 연결 문자열(로컬·CI). Workers에서는 TASK-173이 Hyperdrive 바인딩으로 바꾼다.
 * - REQUEST_HASH_KEY: 요청 지문(request_keys.request_hash, 06 DEC-04)을 만드는 HMAC-SHA256 키. 32자 이상.
 * - STORAGE_ACCESS_KEY_ID·STORAGE_SECRET_ACCESS_KEY: 사진 저장소(Supabase Storage의 S3 호환 주소)의 S3 접근 키(TASK-022,
 *   storage.ts). Supabase의 publishable·secret 키가 아니다(TASK-174).
 * - FILE_URL_KEY: 사진의 15분 서명 주소(file-url.ts)의 키를 뽑는 비밀 값. 32자 이상.
 */
export const SECRET_NAMES = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "DATABASE_URL",
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

export interface Settings {
  readonly appEnv: AppEnv;
  readonly secrets: Readonly<Record<SecretName, Secret | null>>;
  /** 값이 없는 비밀 값의 이름. 시작 로그에는 이 이름만 남긴다. */
  readonly missingSecrets: readonly SecretName[];
  /** 사진 저장소의 주소. 세 변수가 모두 없으면 null(저장소가 필요한 요청만 500 internal). */
  readonly storage: StorageSettings | null;
  /** 계좌번호·원래 값 암호화의 키. 하나도 없으면 null(암호화가 필요한 요청만 500 internal). */
  readonly fieldKeys: FieldKeySettings | null;
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

/** Worker의 env(바인딩·변수·비밀 값)에서 설정을 읽는다. */
export function readSettings(env: Readonly<Record<string, unknown>>): Settings {
  const appEnv = readAppEnv(env.APP_ENV);
  const secrets = {} as Record<SecretName, Secret | null>;
  const missingSecrets: SecretName[] = [];
  for (const name of SECRET_NAMES) {
    const raw = env[name];
    if (typeof raw === "string" && raw.trim() !== "") {
      secrets[name] = new Secret(raw.trim());
    } else {
      secrets[name] = null;
      missingSecrets.push(name);
    }
  }
  // 값은 메시지에 싣지 않는다(이름과 조건만).
  const db = secrets.DATABASE_URL?.reveal();
  if (db !== undefined && !/^postgres(ql)?:\/\//.test(db)) {
    throw new SettingsError("DATABASE_URL must start with postgres:// or postgresql://");
  }
  for (const name of ["REQUEST_HASH_KEY", "FILE_URL_KEY"] as const) {
    const key = secrets[name]?.reveal();
    if (key !== undefined && key.length < MIN_HASH_KEY_LENGTH) {
      throw new SettingsError(`${name} must be at least ${MIN_HASH_KEY_LENGTH} characters`);
    }
  }
  return { appEnv, secrets, missingSecrets, storage: readStorage(env, appEnv), fieldKeys: readFieldKeys(env) };
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
