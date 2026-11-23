import { afterAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import { expectProblem, expectSchema } from "./support/contract";
import { describeDb, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { MemoryLimiter } from "./support/rate-limit";
import { createShop, issueTestBookingLink, linkTestChannel } from "./support/shops";

const db = testDb();
const NOW = new Date("2026-11-23T02:00:00Z");
const ORIGIN = "https://siljang.example";

async function fixture() {
  const shop = await createShop(db, "공개 예약 합성 가게");
  await linkTestChannel(db, shop.channelId);
  await issueTestBookingLink(db, shop);
  const row = (await db.query<{ booking_slug: string }>("SELECT booking_slug FROM shops WHERE id=$1", [shop.shopId]))
    .rows[0];
  if (!row) throw new Error("합성 예약 주소 없음");
  const pageLimit = new MemoryLimiter(60),
    privacyLimit = new MemoryLimiter(60);
  const limiters = { PUBLIC_BOOKING_RATE_LIMITER: pageLimit, PUBLIC_PRIVACY_RATE_LIMITER: privacyLimit };
  const app = createApp({ services: { now: () => NOW, publicAppOrigin: ORIGIN, limiters } });
  const get = (slug = row.booking_slug) =>
    app.request(`${ORIGIN}/api/public/shops/${slug}`, {}, testEnv({ FILE_URL_KEY: TEST_HASH_KEY }));
  return { shop, slug: row.booking_slug, app, get, pageLimit, privacyLimit };
}

describeDb("TASK-045 공개 예약 페이지", () => {
  afterAll(async () => db.close());
  it("누구나 발급된 가게의 신원·현재 가격표·날짜 상태만 읽으며 내부 ID/자리 수는 없음", async () => {
    const h = await fixture(),
      response = await h.get();
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      shop: { name: string };
      priceList: { version: number };
      days: unknown[];
      portfolio: unknown[];
    };
    expectSchema("BookingPage", body);
    expect(body.shop.name).toBe("공개 예약 합성 가게");
    expect(body.priceList.version).toBe(1);
    expect(body.days).toHaveLength(60);
    expect(body.portfolio).toEqual([]);
    const text = JSON.stringify(body);
    for (const id of [
      h.shop.shopId,
      h.shop.ownerId,
      h.shop.customerId,
      h.shop.orderId,
      h.shop.priceListId,
      h.shop.designId,
    ])
      expect(text).not.toContain(id);
    for (const field of ["remaining", "held", "capacity", "orderNo", "customerName"])
      expect(text).not.toContain(`"${field}"`);
  });
  it("공개 페이지는 IP당60번 뒤429이며 처리방침의 한도와 따로 셈", async () => {
    const h = await fixture();
    for (let i = 0; i < 60; i++) await h.get("missing-slug");
    await expectProblem(await h.get("missing-slug"), "rate_limited");
    expect(h.privacyLimit.counts.size).toBe(0);
    const privacy = await h.app.request(`${ORIGIN}/api/public/shops/missing-slug/privacy-policy`, {}, testEnv());
    await expectProblem(privacy, "not_found");
    expect(h.privacyLimit.counts.size).toBe(1);
  });
});
