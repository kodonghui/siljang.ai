import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { runScheduled } from "../src/scheduled";
import { describeDb, newUuid, testEnv } from "./support/db";
import { singleKeyCrypto } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-27T09:00:00Z");
const PICKUP = new Date("2026-11-28T06:00:00Z");
describeDb("전날 안내의 기본 일 실행기 연결(TASK-134, SPEC-052)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    shop = await createShop(isolated.db, "합성 전날 안내 가게");
    await linkTestChannel(isolated.db, shop.channelId);
    const paid = newUuid();
    await isolated.db.transaction(async (tx) => {
      await tx.query("UPDATE shops SET pickup_address='합성 픽업 장소',contact_phone='02-000-0000' WHERE id=$1", [
        shop.shopId,
      ]);
      await tx.query(
        "UPDATE payment_requests SET status='paid',paid_at=$2,arrived_at=$2,arrived_amount=amount WHERE id=$1",
        [shop.paymentRequestId, NOW],
      );
      await tx.query(
        "INSERT INTO payments(id,shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES($1,$2,$3,$4,35000,$5)",
        [paid, shop.shopId, shop.orderId, shop.paymentRequestId, NOW],
      );
      await tx.query("UPDATE order_details SET pickup_at=$2 WHERE order_id=$1 AND version=1", [shop.orderId, PICKUP]);
      await tx.query(
        "UPDATE orders SET status='confirmed',confirmed_at=$2,confirmed_payment_id=$3,pickup_at=$4,pickup_day='2026-11-28' WHERE id=$1",
        [shop.orderId, NOW, paid, PICKUP],
      );
      await tx.query(
        "INSERT INTO business_calendars(shop_id,daily_capacity,order_cutoff_days,order_cutoff_time,day_before_notice_time) VALUES($1,10,2,'18:00','18:00') ON CONFLICT(shop_id) DO UPDATE SET day_before_notice_time='18:00'",
        [shop.shopId],
      );
    });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("합성 전날 안내의 실제 발신 금지"));
  });
  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await isolated?.close();
  });
  it.each([false, true])(
    "가게 시간의 전날18시에 광고 없이 한 번 만들고 픽업 장소가 비어도 보존한다(빈 장소%s)",
    async (empty) => {
      if (empty) await isolated.db.query("UPDATE shops SET pickup_address=NULL WHERE id=$1", [shop.shopId]);
      const { keys } = singleKeyCrypto();
      const fieldKey = keys.get(1);
      if (fieldKey === undefined) throw new Error("합성 암호화 키 없음");
      const env = testEnv({ FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: fieldKey });
      for (const now of [NOW, new Date(NOW.getTime() + 60000)]) {
        const result = await runScheduled({ scheduledTime: now.getTime(), cron: "* * * * *" }, env, {
          connect: () => isolated.connect(),
          logSink: () => {},
          now: () => now,
        });
        expect(result).not.toBeNull();
      }
      const rows = await isolated.db.query<{ body: string; scheduled_for: Date; status: string; sent_at: Date | null }>(
        "SELECT body,scheduled_for,status,sent_at FROM notifications WHERE shop_id=$1 AND order_id=$2 AND kind='day_before'",
        [shop.shopId, shop.orderId],
      );
      expect(rows.rows).toHaveLength(1);
      const notice = rows.rows[0];
      if (notice === undefined) throw new Error("전날 안내가 생성되지 않음");
      expect(notice).toMatchObject({ scheduled_for: NOW, status: "deferred", sent_at: null });
      expect(notice.body).toContain("2026-11-28");
      expect(notice.body).toContain("15:00");
      expect(notice.body).toContain("02-000-0000");
      expect(notice.body).not.toMatch(/할인|이벤트|다른 상품/u);
      if (empty) expect(notice.body).not.toMatch(/픽업 장소|위치/u);
      else expect(notice.body).toContain("합성 픽업 장소");
    },
  );
});
