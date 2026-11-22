/**
 * 사장님 범위(TASK-022). 사장님 세션은 있지만 가게가 정해지기 전이거나 가게 기록이 아닌 API(06 API-007 사진 올리기,
 * 뒤에 API-008 가게 등록 등)의 처리기가 받는 '로그인한 사장님' 하나다. 해석기(routes.ts의 OwnerResolver)만 만든다:
 * 사장님 세션(TASK-020). 해석기가 없으면 사장님 범위 경로는 닫혀 있다(401 unauthenticated).
 * - createOwnerScope를 부를 수 있는 파일은 정적 시험(test/shop-scope-static.test.ts)이 정한 목록뿐이다.
 * - 이 범위로는 가게 기록을 읽고 쓰지 않는다(가게 기록은 가게 범위 ShopScope와 ShopDb로만, shop-scope.ts).
 */
import { ForgedScopeError, isShopScope, isUuid, type ShopScope } from "./shop-scope";
import { isTimeZone } from "./time";

/** 가게가 없을 때 응답 시각을 보일 시간대(05 shops.time_zone의 기본값). */
export const DEFAULT_TIME_ZONE = "Asia/Seoul";

export interface OwnerProfile {
  readonly owner: { readonly ownerId: string; readonly alertChannelFriend: boolean; readonly createdAt: string };
  readonly shop: {
    readonly shopId: string;
    readonly name: string;
    readonly licenseStatus: "pending" | "on_hold" | "verified";
  } | null;
  readonly banners: readonly string[];
}

const ownerBrand: unique symbol = Symbol("OwnerScope");

/** 로그인한 사장님. createOwnerScope로만 만들고, 흉내 낸 객체는 경로가 받지 않는다(ForgedScopeError). */
export interface OwnerScope {
  readonly ownerId: string;
  /** 응답 시각(06 DEC-15)을 보일 시간대: 가게가 있으면 그 가게 시간대, 없으면 DEFAULT_TIME_ZONE. */
  readonly timeZone: string;
  readonly profile?: OwnerProfile;
  readonly [ownerBrand]: true;
}

const genuine = new WeakSet<object>();

/** 사장님 범위를 만든다. 해석기만 부른다. ownerId는 해석기가 세션에서 찾은 사장님 ID다. */
export function createOwnerScope(
  ownerId: string,
  timeZone: string = DEFAULT_TIME_ZONE,
  profile?: OwnerProfile,
): OwnerScope {
  if (!isUuid(ownerId)) throw new TypeError("owner id must be a uuid");
  if (!isTimeZone(timeZone)) throw new TypeError("time zone must be an IANA name");
  const scope: OwnerScope = Object.freeze({
    ownerId: ownerId.toLowerCase(),
    timeZone,
    ...(profile === undefined ? {} : { profile }),
    [ownerBrand]: true as const,
  });
  genuine.add(scope);
  return scope;
}

export function isOwnerScope(value: unknown): value is OwnerScope {
  return typeof value === "object" && value !== null && genuine.has(value);
}

/** 인증된 사장님의 가게 경로에서 사진 소유자를 얻는다. 다른 출처/흉내 낸 범위는 받지 않는다. */
export function ownerOfShopScope(scope: ShopScope): OwnerScope {
  if (!isShopScope(scope) || scope.via.kind !== "owner") throw new ForgedScopeError("owner shop scope is required");
  return createOwnerScope(scope.via.ownerId);
}
