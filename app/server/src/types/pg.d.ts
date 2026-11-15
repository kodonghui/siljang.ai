/**
 * node-postgres(pg)에서 이 서버가 쓰는 만큼만 적은 형식.
 * @types/pg는 Node 형식(@types/node)을 끌어와, Workers 런타임 형식만 보는 src의 타입 검사와 섞이므로 쓰지 않는다
 * (app/README.md 설계 메모 8). 쓰는 API를 늘리면 여기에 더한다.
 */
declare module "pg" {
  export type TypeParser = (value: string) => unknown;

  export interface CustomTypes {
    getTypeParser(oid: number, format?: "text" | "binary"): TypeParser;
  }

  export interface ClientConfig {
    connectionString?: string;
    types?: CustomTypes;
    application_name?: string;
    connectionTimeoutMillis?: number;
    query_timeout?: number;
  }

  export interface QueryResult<R> {
    rows: R[];
    rowCount: number | null;
  }

  export class Client {
    constructor(config?: ClientConfig);
    connect(): Promise<void>;
    query<R = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<R>>;
    end(): Promise<void>;
    on(event: "error", listener: (err: Error) => void): this;
  }

  /** 서버가 보낸 오류. code는 SQLSTATE. message·detail에는 넣은 값이 들어갈 수 있어 응답·로그에 싣지 않는다. */
  export class DatabaseError extends Error {
    code: string | undefined;
  }

  export const types: CustomTypes;
}
