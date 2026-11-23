/** API-037: 가게 잠금 안에서 준비 조건/처리방침/영구 예약 주소를 한 번 만든다. */

import type { OverseasTransfer } from "./privacy-policy-settings";
import { MissingSettingError } from "./request-key";
import type { ShopRequest } from "./routes";
import { toShopIso } from "./time";

export function privacyPolicyBody(
  shop: { name: string; contact_email: string; contact_phone: string },
  transfers: readonly OverseasTransfer[],
): string {
  return [
    `${shop.name} 개인정보 처리방침`,
    `개인정보 처리자: ${shop.name}. 문의·열람·정정·삭제·동의 철회: ${shop.contact_email}, ${shop.contact_phone}.`,
    "상담 대화와 도안 사진은 상담·견적에, 주문자 이름과 연락처는 픽업·급한 연락에, 입금자 이름은 입금 대조에 사용합니다.",
    "주문자 이름·연락처·입금자 이름은 AI를 거치지 않는 입력으로 받으며 AI 모델 회사에 보내지 않습니다.",
    "알레르기 정보는 따로 동의한 손님에게서만 AI를 거치지 않는 입력으로 받습니다. 제작 중 알레르기 확인에만 사용하고 가게 사장님만 봅니다. AI 모델 회사에 보내지 않습니다.",
    "상담 대화는 상담이 닫히고 30일 뒤 지웁니다. 주문 개인정보와 알레르기 정보는 주문이 끝나고 30일 뒤 지웁니다. 계약·결제 기록은 별도로 나누어 5년, 문제 신고 기록은 3년 보관합니다.",
    "손님은 위 연락처로 열람·정정·삭제·동의 철회를 신청할 수 있습니다. 법령에 따라 따로 보관하는 기록은 그 보유 기간 뒤 지웁니다.",
    "개인정보 처리 위탁·재위탁 및 국외 이전:",
    ...transfers.map(
      (t) =>
        `받는 자: ${t.recipient}\n나라: ${t.country}\n옮기는 개인정보: ${t.personalData}\n시기·방법: ${t.whenAndHow}\n목적·보유 기간: ${t.purposeAndRetention}\n거부 방법·절차와 결과: ${t.howToRefuse}`,
    ),
  ].join("\n\n");
}

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
    if (settings === null) {
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
      url: `${settings.origin}/s/${slug}`,
      issuedAt: toShopIso(now, shop.time_zone),
      missing: [],
      recommended,
    };
  });
  return r.json(body);
}
