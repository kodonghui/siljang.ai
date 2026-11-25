import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createDayBeforeNotice } from "../src/day-before-notice";
import { runScheduled } from "../src/scheduled";
import { createShopScope, shopDb, shopRequestDb } from "../src/shop-scope";
import { describeDb, newUuid, testDb, testEnv } from "./support/db";
import { singleKeyCrypto } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-27T09:00:00Z");
const CONFIRMED = new Date(NOW.getTime() - 3600000);
const PICKUP = new Date("2026-11-28T06:00:00Z");
describeDb("전날 안내의 기본 일 실행기 연결(TASK-134, SPEC-052)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture;
  const role = `day134_${newUuid().replaceAll("-", "")}`;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
    await isolated.db.query(`CREATE ROLE "${role}" NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await isolated.db.query(
      readFileSync(new URL("../../../tools/staging-login-callback-grants.sql", import.meta.url), "utf8").replaceAll(
        ':"runtime_role"',
        `"${role}"`,
      ),
    );
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
        [shop.paymentRequestId, CONFIRMED],
      );
      await tx.query(
        "INSERT INTO payments(id,shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES($1,$2,$3,$4,35000,$5)",
        [paid, shop.shopId, shop.orderId, shop.paymentRequestId, CONFIRMED],
      );
      await tx.query("UPDATE order_details SET pickup_at=$2 WHERE order_id=$1 AND version=1", [shop.orderId, PICKUP]);
      await tx.query(
        "UPDATE orders SET status='confirmed',confirmed_at=$2,confirmed_payment_id=$3,pickup_at=$4,pickup_day='2026-11-28' WHERE id=$1",
        [shop.orderId, CONFIRMED, paid, PICKUP],
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
    const admin = testDb();
    try {
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
    } finally {
      await admin.close();
    }
  });
  it("실제 제한 역할로 자기 주문 안내를 만들고 다른 가게 주문에는 쓰지 않는다", async () => {
    const other = await createShop(isolated.db, "합성 다른 전날 안내 가게");
    await isolated.db.transaction(async (raw) => {
      await raw.query(`SET LOCAL ROLE "${role}"`);
      const scoped = shopDb(createShopScope(shop.shopId, { kind: "job", job: "day_before_notice" }), raw);
      expect(await createDayBeforeNotice(scoped, other.orderId, NOW)).toBe(false);
      expect(await createDayBeforeNotice(scoped, shop.orderId, NOW)).toBe(true);
    });
    expect(
      (
        await isolated.db.query("SELECT count(*)::int AS n FROM notifications WHERE shop_id=$1 AND kind='day_before'", [
          other.shopId,
        ])
      ).rows[0]?.n,
    ).toBe(0);
  });
  it("독립 연결의 동시 생성도 안내 한 건만 남긴다", async () => {
    const first = isolated.connect(),
      second = isolated.connect();
    const scope = createShopScope(shop.shopId, { kind: "job", job: "day_before_notice" });
    try {
      const results = await Promise.all(
        [first, second].map((db) =>
          shopRequestDb(scope, db).transaction((tx) => createDayBeforeNotice(tx, shop.orderId, NOW)),
        ),
      );
      expect(results.sort()).toEqual([false, true]);
      expect(
        (
          await isolated.db.query(
            "SELECT count(*)::int AS n FROM notifications WHERE shop_id=$1 AND kind='day_before'",
            [shop.shopId],
          )
        ).rows[0]?.n,
      ).toBe(1);
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });
  it("생성 함수는 정각 전/반복/미전달 값 변경/이미 전한 안내를 구분한다", async () => {
    const scoped = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "day_before_notice" }), isolated.db);
    const create = (now = NOW, id = shop.orderId) => scoped.transaction((tx) => createDayBeforeNotice(tx, id, now));
    expect(await create(new Date(NOW.getTime() - 60000))).toBe(false);
    expect(await create()).toBe(true);
    expect(await create(NOW, shop.orderId.toUpperCase())).toBe(false);
    expect(await create()).toBe(false);
    const setPickup = async (hour: number) =>
      isolated.db.transaction(async (tx) => {
        const at = new Date(PICKUP.getTime() + hour * 3600000);
        await tx.query("UPDATE order_details SET pickup_at=$2 WHERE order_id=$1 AND version=1", [shop.orderId, at]);
        await tx.query("UPDATE orders SET pickup_at=$2 WHERE id=$1", [shop.orderId, at]);
      });
    await setPickup(1);
    expect(await create()).toBe(true);
    const rows = await isolated.db.query<{ id: string; body: string }>(
      "SELECT id,body FROM notifications WHERE shop_id=$1 AND kind='day_before'",
      [shop.shopId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.body).toContain("16:00");
    await isolated.db.query("UPDATE notifications SET status='delivered_on_reply',sent_at=$2 WHERE id=$1", [
      rows.rows[0]?.id,
      NOW,
    ]);
    await setPickup(2);
    expect(await create()).toBe(false);
    expect(
      (await isolated.db.query("SELECT body FROM notifications WHERE id=$1", [rows.rows[0]?.id])).rows[0]?.body,
    ).toBe(rows.rows[0]?.body);
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
