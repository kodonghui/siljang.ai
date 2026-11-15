import { type Context, Hono } from "hono";
import { type DbConnector, pgConnector, type RequestDb, sqlStateOf } from "./db";
import { type LogFields, type LogLevel, type LogSink, log } from "./log";
import { ApiError, problemResponse } from "./problem";
import { mountRoutes, openRoute, type RouteDecl, type ScopeResolvers } from "./routes";
import { readSettings, type Settings } from "./settings";
import { newTraceId } from "./trace";

/** Worker의 env. 업무 코드는 이것을 직접 읽지 않고 settings.ts의 readSettings()를 거친다. */
export type Bindings = {
  readonly APP_ENV?: string;
  readonly ANTHROPIC_API_KEY?: string;
  readonly OPENAI_API_KEY?: string;
  readonly DATABASE_URL?: string;
  readonly REQUEST_HASH_KEY?: string;
};

export type Logger = (level: LogLevel, fields: LogFields) => void;

interface Variables {
  traceId: string;
  settings: Settings;
  /** 요청 하나의 데이터베이스 연결(처음 쿼리 때 맺고 응답 뒤 닫음, db.ts). */
  db: RequestDb;
  /** 이 앱의 로그(createApp의 logSink로 감). 업무 코드는 console을 쓰지 않는다. */
  log: Logger;
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
}

/**
 * 앱의 경로 선언(routes.ts). 새 API는 여기에 선언을 더하고, 가게 범위 경로는 교차 가게 시험 묶음
 * (test/support/cross-shop.ts의 CROSS_SHOP_CASES)에도 더한다. 빠지면 시험이 실패한다(TASK-019).
 */
export const APP_ROUTES: readonly RouteDecl[] = [
  // 기반 시설용 확인 주소(06 계약 밖). 1분 외부 감시(TASK-016)가 부른다. 데이터베이스는 보지 않는다.
  openRoute("GET", "/healthz", "기반 시설 확인 주소(06 계약 밖, TASK-016 감시). 데이터베이스를 보지 않음", (c) =>
    c.json({ status: "ok" }, 200, { "cache-control": "no-store" }),
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
 */
export function createApp(options: AppOptions = {}): Hono<HonoEnv> {
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
    if (!startLogged) {
      // Worker에는 따로 시작 단계가 없어, 이 앱의 첫 요청에서 한 번 남긴다. 빠진 비밀 값은 이름만.
      startLogged = true;
      appLog("info", { event: "settings_loaded", names: settings.missingSecrets });
    }
    const db = connect(settings.secrets.DATABASE_URL);
    c.set("db", db);
    try {
      await next();
    } finally {
      await afterResponse(c, db.close());
    }
  });

  // 경로는 모두 선언으로 붙인다(가게 범위 경로는 가게 범위 연결만 받음, TASK-019).
  mountRoutes(app, options.routes ?? APP_ROUTES, options.scopes);

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
