/** 정기 삭제 자격 증명은 예약 처리기에서만 쓰고 공용 HTTP 연결로 대신 실행하지 않는다. */
import { type DbConnector, pgConnector, type RequestDb } from "./db";
import { dailyDue, JobConfigError, type RunnableJob } from "./job-runner";
import { MissingSettingError } from "./request-key";
import type { Settings } from "./settings";

export function jobDatabases(
  settings: Settings,
  regular: RequestDb,
  now: Date,
  windowMs: number,
  connect: DbConnector = pgConnector,
) {
  let purge: RequestDb | undefined;
  let checked = false;
  return {
    async forJob(job: RunnableJob): Promise<RequestDb> {
      if (job.name !== "purge") return regular;
      // 실행 시간 밖의 시작 기록 확인은 공용 연결의 종류/시각 읽기만 쓴다. 쓰기는 시작하지 않는다.
      if (job.every === "day" && !dailyDue(now, null, job.at, job.timeZone, windowMs)) return regular;
      const secret = settings.secrets.PURGE_DATABASE_URL;
      if (secret === null) throw new MissingSettingError("PURGE_DATABASE_URL is not set");
      purge ??= connect(secret);
      if (purge === regular) throw new JobConfigError("purge requires a separate connection");
      if (!checked) {
        const current = (await regular.query<{ role_name: string }>("SELECT current_user AS role_name")).rows[0];
        const target = (
          await purge.query<{
            role_name: string;
            rolsuper: boolean;
            rolcreatedb: boolean;
            rolcreaterole: boolean;
            rolbypassrls: boolean;
            rolinherit: boolean;
          }>(
            "SELECT r.rolname AS role_name,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolbypassrls,r.rolinherit FROM pg_roles r WHERE r.rolname=current_user",
          )
        ).rows[0];
        if (
          !current ||
          !target ||
          current.role_name === target.role_name ||
          target.rolsuper ||
          target.rolcreatedb ||
          target.rolcreaterole ||
          target.rolbypassrls ||
          target.rolinherit
        )
          throw new JobConfigError("purge requires a separate limited role");
        checked = true;
      }
      return purge;
    },
    async close() {
      if (purge !== undefined && purge !== regular) await purge.close();
    },
  };
}
