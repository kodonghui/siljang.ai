import type { Queryable } from "./db";

/** TASK-158의 24시간 요청 키 지우기. 실패 시험부터 작성 중이며 아직 실행기에 연결하지 않는다. */
export async function purgeExpiredRequestKeys(_db: Queryable, _now: Date, _limit = 100): Promise<number> {
  return 0;
}
