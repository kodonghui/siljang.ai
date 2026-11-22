import { expect, it } from "vitest";
import type { Queryable } from "../src/db";
import { createOperatorScope, type OperatorScope } from "../src/operator-scope";
import { operatorShopDirectory } from "../src/operator-shop-directory";
import { createShopScope, ForgedScopeError } from "../src/shop-scope";
import { newUuid } from "./support/db";

it("가짜 운영자/가게 범위와 진짜 사장님 범위는 운영자 목록 연결을 받지 못하고 SQL0건임", () => {
  let calls = 0;
  const db: Queryable = {
    async query() {
      calls++;
      return { rows: [], rowCount: 0 };
    },
  };
  for (const scope of [
    { operatorId: newUuid(), displayName: "위조" },
    { shopId: newUuid(), via: { kind: "operator", operatorId: newUuid() } },
    createShopScope(newUuid(), { kind: "owner", ownerId: newUuid() }),
  ])
    expect(() => operatorShopDirectory(db, scope as OperatorScope)).toThrow(ForgedScopeError);
  expect(calls).toBe(0);
});
it("한 가게의 운영자 범위로 전체 목록을 열 수 없고 전체 운영자 범위로 임의 가게 중복을 열 수 없음", async () => {
  let calls = 0;
  const db: Queryable = {
      async query() {
        calls++;
        return { rows: [], rowCount: 0 };
      },
    },
    operatorId = newUuid();
  const one = operatorShopDirectory(db, createShopScope(newUuid(), { kind: "operator", operatorId }));
  await expect(one.list({ status: "pending", limit: 20, after: null })).rejects.toThrow(ForgedScopeError);
  const all = operatorShopDirectory(db, createOperatorScope(operatorId, "합성 운영자"));
  await expect(all.duplicates()).rejects.toThrow(ForgedScopeError);
  expect(calls).toBe(0);
});
