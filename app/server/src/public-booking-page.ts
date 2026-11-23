/** API-038. 발급한 예약 주소의 공개 필드만 읽는다. */
import { calendarBookingDays } from "./calendar";
import { contents, current } from "./price-lists";
import { ApiError } from "./problem";
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

export async function getPublicBookingPage(r: ShopRequest): Promise<Response> {
  const now = r.services.now();
  const origin = new URL(r.req.url).origin;
  const data = await r.db.transaction(async (db) => {
    const shop = await db.found<PublicShop>(
      `SELECT s.name,s.business_name,s.representative_name,s.business_address,s.contact_phone,s.contact_email,
       s.business_reg_no,s.mail_order_reg_no,s.mail_order_authority,s.mail_order_exemption,s.pickup_address
       FROM shops s WHERE s.id=$1`,
    );
    const head = await current(db);
    if (head === undefined) throw new ApiError("not_found");
    const price = await contents(db, head.id);
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
    const days = await calendarBookingDays(db, now);
    return { shop, head, price, photos, channel, days };
  });
  // 사진 서명은 커밋 뒤에 수행해 달력 공유 잠금을 쥔 채 CPU를 쓰지 않는다.
  const { shop, head, price, photos, channel, days } = data;
  const sign = (key: string) => r.services.fileUrls().sign(key, origin, now);
  return r.json(
    {
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
        options: price.options.map((o) => ({
          group: o.option_group,
          name: o.name,
          priceKind: o.price_kind,
          amount: o.amount,
          amountMax: o.amount_max,
          inStandard: o.in_standard,
        })),
        designs: await Promise.all(
          price.designs.map(async (d) => ({
            name: d.name,
            imageUrl: await sign(d.image_key),
            inStandard: d.in_standard,
          })),
        ),
      },
      days,
      portfolio: await Promise.all(photos.map(async (p) => ({ imageUrl: await sign(p.storage_key) }))),
      privacyPolicyUrl: new URL(`/s/${r.req.param("slug")}/privacy`, r.services.publicAppOrigin ?? origin).href,
      inquiryUrl: channel?.channel_public_id
        ? `https://pf.kakao.com/${encodeURIComponent(channel.channel_public_id)}/chat`
        : null,
    },
    200,
    { "cache-control": "no-store" },
  );
}
