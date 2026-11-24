import { sqlStateOf } from "./db";

/** 오류 내용 대신 로그에서 분류할 이름만 돌려준다. PostgreSQL의 실제 name은 error일 수 있다. */
export function errorNameOf(error: unknown): string {
  if (sqlStateOf(error) !== undefined) return "DatabaseError";
  return error instanceof Error ? error.name : "Error";
}
