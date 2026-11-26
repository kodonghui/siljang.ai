import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createDayBeforeNotice } from "../src/day-before-notice";
import type { Queryable, RequestDb } from "../src/db";
import { kakaoCallback } from "../src/kakao-callback";
import { consumeKakaoCallback } from "../src/kakao-callback-queue";
import { storeKakaoCallback } from "../src/kakao-callback-store";
import { createServices } from "../src/services";
import { readSettings } from "../src/settings";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { describeDb, newUuid, testEnv } from "./support/db";
import { newFieldKey } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-27T09:00:00Z"),
  PICKUP = new Date("2026-11-28T06:00:00Z");
const CONFIRMED = new Date(NOW.getTime() - 86400000);
const env = testEnv({ FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: newFieldKey() });
describeDb("전날 안내의 실제 콜백 소비자와 Cron 갱신 경쟁", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    shop = await createShop(isolated.db, "합성 콜백 전날 안내 가게");
    await issueTestBookingLink(isolated.db, shop);
    await linkTestChannel(isolated.db, shop.channelId);
    await isolated.db.transaction(async (tx) => {
      await tx.query("UPDATE shops SET pickup_address='합성 첫 장소',contact_phone='02-000-0000' WHERE id=$1", [
        shop.shopId,
      ]);
      await tx.query(
        "UPDATE payment_requests SET status='paid',paid_at=$2,arrived_at=$2,arrived_amount=amount WHERE id=$1",
        [shop.paymentRequestId, CONFIRMED],
      );
      const paymentId = newUuid();
      await tx.query(
        "INSERT INTO payments(id,shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES($1,$2,$3,$4,35000,$5)",
        [paymentId, shop.shopId, shop.orderId, shop.paymentRequestId, CONFIRMED],
      );
      await tx.query("UPDATE order_details SET pickup_at=$2 WHERE order_id=$1 AND version=1", [shop.orderId, PICKUP]);
      await tx.query(
        "UPDATE orders SET status='confirmed',confirmed_at=$2,confirmed_payment_id=$3,pickup_at=$4,pickup_day='2026-11-28' WHERE id=$1",
        [shop.orderId, CONFIRMED, paymentId, PICKUP],
      );
      await tx.query("UPDATE messages SET created_at=$2 WHERE id=$1", [shop.messageId, NOW]);
    });
    const db = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "day_before_notice" }), isolated.db);
    expect(await db.transaction((tx) => createDayBeforeNotice(tx, shop.orderId, NOW))).toBe(true);
    const callback = kakaoCallback("https://bot-api.kakao.com/v1/callback/synthetic_day_before", NOW);
    if (callback === null) throw new Error("합성 콜백 없음");
    await db.transaction((tx) =>
      storeKakaoCallback(
        tx,
        createServices(env, readSettings(env)).fieldCrypto(),
        shop.messageId,
        callback,
        () => 1000,
      ),
    );
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("합성 시험의 실제 발신 금지"));
  });
  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await isolated?.close();
  });
  const cron = () =>
    shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "day_before_notice" }), isolated.db).transaction(
      (tx) => createDayBeforeNotice(tx, shop.orderId, NOW),
    );
  it("발신 중 Cron이 같은 안내를 고치지 못하고 성공 뒤 다시 만들지 않는다", async () => {
    let refreshed: boolean | undefined,
      sent = "";
    const send = vi.fn<typeof fetch>(async (_url, init) => {
      sent = String(init?.body);
      await isolated.db.query("UPDATE shops SET pickup_address='합성 바뀐 장소' WHERE id=$1", [shop.shopId]);
      refreshed = await cron();
      return Response.json({ status: "SUCCESS" });
    });
    await expect(
      consumeKakaoCallback({ shopId: shop.shopId, messageId: shop.messageId }, env, {
        connect: () => isolated.connect(),
        now: () => NOW,
        fetch: send,
        logSink: () => {},
      }),
    ).resolves.toBe("done");
    expect(refreshed).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(sent).toContain("합성 첫 장소");
    expect(await cron()).toBe(false);
    const rows = (
      await isolated.db.query("SELECT status,body FROM notifications WHERE shop_id=$1 AND kind='day_before'", [
        shop.shopId,
      ])
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "delivered_on_reply" });
    expect(rows[0]?.body).toContain("합성 첫 장소");
  });
  it("선택 트랜잭션 뒤 장소가 바뀌면 발신 직전 검사에서 옛 안내를 보내지 않는다", async () => {
    let changed = false;
    const wrap = (raw: RequestDb): RequestDb => ({
      query: raw.query.bind(raw),
      close: () => raw.close(),
      abort: () => raw.abort(),
      async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
        let selected = false;
        const value = await raw.transaction((tx) =>
          fn({
            async query<R>(sql: string, params?: readonly unknown[]) {
              const result = await tx.query<R>(sql, params);
              if (sql.includes("FROM notifications n") && sql.includes("FOR UPDATE OF n")) selected = true;
              return result;
            },
          }),
        );
        if (selected && !changed) {
          changed = true;
          await isolated.db.query("UPDATE shops SET pickup_address='발신 전 바뀐 합성 장소' WHERE id=$1", [
            shop.shopId,
          ]);
        }
        return value;
      },
    });
    const send = vi.fn(async () => Response.json({ status: "SUCCESS" }));
    expect(
      await consumeKakaoCallback({ shopId: shop.shopId, messageId: shop.messageId }, env, {
        connect: () => wrap(isolated.connect()),
        now: () => NOW,
        fetch: send,
        logSink: () => {},
      }),
    ).toBe("done");
    expect(changed).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(await cron()).toBe(true);
    const notice = (
      await isolated.db.query("SELECT status,body,sent_at FROM notifications WHERE shop_id=$1 AND kind='day_before'", [
        shop.shopId,
      ])
    ).rows[0];
    expect(notice).toMatchObject({ status: "deferred", sent_at: null });
    expect(notice?.body).toContain("발신 전 바뀐 합성 장소");
  });
});
