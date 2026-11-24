import { sqlStateOf } from "./db";

/** 오류 내용 대신 로그에서 분류할 이름만 돌려준다. PostgreSQL의 실제 name은 error일 수 있다. */
export function errorNameOf(error: unknown): string {
  return errorFields(error).errorName;
}

/** SQLSTATE와 분류 이름만 반환한다. 오류의 내용과 스택은 읽지 않는다. */
export function errorFields(error: unknown): { readonly errorName: string; readonly dbCode?: string } {
  const dbCode = sqlStateOf(error);
  return {
    errorName: dbCode !== undefined ? "DatabaseError" : error instanceof Error ? error.name : "Error",
    ...(dbCode === undefined ? {} : { dbCode }),
  };
}
