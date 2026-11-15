import { Hono } from "hono";
import { type LogSink, log } from "./log";
import { problemResponse } from "./problem";
import { readSettings, type Settings } from "./settings";
import { newTraceId } from "./trace";

/** Worker의 env. 업무 코드는 이것을 직접 읽지 않고 settings.ts의 readSettings()를 거친다. */
export type Bindings = {
  readonly APP_ENV?: string;
  readonly ANTHROPIC_API_KEY?: string;
  readonly OPENAI_API_KEY?: string;
};

interface Variables {
  traceId: string;
  settings: Settings;
}

export type HonoEnv = { Bindings: Bindings; Variables: Variables };

export interface AppOptions {
  readonly logSink?: LogSink;
}

function pathOf(url: string): string {
  return new URL(url).pathname;
}

/**
 * API 앱. 모든 경로는 /api 아래다(같은 주소의 화면 경로 /owner/…와 겹치지 않게).
 * 06 계약의 경로(/owner/session 등)는 /api 뒤에 그대로 붙는다. 계약의 servers 주소는 TASK-016에서 정한다.
 */
export function createApp(options: AppOptions = {}): Hono<HonoEnv> {
  const sink = options.logSink;
  const app = new Hono<HonoEnv>().basePath("/api");
  let startLogged = false;

  app.use("*", async (c, next) => {
    c.set("traceId", newTraceId());
    const settings = readSettings(c.env ?? {});
    c.set("settings", settings);
    if (!startLogged) {
      // Worker에는 따로 시작 단계가 없어, 이 앱의 첫 요청에서 한 번 남긴다. 빠진 비밀 값은 이름만.
      startLogged = true;
      log("info", { event: "settings_loaded", names: settings.missingSecrets }, sink);
    }
    await next();
  });

  // 기반 시설용 확인 주소(06 계약 밖). 1분 외부 감시(TASK-016)가 부른다. 데이터베이스는 보지 않는다.
  app.get("/healthz", (c) => c.json({ status: "ok" }, 200, { "cache-control": "no-store" }));

  app.notFound((c) => problemResponse("not_found", c.get("traceId") ?? newTraceId(), pathOf(c.req.url)));

  app.onError((err, c) => {
    const traceId = c.get("traceId") ?? newTraceId();
    log("error", { event: "unhandled_error", traceId, errorName: err.name, status: 500 }, sink);
    return problemResponse("internal", traceId, pathOf(c.req.url));
  });

  return app;
}
