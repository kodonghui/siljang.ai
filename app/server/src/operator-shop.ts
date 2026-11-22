/** API-013/014: 실제 운영자 세션을 확인한 뒤 경로의 가게 하나만 연다. */
import type { Context } from "hono";
import type { HonoEnv } from "./app";
import { resolveOperatorSession } from "./operator-login";
import { ApiError } from "./problem";
import { createShopScope, pathId, type ShopScope } from "./shop-scope";

export async function resolveOperatorShop(c: Context<HonoEnv>): Promise<ShopScope> {
  const operator = await resolveOperatorSession(c);
  const shopId = c.req.param("shopId"),
    id = pathId(shopId ?? c.req.param("changeId"));
  const row =
    shopId === undefined
      ? await c.get("db").query<{ id: string }>("SELECT shop_id AS id FROM shop_identity_changes WHERE id=$1", [id])
      : await c.get("db").query<{ id: string }>("SELECT id FROM shops WHERE id=$1", [id]);
  if (row.rows.length === 0) throw new ApiError("not_found");
  const selected = row.rows[0];
  if (!selected) throw new ApiError("not_found");
  return createShopScope(selected.id, { kind: "operator", operatorId: operator.operatorId });
}
