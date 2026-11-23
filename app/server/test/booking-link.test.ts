import { afterAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { PrivacyPolicySettings } from "../src/privacy-policy-settings";
import { readPrivacyPolicySettings } from "../src/privacy-policy-settings";
import { ApiError } from "../src/problem";
import { createShopScope } from "../src/shop-scope";
import { expectProblem, expectSchema } from "./support/contract";
import { describeDb, newUuid, testDb, testEnv } from "./support/db";
import { MemoryLimiter } from "./support/rate-limit";

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

const POLICY = readPrivacyPolicySettings(
  {
    PUBLIC_APP_ORIGIN: "https://siljang.example",
    PRIVACY_TRANSFER_SETTINGS: JSON.stringify(
      ["anthropic", "supabase", "cloudflare"].map((provider) => ({
        provider,
        recipient: `${provider} 합성 회사`,
        country: "합성 국가",
        whenAndHow: "이용 시 암호화 전송",
        purposeAndRetention: "합성 목적과 기간",
        howToRefuse: "가게에 거부하면 온라인 상담을 쓰지 않습니다.",
      })),
    ),
  },
  "anthropic",
) as PrivacyPolicySettings;

async function readyFixture(privacyPolicy: PrivacyPolicySettings | null = POLICY) {
  const ownerId = newUuid(),
    shopId = newUuid(),
    operatorId = newUuid();
  await db.transaction(async (tx) => {
    await tx.query("INSERT INTO owners(id,kakao_account_id) VALUES ($1,$2)", [
      ownerId,
      BigInt(`0x${newUuid().replaceAll("-", "").slice(0, 13)}`).toString(),
    ]);
    await tx.query("INSERT INTO operators(id,email,display_name) VALUES ($1,$2,'합성 운영자')", [
      operatorId,
      `${newUuid()}@example.invalid`,
    ]);
    await tx.query(
      `INSERT INTO shops(id,owner_id,name,contact_phone,contact_email,business_address,business_name,representative_name,business_reg_no,mail_order_exemption,food_license_no,food_business_type,license_photo_key,entrustment_terms_version,entrustment_consented_at,license_status,license_reviewed_by,license_reviewed_at)
    VALUES ($1,$2,'준비된 합성 가게','010-0000-0000','booking@example.invalid','서울 합성로1','합성 제과','합성 시험','1234567890','합성 면제','2026-0001','bakery','license/synthetic.png','test-v1',$3,'verified',$4,$3)`,
      [shopId, ownerId, NOW, operatorId],
    );
    await tx.query("INSERT INTO price_lists(shop_id,version) VALUES ($1,1)", [shopId]);
    await tx.query(
      "INSERT INTO operating_rules(shop_id,version,change_deadline_hours,date_change_refund_basis) VALUES ($1,1,48,'original_pickup')",
      [shopId],
    );
    await tx.query(
      "INSERT INTO business_calendars(shop_id,daily_capacity,order_cutoff_days,order_cutoff_time) VALUES ($1,10,2,'18:00')",
      [shopId],
    );
    await tx.query(
      `INSERT INTO payment_accounts(shop_id,bank_name,account_number_enc,account_last4,holder_name,holder_checked_by,holder_checked_at)
    VALUES ($1,'합성 은행','v1:TESTnonce000000000000ciphertext0001tag16','0000','합성 시험',$2,$3)`,
      [shopId, operatorId, NOW],
    );
    await tx.query(
      `INSERT INTO kakao_channels(shop_id,bot_id,status,linked_at,card_block_id,orderer_block_id,allergy_block_id,depositor_block_id,review_block_id,verified_blocks)
    VALUES ($1,$2,'linked',$3,'card','orderer','allergy','depositor','review',ARRAY['card','orderer_info','allergy_answer','depositor_name','review'])`,
      [shopId, newUuid().replaceAll("-", ""), NOW],
    );
  });
  const limiter = new MemoryLimiter(60);
  const app = createApp({
    scopes: {
      owner: async (c) => {
        if (c.req.header("x-test-owner") !== ownerId) throw new ApiError("unauthenticated");
        return createShopScope(shopId, { kind: "owner", ownerId });
      },
    },
    services: { now: () => NOW, privacyPolicy, limiters: { PUBLIC_PRIVACY_RATE_LIMITER: limiter } },
  });
  const get = () =>
    app.request("https://siljang.example/api/owner/booking-link", { headers: { "x-test-owner": ownerId } }, testEnv());
  const publicGet = (slug: string) =>
    app.request(`https://siljang.example/api/public/shops/${slug}/privacy-policy`, {}, testEnv());
  return { ownerId, shopId, operatorId, app, get, publicGet, limiter };
}

describeDb("TASK-044 발급·공개 처리방침", () => {
  it("여섯 조건이 채워지면 처리방침/링크를 한 번 만들고 동시에 여덟 번 불러도 같은 주소임", async () => {
    const h = await readyFixture();
    const responses = await Promise.all(Array.from({ length: 8 }, () => h.get()));
    const bodies = [];
    for (const r of responses) {
      expect(r.status, await r.clone().text()).toBe(200);
      const body = await r.json();
      expectSchema("BookingLink", body);
      bodies.push(body);
    }
    expect(new Set(bodies.map((x) => x.url)).size).toBe(1);
    expect(bodies[0]).toMatchObject({ status: "issued", missing: [], recommended: ["pickup_address"] });
    expect(
      (await db.query("SELECT count(*)::int AS n FROM privacy_policies WHERE shop_id=$1", [h.shopId])).rows[0]?.n,
    ).toBe(1);
    const slug = new URL(bodies[0].url).pathname.split("/").at(-1) as string;
    const response = await h.publicGet(slug);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const policy = await response.json();
    expectSchema("PrivacyPolicy", policy);
    expect(policy.version).toBe(1);
    expect(policy.overseasTransfers).toHaveLength(3);
    for (const text of [
      "주문자 이름",
      "연락처",
      "입금자 이름",
      "알레르기",
      "30일",
      "5년",
      "3년",
      "열람",
      "삭제",
      "동의 철회",
    ])
      expect(policy.body).toContain(text);
    expect(JSON.stringify(policy)).not.toContain(h.ownerId);
    expect(JSON.stringify(policy)).not.toContain(h.shopId);
  });
  it.each(["license_verified", "payment_destination"] as const)(
    "%s만 빠지면 주소/처리방침을 만들지 않음",
    async (missing) => {
      const h = await readyFixture();
      if (missing === "license_verified")
        await db.query(
          "UPDATE shops SET license_status='pending',license_reviewed_by=NULL,license_reviewed_at=NULL WHERE id=$1",
          [h.shopId],
        );
      else await db.query("UPDATE payment_accounts SET retired_at=$2 WHERE shop_id=$1", [h.shopId, NOW]);
      const response = await h.get();
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        status: "not_ready",
        missing: [missing],
        url: null,
        issuedAt: null,
      });
      expect(
        (await db.query("SELECT count(*)::int AS n FROM privacy_policies WHERE shop_id=$1", [h.shopId])).rows[0]?.n,
      ).toBe(0);
    },
  );
  it("국외 이전 설정 부재는 링크를 막고 반복/동시 조회에도 하루 알림 하나만 남김", async () => {
    const h = await readyFixture(null);
    for (const response of await Promise.all([h.get(), h.get(), h.get()])) {
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: "not_ready", missing: ["privacy_policy"] });
    }
    expect(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM ops_events WHERE shop_id=$1 AND kind='privacy_transfer_missing'",
          [h.shopId],
        )
      ).rows[0]?.n,
    ).toBe(1);
  });
  it("공개하지 않은 가게/없는 주소/잘못된 주소는 같은404이며 공개 조회는 IP당60번 뒤429", async () => {
    const h = await readyFixture();
    for (const slug of ["missing-slug", "UPPERCASE", "x"]) await expectProblem(await h.publicGet(slug), "not_found");
    h.limiter.reset();
    for (let i = 0; i < 60; i++) await expectProblem(await h.publicGet("missing-slug"), "not_found");
    const limited = await h.publicGet("missing-slug");
    await expectProblem(limited, "rate_limited");
    expect(limited.headers.get("retry-after")).toBe("60");
    expect([...h.limiter.counts.keys()].some((x) => x.includes("local"))).toBe(false);
  });
});
