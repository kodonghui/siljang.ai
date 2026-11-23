/** API-037: 가게 잠금 안에서 준비 조건/처리방침/영구 예약 주소를 한 번 만든다. */

import { privacyPolicyBody } from "./privacy-policy-body";

export { privacyPolicyBody } from "./privacy-policy-body";

import { MissingSettingError } from "./request-key";
import type { ShopRequest } from "./routes";
import { toShopIso } from "./time";

export async function getBookingLink(r: ShopRequest): Promise<Response> {
  const settings = r.services.privacyPolicy;
  const body = await r.db.transaction(async (db) => {
    const shop = await db.found<{
      name: string;
      contact_email: string;
      contact_phone: string;
      time_zone: string;
      license_status: string;
      pickup_address: string | null;
      booking_slug: string | null;
      booking_issued_at: Date | null;
    }>(
      "SELECT s.name,s.contact_email,s.contact_phone,s.time_zone,s.license_status,s.pickup_address,s.booking_slug,s.booking_issued_at FROM shops s WHERE s.id=$1 FOR NO KEY UPDATE",
    );
    const recommended = shop.pickup_address?.trim() ? [] : ["pickup_address"];
    // 이미 낸 주소는 뒤의 설정/판정 변경으로 새로 발급하지 않는다.
    if (shop.booking_slug !== null) {
      const origin = r.services.publicAppOrigin;
      if (origin === null) throw new MissingSettingError("PUBLIC_APP_ORIGIN is not set");
      return {
        status: "issued",
        url: `${origin}/s/${shop.booking_slug}`,
        issuedAt: toShopIso(shop.booking_issued_at as Date, shop.time_zone),
        missing: [],
        recommended,
      };
    }
    const readiness = await db.found<{
      price_list: boolean;
      rules_ready: boolean;
      calendar: boolean;
      kakao_channel: boolean;
      payment_destination: boolean;
    }>(
      `SELECT EXISTS(SELECT 1 FROM price_lists p WHERE p.shop_id=$1 AND p.superseded_at IS NULL) AS price_list,
      EXISTS(SELECT 1 FROM operating_rules o WHERE o.shop_id=$1 AND o.superseded_at IS NULL) AS rules_ready,
      EXISTS(SELECT 1 FROM business_calendars b WHERE b.shop_id=$1) AS calendar,
      EXISTS(SELECT 1 FROM kakao_channels k WHERE k.shop_id=$1 AND k.status='linked') AS kakao_channel,
      EXISTS(SELECT 1 FROM payment_accounts a WHERE a.shop_id=$1 AND a.retired_at IS NULL) AS payment_destination`,
    );
    const conditions = {
      price_list: readiness.price_list,
      operating_rules: readiness.rules_ready,
      calendar: readiness.calendar,
      license_verified: shop.license_status === "verified",
      kakao_channel: readiness.kakao_channel,
      payment_destination: readiness.payment_destination,
      privacy_policy: settings !== null,
    };
    const missing = Object.entries(conditions)
      .filter(([, ready]) => !ready)
      .map(([name]) => name);
    const otherwiseReady = Object.entries(conditions).every(([name, ready]) => name === "privacy_policy" || ready);
    if (otherwiseReady && r.services.publicAppOrigin === null)
      throw new MissingSettingError("PUBLIC_APP_ORIGIN is not set");
    if (otherwiseReady && !r.services.aiProviderConfigured) throw new MissingSettingError("AI_PROVIDER is not set");
    if (otherwiseReady && settings === null) {
      await db.run(
        `INSERT INTO ops_events (shop_id,kind,count,created_at)
        SELECT $1,'privacy_transfer_missing',1,$2 WHERE NOT EXISTS(SELECT 1 FROM ops_events e WHERE e.shop_id=$1 AND e.kind='privacy_transfer_missing' AND e.created_at >= $2::timestamptz - interval '1 day')`,
        [r.services.now()],
      );
    }
    if (missing.length > 0 || settings === null)
      return { status: "not_ready", url: null, issuedAt: null, missing, recommended };
    const now = r.services.now();
    const policy = await db.run<{ version: number }>(
      "SELECT p.version FROM privacy_policies p WHERE p.shop_id=$1 ORDER BY p.version DESC LIMIT 1",
    );
    // 예전 고지가 참조하는 글은 보존하고, 첫 링크는 지금 설정의 새 글을 가리킨다.
    const version = (policy.rows[0]?.version ?? 0) + 1;
    await db.run(
      "INSERT INTO privacy_policies (shop_id,version,body,overseas_transfers,published_at) VALUES ($1,$2,$3,$4::jsonb,$5)",
      [version, privacyPolicyBody(shop, settings.transfers), JSON.stringify(settings.transfers), now],
    );
    const slug = crypto.randomUUID().replaceAll("-", "");
    await db.run("UPDATE shops SET booking_slug=$2,booking_issued_at=$3 WHERE id=$1", [slug, now]);
    return {
      status: "issued",
      url: `${r.services.publicAppOrigin}/s/${slug}`,
      issuedAt: toShopIso(now, shop.time_zone),
      missing: [],
      recommended,
    };
  });
  return r.json(body);
}
