/** 예약 주소의 공개 가게 한 곳만 찾는다. 비공개 자료를 해석기에 돌려주지 않는다. */
import type { Context } from "hono";
import type { HonoEnv } from "./app";
import { ownerRateKey } from "./owner-oauth";
import { ApiError } from "./problem";
import { PUBLIC_PRIVACY_RATE } from "./rate-limit";
import { MissingSettingError } from "./request-key";
import { createShopScope, type ShopScope } from "./shop-scope";

export const PUBLIC_SHOP_SQL = "SELECT id FROM shops WHERE booking_slug=$1 AND booking_issued_at IS NOT NULL";

export async function resolvePublicShop(c: Context<HonoEnv>): Promise<ShopScope> {
  const slug = c.req.param("slug");
  if (slug === undefined) throw new ApiError("not_found");
  const ip = c.req.header("cf-connecting-ip") ?? (c.get("settings").appEnv === "development" ? "local" : null);
  const key = c.get("settings").secrets.REQUEST_HASH_KEY;
  if (ip === null || ip.length > 64 || !/^[A-Za-z0-9:.]+$/.test(ip) || key === null)
    throw new MissingSettingError("public request rate settings are not available");
  if (
    !(await c
      .get("services")
      .limiter(PUBLIC_PRIVACY_RATE)
      .limit(await ownerRateKey(key, `public-privacy:${ip}`)))
  )
    throw new ApiError("rate_limited", { retryAfterSeconds: 60 });
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(slug)) throw new ApiError("not_found");
  const row = (await c.get("db").query<{ id: string }>(PUBLIC_SHOP_SQL, [slug])).rows[0];
  if (row === undefined) throw new ApiError("not_found");
  return createShopScope(row.id, { kind: "public" });
}
