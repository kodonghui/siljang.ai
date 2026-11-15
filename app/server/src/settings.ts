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

/** 서버가 읽는 비밀 값의 이름. 공급사 SDK가 읽는 이름을 그대로 쓴다. */
export const SECRET_NAMES = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

export interface Settings {
  readonly appEnv: AppEnv;
  readonly secrets: Readonly<Record<SecretName, Secret | null>>;
  /** 값이 없는 비밀 값의 이름. 시작 로그에는 이 이름만 남긴다. */
  readonly missingSecrets: readonly SecretName[];
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
  return { appEnv, secrets, missingSecrets };
}
