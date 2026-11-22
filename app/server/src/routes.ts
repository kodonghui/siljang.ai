/**
 * 경로 선언(TASK-019). 앱의 경로는 모두 이 선언으로 붙는다(app.ts의 APP_ROUTES). 시험이 라우터의 경로가 모두 선언됐는지,
 * 가게 범위 경로가 모두 교차 가게 시험 묶음(test/support/cross-shop.ts의 CROSS_SHOP_CASES)에 들었는지 본다.
 * - shopRoute: 가게 범위 경로. 처리기는 ShopRequest만 받는다. 날 데이터베이스 연결(RequestDb)과 Hono 맥락을 받지 않아
 *   가게 조건 없는 SQL을 보낼 길이 타입에 없다. 가게 범위는 경로마다 정한 출처의 해석기가 만든다. 해석기가 아직 없는
 *   출처의 경로는 닫혀 있다(사장님·운영자 401 unauthenticated, 손님 401 skill_key_invalid, 예약 링크 404).
 * - ownerRoute: 사장님 범위 경로(TASK-022). 사장님 세션은 있지만 가게가 정해지기 전이거나 가게 기록이 아닌 API(사진 올리기
 *   API-007 등). 처리기는 OwnerRequest만 받고 데이터베이스 연결이 없다. 사장님은 사장님 해석기(TASK-020)가 정하고, 없으면
 *   닫혀 있다(401 unauthenticated).
 * - operatorRoute: 운영자 범위 경로(TASK-021). 운영자 세션(쿠키 siljang_operator)은 있지만 가게 기록이 아닌 API(로그인한
 *   운영자 API-005 등). 처리기는 OperatorRequest만 받고 데이터베이스 연결이 없다. 운영자는 운영자 해석기(operator-login.ts의
 *   resolveOperatorSession)가 정하고, 운영자 세션이 아니면(사장님 세션 포함) 401 unauthenticated로 운영자 기록을 하나도
 *   보이지 않는다(04 SPEC-001 수락 기준 5, 06 DEC-11). 운영자가 여는 가게 기록은 가게 범위 경로(출처 operator, TASK-159).
 * - openRoute: 가게 범위도 사장님·운영자 범위도 아닌 경로(기반 시설, 로그인, 서명 주소). 왜 그런지 적는다.
 *   가게 테이블을 읽고 쓰지 않는다(정적 시험이 날 연결을 쥔 파일의 SQL을 봄).
 * - accessRoute: 접속기록을 남기는 가게 범위 경로(TASK-024, 06의 사장님 API-040~066과 운영자 API-074~077, SPEC-074).
 *   선언에 06 API 번호를 두고, 처리기는 AccessRequest만 받는다. 데이터베이스는 접속기록 한 행과 같은 트랜잭션의 읽기(read)와
 *   쓰기 명령(command)으로만 쓰고, 성공 응답인데 커밋된 접속기록이 없으면 500으로 닫는다(access-log.ts). 시험이 06의 접속기록
 *   API는 모두 이 선언으로, API 번호는 06의 (방법, 경로)와 같게 선언됐는지 본다.
 */
import type { Context, Hono, HonoRequest } from "hono";
import { ACCESS_LOG_APIS, type AccessEntry, AccessRecorder } from "./access-log";
import type { HonoEnv, Logger } from "./app";
import { readJsonBody } from "./body";
import type { AuthorizedKakaoSkill } from "./kakao-skill-auth";
import { isOperatorScope, type OperatorScope } from "./operator-scope";
import { type OperatorShopDirectory, operatorShopDirectory } from "./operator-shop-directory";
import { isOwnerScope, type OwnerScope } from "./owner-scope";
import { type OwnerShopDb, ownerShopDb } from "./owner-shop-db";
import { ApiError } from "./problem";
import { type CommandResult, runCommand, type StoredResult } from "./request-key";
import type { Services } from "./services";
import {
  actorOf,
  ForgedScopeError,
  isShopScope,
  pathId,
  type ScopeKind,
  type ShopDb,
  type ShopRequestDb,
  type ShopScope,
  shopDb,
  shopRequestDb,
} from "./shop-scope";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** 가게 범위의 쓰기 명령(요청 키, 06 DEC-04). 누른 사람은 가게 범위에서 온다. execute·render는 가게 범위 연결만 받는다. */
export interface ShopCommandSpec {
  /** 명령 이름: 06의 API ID. */
  readonly command: string;
  readonly pathIds: readonly string[];
  readonly body: unknown;
  execute(tx: ShopDb): Promise<CommandResult>;
  render(db: ShopDb, stored: StoredResult): Promise<unknown>;
}

/** 가게 범위 경로의 처리기가 받는 것. 데이터베이스는 가게 범위 연결뿐이다. */
export interface ShopRequest {
  readonly scope: ShopScope;
  /** 운영자가 연 가게의 중복 등록 표시만 읽는 기능. 사장님·손님은 받지 않는다. */
  readonly operatorShops: OperatorShopDirectory | undefined;
  readonly kakaoSkill: AuthorizedKakaoSkill | undefined;
  /** 트랜잭션 밖 읽기와 트랜잭션. 쓰기 명령은 command로. */
  readonly db: ShopRequestDb;
  /** 경로 값·쿼리·헤더(Hono의 요청). 본문은 body()로 읽는다. */
  readonly req: HonoRequest;
  readonly traceId: string;
  readonly log: Logger;
  /** 지금 시각·사진 저장소·한도·서명 주소(services.ts). */
  readonly services: Services;
  /** 경로의 ID(uuid). 형식이 틀리면 없는 ID와 같은 404(06 DEC-02). */
  pathId(name: string): string;
  /** 본문 JSON(body.ts, 한 번만). */
  body(): Promise<unknown>;
  json(body: unknown, status?: 200 | 201 | 202, headers?: Record<string, string>): Response;
  noContent(): Response;
  /** 요청 키를 지키며 쓰기 명령 하나(request-key.ts의 runCommand). */
  command(spec: ShopCommandSpec): Promise<Response>;
}

export interface ShopRouteDecl {
  readonly kind: "shop";
  readonly method: Method;
  /** /api 뒤의 경로(Hono 꼴, :이름). */
  readonly path: string;
  /** 가게 범위의 출처. */
  readonly via: ScopeKind;
  /** 접속기록을 남기지 않는 경로(AccessRouteDecl과 가름). */
  readonly access?: undefined;
  readonly handler: (r: ShopRequest) => Promise<Response>;
}

/** 접속기록을 남기는 읽기 하나의 결과: 응답 본문(200)과 그 본문이 담은 손님 ID들. */
export interface AccessRead {
  readonly body: unknown;
  readonly subjects: readonly string[];
}

/** 접속기록을 남기는 쓰기 명령(요청 키, 06 DEC-04). 명령 이름은 경로의 06 API 번호다. */
export interface AccessCommandSpec {
  readonly pathIds: readonly string[];
  readonly body: unknown;
  /** 명령의 일과 남길 접속기록(바꿈은 change, 원래 값·보관 기록 열기는 open_*). 접속기록과 한 트랜잭션. */
  execute(tx: ShopDb): Promise<{ readonly result: CommandResult; readonly access: AccessEntry }>;
  /**
   * 같은 키가 다시 왔을 때 처음 결과가 가리킨 기록을 지금 다시 읽은 본문과 남길 접속기록. 접속기록과 한 트랜잭션.
   * 다시 온 요청은 아무것도 바꾸지 않으므로 change는 받지 않는다(다시 읽으면 read, 다시 열면 open_*, 06 README 625행).
   */
  render(db: ShopDb, stored: StoredResult): Promise<{ readonly body: unknown; readonly access: AccessEntry }>;
}

/** 접속기록을 남기는 경로의 처리기가 받는 것. 데이터베이스는 read·command로만 쓴다(그 안에서 접속기록 한 행). */
export interface AccessRequest {
  readonly scope: ShopScope;
  /** 이 경로의 06 API 번호(접속기록의 api_id, 명령 이름). */
  readonly api: string;
  readonly req: HonoRequest;
  readonly traceId: string;
  readonly log: Logger;
  readonly services: Services;
  pathId(name: string): string;
  body(): Promise<unknown>;
  /** 읽기 하나: fn과 접속기록(read) 한 행을 한 트랜잭션에서 하고, 커밋된 뒤 200 응답. */
  read(fn: (tx: ShopDb) => Promise<AccessRead>): Promise<Response>;
  /** 요청 키를 지키며 쓰기 명령 하나: 처음 실행과 다시 보냄 모두 접속기록 한 행과 같은 트랜잭션. */
  command(spec: AccessCommandSpec): Promise<Response>;
}

export interface AccessRouteDecl {
  readonly kind: "shop";
  readonly method: Method;
  readonly path: string;
  readonly via: "owner" | "operator";
  /** 06 API 번호(ACCESS_LOG_APIS 안). */
  readonly access: string;
  readonly handler: (r: AccessRequest) => Promise<Response>;
}

/** 사장님 범위 경로의 처리기가 받는 것. 데이터베이스 연결이 없다(가게 기록은 가게 범위 경로로만). */
export interface OwnerRequest {
  readonly owner: OwnerScope;
  /** 경로 값·쿼리·헤더와 날 요청(raw). 사진 올리기만 본문을 raw로 읽는다(uploads.ts의 한도). */
  readonly req: HonoRequest;
  readonly traceId: string;
  readonly log: Logger;
  readonly services: Services;
  body(): Promise<unknown>;
  /** 등록 전 사장님도 쓰는 요청 키 명령. SQL 대신 자기 가게의 등록 기능만 받는다. */
  command(spec: OwnerCommandSpec): Promise<Response>;
  json(body: unknown, status?: 200 | 201 | 202): Response;
}

export interface OwnerCommandSpec {
  readonly command: string;
  readonly body: unknown;
  execute(db: OwnerShopDb): Promise<CommandResult>;
  render(db: OwnerShopDb, stored: StoredResult): Promise<unknown>;
  /** 실패 뒤 자기 가게 조회로 커밋 여부를 확인한 후 외부 복사본을 정리한다. */
  cleanup?(db: Pick<OwnerShopDb, "find">): Promise<void>;
}

export interface OwnerRouteDecl {
  readonly kind: "owner";
  readonly method: Method;
  readonly path: string;
  readonly handler: (r: OwnerRequest) => Promise<Response>;
}

/** 운영자 범위 경로의 처리기가 받는 것. 데이터베이스 연결이 없다(가게 기록은 가게 범위 경로로만). */
export interface OperatorRequest {
  readonly operator: OperatorScope;
  readonly shops: OperatorShopDirectory;
  readonly req: HonoRequest;
  readonly traceId: string;
  readonly log: Logger;
  readonly services: Services;
  json(body: unknown, status?: 200 | 201 | 202): Response;
}

export interface OperatorRouteDecl {
  readonly kind: "operator";
  readonly method: Method;
  readonly path: string;
  readonly handler: (r: OperatorRequest) => Promise<Response>;
}

export interface OpenRouteDecl {
  readonly kind: "open";
  readonly method: Method;
  readonly path: string;
  /** 왜 가게 범위가 아닌지(가게가 정해지기 전, 기반 시설 등). */
  readonly why: string;
  readonly handler: (c: Context<HonoEnv>) => Response | Promise<Response>;
}

export type RouteDecl = ShopRouteDecl | AccessRouteDecl | OwnerRouteDecl | OperatorRouteDecl | OpenRouteDecl;

export function shopRoute(
  method: Method,
  path: string,
  via: ScopeKind,
  handler: (r: ShopRequest) => Promise<Response>,
): ShopRouteDecl {
  return { kind: "shop", method, path, via, handler };
}

/**
 * 접속기록을 남기는 가게 범위 경로(TASK-024). api는 06 API 번호로 ACCESS_LOG_APIS 안이어야 하고, via는 그 API를 부르는 쪽
 * (사장님 API-040~066은 owner, 운영자 API-074~077은 operator)과 같아야 한다. 아니면 선언 때 멈춘다.
 */
export function accessRoute(
  method: Method,
  path: string,
  via: "owner" | "operator",
  api: string,
  handler: (r: AccessRequest) => Promise<Response>,
): AccessRouteDecl {
  const need = ACCESS_LOG_APIS.get(api);
  if (need === undefined) throw new TypeError(`${api} is not an access-logged API (06 SPEC-074)`);
  if (via !== need) throw new TypeError(`${api} is called by ${need}, not ${String(via)}`);
  return { kind: "shop", method, path, via, access: api, handler };
}

export function ownerRoute(
  method: Method,
  path: string,
  handler: (r: OwnerRequest) => Promise<Response>,
): OwnerRouteDecl {
  return { kind: "owner", method, path, handler };
}

export function operatorRoute(
  method: Method,
  path: string,
  handler: (r: OperatorRequest) => Promise<Response>,
): OperatorRouteDecl {
  return { kind: "operator", method, path, handler };
}

export function openRoute(
  method: Method,
  path: string,
  why: string,
  handler: (c: Context<HonoEnv>) => Response | Promise<Response>,
): OpenRouteDecl {
  if (why.trim() === "") throw new TypeError("an open route says why it is not shop-scoped");
  return { kind: "open", method, path, why, handler };
}

/** 선언 하나의 열쇠(방법과 /api 뒤 경로). 교차 가게 시험 묶음이 같은 열쇠로 등록한다. */
export function routeKey(method: string, path: string): string {
  return `${method} ${path}`;
}

/** 요청에서 가게 범위를 찾는다. 찾지 못하면 계약의 오류(ApiError)를 던진다. createShopScope로 만든 것만 받는다. */
export type ScopeResolver = (c: Context<HonoEnv>) => Promise<ShopScope>;
export type ScopeResolvers = { readonly [K in ScopeKind]: ScopeResolver };

/** 요청에서 로그인한 사장님을 찾는다. 찾지 못하면 401 unauthenticated(ApiError). createOwnerScope로 만든 것만 받는다. */
export type OwnerResolver = (c: Context<HonoEnv>) => Promise<OwnerScope>;

/** 사장님 세션 해석기가 아직 없음(TASK-020): 사장님 범위 경로는 닫혀 있다. */
const CLOSED_OWNER: OwnerResolver = () => Promise.reject(new ApiError("unauthenticated"));

/** 요청에서 로그인한 운영자를 찾는다. 찾지 못하면 401 unauthenticated(ApiError). createOperatorScope로 만든 것만 받는다. */
export type OperatorResolver = (c: Context<HonoEnv>) => Promise<OperatorScope>;

/** 운영자 해석기를 주지 않으면 운영자 범위 경로는 닫혀 있다(앱은 operator-login.ts의 resolveOperatorSession을 줌). */
const CLOSED_OPERATOR: OperatorResolver = () => Promise.reject(new ApiError("unauthenticated"));

/**
 * 해석기가 아직 없는 출처: 닫혀 있다. 사장님 세션은 TASK-020, 카카오 스킬은 TASK-028, 예약 링크는 TASK-044·045. 운영자 세션은
 * TASK-021이 만들었지만 운영자가 여는 가게(가게 범위의 출처 operator)는 TASK-159가 정한다.
 */
const CLOSED: ScopeResolvers = {
  owner: () => Promise.reject(new ApiError("unauthenticated")),
  operator: () => Promise.reject(new ApiError("unauthenticated")),
  customer: () => Promise.reject(new ApiError("skill_key_invalid")),
  public: () => Promise.reject(new ApiError("not_found")),
};

function shopRequest(c: Context<HonoEnv>, scope: ShopScope): ShopRequest {
  const db = shopRequestDb(scope, c.get("db"));
  const headers = { "cache-control": "no-store" };
  return {
    scope,
    operatorShops: scope.via.kind === "operator" ? operatorShopDirectory(c.get("db"), scope) : undefined,
    kakaoSkill: c.get("kakaoSkill"),
    db,
    req: c.req,
    traceId: c.get("traceId"),
    log: c.get("log"),
    services: c.get("services"),
    pathId: (name) => pathId(c.req.param(name)),
    body: () => readJsonBody(c),
    json: (body, status = 200, extra) => c.json(body as object, status, { ...extra, ...headers }),
    noContent: () => c.body(null, 204, headers),
    command: (spec) =>
      runCommand(c, {
        command: spec.command,
        actor: actorOf(scope),
        pathIds: spec.pathIds,
        body: spec.body,
        execute: (tx) => spec.execute(shopDb(scope, tx)),
        render: (q, stored) => spec.render(shopDb(scope, q), stored),
      }),
  };
}

function accessRequest(c: Context<HonoEnv>, scope: ShopScope, api: string, recorder: AccessRecorder): AccessRequest {
  const db = shopRequestDb(scope, c.get("db"));
  const headers = { "cache-control": "no-store" };
  return {
    scope,
    api,
    req: c.req,
    traceId: c.get("traceId"),
    log: c.get("log"),
    services: c.get("services"),
    pathId: (name) => pathId(c.req.param(name)),
    body: () => readJsonBody(c),
    read: async (fn) => {
      const body = await db.transaction(async (tx) => {
        const out = await fn(tx);
        await recorder.record(tx, { action: "read", subjects: out.subjects });
        return out.body;
      });
      recorder.markCommitted();
      return c.json(body as object, 200, headers);
    },
    command: async (spec) => {
      const res = await runCommand(c, {
        command: api,
        actor: actorOf(scope),
        pathIds: spec.pathIds,
        body: spec.body,
        execute: async (tx) => {
          const scoped = shopDb(scope, tx);
          const out = await spec.execute(scoped);
          await recorder.record(scoped, out.access);
          return out.result;
        },
        // 다시 온 요청의 render는 runCommand가 트랜잭션 안에서 부른다(request-key.ts).
        render: async (q, stored) => {
          const scoped = shopDb(scope, q);
          const out = await spec.render(scoped, stored);
          await recorder.record(scoped, out.access, { replay: true });
          return out.body;
        },
      });
      // runCommand가 응답을 돌려줬으면 접속기록을 넣은 트랜잭션은 커밋됐다(실패면 던짐).
      recorder.markCommitted();
      return res;
    },
  };
}

function operatorRequest(c: Context<HonoEnv>, operator: OperatorScope): OperatorRequest {
  const headers = { "cache-control": "no-store" };
  return {
    operator,
    shops: operatorShopDirectory(c.get("db"), operator),
    req: c.req,
    traceId: c.get("traceId"),
    log: c.get("log"),
    services: c.get("services"),
    json: (body, status = 200) => c.json(body as object, status, headers),
  };
}

function ownerRequest(c: Context<HonoEnv>, owner: OwnerScope): OwnerRequest {
  const headers = { "cache-control": "no-store" };
  return {
    owner,
    req: c.req,
    traceId: c.get("traceId"),
    log: c.get("log"),
    services: c.get("services"),
    body: () => readJsonBody(c),
    async command(spec) {
      try {
        return await runCommand(c, {
          actor: { kind: "owner", id: owner.ownerId },
          command: spec.command,
          pathIds: [],
          body: spec.body,
          execute: (tx) => spec.execute(ownerShopDb(tx, owner)),
          render: (tx, stored) => spec.render(ownerShopDb(tx, owner), stored),
        });
      } catch (error) {
        try {
          await spec.cleanup?.(ownerShopDb(c.get("db"), owner));
        } catch {
          c.get("log")("warn", { event: "shop_registration_cleanup_failed", traceId: c.get("traceId") });
        }
        throw error;
      }
    },
    json: (body, status = 200) => c.json(body as object, status, headers),
  };
}

/** 선언을 앱에 붙인다. 같은 방법·경로를 두 번 선언하면 멈춘다. */
export function mountRoutes(
  app: Hono<HonoEnv>,
  routes: readonly RouteDecl[],
  resolvers: Partial<ScopeResolvers> = {},
  ownerResolver: OwnerResolver = CLOSED_OWNER,
  operatorResolver: OperatorResolver = CLOSED_OPERATOR,
): void {
  const resolve: ScopeResolvers = { ...CLOSED, ...resolvers };
  const seen = new Set<string>();
  for (const route of routes) {
    const key = routeKey(route.method, route.path);
    if (seen.has(key)) throw new TypeError(`route declared twice: ${key}`);
    seen.add(key);
    if (route.kind === "open") {
      app.on(route.method, route.path, (c) => route.handler(c));
      continue;
    }
    if (route.kind === "owner") {
      app.on(route.method, route.path, async (c) => {
        const owner = await ownerResolver(c);
        if (!isOwnerScope(owner)) throw new ForgedScopeError("owner scope did not come from createOwnerScope");
        return route.handler(ownerRequest(c, owner));
      });
      continue;
    }
    if (route.kind === "operator") {
      app.on(route.method, route.path, async (c) => {
        const operator = await operatorResolver(c);
        if (!isOperatorScope(operator)) {
          throw new ForgedScopeError("operator scope did not come from createOperatorScope");
        }
        return route.handler(operatorRequest(c, operator));
      });
      continue;
    }
    const resolver = resolve[route.via];
    if (route.access !== undefined) {
      const decl = route;
      app.on(decl.method, decl.path, async (c) => {
        const scope = await resolver(c);
        if (!isShopScope(scope) || scope.via.kind !== decl.via) {
          throw new ForgedScopeError("scope did not come from createShopScope for this route");
        }
        // 접속지 헤더가 없거나 틀리면 아무것도 읽기 전에 닫힌다(500, access-log.ts).
        const recorder = AccessRecorder.start(
          { actor: actorOf(scope), api: decl.access, url: c.req.url, headers: c.req.raw.headers },
          c.get("log"),
          c.get("traceId"),
        );
        const res = await decl.handler(accessRequest(c, scope, decl.access, recorder));
        recorder.assertLogged(res.status);
        return res;
      });
      continue;
    }
    app.on(route.method, route.path, async (c) => {
      const scope = await resolver(c);
      if (!isShopScope(scope) || scope.via.kind !== route.via) {
        throw new ForgedScopeError("scope did not come from createShopScope for this route");
      }
      return route.handler(shopRequest(c, scope));
    });
  }
}
