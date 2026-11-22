import { type Context, Hono } from "hono";
import { type DbConnector, pgConnector, type RequestDb, sqlStateOf } from "./db";
import { FILE_ROUTE, serveFile } from "./file-url";
import { SKILL_WORK_MS } from "./kakao-callback";
import type { KakaoCallbackQueue } from "./kakao-callback-store";
import { kakaoReply } from "./kakao-reply";
import { kakaoSkillRoutes } from "./kakao-skill";
import { type AuthorizedKakaoSkill, resolveKakaoSkillScope } from "./kakao-skill-auth";
import { type LogFields, type LogLevel, type LogSink, log } from "./log";
import { AuthUnavailableError } from "./operator-auth";
import { createOperatorSession, deleteOperatorSession, getOperatorMe, resolveOperatorSession } from "./operator-login";
import {
  createOwnerLogin,
  deleteOwnerLogin,
  getOwnerMe,
  resolveOwnerSession,
  resolveOwnerShop,
  startOwnerLogin,
} from "./owner-login";
import type { OwnerScope } from "./owner-scope";
import type { ImageBinding } from "./photo-normalizer";
import { ApiError, problemResponse } from "./problem";
import type { RateLimitBinding } from "./rate-limit";
import {
  mountRoutes,
  type OperatorResolver,
  type OwnerResolver,
  openRoute,
  operatorRoute,
  ownerRoute,
  type RouteDecl,
  type ScopeResolvers,
  shopRoute,
} from "./routes";
import { createServices, type ServiceOverrides, type Services } from "./services";
import { readSettings, type Settings } from "./settings";
import { getShop, registerShop } from "./shops";
import { StorageUnavailableError } from "./storage";
import { newTraceId } from "./trace";
import { createUpload } from "./uploads";

/** Worker의 env. 업무 코드는 이것을 직접 읽지 않고 settings.ts의 readSettings()를 거친다. */
export type Bindings = {
  readonly APP_ENV?: string;
  readonly ANTHROPIC_API_KEY?: string;
  readonly OPENAI_API_KEY?: string;
  readonly DATABASE_URL?: string;
  readonly HYPERDRIVE?: { readonly connectionString: string };
  readonly IMAGES?: ImageBinding;
  readonly REQUEST_HASH_KEY?: string;
  readonly STORAGE_ACCESS_KEY_ID?: string;
  readonly STORAGE_SECRET_ACCESS_KEY?: string;
  readonly FILE_URL_KEY?: string;
  readonly STORAGE_ENDPOINT?: string;
  readonly STORAGE_REGION?: string;
  readonly STORAGE_BUCKET?: string;
  /** 계좌번호·원래 값 암호화(TASK-025, settings.ts의 FieldKeySettings): 지금 버전과 버전마다의 키. */
  readonly FIELD_KEY_CURRENT?: string;
  readonly [fieldKey: `FIELD_KEY_V${number}`]: string | undefined;
  /** 운영자 인증 서비스(TASK-021, settings.ts의 OperatorAuthSettings): Supabase 프로젝트 주소와 publishable 키. */
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_PUBLISHABLE_KEY?: string;
  /** 사진 올리기의 1분 30번(wrangler.jsonc의 ratelimits, rate-limit.ts의 UPLOAD_RATE). */
  readonly UPLOAD_RATE_LIMITER?: RateLimitBinding;
  readonly KAKAO_CALLBACK_QUEUE?: KakaoCallbackQueue;
  readonly OWNER_LOGIN_RATE_LIMITER?: RateLimitBinding;
  readonly KAKAO_REST_API_KEY?: string;
  readonly KAKAO_CLIENT_SECRET?: string;
  readonly KAKAO_ADMIN_KEY?: string;
  readonly KAKAO_OWNER_REDIRECT_URIS?: string;
  readonly KAKAO_ALERT_CHANNEL_ID?: string;
};

export type Logger = (level: LogLevel, fields: LogFields) => void;

interface Variables {
  traceId: string;
  settings: Settings;
  /** 요청 하나의 데이터베이스 연결(처음 쿼리 때 맺고 응답 뒤 닫음, db.ts). */
  db: RequestDb;
  /** 이 앱의 로그(createApp의 logSink로 감). 업무 코드는 console을 쓰지 않는다. */
  log: Logger;
  /** 지금 시각·사진 저장소·한도·서명 주소(services.ts). */
  services: Services;
  kakaoSkill?: AuthorizedKakaoSkill;
  kakaoSkillReceivedAt?: Date;
  kakaoSkillTimedOut?: boolean;
  ownerScope?: OwnerScope;
}

export type HonoEnv = { Bindings: Bindings; Variables: Variables };

export interface AppOptions {
  readonly logSink?: LogSink;
  /** 데이터베이스 연결기. 기본은 settings의 DATABASE_URL로 pg Client 하나(요청마다). */
  readonly connect?: DbConnector;
  /** 붙일 경로 선언. 기본은 APP_ROUTES. 시험만 시험용 경로를 더한다. */
  readonly routes?: readonly RouteDecl[];
  /** 가게 범위 해석기. 없는 출처의 가게 범위 경로는 닫혀 있다(routes.ts). 사장님 세션은 TASK-020부터. */
  readonly scopes?: Partial<ScopeResolvers>;
  /** 사장님 범위 해석기. 없으면 사장님 범위 경로는 닫혀 있다(401, routes.ts). 사장님 세션은 TASK-020부터. */
  readonly ownerAccount?: OwnerResolver;
  /** 운영자 범위 해석기. 기본은 운영자 세션(operator-login.ts의 resolveOperatorSession, TASK-021). 시험만 바꾼다. */
  readonly operatorAccount?: OperatorResolver;
  /** 바깥 서비스를 바꾼다(시험만: 메모리 저장소·메모리 한도·정한 시각). */
  readonly services?: ServiceOverrides;
  /** 시험에서만 짧게 한다. 카카오 전체 응답 기한에서 250ms 여유를 남긴다. */
  readonly kakaoSkillTimeoutMs?: number;
}

/**
 * 앱의 경로 선언(routes.ts). 새 API는 여기에 선언을 더하고, 가게 범위 경로는 교차 가게 시험 묶음
 * (test/support/cross-shop.ts의 CROSS_SHOP_CASES)에도 더한다. 빠지면 시험이 실패한다(TASK-019).
 */
export const APP_ROUTES: readonly RouteDecl[] = [
  ...kakaoSkillRoutes,
  openRoute(
    "POST",
    "/owner/session/authorization",
    "사장님 로그인 시작(API-078): 세션 전의 state·PKCE와 시작 쿠키만 만들고 기록을 저장하지 않음",
    startOwnerLogin,
  ),
  openRoute(
    "POST",
    "/owner/session",
    "사장님 로그인(API-001): 세션을 만들기 전. 카카오 인증 뒤 계정과 세션을 만들고 그 사장님의 가게 요약만 읽음",
    createOwnerLogin,
  ),
  ownerRoute("GET", "/owner/me", getOwnerMe),
  openRoute(
    "DELETE",
    "/owner/session",
    "사장님 로그아웃(API-003): 세션이 없어도 204. 자기 세션만 끝내고 쿠키를 지움",
    deleteOwnerLogin,
  ),
  // 기반 시설용 확인 주소(06 계약 밖). 1분 외부 감시(TASK-016)가 부른다. 데이터베이스는 보지 않는다.
  openRoute("GET", "/healthz", "기반 시설 확인 주소(06 계약 밖, TASK-016 감시). 데이터베이스를 보지 않음", (c) =>
    c.json({ status: "ok" }, 200, { "cache-control": "no-store" }),
  ),
  // 06 API-004·005·006 운영자 로그인·로그인한 운영자·로그아웃(TASK-021, operator-login.ts).
  openRoute(
    "POST",
    "/operator/session",
    "운영자 로그인(06 API-004): 세션이 생기기 전. 운영자 표·세션 표·로그인 실패 표만 쓰고 가게 테이블은 보지 않음",
    createOperatorSession,
  ),
  openRoute(
    "DELETE",
    "/operator/session",
    "운영자 로그아웃(06 API-006): 세션이 없어도 204. 세션 표만 쓰고 가게 테이블은 보지 않음",
    deleteOperatorSession,
  ),
  operatorRoute("GET", "/operator/me", getOperatorMe),
  // 06 API-007 사진 올리기(TASK-022). 가게가 정해지기 전에도 쓰므로(가게 등록의 신고증) 사장님 범위 경로다.
  ownerRoute("POST", "/owner/uploads", createUpload),
  ownerRoute("POST", "/owner/shop", registerShop),
  shopRoute("GET", "/owner/shop", "owner", getShop),
  openRoute(
    "GET",
    FILE_ROUTE,
    "사진의 15분 서명 주소(06 DEC-09, 계약 밖, TASK-022). 주소의 서명이 권한이라 세션·가게를 보지 않음. 저장소만 읽고 데이터베이스는 보지 않음",
    serveFile,
  ),
];

function pathOf(url: string): string {
  return new URL(url).pathname;
}

/** Worker에서는 응답 뒤에 끝내고(waitUntil), 실행 맥락이 없는 시험(Node)에서는 기다린다. */
async function afterResponse(c: Context<HonoEnv>, work: Promise<void>): Promise<void> {
  let ctx: { waitUntil(p: Promise<unknown>): void } | undefined;
  try {
    ctx = c.executionCtx;
  } catch {
    ctx = undefined;
  }
  if (ctx !== undefined) ctx.waitUntil(work);
  else await work;
}

/** 경로 꼴(/api/owner/orders/:orderId)을 정규식으로. :이름은 한 단계, *는 아무것. */
function routePattern(path: string): RegExp {
  const parts = path.split("/").map((seg) => {
    if (seg === "*") return ".*";
    if (seg.startsWith(":")) return "[^/]+";
    return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  });
  return new RegExp(`^${parts.join("/")}/?$`);
}

/**
 * API 앱. 모든 경로는 /api 아래다(같은 주소의 화면 경로 /owner/…와 겹치지 않게).
 * 06 계약의 경로(/owner/session 등)는 /api 뒤에 그대로 붙는다. 계약의 servers 주소는 TASK-016에서 정한다.
 * 공통 처리(TASK-018): 추적 ID, 설정, 요청마다 데이터베이스 연결, 06 Problem 오류 응답(04 G6: 내부 내용 없음),
 * 계약에 없는 방법은 405와 Allow(06 DEC-02). 요청 키는 쓰기 명령이 request-key.ts의 runCommand로 지킨다.
 * 가게별 기록 나누기(TASK-019): 경로는 routes.ts의 선언으로만 붙고, 가게 범위 경로의 처리기는 가게 범위 연결(shop-scope.ts)만 받는다.
 * 사진 올리기(TASK-022): 가게가 정해지기 전에도 여는 사장님 범위 경로(ownerRoute, 해석기 ownerAccount가 없으면 401)와,
 * 요청마다 쓰는 바깥 서비스(services.ts의 시계·저장소·한도·서명 주소. 시험은 options.services로 바꿈)를 둔다.
 * 운영자 로그인(TASK-021): 운영자 범위 경로(operatorRoute)의 해석기는 운영자 세션(operator-login.ts). 시험은 operatorAccount로 바꿈.
 */
export function createApp(options: AppOptions = {}): Hono<HonoEnv> {
  const skillTimeoutMs = options.kakaoSkillTimeoutMs ?? SKILL_WORK_MS;
  if (!Number.isSafeInteger(skillTimeoutMs) || skillTimeoutMs < 1 || skillTimeoutMs > SKILL_WORK_MS) {
    throw new RangeError("kakaoSkillTimeoutMs must be between 1 and 3750");
  }
  const sink = options.logSink;
  const connect = options.connect ?? pgConnector;
  const appLog: Logger = (level, fields) => log(level, fields, sink);
  const app = new Hono<HonoEnv>().basePath("/api");
  let startLogged = false;

  app.use("*", async (c, next) => {
    c.set("traceId", newTraceId());
    c.set("log", appLog);
    const settings = readSettings(c.env ?? {});
    c.set("settings", settings);
    c.set("services", createServices(c.env ?? {}, settings, options.services));
    if (!startLogged) {
      // Worker에는 따로 시작 단계가 없어, 이 앱의 첫 요청에서 한 번 남긴다. 빠진 비밀 값은 이름만.
      startLogged = true;
      appLog("info", { event: "settings_loaded", names: settings.missingSecrets });
    }
    const db = connect(settings.secrets.DATABASE_URL);
    c.set("db", db);
    const skillKind =
      c.req.method === "POST"
        ? /^\/api\/kakao\/skills\/(message|card|review|event)\/?$/.exec(c.req.path)?.[1]
        : undefined;
    const skillRequest = skillKind !== undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!skillRequest) {
        await next();
        return;
      }
      c.set("kakaoSkillReceivedAt", c.get("services").now());
      const running = next();
      const deadline = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          c.set("kakaoSkillTimedOut", true);
          // 인증 전에는 가게 응답을 주지 않는다. 안내 스킬도500으로 발송을 막는다(DEC-20).
          c.res =
            c.get("kakaoSkill") && skillKind !== "event"
              ? kakaoReply(
                  { json: (body, status = 200, headers) => c.json(body as object, status, headers) },
                  "server_error",
                )
              : problemResponse("internal", c.get("traceId"), pathOf(c.req.url));
          appLog("error", { event: "kakao_skill_timeout", traceId: c.get("traceId"), status: c.res.status });
          // 중단 표시는 즉시 세우되 연결 닫기를 응답 앞에서 기다리지 않는다.
          // 늦은 처리·거절된 약속은 관찰하며 Worker에서는 waitUntil로 끝까지 정리한다.
          void afterResponse(
            c,
            Promise.allSettled([running, db.abort()]).then(() => {}),
          );
          resolve();
        }, skillTimeoutMs);
      });
      await Promise.race([running, deadline]);
    } finally {
      clearTimeout(timer);
      if (!c.get("kakaoSkillTimedOut")) await afterResponse(c, db.close());
    }
  });

  // 경로는 모두 선언으로 붙인다(가게 범위 경로는 가게 범위 연결만 받음, TASK-019).
  mountRoutes(
    app,
    options.routes ?? APP_ROUTES,
    { owner: resolveOwnerShop, customer: resolveKakaoSkillScope, ...options.scopes },
    options.ownerAccount ?? resolveOwnerSession,
    options.operatorAccount ?? resolveOperatorSession,
  );

  app.notFound((c) => {
    const traceId = c.get("traceId") ?? newTraceId();
    const path = pathOf(c.req.url);
    // 경로는 있지만 방법이 없으면 405와 Allow(06 DEC-02). 없는 경로는 404(있는지 알리지 않음).
    const methods = new Set<string>();
    for (const r of app.routes) {
      if (r.method === "ALL" || r.path.includes("*")) continue;
      if (routePattern(r.path).test(path)) methods.add(r.method);
    }
    if (methods.size > 0) {
      return problemResponse("method_not_allowed", traceId, path, { allow: [...methods].sort() });
    }
    return problemResponse("not_found", traceId, path);
  });

  app.onError((err, c) => {
    // 기한 뒤의 DB 거절·처리 오류가 이미 정한 시간 초과 응답을 덮지 않는다.
    if (c.get("kakaoSkillTimedOut")) return c.res;
    const traceId = c.get("traceId") ?? newTraceId();
    const instance = pathOf(c.req.url);
    if (err instanceof ApiError) {
      try {
        const res = problemResponse(err.code, traceId, instance, err.extras);
        appLog(res.status >= 500 ? "error" : "info", {
          event: "api_error",
          traceId,
          status: res.status,
          code: err.code,
        });
        return res;
      } catch (shapeErr) {
        // 계약에 맞지 않는 오류 응답을 만들려 함(코드의 잘못). 그대로 내보내지 않고 internal.
        const name = shapeErr instanceof Error ? shapeErr.name : "Error";
        appLog("error", { event: "unhandled_error", traceId, errorName: name, status: 500, code: err.code });
        return problemResponse("internal", traceId, instance);
      }
    }
    if (err instanceof AuthUnavailableError) {
      // 운영자 인증 서비스가 답하지 않음(06 auth_unavailable). 주소·응답 내용은 싣지 않고 이유와 상태 코드만.
      appLog("error", { event: "api_error", traceId, errorName: err.name, status: 503, code: "auth_unavailable" });
      return problemResponse("auth_unavailable", traceId, instance);
    }
    if (err instanceof StorageUnavailableError) {
      // 사진 저장소가 답하지 않거나 오류(06 storage_unavailable). 저장 위치·응답 내용은 싣지 않고 이름만.
      appLog("error", { event: "api_error", traceId, errorName: err.name, status: 503, code: "storage_unavailable" });
      return problemResponse("storage_unavailable", traceId, instance);
    }
    // 예상하지 못한 오류: 내용(메시지·스택·SQL·넣은 값)은 응답에도 로그에도 싣지 않는다(04 G6). 이름과 SQLSTATE만.
    const dbCode = sqlStateOf(err);
    appLog("error", {
      event: "unhandled_error",
      traceId,
      errorName: dbCode !== undefined ? "DatabaseError" : err.name,
      status: 500,
      ...(dbCode !== undefined ? { dbCode } : {}),
    });
    return problemResponse("internal", traceId, instance);
  });

  return app;
}
