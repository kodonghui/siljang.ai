/** API-010/SPEC-077. 변경은 가게 설정에만 쓰며 이미 열린 기다림/주문은 바꾸지 않는다. */
import { requireJson } from "./body";
import { currentPrivacyPolicy } from "./privacy-policy-current";
import { ApiError } from "./problem";
import type { ShopRequest } from "./routes";
import {
  parseShopSettings,
  SHOP_SETTING_COLUMNS,
  type ShopSettingKey,
  type ShopSettingsValues,
  validateShopMailOrder,
} from "./shop-settings-input";
import { renderShop, type ShopRow } from "./shops";

export async function updateShopSettings(r: ShopRequest): Promise<Response> {
  requireJson(r.req.raw);
  const raw = await r.body();
  const input = parseShopSettings(raw),
    now = r.services.now(),
    origin = new URL(r.req.url).origin;
  return r.command({
    command: "API-010",
    pathIds: [],
    body: raw,
    async execute(db) {
      let row = await db.found<ShopRow>(
        "SELECT s.*,s.xmin::text AS revision FROM shops s WHERE s.id=$1 FOR NO KEY UPDATE",
      );
      if (input.baseRevision !== row.revision) throw new ApiError("version_conflict");
      const previous = Object.fromEntries(
        Object.entries(SHOP_SETTING_COLUMNS).map(([key, column]) => [key, row[column]]),
      ) as unknown as ShopSettingsValues;
      const values = { ...previous, ...input.changes };
      validateShopMailOrder(values);
      const changed = (Object.keys(input.changes) as ShopSettingKey[]).filter(
        (key) => input.changes[key] !== previous[key],
      );
      if (changed.length) {
        // 고정한 한 문장과 잠근 현재 값을 쓰므로 입력 조합별 SQL/캐시 항목을 만들지 않는다.
        row = await db.found<ShopRow>(
          "UPDATE shops SET name=$2,contact_phone=$3,business_address=$4,contact_email=$5,pickup_address=$6,mail_order_reg_no=$7,mail_order_authority=$8,mail_order_exemption=$9,completion_photo_enabled=$10,idle_close_hours=$11,owner_wait_minutes=$12,daily_ai_cost_limit_krw=$13,awaiting_payment_limit=$14,updated_at=$15 WHERE id=$1 RETURNING *,xmin::text AS revision",
          [
            values.name,
            values.contactPhone,
            values.businessAddress,
            values.contactEmail,
            values.pickupAddress,
            values.mailOrderRegNo,
            values.mailOrderAuthority,
            values.mailOrderExemption,
            values.completionPhotoEnabled,
            values.idleCloseHours,
            values.ownerWaitMinutes,
            values.dailyAiCostLimitKrw,
            values.awaitingPaymentLimit,
            now,
          ],
        );
      }
      // 연락처 변경은 처리방침과 원자적으로 저장한다. 다른 설정은 국외 이전 설정 부재만으로 막지 않는다.
      await currentPrivacyPolicy(
        db,
        r.services,
        changed.some((key) => ["name", "contactPhone", "contactEmail"].includes(key)),
      );
      const outcome = changed.length ? "done" : "unchanged";
      return {
        status: 200,
        code: outcome,
        ref: {},
        body: { outcome, shop: await renderShop(db, r.services, origin, row) },
      };
    },
    async render(db, stored) {
      return { outcome: stored.code, shop: await renderShop(db, r.services, origin) };
    },
  });
}
