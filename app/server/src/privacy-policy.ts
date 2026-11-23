/** API-039. 예약 주소로 발급된 가게의 최신 처리방침만 공개한다. */

import type { OverseasTransfer } from "./privacy-policy-settings";
import type { ShopRequest } from "./routes";
import { toShopIso } from "./time";

export async function getPublicPrivacyPolicy(r: ShopRequest): Promise<Response> {
  const result = await r.db.found<{
    name: string;
    time_zone: string;
    version: number;
    body: string;
    overseas_transfers: OverseasTransfer[];
    published_at: Date;
  }>(
    `SELECT s.name,s.time_zone,p.version,p.body,p.overseas_transfers,p.published_at FROM shops s
    JOIN privacy_policies p ON p.shop_id=s.id AND p.shop_id=$1 WHERE s.id=$1 AND p.published_at<=$2
    ORDER BY p.version DESC LIMIT 1`,
    [r.services.now()],
  );
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
