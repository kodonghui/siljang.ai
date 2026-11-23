/** API-039. 예약 주소로 발급된 가게의 최신 처리방침만 공개한다. */

import { currentPrivacyPolicy } from "./privacy-policy-current";
import { ApiError } from "./problem";
import type { ShopRequest } from "./routes";
import { toShopIso } from "./time";

export async function getPublicPrivacyPolicy(r: ShopRequest): Promise<Response> {
  const result = await r.db.transaction((db) => currentPrivacyPolicy(db, r.services));
  if (result === null) throw new ApiError("not_found");
  return r.json(
    {
      shopName: result.name,
      version: result.version,
      body: result.body,
      overseasTransfers: result.overseas_transfers,
      publishedAt: toShopIso(result.published_at, result.time_zone),
    },
    200,
    { "cache-control": "no-store" },
  );
}
