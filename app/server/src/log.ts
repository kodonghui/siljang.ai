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
}

export type LogSink = (line: string) => void;

const defaultSink: LogSink = (line) => {
  console.log(line);
};

export function log(level: LogLevel, fields: LogFields, sink: LogSink = defaultSink): void {
  const line: Record<string, unknown> = { level, event: fields.event };
  if (fields.traceId !== undefined) line.traceId = fields.traceId;
  if (fields.errorName !== undefined) line.errorName = fields.errorName;
  if (fields.names !== undefined) line.names = [...fields.names];
  if (fields.status !== undefined) line.status = fields.status;
  sink(JSON.stringify(line));
}
