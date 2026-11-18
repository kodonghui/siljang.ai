/**
 * 운영자 범위(TASK-021). 운영자 세션(06 operatorSession, 쿠키 siljang_operator)으로 들어온 운영자 하나다. 가게 기록이 아닌
 * 운영자 API(06 API-005 로그인한 운영자 등)의 처리기가 받는다. 해석기(operator-login.ts의 resolveOperatorSession)만 만든다.
 * - createOperatorScope를 부를 수 있는 파일은 정적 시험(test/shop-scope-static.test.ts)이 정한 목록뿐이다.
 * - 이 범위로는 가게 기록을 읽고 쓰지 않는다. 운영자가 여는 가게 기록은 가게 범위(출처 operator, TASK-034·159)로만.
 */
import { isUuid } from "./shop-scope";

const operatorBrand: unique symbol = Symbol("OperatorScope");

/** 로그인한 운영자. createOperatorScope로만 만들고, 흉내 낸 객체는 경로가 받지 않는다(ForgedScopeError). */
export interface OperatorScope {
  readonly operatorId: string;
  /** 화면에 보일 이름(05 operators.display_name). */
  readonly displayName: string;
  readonly [operatorBrand]: true;
}

const genuine = new WeakSet<object>();

/** 운영자 범위를 만든다. 해석기만 부른다. operatorId는 해석기가 세션에서 찾은 운영자 ID다. */
export function createOperatorScope(operatorId: string, displayName: string): OperatorScope {
  if (!isUuid(operatorId)) throw new TypeError("operator id must be a uuid");
  if (displayName.length < 1 || displayName.length > 40) throw new TypeError("display name must be 1~40 characters");
  const scope: OperatorScope = Object.freeze({
    operatorId: operatorId.toLowerCase(),
    displayName,
    [operatorBrand]: true as const,
  });
  genuine.add(scope);
  return scope;
}

export function isOperatorScope(value: unknown): value is OperatorScope {
  return typeof value === "object" && value !== null && genuine.has(value);
}
