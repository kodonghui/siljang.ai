/** API-010/SPEC-077. 변경은 가게 설정에만 쓰며 이미 열린 기다림/주문은 바꾸지 않는다. */
import { requireJson } from "./body";
import { ApiError } from "./problem";
import type { ShopRequest } from "./routes";
import {
  parseShopSettings,
  SHOP_SETTING_COLUMNS,
  type ShopSettingKey,
  type ShopSettingsValues,
  validateShopMailOrder,
} from "./shop-settings-input";
import { renderShop } from "./shops";

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
      const row = await db.found<Record<string, unknown> & { revision: string }>(
        "SELECT s.*,s.xmin::text AS revision FROM shops s WHERE s.id=$1 FOR NO KEY UPDATE",
      );
      if (input.baseRevision !== row.revision) throw new ApiError("version_conflict");
      const previous = Object.fromEntries(
        Object.entries(SHOP_SETTING_COLUMNS).map(([key, column]) => [key, row[column]]),
      ) as unknown as ShopSettingsValues;
      validateShopMailOrder({ ...previous, ...input.changes });
      const changed = (Object.keys(input.changes) as ShopSettingKey[]).filter(
        (key) => input.changes[key] !== previous[key],
      );
      if (changed.length) {
        const assignments = changed.map((key, i) => `${SHOP_SETTING_COLUMNS[key]}=$${i + 2}`);
        // 열 이름은 위 고정 목록만 사용한다. 요청 값은 모두 별도 매개변수다.
        await db.run(`UPDATE shops SET ${assignments.join(",")},updated_at=$${changed.length + 2} WHERE id=$1`, [
          ...changed.map((key) => input.changes[key]),
          now,
        ]);
      }
      const outcome = changed.length ? "done" : "unchanged";
      return { status: 200, code: outcome, ref: {}, body: { outcome, shop: await renderShop(db, r.services, origin) } };
    },
    async render(db, stored) {
      return { outcome: stored.code, shop: await renderShop(db, r.services, origin) };
    },
  });
}
