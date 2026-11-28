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
import { type AiModel, type AiModelOptions, createAiModel } from "./ai-model";
import type { Bindings } from "./app";
import type { ConfirmCardCommand } from "./confirm-card-store";
import { type FieldCrypto, fieldCrypto } from "./field-crypto";
import { type FileUrls, fileUrlSigner } from "./file-url";
import type { KakaoCallbackQueue } from "./kakao-callback-store";
import { type KakaoEvents, type KakaoOwnerEvents, kakaoEvents, kakaoOwnerEvents } from "./kakao-event";
import { deriveKakaoProofPhrase, deriveKakaoSkillKey } from "./kakao-skill-auth";
import { type LedgerAuthorizationService, ledgerAuthorizationService } from "./ledger-authorization";
import { type GoogleLedgerOAuth, googleLedgerOAuth } from "./ledger-google-auth";
import { ledgerSheetSetup } from "./ledger-sheet-setup";
import { type OperatorAuth, supabaseAuth } from "./operator-auth";
import { kakaoOwnerAuth, type OwnerAuth } from "./owner-auth";
import { type ImageBinding, type PhotoNormalizer, photoNormalizer } from "./photo-normalizer";
import type { PrivacyPolicySettings } from "./privacy-policy-settings";
import { bindingLimiter, type RateLimiter, type RateLimitRule } from "./rate-limit";
import { MissingSettingError } from "./request-key";
import type { Settings } from "./settings";
import { type ObjectStore, S3Store } from "./storage";
import { batchS3Store } from "./storage-batch";

export interface Services {
  readonly confirmCardCommand: ConfirmCardCommand | undefined;
  now(): Date;
  readonly privacyPolicy: PrivacyPolicySettings | null;
  readonly publicAppOrigin: string | null;
  /** 사진 저장소. 설정(STORAGE_*)이 없으면 MissingSettingError. */
  storage(): ObjectStore;
  /** G10 사진 정리. 회전할 WebP에만 Images 바인딩을 요구한다. */
  photos(): PhotoNormalizer;
  /** rule의 한도. Workers 바인딩이 없으면 MissingSettingError. */
  limiter(rule: RateLimitRule): RateLimiter;
  /** 사진 서명 주소. FILE_URL_KEY가 없으면 MissingSettingError. */
  fileUrls(): FileUrls;
  /** 계좌번호·원래 값 암호화. FIELD_KEY_CURRENT·FIELD_KEY_V<n>이 없으면 MissingSettingError. */
  fieldCrypto(): FieldCrypto;
  kakaoSkillKey(connectionId: string, version: number): Promise<string>;
  kakaoProofPhrase(connectionId: string, startedAt: Date): Promise<string>;
  /** 배포 설정으로 고른 회사·모델의 호출 모듈. AI_PROVIDER 등이 없으면 MissingSettingError. */
  aiModel(options?: Pick<AiModelOptions, "totalTimeoutMs">): AiModel;
  /** 회사/모델과 선택 회사 키의 존재. 실제 업무 처리기의 준비 여부나 호출 성공이 아니다. */
  readonly aiConfigured: boolean;
  readonly aiProviderConfigured: boolean;
  /** 카카오 공통 Event API. 가져오는 것만으로 발신하지 않으며 우리 앱의 REST 키를 쓴다. */
  kakaoEvents(): KakaoEvents;
  kakaoOwnerEvents(): KakaoOwnerEvents;
  /** 운영자 인증 서비스(Supabase Auth). SUPABASE_URL·SUPABASE_PUBLISHABLE_KEY가 없으면 MissingSettingError. */
  operatorAuth(): OperatorAuth;
  ownerAuth(): OwnerAuth;
  ledgerAuthorization(): LedgerAuthorizationService;
  ledgerGoogle(): GoogleLedgerOAuth;
  ledgerSetup(): ReturnType<typeof ledgerSheetSetup>;
  /** ms 밀리초 기다린다(운영자 로그인 실패 응답의 최소 시간, operator-login.ts). */
  wait(ms: number): Promise<void>;
  readonly kakaoCallbackQueue: KakaoCallbackQueue | undefined;
}

/** 시험이 바꾸는 것. */
export interface ServiceOverrides {
  readonly confirmCardCommand?: ConfirmCardCommand | undefined;
  readonly now?: () => Date;
  readonly privacyPolicy?: PrivacyPolicySettings | null;
  readonly publicAppOrigin?: string | null;
  readonly storage?: ObjectStore;
  readonly images?: ImageBinding;
  readonly limiters?: { readonly [B in RateLimitRule["binding"]]?: RateLimiter };
  readonly fieldCrypto?: FieldCrypto;
  readonly aiModel?: AiModel;
  readonly kakaoEvents?: KakaoEvents;
  readonly kakaoOwnerEvents?: KakaoOwnerEvents;
  readonly operatorAuth?: OperatorAuth;
  readonly ownerAuth?: OwnerAuth;
  readonly ledgerAuthorization?: LedgerAuthorizationService;
  readonly ledgerGoogle?: GoogleLedgerOAuth;
  readonly ledgerSetup?: ReturnType<typeof ledgerSheetSetup>;
  readonly wait?: (ms: number) => Promise<void>;
  readonly kakaoCallbackQueue?: KakaoCallbackQueue;
}

export function createServices(env: Bindings, settings: Settings, overrides: ServiceOverrides = {}): Services {
  function channelSecret() {
    const secret = settings.secrets.REQUEST_HASH_KEY;
    if (secret === null) throw new MissingSettingError("REQUEST_HASH_KEY is not set");
    return secret;
  }
  function kakaoRestKey() {
    const key = settings.ownerAuth?.clientId;
    if (key === undefined) throw new MissingSettingError("KAKAO_REST_API_KEY is not set");
    return key;
  }
  let store: ObjectStore | undefined = overrides.storage;
  let photos: PhotoNormalizer | undefined;
  let urls: FileUrls | undefined;
  let fields: FieldCrypto | undefined = overrides.fieldCrypto;
  let ai: AiModel | undefined = overrides.aiModel;
  let events: KakaoEvents | undefined = overrides.kakaoEvents;
  let ownerEvents: KakaoOwnerEvents | undefined = overrides.kakaoOwnerEvents;
  let auth: OperatorAuth | undefined = overrides.operatorAuth;
  let ownerAuth: OwnerAuth | undefined = overrides.ownerAuth;
  let ledgerAuth: LedgerAuthorizationService | undefined = overrides.ledgerAuthorization;
  let ledgerGoogle = overrides.ledgerGoogle;
  let ledgerSetup = overrides.ledgerSetup;
  return {
    now: overrides.now ?? (() => new Date()),
    publicAppOrigin: overrides.publicAppOrigin === undefined ? settings.publicAppOrigin : overrides.publicAppOrigin,
    privacyPolicy: overrides.privacyPolicy === undefined ? settings.privacyPolicy : overrides.privacyPolicy,
    aiProviderConfigured: overrides.privacyPolicy !== undefined || settings.ai !== null,
    aiConfigured: overrides.aiModel !== undefined || (settings.ai !== null && settings.ai.apiKey !== null),
    kakaoCallbackQueue: overrides.kakaoCallbackQueue ?? env.KAKAO_CALLBACK_QUEUE,
    confirmCardCommand: overrides.confirmCardCommand,
    kakaoSkillKey: (id, version) => deriveKakaoSkillKey(channelSecret(), id, version),
    kakaoProofPhrase: (id, at) => deriveKakaoProofPhrase(channelSecret(), id, at),
    storage() {
      if (store !== undefined) return store;
      const s = settings.storage;
      const id = settings.secrets.STORAGE_ACCESS_KEY_ID;
      const secret = settings.secrets.STORAGE_SECRET_ACCESS_KEY;
      if (s === null || id === null || secret === null) throw new MissingSettingError("storage is not set");
      const config = { ...s, accessKeyId: id.reveal(), secretAccessKey: secret.reveal() };
      if (env.STORAGE_BATCHES && config.endpoint.startsWith("https:"))
        store = batchS3Store(config, env.STORAGE_BATCHES);
      else if (settings.appEnv === "development") store = new S3Store(config);
      else throw new MissingSettingError("STORAGE_BATCHES is not bound");
      return store;
    },
    photos() {
      photos ??= photoNormalizer(() => {
        const images = overrides.images ?? env.IMAGES;
        if (images === undefined) throw new MissingSettingError("IMAGES is not bound");
        return images;
      });
      return photos;
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
    aiModel(options = {}) {
      if (ai !== undefined) return ai;
      if (settings.ai === null) throw new MissingSettingError("AI_PROVIDER and AI_MODEL are not set");
      ai = createAiModel(settings.appEnv, settings.ai, {
        ...options,
        ...(overrides.now ? { now: overrides.now } : {}),
      });
      return ai;
    },
    kakaoEvents() {
      if (events !== undefined) return events;
      events = kakaoEvents(kakaoRestKey());
      return events;
    },
    kakaoOwnerEvents() {
      if (ownerEvents !== undefined) return ownerEvents;
      ownerEvents = kakaoOwnerEvents(kakaoRestKey());
      return ownerEvents;
    },
    operatorAuth() {
      if (auth !== undefined) return auth;
      if (settings.operatorAuth === null) {
        throw new MissingSettingError("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are not set");
      }
      auth = supabaseAuth(settings.operatorAuth);
      return auth;
    },
    ownerAuth() {
      if (ownerAuth !== undefined) return ownerAuth;
      if (settings.ownerAuth === null) throw new MissingSettingError("KAKAO owner login settings are not set");
      ownerAuth = kakaoOwnerAuth(settings.ownerAuth);
      return ownerAuth;
    },
    ledgerAuthorization() {
      if (ledgerAuth !== undefined) return ledgerAuth;
      if (settings.ledgerOAuth === null) throw new MissingSettingError("Google ledger settings are not set");
      ledgerAuth = ledgerAuthorizationService(channelSecret(), settings.ledgerOAuth);
      return ledgerAuth;
    },
    ledgerGoogle() {
      if (ledgerGoogle !== undefined) return ledgerGoogle;
      if (settings.ledgerOAuth === null) throw new MissingSettingError("Google ledger settings are not set");
      ledgerGoogle = googleLedgerOAuth(settings.ledgerOAuth);
      return ledgerGoogle;
    },
    ledgerSetup() {
      if (ledgerSetup !== undefined) return ledgerSetup;
      ledgerSetup = ledgerSheetSetup(channelSecret());
      return ledgerSetup;
    },
    wait: overrides.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  };
}
