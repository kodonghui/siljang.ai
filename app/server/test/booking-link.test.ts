import { afterAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import { ApiError } from "../src/problem";
import { createShopScope } from "../src/shop-scope";
import { expectProblem, expectSchema } from "./support/contract";
import { describeDb, newUuid, testDb, testEnv } from "./support/db";

const NOW = new Date("2026-11-23T01:00:00Z");
const db = testDb();

it("예약 링크의 무인증 요청은401이며 데이터베이스를 조회하지 않음", async () => {
  let queries = 0;
  const app = createApp({
    connect: () => ({
      async query() {
        queries++;
        throw new Error("synthetic unexpected database query");
      },
      async transaction() {
        queries++;
        throw new Error("synthetic unexpected database transaction");
      },
      async abort() {},
      async close() {},
    }),
  });
  await expectProblem(
    await app.request("https://siljang.example/api/owner/booking-link", {}, testEnv()),
    "unauthenticated",
  );
  expect(queries).toBe(0);
});

describeDb("TASK-044 예약 링크와 처리방침", () => {
  afterAll(async () => db.close());

  it("등록 직후에는 빠진 일곱 조건과 추천 항목만 알려 주고 링크를 내지 않음", async () => {
    const ownerId = newUuid(),
      shopId = newUuid();
    await db.transaction(async (tx) => {
      await tx.query("INSERT INTO owners (id,kakao_account_id) VALUES ($1,$2)", [
        ownerId,
        BigInt(`0x${newUuid().replaceAll("-", "").slice(0, 13)}`).toString(),
      ]);
      await tx.query(
        `INSERT INTO shops (id,owner_id,name,contact_phone,contact_email,business_address,business_name,representative_name,business_reg_no,mail_order_exemption,food_license_no,food_business_type,license_photo_key,entrustment_terms_version,entrustment_consented_at)
         VALUES ($1,$2,'예약 링크 합성 가게','010-0000-0000','booking@example.com','서울 합성로1','합성 제과','시험사장','1234567890','합성 면제','2026-0001','bakery','license/synthetic.png','test-v1',$3)`,
        [shopId, ownerId, NOW],
      );
    });
    const app = createApp({
      scopes: {
        owner: async (c) => {
          if (c.req.header("x-test-owner") !== ownerId) throw new ApiError("unauthenticated");
          return createShopScope(shopId, { kind: "owner", ownerId });
        },
      },
      services: { now: () => NOW },
    });
    const response = await app.request(
      "https://siljang.example/api/owner/booking-link",
      {
        headers: { "x-test-owner": ownerId },
      },
      testEnv(),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = await response.json();
    expectSchema("BookingLink", body);
    expect(body).toEqual({
      status: "not_ready",
      url: null,
      issuedAt: null,
      missing: [
        "price_list",
        "operating_rules",
        "calendar",
        "license_verified",
        "kakao_channel",
        "payment_destination",
        "privacy_policy",
      ],
      recommended: ["pickup_address"],
    });
    expect((await db.query("SELECT booking_slug,booking_issued_at FROM shops WHERE id=$1", [shopId])).rows).toEqual([
      { booking_slug: null, booking_issued_at: null },
    ]);
  });
});
