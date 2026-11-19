/**
 * 요청마다 쓰는 바깥 서비스(TASK-022): 지금 시각, 사진 저장소, 요청 빈도 한도, 사진 서명 주소.
 * TASK-025: 계좌번호·원래 값 암호화(field-crypto.ts).
 * TASK-026: 모델 호출 모듈(ai-model.ts). 설정(AI_PROVIDER 등)이 없으면 MissingSettingError.
 * TASK-021: 운영자 인증 서비스(operator-auth.ts). 설정(SUPABASE_URL·SUPABASE_PUBLISHABLE_KEY)이 없으면 MissingSettingError.
 *   로그인 실패 응답을 늦추는 기다림(wait)도 여기서 받는다(시험은 기다리지 않고 기록만).
 * 업무 코드는 Workers 바인딩과 설정 값을 직접 읽지 않고 이것을 받는다(tech-stack.md 4-3의 1). 시험은 AppOptions.services로
 * 메모리 저장소·메모리 한도·정한 시각을 넣는다.
 * 설정이 빠졌으면 그것을 쓰는 요청만 500 internal(MissingSettingError, 로그에는 이름만).
 */
import { type AiModel, createAiModel } from "./ai-model";
import type { Bindings } from "./app";
import { type FieldCrypto, fieldCrypto } from "./field-crypto";
import { type FileUrls, fileUrlSigner } from "./file-url";
import type { KakaoCallbackQueue } from "./kakao-callback-store";
import { type OperatorAuth, supabaseAuth } from "./operator-auth";
import { bindingLimiter, type RateLimiter, type RateLimitRule } from "./rate-limit";
import { MissingSettingError } from "./request-key";
import type { Settings } from "./settings";
import { type ObjectStore, S3Store } from "./storage";

export interface Services {
  now(): Date;
  /** 사진 저장소. 설정(STORAGE_*)이 없으면 MissingSettingError. */
  storage(): ObjectStore;
  /** rule의 한도. Workers 바인딩이 없으면 MissingSettingError. */
  limiter(rule: RateLimitRule): RateLimiter;
  /** 사진 서명 주소. FILE_URL_KEY가 없으면 MissingSettingError. */
  fileUrls(): FileUrls;
  /** 계좌번호·원래 값 암호화. FIELD_KEY_CURRENT·FIELD_KEY_V<n>이 없으면 MissingSettingError. */
  fieldCrypto(): FieldCrypto;
  /** 배포 설정으로 고른 회사·모델의 호출 모듈. AI_PROVIDER 등이 없으면 MissingSettingError. */
  aiModel(): AiModel;
  /** 운영자 인증 서비스(Supabase Auth). SUPABASE_URL·SUPABASE_PUBLISHABLE_KEY가 없으면 MissingSettingError. */
  operatorAuth(): OperatorAuth;
  /** ms 밀리초 기다린다(운영자 로그인 실패 응답의 최소 시간, operator-login.ts). */
  wait(ms: number): Promise<void>;
  readonly kakaoCallbackQueue: KakaoCallbackQueue | undefined;
}

/** 시험이 바꾸는 것. */
export interface ServiceOverrides {
  readonly now?: () => Date;
  readonly storage?: ObjectStore;
  readonly limiters?: { readonly [B in RateLimitRule["binding"]]?: RateLimiter };
  readonly fieldCrypto?: FieldCrypto;
  readonly aiModel?: AiModel;
  readonly operatorAuth?: OperatorAuth;
  readonly wait?: (ms: number) => Promise<void>;
  readonly kakaoCallbackQueue?: KakaoCallbackQueue;
}

export function createServices(env: Bindings, settings: Settings, overrides: ServiceOverrides = {}): Services {
  let store: ObjectStore | undefined = overrides.storage;
  let urls: FileUrls | undefined;
  let fields: FieldCrypto | undefined = overrides.fieldCrypto;
  let ai: AiModel | undefined = overrides.aiModel;
  let auth: OperatorAuth | undefined = overrides.operatorAuth;
  return {
    now: overrides.now ?? (() => new Date()),
    kakaoCallbackQueue: overrides.kakaoCallbackQueue ?? env.KAKAO_CALLBACK_QUEUE,
    storage() {
      if (store !== undefined) return store;
      const s = settings.storage;
      const id = settings.secrets.STORAGE_ACCESS_KEY_ID;
      const secret = settings.secrets.STORAGE_SECRET_ACCESS_KEY;
      if (s === null || id === null || secret === null) throw new MissingSettingError("storage is not set");
      store = new S3Store({ ...s, accessKeyId: id.reveal(), secretAccessKey: secret.reveal() });
      return store;
    },
    limiter(rule) {
      const override = overrides.limiters?.[rule.binding];
      if (override !== undefined) return override;
      const binding = env[rule.binding];
      if (binding === undefined) throw new MissingSettingError(`${rule.binding} is not bound`);
      return bindingLimiter(binding);
    },
    fileUrls() {
      if (urls !== undefined) return urls;
      const key = settings.secrets.FILE_URL_KEY;
      if (key === null) throw new MissingSettingError("FILE_URL_KEY is not set");
      urls = fileUrlSigner(key);
      return urls;
    },
    fieldCrypto() {
      if (fields !== undefined) return fields;
      if (settings.fieldKeys === null)
        throw new MissingSettingError("FIELD_KEY_CURRENT and FIELD_KEY_V<n> are not set");
      fields = fieldCrypto(settings.fieldKeys);
      return fields;
    },
    aiModel() {
      if (ai !== undefined) return ai;
      if (settings.ai === null) throw new MissingSettingError("AI_PROVIDER and AI_MODEL are not set");
      ai = createAiModel(settings.appEnv, settings.ai, overrides.now ? { now: overrides.now } : {});
      return ai;
    },
    operatorAuth() {
      if (auth !== undefined) return auth;
      if (settings.operatorAuth === null) {
        throw new MissingSettingError("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are not set");
      }
      auth = supabaseAuth(settings.operatorAuth);
      return auth;
    },
    wait: overrides.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  };
}
