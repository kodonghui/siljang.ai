/** 예약 주소의 공개 가게 한 곳만 찾는다. 비공개 자료를 해석기에 돌려주지 않는다. */
import type { Context } from "hono";
import { routePath } from "hono/route";
import type { HonoEnv } from "./app";
import { ApiError } from "./problem";
import { limitPublicRequest } from "./public-rate";
import { PUBLIC_BOOKING_RATE, PUBLIC_PRIVACY_RATE } from "./rate-limit";
import { createShopScope, type ShopScope } from "./shop-scope";

export const PUBLIC_SHOP_SQL = "SELECT id FROM shops WHERE booking_slug=$1 AND booking_issued_at IS NOT NULL";

export async function resolvePublicShop(c: Context<HonoEnv>): Promise<ShopScope> {
  const slug = c.req.param("slug");
  if (slug === undefined) throw new ApiError("not_found");
  const path = routePath(c);
  const rule =
    path === "/api/public/shops/:slug"
      ? PUBLIC_BOOKING_RATE
      : path === "/api/public/shops/:slug/privacy-policy"
        ? PUBLIC_PRIVACY_RATE
        : null;
  if (rule === null) throw new ApiError("not_found");
  await limitPublicRequest(c, rule);
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(slug)) throw new ApiError("not_found");
  const row = (await c.get("db").query<{ id: string }>(PUBLIC_SHOP_SQL, [slug])).rows[0];
  if (row === undefined) throw new ApiError("not_found");
  return createShopScope(row.id, { kind: "public" });
}
