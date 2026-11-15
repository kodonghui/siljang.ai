/**
 * 가게 범위 접근 층(TASK-019; 04 SPEC-068·G1, 05 A9·E1, 06 DEC-02).
 *
 * - 가게 범위(ShopScope)는 이 요청이 읽고 쓸 수 있는 가게 하나다. 해석기(routes.ts의 ScopeResolver)만 만든다:
 *   로그인한 사장님의 가게(TASK-020), 카카오 채널로 찾은 가게(TASK-028), 운영자가 연 가게(TASK-021·159),
 *   예약 링크의 가게(TASK-044·045). createShopScope를 부를 수 있는 파일은 정적 시험이 정한 목록뿐이다.
 * - 가게 테이블(05 E1의 shop_id를 가진 54개와 가게 자체 shops)을 읽고 쓰는 길은 ShopDb 하나다. ShopDb는 $1에 가게 ID를
 *   스스로 채우고, SQL이 든 가게 테이블마다 가게 조건이 있는지 보내기 전에 본다(sql-scope.ts). 없으면 보내지 않고
 *   UnscopedQueryError(응답은 500 internal). ShopDb의 메서드 이름(run 등)은 Queryable(query)과 달라 서로 바꿔 넘길 수 없다.
 * - 경로의 ID: 형식이 틀리거나(uuid가 아님, 100자 넘는 것 포함) 없거나 다른 가게 것이면 모두 같은 404 not_found
 *   (06 DEC-02, G1). 가게 조건 때문에 다른 가게 행은 없는 행과 똑같이 0행이라 응답이 같다.
 * - 본문·쿼리의 ID: 없거나 다른 가게 것이면 같은 422 validation_failed와 그 필드의 reference_not_found(06 DEC-02).
 *   uuid 꼴이 아니면 bad_format(형식은 다른 가게와 무관). 올린 파일 ID(upload_not_found)는 TASK-022.
 * - 데이터베이스가 막는 것: 가게가 섞인 행(복합 외래 키, 05 E1, 쓰면 23503). 막지 않는 것: 다른 가게 행 읽기(05 A9).
 */
import type { Queryable, RequestDb, Rows } from "./db";
import { ApiError, type FieldError } from "./problem";
import type { Actor } from "./request-key";
import { type IdShopTable, SHOP_TABLES, SHOP_TABLES_WITHOUT_ID, scopeViolations } from "./sql-scope";

/** 가게 범위가 어디서 왔는지. 손님·운영자·예약 링크 쪽은 이 층의 바탕만 있고 경로는 그 작업에서 붙인다. */
export type ScopeVia =
  /** 로그인한 사장님의 가게(TASK-020 세션, 가게가 없으면 404 shop_not_registered는 TASK-032). */
  | { readonly kind: "owner"; readonly ownerId: string }
  /** 카카오 채널(봇 ID)로 찾은 가게(TASK-028). 손님 명령은 카카오 사용자 키로 가린다(G1, TASK-105 등). */
  | { readonly kind: "customer"; readonly channelId: string }
  /** 운영자가 연 가게(TASK-021 세션, TASK-159 화면). 손님·주문 기록은 가린 값으로만(SPEC-073). */
  | { readonly kind: "operator"; readonly operatorId: string }
  /** 예약 링크 주소의 가게(TASK-044·045). 읽기만. */
  | { readonly kind: "public" };

export type ScopeKind = ScopeVia["kind"];

const scopeBrand: unique symbol = Symbol("ShopScope");

/** 이 요청의 가게. createShopScope로만 만들고, 흉내 낸 객체는 ShopDb가 받지 않는다(ForgedScopeError). */
export interface ShopScope {
  readonly shopId: string;
  readonly via: ScopeVia;
  readonly [scopeBrand]: true;
}

const genuine = new WeakSet<object>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/**
 * 가게 범위를 만든다. 해석기만 부른다(정적 시험이 부르는 파일을 정함). shopId는 해석기가 데이터베이스에서 찾은 가게 ID다.
 */
export function createShopScope(shopId: string, via: ScopeVia): ShopScope {
  if (!isUuid(shopId)) throw new TypeError("shop id must be a uuid");
  const scope: ShopScope = Object.freeze({
    shopId: shopId.toLowerCase(),
    via: Object.freeze({ ...via }),
    [scopeBrand]: true as const,
  });
  genuine.add(scope);
  return scope;
}

export function isShopScope(value: unknown): value is ShopScope {
  return typeof value === "object" && value !== null && genuine.has(value);
}

/** 요청 키를 남길 누른 사람(06 DEC-04). 손님 명령은 카카오 요청·카드 키(TASK-028·081), 예약 링크는 명령이 없다. */
export function actorOf(scope: ShopScope): Actor {
  const via = scope.via;
  if (via.kind === "owner") return { kind: "owner", id: via.ownerId };
  if (via.kind === "operator") return { kind: "operator", id: via.operatorId };
  throw new TypeError(`no request-key actor for ${via.kind} scope`);
}

/** 가게 조건이 없는 SQL을 보내려 함(코드의 잘못). 응답은 500 internal, 로그에는 이름만. */
export class UnscopedQueryError extends Error {
  override readonly name = "UnscopedQueryError";
  readonly violations: readonly string[];

  constructor(violations: readonly string[]) {
    super(violations.join("; "));
    this.violations = violations;
  }
}

/** createShopScope로 만들지 않은 가게 범위(코드의 잘못). 응답은 500 internal. */
export class ForgedScopeError extends Error {
  override readonly name = "ForgedScopeError";
}

/** 본문·쿼리가 가리킨 기록 하나: 필드(JSON Pointer나 query:이름)와 받은 값. */
export interface ShopReference {
  readonly field: string;
  readonly id: unknown;
}

/** 가게 범위 연결. 모든 SQL의 $1은 이 가게 ID이고(이 층이 채움) 넘기는 값은 $2부터다. */
export interface ShopDb {
  readonly scope: ShopScope;
  /** 가게 조건을 지킨 SQL 하나(sql-scope.ts의 규칙). 어기면 보내지 않고 UnscopedQueryError. */
  run<R = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<Rows<R>>;
  /** run의 첫 행. 없으면 404 not_found(없는 것과 다른 가게 것을 가리지 않음, G1). */
  found<R = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<R>;
  /**
   * 경로의 ID가 이 가게의 table 행인지 보고 ID(소문자)를 돌려준다. 형식이 틀리거나 없거나 다른 가게 것이면 모두 404
   * not_found(06 DEC-02). lock이면 그 행을 FOR UPDATE로 잡는다(트랜잭션 안에서).
   */
  owned(table: IdShopTable, id: string | undefined, options?: { readonly lock?: boolean }): Promise<string>;
  /**
   * 본문·쿼리가 가리킨 ID들이 이 가게의 table 행인지 한 번에 본다. 없거나 다른 가게 것이면 그 필드마다 reference_not_found,
   * uuid 꼴이 아니면 bad_format으로 422 validation_failed(06 DEC-02). 쓰기 전에 부른다.
   */
  references(table: IdShopTable, refs: readonly ShopReference[]): Promise<void>;
}

/** 요청 하나의 가게 범위 연결. 트랜잭션도 가게 범위 연결로만 받는다. */
export interface ShopRequestDb extends ShopDb {
  transaction<T>(fn: (tx: ShopDb) => Promise<T>): Promise<T>;
}

const ID_TABLES = new Set<string>(
  SHOP_TABLES.filter((t) => !(SHOP_TABLES_WITHOUT_ID as readonly string[]).includes(t)),
);

/** 같은 SQL 글을 요청마다 다시 읽지 않게 검사 결과를 둔다(코드의 SQL은 몇 개뿐, 넘치면 비움). */
const checked = new Map<string, readonly string[]>();
const CHECKED_MAX = 1000;

export function assertScoped(sql: string): void {
  let violations = checked.get(sql);
  if (violations === undefined) {
    violations = scopeViolations(sql);
    if (checked.size >= CHECKED_MAX) checked.clear();
    checked.set(sql, violations);
  }
  if (violations.length > 0) throw new UnscopedQueryError(violations);
}

/** 경로의 ID(uuid). 형식이 틀리면 없는 ID와 같은 404 not_found(06 DEC-02). */
export function pathId(raw: string | undefined): string {
  if (!isUuid(raw)) throw new ApiError("not_found");
  return raw.toLowerCase();
}

function idTable(table: string): string {
  if (!ID_TABLES.has(table)) throw new TypeError("not a shop table with a uuid id");
  return table;
}

class ScopedDb implements ShopDb {
  readonly scope: ShopScope;
  readonly #q: Queryable;

  constructor(scope: ShopScope, q: Queryable) {
    if (!isShopScope(scope)) throw new ForgedScopeError("scope was not made by createShopScope");
    this.scope = scope;
    this.#q = q;
  }

  async run<R = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<Rows<R>> {
    assertScoped(sql);
    return this.#q.query<R>(sql, [this.scope.shopId, ...params]);
  }

  async found<R = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<R> {
    const r = await this.run<R>(sql, params);
    const row = r.rows[0];
    if (row === undefined) throw new ApiError("not_found");
    return row;
  }

  async owned(table: IdShopTable, raw: string | undefined, options: { readonly lock?: boolean } = {}): Promise<string> {
    const name = idTable(table);
    const id = pathId(raw);
    const lock = options.lock === true ? " FOR UPDATE" : "";
    await this.found(`SELECT t.id FROM ${name} t WHERE t.shop_id = $1 AND t.id = $2${lock}`, [id]);
    return id;
  }

  async references(table: IdShopTable, refs: readonly ShopReference[]): Promise<void> {
    const name = idTable(table);
    if (refs.length === 0) return;
    const ids = new Set<string>();
    for (const ref of refs) if (isUuid(ref.id)) ids.add(ref.id.toLowerCase());
    const present = new Set<string>();
    if (ids.size > 0) {
      const r = await this.run<{ id: string }>(
        `SELECT t.id FROM ${name} t WHERE t.shop_id = $1 AND t.id = ANY($2::uuid[])`,
        [[...ids]],
      );
      for (const row of r.rows) present.add(row.id);
    }
    const errors: FieldError[] = [];
    for (const ref of refs) {
      if (!isUuid(ref.id)) errors.push({ field: ref.field, code: "bad_format" });
      else if (!present.has(ref.id.toLowerCase())) errors.push({ field: ref.field, code: "reference_not_found" });
    }
    if (errors.length > 0) throw new ApiError("validation_failed", { errors: errors.slice(0, 50) });
  }
}

/** 날 연결(트랜잭션 안의 tx 포함)을 가게 범위 연결로 감싼다. 가게 범위는 createShopScope로 만든 것만. */
export function shopDb(scope: ShopScope, q: Queryable): ShopDb {
  return new ScopedDb(scope, q);
}

class ScopedRequestDb extends ScopedDb implements ShopRequestDb {
  readonly #db: RequestDb;

  constructor(scope: ShopScope, db: RequestDb) {
    super(scope, db);
    this.#db = db;
  }

  transaction<T>(fn: (tx: ShopDb) => Promise<T>): Promise<T> {
    return this.#db.transaction((tx) => fn(new ScopedDb(this.scope, tx)));
  }
}

/** 요청 하나의 연결을 가게 범위 연결로 감싼다. 트랜잭션 안에서도 가게 범위 연결만 준다. */
export function shopRequestDb(scope: ShopScope, db: RequestDb): ShopRequestDb {
  return new ScopedRequestDb(scope, db);
}
