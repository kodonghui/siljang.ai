/**
 * Workers의 scheduled 처리기(어댑터 층, TASK-023). Cron Trigger가 부르면 설정을 읽고 연결 하나를 맺어 실행기(job-runner.ts)를
 * 한 번 돌린다. 업무 코드는 env·ctx·Cron을 직접 부르지 않는다(tech-stack.md 180행).
 * - 기준 시각은 이벤트의 scheduledTime(그 분의 시각)이다. SQL은 now() 대신 이 시각을 쓴다.
 * - 1분 Cron Trigger는 Wrangler의 staging 환경에서 바인딩한다(TASK-173). 시험은 가짜 이벤트로 부른다.
 * - 실패는 ID만 실은 로그로 남기고 던지지 않는다(다음 분에 다시 돎).
 */
import type { Bindings } from "./app";
import { type DbConnector, pgConnector } from "./db";
import { type RunLimits, type RunnableJob, type RunSummary, runDueJobs } from "./job-runner";
import { runnableJobs } from "./jobs";
import { recoverExpiredKakaoCallbacks } from "./kakao-callback-queue";
import { type LogFields, type LogLevel, type LogSink, log } from "./log";
import { createServices } from "./services";
import { readSettings, type Settings } from "./settings";
import type { ObjectStore } from "./storage";

/** Workers ScheduledController에서 쓰는 것. */
export interface ScheduledEventLike {
  readonly scheduledTime: number;
  readonly cron: string;
}

/** Workers ExecutionContext에서 쓰는 것. */
export interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

export interface ScheduledOptions {
  /** 데이터베이스 연결기. 기본은 settings의 DATABASE_URL로 pg Client 하나(실행마다). */
  readonly connect?: DbConnector;
  /** 돌릴 일. 기본은 등록부의 처리가 붙은 일(jobs.ts의 runnableJobs). */
  readonly jobs?: readonly RunnableJob[];
  readonly logSink?: LogSink;
  readonly limits?: Partial<RunLimits>;
  /** 걸린 시간을 재는 시계(시험만). */
  readonly clock?: () => number;
  /** 시험용 저장소. 실제 실행은 settings의 S3 연결을 늦게 만든다. */
  readonly storage?: ObjectStore;
}

function nameOf(err: unknown): string {
  return err instanceof Error ? err.name : "Error";
}

/** 실행기를 한 번 돈다. 설정이 틀렸거나 실행기가 던지면 로그를 남기고 null. */
export async function runScheduled(
  event: ScheduledEventLike,
  env: Readonly<Record<string, unknown>>,
  options: ScheduledOptions = {},
): Promise<RunSummary | null> {
  const appLog = (level: LogLevel, fields: LogFields) => log(level, fields, options.logSink);
  const now = new Date(event.scheduledTime);
  if (Number.isNaN(now.getTime())) {
    appLog("error", { event: "job_run_failed", errorName: "RangeError" });
    return null;
  }
  let settings: Settings;
  try {
    settings = readSettings(env);
  } catch (err) {
    appLog("error", { event: "job_run_failed", errorName: nameOf(err) });
    return null;
  }
  const db = (options.connect ?? pgConnector)(settings.secrets.DATABASE_URL);
  const services = createServices(env as Bindings, settings, options.storage ? { storage: options.storage } : {});
  try {
    return await runDueJobs({
      db,
      now,
      jobs: options.jobs ?? runnableJobs(),
      log: appLog,
      storage: () => services.storage(),
      ...(options.limits !== undefined ? { limits: options.limits } : {}),
      ...(options.clock !== undefined ? { clock: options.clock } : {}),
    });
  } catch (err) {
    appLog("error", { event: "job_run_failed", errorName: nameOf(err) });
    return null;
  } finally {
    try {
      if (settings.secrets.DATABASE_URL !== null) {
        await recoverExpiredKakaoCallbacks(db, now, {
          ...(options.logSink === undefined ? {} : { logSink: options.logSink }),
        });
      }
    } catch (err) {
      appLog("error", { event: "job_run_failed", job: "kakao_callback_recovery", errorName: nameOf(err) });
    } finally {
      await db.close();
    }
  }
}

/** Workers의 scheduled 처리기를 만든다. 실행기는 ctx.waitUntil로 끝까지 돈다(Cloudflare 문서의 꼴). */
export function createScheduledHandler(
  options: ScheduledOptions = {},
): (event: ScheduledEventLike, env: Bindings, ctx: WaitUntil) => void {
  return (event, env, ctx) => {
    ctx.waitUntil(runScheduled(event, env ?? {}, options));
  };
}
