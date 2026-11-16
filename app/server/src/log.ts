/**
 * 서버 로그는 이 모듈로만 쓴다. 한 줄에 JSON 하나이고, 정해 둔 필드만 싣는다.
 * 오류의 메시지·요청 본문·헤더·설정 값은 싣지 않는다(손님 값과 비밀 값이 섞일 수 있음, 06 G6·REQ-135).
 */

export type LogLevel = "info" | "warn" | "error";

export interface LogFields {
  readonly event: string;
  readonly traceId?: string;
  readonly errorName?: string;
  readonly names?: readonly string[];
  readonly status?: number;
  /** 06 오류 코드(problem.ts의 ERRORS 이름)나 명령의 결과 종류. 넣은 값이 아님. */
  readonly code?: string;
  /** PostgreSQL 오류의 SQLSTATE(다섯 글자). 오류 메시지·detail·제약 이름은 싣지 않는다. */
  readonly dbCode?: string;
  /** 서버 안의 일의 이름(jobs.ts 등록부, 소문자·숫자·_). TASK-023. */
  readonly job?: string;
  /** 서버 안의 일이 다룬 행의 ID(uuid). 행의 내용은 싣지 않는다(tech-stack.md의 '큐 메시지와 로그에는 ID만'). */
  readonly itemId?: string;
  /** 건수(0 이상 정수). 실행기의 찾음·끝냄·실패 수 따위. */
  readonly count?: number;
  /** 06 API 번호(API-000 꼴). 접속기록을 남기지 못한 API(TASK-024, access-log.ts). */
  readonly api?: string;
}

export type LogSink = (line: string) => void;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const defaultSink: LogSink = (line) => {
  console.log(line);
};

export function log(level: LogLevel, fields: LogFields, sink: LogSink = defaultSink): void {
  const line: Record<string, unknown> = { level, event: fields.event };
  if (fields.traceId !== undefined) line.traceId = fields.traceId;
  if (fields.errorName !== undefined && /^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(fields.errorName)) {
    line.errorName = fields.errorName;
  }
  if (fields.names !== undefined) line.names = [...fields.names];
  if (fields.status !== undefined) line.status = fields.status;
  // 이름 꼴이 아닌 값은 싣지 않는다(실수로 넣은 값이 섞이지 않게).
  if (fields.code !== undefined && /^[a-z][a-z0-9_]{0,59}$/.test(fields.code)) line.code = fields.code;
  if (fields.dbCode !== undefined && /^[0-9A-Z]{5}$/.test(fields.dbCode)) line.dbCode = fields.dbCode;
  if (fields.job !== undefined && /^[a-z][a-z0-9_]{0,59}$/.test(fields.job)) line.job = fields.job;
  if (fields.itemId !== undefined && UUID.test(fields.itemId)) line.itemId = fields.itemId;
  if (fields.count !== undefined && Number.isSafeInteger(fields.count) && fields.count >= 0) line.count = fields.count;
  if (fields.api !== undefined && /^API-[0-9]{3}$/.test(fields.api)) line.api = fields.api;
  sink(JSON.stringify(line));
}
