/**
 * 경로 선언(TASK-019). 앱의 경로는 모두 이 선언으로 붙는다(app.ts의 APP_ROUTES). 시험이 라우터의 경로가 모두 선언됐는지,
 * 가게 범위 경로가 모두 교차 가게 시험 묶음(test/support/cross-shop.ts의 CROSS_SHOP_CASES)에 들었는지 본다.
 * - shopRoute: 가게 범위 경로. 처리기는 ShopRequest만 받는다. 날 데이터베이스 연결(RequestDb)과 Hono 맥락을 받지 않아
 *   가게 조건 없는 SQL을 보낼 길이 타입에 없다. 가게 범위는 경로마다 정한 출처의 해석기가 만든다. 해석기가 아직 없는
 *   출처의 경로는 닫혀 있다(사장님·운영자 401 unauthenticated, 손님 401 skill_key_invalid, 예약 링크 404).
 * - ownerRoute: 사장님 범위 경로(TASK-022). 사장님 세션은 있지만 가게가 정해지기 전이거나 가게 기록이 아닌 API(사진 올리기
 *   API-007 등). 처리기는 OwnerRequest만 받고 데이터베이스 연결이 없다. 사장님은 사장님 해석기(TASK-020)가 정하고, 없으면
 *   닫혀 있다(401 unauthenticated).
 * - openRoute: 가게 범위도 사장님 범위도 아닌 경로(기반 시설, 로그인, 서명 주소). 왜 그런지 적는다.
 *   가게 테이블을 읽고 쓰지 않는다(정적 시험이 날 연결을 쥔 파일의 SQL을 봄).
 */
import type { Context, Hono, HonoRequest } from "hono";
import type { HonoEnv, Logger } from "./app";
import { readJsonBody } from "./body";
import { isOwnerScope, type OwnerScope } from "./owner-scope";
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
  json(body: unknown, status?: 200 | 201 | 202): Response;
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
  readonly handler: (r: ShopRequest) => Promise<Response>;
}

/** 사장님 범위 경로의 처리기가 받는 것. 데이터베이스 연결이 없다(가게 기록은 가게 범위 경로로만). */
export interface OwnerRequest {
  readonly owner: OwnerScope;
  /** 경로 값·쿼리·헤더와 날 요청(raw). 사진 올리기만 본문을 raw로 읽는다(uploads.ts의 한도). */
  readonly req: HonoRequest;
  readonly traceId: string;
  readonly log: Logger;
  readonly services: Services;
  json(body: unknown, status?: 200 | 201 | 202): Response;
}

export interface OwnerRouteDecl {
  readonly kind: "owner";
  readonly method: Method;
  readonly path: string;
  readonly handler: (r: OwnerRequest) => Promise<Response>;
}

export interface OpenRouteDecl {
  readonly kind: "open";
  readonly method: Method;
  readonly path: string;
  /** 왜 가게 범위가 아닌지(가게가 정해지기 전, 기반 시설 등). */
  readonly why: string;
  readonly handler: (c: Context<HonoEnv>) => Response | Promise<Response>;
}

export type RouteDecl = ShopRouteDecl | OwnerRouteDecl | OpenRouteDecl;

export function shopRoute(
  method: Method,
  path: string,
  via: ScopeKind,
  handler: (r: ShopRequest) => Promise<Response>,
): ShopRouteDecl {
  return { kind: "shop", method, path, via, handler };
}

export function ownerRoute(
  method: Method,
  path: string,
  handler: (r: OwnerRequest) => Promise<Response>,
): OwnerRouteDecl {
  return { kind: "owner", method, path, handler };
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

/** 해석기가 아직 없는 출처: 닫혀 있다. 사장님 세션은 TASK-020, 운영자 세션은 TASK-021, 카카오 스킬은 TASK-028, 예약 링크는 TASK-044·045. */
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
    db,
    req: c.req,
    traceId: c.get("traceId"),
    log: c.get("log"),
    services: c.get("services"),
    pathId: (name) => pathId(c.req.param(name)),
    body: () => readJsonBody(c),
    json: (body, status = 200) => c.json(body as object, status, headers),
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

function ownerRequest(c: Context<HonoEnv>, owner: OwnerScope): OwnerRequest {
  const headers = { "cache-control": "no-store" };
  return {
    owner,
    req: c.req,
    traceId: c.get("traceId"),
    log: c.get("log"),
    services: c.get("services"),
    json: (body, status = 200) => c.json(body as object, status, headers),
  };
}

/** 선언을 앱에 붙인다. 같은 방법·경로를 두 번 선언하면 멈춘다. */
export function mountRoutes(
  app: Hono<HonoEnv>,
  routes: readonly RouteDecl[],
  resolvers: Partial<ScopeResolvers> = {},
  ownerResolver: OwnerResolver = CLOSED_OWNER,
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
    const resolver = resolve[route.via];
    app.on(route.method, route.path, async (c) => {
      const scope = await resolver(c);
      if (!isShopScope(scope) || scope.via.kind !== route.via) {
        throw new ForgedScopeError("scope did not come from createShopScope for this route");
      }
      return route.handler(shopRequest(c, scope));
    });
  }
}
