/** SCR-034 카드 상태. 이 가게의 현재 값만 읽고 계좌·OAuth 참조·사진 주소는 돌려주지 않는다. */
import type { ShopDb } from "./shop-scope";

interface SummaryRow {
  price_list_version: number | null;
  operating_rules_version: number | null;
  payment_configured: boolean;
  kakao_channel_status: "not_started" | "pending" | "linked" | "failed" | null;
  ledger_status: "linked" | "auth_lost" | null;
  has_portfolio: boolean;
  has_reviews: boolean;
}
export async function shopSettingsSummary(db: ShopDb, now: Date) {
  const row = await db.found<SummaryRow>(
    `SELECT
      (SELECT pl.version FROM price_lists pl WHERE pl.shop_id=$1 AND pl.superseded_at IS NULL) AS price_list_version,
      (SELECT opr.version FROM operating_rules opr WHERE opr.shop_id=$1 AND opr.superseded_at IS NULL) AS operating_rules_version,
      EXISTS(SELECT 1 FROM payment_accounts pac WHERE pac.shop_id=$1 AND pac.retired_at IS NULL) AS payment_configured,
      (SELECT CASE WHEN kc.status='pending' AND kc.check_started_at IS NULL THEN 'not_started' WHEN kc.status='pending' AND kc.check_started_at<=$2::timestamptz-interval '10 minutes' THEN 'failed' ELSE kc.status END
        FROM kakao_channels kc WHERE kc.shop_id=$1 AND kc.status<>'retired' ORDER BY kc.configuration_order DESC LIMIT 1) AS kakao_channel_status,
      (SELECT ll.status FROM ledger_links ll WHERE ll.shop_id=$1 AND ll.status<>'unlinked') AS ledger_status,
      EXISTS(SELECT 1 FROM portfolio_items pi JOIN photo_consents pcn ON pcn.shop_id=$1 AND pcn.id=pi.photo_consent_id
        WHERE pi.shop_id=$1 AND pi.unpublished_at IS NULL AND pi.published_at<=$2::timestamptz AND pcn.withdrawn_at IS NULL) AS has_portfolio,
      EXISTS(SELECT 1 FROM reviews rv WHERE rv.shop_id=$1 AND rv.superseded_at IS NULL) AS has_reviews`,
    [now],
  );
  return {
    priceListVersion: row.price_list_version,
    operatingRulesVersion: row.operating_rules_version,
    paymentConfigured: row.payment_configured,
    kakaoChannelStatus: row.kakao_channel_status,
    ledgerStatus: row.ledger_status,
    hasPortfolio: row.has_portfolio,
    hasReviews: row.has_reviews,
  };
}
