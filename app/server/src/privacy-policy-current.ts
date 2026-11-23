/** TASK-184. 가게 잠금 안에서 현재 글/국외 이전 전체를 비교하고 이전 버전은 보존한다. */
import { privacyPolicyBody } from "./privacy-policy-body";
import type { OverseasTransfer } from "./privacy-policy-settings";
import { ApiError } from "./problem";
import { MissingSettingError } from "./request-key";
import type { Services } from "./services";
import type { ShopDb } from "./shop-scope";

export interface CurrentPrivacyPolicy {
  readonly name: string;
  readonly time_zone: string;
  readonly version: number;
  readonly body: string;
  readonly overseas_transfers: OverseasTransfer[];
  readonly published_at: Date;
}

// jsonb가 객체 속성 순서를 바꿔도 같은 국외 이전 항목은 같은 값이다. 배열 순서/모든 필드는 보존한다.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

/** 호출자는 기존 트랜잭션을 넘긴다. 미발급이면 만들지 않는다. 고지/공개 읽기는 설정 누락 때 옛 글을 내지 않는다. */
export async function currentPrivacyPolicy(
  db: ShopDb,
  services: Pick<Services, "privacyPolicy" | "now">,
  requireSettings = true,
): Promise<CurrentPrivacyPolicy | null> {
  const shop = await db.found<{
    name: string;
    contact_email: string;
    contact_phone: string;
    time_zone: string;
    booking_issued_at: Date | null;
  }>(
    "SELECT s.name,s.contact_email,s.contact_phone,s.time_zone,s.booking_issued_at FROM shops s WHERE s.id=$1 FOR NO KEY UPDATE",
  );
  if (shop.booking_issued_at === null) return null;
  const settings = services.privacyPolicy;
  if (settings === null) {
    if (requireSettings) throw new MissingSettingError("PRIVACY_TRANSFER_SETTINGS is not available");
    return null;
  }
  const now = services.now();
  const previous = (
    await db.run<{ version: number; body: string; overseas_transfers: OverseasTransfer[]; published_at: Date }>(
      "SELECT p.version,p.body,p.overseas_transfers,p.published_at FROM privacy_policies p WHERE p.shop_id=$1 AND p.published_at<=$2 ORDER BY p.version DESC LIMIT 1",
      [now],
    )
  ).rows[0];
  // 첫 발급이 없는 손상된/미래 게시 상태를 공개 읽기로 복구하거나 먼저 공개하지 않는다.
  if (previous === undefined) throw new ApiError("not_found");
  const body = privacyPolicyBody(shop, settings.transfers);
  if (body === previous.body && canonical(settings.transfers) === canonical(previous.overseas_transfers))
    return { name: shop.name, time_zone: shop.time_zone, ...previous };
  const head = await db.found<{ version: number }>(
    "SELECT COALESCE(max(p.version),0)::int AS version FROM privacy_policies p WHERE p.shop_id=$1",
  );
  const version = head.version + 1;
  await db.run(
    "INSERT INTO privacy_policies (shop_id,version,body,overseas_transfers,published_at) VALUES ($1,$2,$3,$4::jsonb,$5)",
    [version, body, JSON.stringify(settings.transfers), now],
  );
  return {
    name: shop.name,
    time_zone: shop.time_zone,
    version,
    body,
    overseas_transfers: [...settings.transfers],
    published_at: now,
  };
}
