/** API-038. 발급한예약 주소의 공개 필드만 읽는다. */
import { calendarBookingDays } from "./calendar";
import type { PriceOptionInput } from "./price-list-input";
import type { ShopRequest } from "./routes";
import type { ShopRow } from "./shops";

type PublicShop = Pick<
  ShopRow,
  | "name"
  | "business_name"
  | "representative_name"
  | "business_address"
  | "contact_phone"
  | "contact_email"
  | "business_reg_no"
  | "mail_order_reg_no"
  | "mail_order_authority"
  | "mail_order_exemption"
  | "pickup_address"
>;
interface PublicOption {
  option_group: PriceOptionInput["group"];
  name: string;
  price_kind: PriceOptionInput["priceKind"];
  amount: number;
  amount_max: number | null;
  in_standard: boolean;
}

export async function getPublicBookingPage(r: ShopRequest): Promise<Response> {
  const now = r.services.now();
  const origin = new URL(r.req.url).origin;
  const body = await r.db.transaction(async (db) => {
    const shop = await db.found<PublicShop>(
      `SELECT s.name,s.business_name,s.representative_name,s.business_address,s.contact_phone,s.contact_email,
       s.business_reg_no,s.mail_order_reg_no,s.mail_order_authority,s.mail_order_exemption,s.pickup_address
       FROM shops s WHERE s.id=$1`,
    );
    const head = await db.found<{ id: string; version: number }>(
      "SELECT p.id,p.version FROM price_lists p WHERE p.shop_id=$1 AND p.superseded_at IS NULL",
    );
    const options = (
      await db.run<PublicOption>(
        `SELECT o.option_group,o.name,o.price_kind,o.amount,o.amount_max,o.in_standard
       FROM price_options o WHERE o.shop_id=$1 AND o.price_list_id=$2
       ORDER BY CASE o.option_group WHEN 'size' THEN 0 WHEN 'flavor' THEN 1 WHEN 'design' THEN 2 ELSE 3 END,o.position,o.name,o.id`,
        [head.id],
      )
    ).rows;
    const designs = (
      await db.run<{ name: string; image_key: string; in_standard: boolean }>(
        `SELECT d.name,d.image_key,d.in_standard FROM designs d WHERE d.shop_id=$1 AND d.price_list_id=$2
       ORDER BY d.position,d.name,d.id`,
        [head.id],
      )
    ).rows;
    const photos = (
      await db.run<{ storage_key: string }>(
        `SELECT COALESCE(cp.storage_key,rp.storage_key) AS storage_key FROM portfolio_items p
       JOIN photo_consents c ON c.id=p.photo_consent_id AND c.shop_id=$1
       LEFT JOIN completion_photos cp ON cp.id=p.completion_photo_id AND cp.shop_id=$1
       LEFT JOIN review_photos rp ON rp.id=p.review_photo_id AND rp.shop_id=$1
       WHERE p.shop_id=$1 AND p.unpublished_at IS NULL AND p.published_at<=$2
       AND c.consented=true AND c.withdrawn_at IS NULL AND c.publishable=true
       AND (cp.storage_key IS NOT NULL OR rp.storage_key IS NOT NULL)
       ORDER BY p.published_at DESC,p.id LIMIT 100`,
        [now],
      )
    ).rows;
    const channel = (
      await db.run<{ channel_public_id: string | null }>(
        `SELECT c.channel_public_id FROM kakao_channels c WHERE c.shop_id=$1 AND c.status='linked'
       ORDER BY c.configuration_order DESC LIMIT 1`,
      )
    ).rows[0];
    const sign = (key: string) => r.services.fileUrls().sign(key, origin, now);
    return {
      shop: {
        name: shop.name,
        businessName: shop.business_name,
        representativeName: shop.representative_name,
        businessAddress: shop.business_address,
        contactPhone: shop.contact_phone,
        contactEmail: shop.contact_email,
        businessRegNo: shop.business_reg_no,
        mailOrderRegNo: shop.mail_order_reg_no,
        mailOrderAuthority: shop.mail_order_authority,
        mailOrderExemption: shop.mail_order_exemption,
        pickupAddress: shop.pickup_address,
      },
      priceList: {
        version: head.version,
        options: options.map((o) => ({
          group: o.option_group,
          name: o.name,
          priceKind: o.price_kind,
          amount: o.amount,
          amountMax: o.amount_max,
          inStandard: o.in_standard,
        })),
        designs: await Promise.all(
          designs.map(async (d) => ({ name: d.name, imageUrl: await sign(d.image_key), inStandard: d.in_standard })),
        ),
      },
      days: await calendarBookingDays(db, now),
      portfolio: await Promise.all(photos.map(async (p) => ({ imageUrl: await sign(p.storage_key) }))),
      privacyPolicyUrl: new URL(`/s/${r.req.param("slug")}/privacy`, r.services.publicAppOrigin ?? origin).href,
      inquiryUrl: channel?.channel_public_id
        ? `https://pf.kakao.com/${encodeURIComponent(channel.channel_public_id)}/chat`
        : null,
    };
  });
  // no-store(0초)로 캐시60초 상한과 사진을 내린 뒤5분 이내 조건을 지킨다.
  return r.json(body, 200, { "cache-control": "no-store" });
}
