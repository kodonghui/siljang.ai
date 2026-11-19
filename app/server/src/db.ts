/**
 * 데이터베이스 연결 층(TASK-018). 업무 코드는 pg를 직접 부르지 않고 이 모듈의 Queryable·RequestDb만 받는다
 * (tech-stack.md 4-3의 1: 어댑터 층만 실행 환경을 안다).
 * - 드라이버는 node-postgres(pg). Cloudflare Hyperdrive 안내가 권하는 드라이버이고 tech-stack.md가 고른 것(app/README.md 14).
 * - 요청마다 Client 하나를 처음 쿼리 때 맺고 요청이 끝나면 닫는다(Hyperdrive 안내: 연결 풀은 Hyperdrive가 맡고
 *   요청마다 새 Client를 만든다). 연결 문자열은 settings.ts가 Hyperdrive 바인딩 또는 DATABASE_URL에서 읽는다.
 * - 트랜잭션은 BEGIN~COMMIT 한 번(Hyperdrive의 트랜잭션 풀링과 맞음). SET·세션 advisory lock·LISTEN은 쓰지 않는다.
 * - 시각은 timestamptz로만 저장하고 JS Date(절대 시각)로 받는다. date와 시간대 없는 timestamp는 글 그대로 받는다
 *   (pg 기본은 date를 서버 프로세스 시간대의 자정 Date로 바꿔 하루가 밀릴 수 있음, 04 G8).
 */
import { Client, DatabaseError, types as pgTypes, type TypeParser } from "pg";
import type { Secret } from "./settings";

export interface Rows<R> {
  readonly rows: R[];
  readonly rowCount: number;
}

/** 쿼리를 보내는 쪽. 트랜잭션 안(tx)과 밖이 같은 꼴이다. 값은 늘 $1·$2 자리표로 넘긴다. */
export interface Queryable {
  query<R = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<Rows<R>>;
}

/** 요청 하나의 데이터베이스 연결. 처음 쿼리 때 맺고 close()로 닫는다. */
export interface RequestDb extends Queryable {
  /** fn이 끝나면 COMMIT, 던지면 ROLLBACK하고 다시 던진다. 트랜잭션 안에서는 바깥 query()를 부르지 못한다. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** 요청마다 RequestDb를 만든다(연결은 처음 쿼리 때). */
export type DbConnector = (url: Secret | null) => RequestDb;

/** DATABASE_URL이 없음. 응답은 internal(500)이고 로그에는 이름만 남는다. */
export class DbUnavailableError extends Error {
  override readonly name = "DbUnavailableError";
}

/** 트랜잭션 안에서 다른 트랜잭션이나 바깥 query()를 부름(코드의 잘못). */
export class TransactionMisuseError extends Error {
  override readonly name = "TransactionMisuseError";
}

const DATE_OID = 1082;
const TIMESTAMP_OID = 1114;
const identity: TypeParser = (value) => value;

/** pg의 값 바꾸기. date·timestamp(시간대 없음)는 글 그대로, 나머지는 pg 기본. */
export const typeParsers = {
  getTypeParser(oid: number, format?: "text" | "binary"): TypeParser {
    if (oid === DATE_OID || oid === TIMESTAMP_OID) return identity;
    return pgTypes.getTypeParser(oid, format);
  },
};

/** PostgreSQL 오류면 SQLSTATE를, 아니면 undefined. 메시지·detail은 꺼내지 않는다(넣은 값이 섞일 수 있음, G6). */
export function sqlStateOf(err: unknown): string | undefined {
  if (err instanceof DatabaseError && typeof err.code === "string" && /^[0-9A-Z]{5}$/.test(err.code)) {
    return err.code;
  }
  return undefined;
}

async function run<R>(client: Client, sql: string, params?: readonly unknown[]): Promise<Rows<R>> {
  const r = await client.query<R>(sql, params);
  return { rows: r.rows, rowCount: r.rowCount ?? 0 };
}

class PgRequestDb implements RequestDb {
  readonly #url: Secret | null;
  #client: Promise<Client> | null = null;
  #inTransaction = false;

  constructor(url: Secret | null) {
    this.#url = url;
  }

  #connect(): Promise<Client> {
    if (this.#client === null) {
      const url = this.#url;
      this.#client = (async () => {
        if (url === null) throw new DbUnavailableError("DATABASE_URL is not set");
        const client = new Client({
          connectionString: url.reveal(),
          types: typeParsers,
          application_name: "siljang-api",
          connectionTimeoutMillis: 5000,
        });
        // 연결이 끊기면 pg가 'error'를 낸다. 받지 않으면 Node에서 프로세스가 멈추므로 받고, 다음 쿼리가 실패로 알린다.
        client.on("error", () => {});
        await client.connect();
        return client;
      })();
      // 연결에 실패한 약속을 다시 쓰지 않게 비운다(다음 쿼리가 다시 맺음).
      this.#client.catch(() => {
        this.#client = null;
      });
    }
    return this.#client;
  }

  async query<R = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<Rows<R>> {
    if (this.#inTransaction) throw new TransactionMisuseError("query outside the open transaction");
    return run<R>(await this.#connect(), sql, params);
  }

  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    if (this.#inTransaction) throw new TransactionMisuseError("nested transaction");
    // 연결을 기다리기 전에 표시한다. 기다리는 사이에 다른 transaction()·query()가 같은 연결의 같은 트랜잭션에
    // 끼어들지 않게 하고, 연결에 실패하면 표시를 거둔다.
    this.#inTransaction = true;
    let client: Client;
    try {
      client = await this.#connect();
    } catch (e) {
      this.#inTransaction = false;
      throw e;
    }
    let open = true;
    const tx: Queryable = {
      query: <R = Record<string, unknown>>(sql: string, params?: readonly unknown[]) => {
        if (!open) return Promise.reject(new TransactionMisuseError("transaction already ended"));
        return run<R>(client, sql, params);
      },
    };
    try {
      await run(client, "BEGIN");
      const result = await fn(tx);
      await run(client, "COMMIT");
      return result;
    } catch (e) {
      try {
        await run(client, "ROLLBACK");
      } catch {
        // 연결이 끊겼으면 서버가 트랜잭션을 되돌린다.
      }
      throw e;
    } finally {
      open = false;
      this.#inTransaction = false;
    }
  }

  async close(): Promise<void> {
    const pending = this.#client;
    this.#client = null;
    if (pending === null) return;
    try {
      const client = await pending;
      await client.end();
    } catch {
      // 맺지 못했거나 이미 끊긴 연결.
    }
  }
}

/** 기본 연결기: pg Client 하나를 요청마다. */
export const pgConnector: DbConnector = (url) => new PgRequestDb(url);
