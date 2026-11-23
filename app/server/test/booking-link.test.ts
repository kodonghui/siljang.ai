import { afterAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import { type DbConnector, pgConnector, type Queryable, type RequestDb } from "../src/db";
import { OWNER_COOKIE } from "../src/owner-oauth";
import { createOwnerSession } from "../src/owner-session";
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

async function readyFixture(privacyPolicy: PrivacyPolicySettings | null = POLICY, connect?: DbConnector) {
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
    ...(connect === undefined ? {} : { connect }),
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
  it("가게가 없는 실제 합성 사장님 세션은404 shop_not_registered", async () => {
    const account = BigInt(`0x${newUuid().replaceAll("-", "").slice(0, 13)}`).toString();
    const session = await createOwnerSession(db, { accountId: account, friend: false }, NOW, false);
    await expectProblem(
      await createApp({ services: { now: () => NOW } }).request(
        "https://siljang.example/api/owner/booking-link",
        { headers: { cookie: `${OWNER_COOKIE}=${session.token}` } },
        testEnv(),
      ),
      "shop_not_registered",
    );
  });
  it("커밋 응답을 잃어도 재조회는 발급한 주소/처리방침 하나를 복구함", async () => {
    let lose = true;
    const h = await readyFixture(POLICY, (secret) => {
      const base = pgConnector(secret);
      return {
        query: (sql, params) => base.query(sql, params),
        transaction: async <T>(fn: (tx: Queryable) => Promise<T>) => {
          const result = await base.transaction(fn);
          if (lose) {
            lose = false;
            throw new Error("synthetic commit response lost");
          }
          return result;
        },
        abort: () => base.abort(),
        close: () => base.close(),
      };
    });
    await expectProblem(await h.get(), "internal");
    const saved = (
      await db.query<{ booking_slug: string; booking_issued_at: Date }>(
        "SELECT booking_slug,booking_issued_at FROM shops WHERE id=$1",
        [h.shopId],
      )
    ).rows[0];
    expect(saved?.booking_slug).toMatch(/^[a-z0-9]{32}$/);
    const response = await h.get();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "issued",
      url: `https://siljang.example/s/${saved?.booking_slug}`,
    });
    expect(
      (await db.query("SELECT count(*)::int AS n FROM privacy_policies WHERE shop_id=$1", [h.shopId])).rows[0]?.n,
    ).toBe(1);
  });
  it("주소 쓰기 전 오류면 처리방침도 롤백하고 다음 조회로 한 번 발급함", async () => {
    let fail = true;
    const h = await readyFixture(POLICY, (secret) => {
      const base = pgConnector(secret);
      return {
        query: (sql, params) => base.query(sql, params),
        transaction: <T>(fn: (tx: Queryable) => Promise<T>) =>
          base.transaction((tx) =>
            fn({
              query: async (sql, params) => {
                if (fail && sql.startsWith("UPDATE shops SET booking_slug")) {
                  fail = false;
                  throw new Error("synthetic write failure");
                }
                return tx.query(sql, params);
              },
            }),
          ),
        abort: () => base.abort(),
        close: () => base.close(),
      };
    });
    await expectProblem(await h.get(), "internal");
    expect(
      (await db.query("SELECT count(*)::int AS n FROM privacy_policies WHERE shop_id=$1", [h.shopId])).rows[0]?.n,
    ).toBe(0);
    expect((await db.query("SELECT booking_slug FROM shops WHERE id=$1", [h.shopId])).rows[0]?.booking_slug).toBeNull();
    expect((await h.get()).status).toBe(200);
  });
  it("공개 경로의 데이터베이스 오류는500이며 비공개 내용을 내보내지 않음", async () => {
    const app = createApp({
      connect: () => ({
        async query() {
          throw new Error("synthetic private database detail");
        },
        async transaction() {
          throw new Error("synthetic private database detail");
        },
        async abort() {},
        async close() {},
      }),
      services: { limiters: { PUBLIC_PRIVACY_RATE_LIMITER: new MemoryLimiter(60) } },
    });
    const problem = await expectProblem(
      await app.request("https://siljang.example/api/public/shops/missing-slug/privacy-policy", {}, testEnv()),
      "internal",
    );
    expect(JSON.stringify(problem)).not.toContain("synthetic private");
  });
  it("발급 뒤 다른 조건/처리방침 설정이 없어져도 같은 주소·시각과 옛 본문을 보존함", async () => {
    const h = await readyFixture();
    const first = (await (await h.get()).json()) as { url: string; issuedAt: string };
    await db.query("UPDATE shops SET pickup_address='서울 합성 픽업1' WHERE id=$1", [h.shopId]);
    await db.query("UPDATE payment_accounts SET retired_at=$2 WHERE shop_id=$1", [h.shopId, NOW]);
    const app = createApp({
      scopes: { owner: async () => createShopScope(h.shopId, { kind: "owner", ownerId: h.ownerId }) },
      services: { now: () => NOW, privacyPolicy: null, publicAppOrigin: "https://siljang.example" },
    });
    const response = await app.request("https://siljang.example/api/owner/booking-link", {}, testEnv());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "issued",
      url: first.url,
      issuedAt: first.issuedAt,
      missing: [],
      recommended: [],
    });
    expect(
      (await db.query("SELECT count(*)::int AS n FROM privacy_policies WHERE shop_id=$1", [h.shopId])).rows[0]?.n,
    ).toBe(1);
  });
  it("새 버전은 최신 공개 글로 읽고 미래 게시 글/옛 버전은 바꾸지 않음", async () => {
    const h = await readyFixture();
    const link = (await (await h.get()).json()) as { url: string };
    const slug = new URL(link.url).pathname.split("/").at(-1) as string;
    const first = (
      await db.query<{ body: string }>("SELECT body FROM privacy_policies WHERE shop_id=$1 AND version=1", [h.shopId])
    ).rows[0]?.body;
    const customerId = newUuid(),
      consultationId = newUuid();
    await db.query(
      "INSERT INTO customers(id,shop_id,kakao_channel_id,kakao_user_key) SELECT $2,$1,k.id,$3 FROM kakao_channels k WHERE k.shop_id=$1 AND k.status='linked'",
      [h.shopId, customerId, newUuid()],
    );
    await db.query(
      "INSERT INTO consultations(shop_id,id,customer_id,ai_disclosed_at,ai_disclosed_policy_version) VALUES ($1,$2,$3,$4,1)",
      [h.shopId, consultationId, customerId, NOW],
    );

    await db.query(
      "INSERT INTO privacy_policies(shop_id,version,body,overseas_transfers,published_at) VALUES ($1,2,$2,$3::jsonb,$4)",
      [h.shopId, "새 합성 처리방침", JSON.stringify(POLICY.transfers), NOW],
    );
    await db.query(
      "INSERT INTO privacy_policies(shop_id,version,body,overseas_transfers,published_at) VALUES ($1,3,'미래 합성 글',$2::jsonb,$3::timestamptz+interval '1 hour')",
      [h.shopId, JSON.stringify(POLICY.transfers), NOW],
    );
    const response = await h.publicGet(slug);
    expect(response.status).toBe(200);
    const value = await response.json();
    expectSchema("PrivacyPolicy", value);
    expect(value).toMatchObject({ version: 2, body: "새 합성 처리방침" });
    expect(
      (await db.query("SELECT body FROM privacy_policies WHERE shop_id=$1 AND version=1", [h.shopId])).rows[0]?.body,
    ).toBe(first);
    expect(((await (await h.get()).json()) as { url: string }).url).toBe(link.url);
    expect(
      (
        await db.query(
          "SELECT ai_disclosed_at,ai_disclosed_policy_version FROM consultations WHERE shop_id=$1 AND id=$2",
          [h.shopId, consultationId],
        )
      ).rows,
    ).toEqual([{ ai_disclosed_at: NOW, ai_disclosed_policy_version: 1 }]);
    await expect(
      db.query("DELETE FROM privacy_policies WHERE shop_id=$1 AND version=1", [h.shopId]),
    ).rejects.toMatchObject({ code: "23503" });
  });
  it.each(["price_list", "operating_rules", "calendar", "kakao_channel"] as const)(
    "%s만 빠진 상태와 이전 버전/연결은 새 발급 조건이 아님",
    async (missing) => {
      const h = await readyFixture();
      if (missing === "price_list")
        await db.query("UPDATE price_lists SET superseded_at=$2 WHERE shop_id=$1", [h.shopId, NOW]);
      if (missing === "operating_rules")
        await db.query("UPDATE operating_rules SET superseded_at=$2 WHERE shop_id=$1", [h.shopId, NOW]);
      if (missing === "calendar") await db.query("DELETE FROM business_calendars WHERE shop_id=$1", [h.shopId]);
      if (missing === "kakao_channel")
        await db.query("UPDATE kakao_channels SET status='retired',retired_at=$2 WHERE shop_id=$1", [h.shopId, NOW]);
      const response = await h.get();
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: "not_ready", missing: [missing], url: null });
    },
  );
  it("영업 신고 미확인 가게에는 데이터베이스도 예약 주소를 허용하지 않음(A10)", async () => {
    const h = await readyFixture();
    await db.query(
      "UPDATE shops SET license_status='pending',license_reviewed_by=NULL,license_reviewed_at=NULL WHERE id=$1",
      [h.shopId],
    );
    await expect(
      db.query("UPDATE shops SET booking_slug=$2,booking_issued_at=$3 WHERE id=$1", [
        h.shopId,
        newUuid().replaceAll("-", ""),
        NOW,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("최소 서버 역할로 발급/공개 조회하며 영업 판정·옛 처리방침 수정/삭제는42501", async () => {
    const role = `booking_test_${newUuid().replaceAll("-", "")}`;
    await db.query(`CREATE ROLE "${role}" NOLOGIN NOINHERIT`);
    const roleDb = (): RequestDb => {
      const base = testDb();
      const transaction = <T>(fn: (tx: Queryable) => Promise<T>) =>
        base.transaction(async (tx) => {
          await tx.query(`SET LOCAL ROLE "${role}"`);
          return fn(tx);
        });
      return {
        query: (sql, params) => transaction((tx) => tx.query(sql, params)),
        transaction,
        abort: () => base.abort(),
        close: () => base.close(),
      };
    };
    try {
      await db.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
      await db.query(
        `GRANT SELECT ON shops,price_lists,operating_rules,business_calendars,kakao_channels,payment_accounts,privacy_policies TO "${role}"`,
      );
      await db.query(`GRANT UPDATE (id,booking_slug,booking_issued_at) ON shops TO "${role}"`);
      await db.query(`GRANT INSERT ON privacy_policies TO "${role}"`);
      const h = await readyFixture(POLICY, roleDb);
      const response = await h.get();
      expect(response.status, await response.clone().text()).toBe(200);
      const link = (await response.json()) as { url: string };
      expect((await h.publicGet(new URL(link.url).pathname.split("/").at(-1) as string)).status).toBe(200);
      const limited = roleDb();
      try {
        for (const sql of [
          "UPDATE shops SET license_status='verified' WHERE id=$1",
          "UPDATE privacy_policies SET body='changed' WHERE shop_id=$1",
          "DELETE FROM privacy_policies WHERE shop_id=$1",
        ])
          await expect(limited.query(sql, [h.shopId])).rejects.toMatchObject({ code: "42501" });
      } finally {
        await limited.close();
      }
      await db.query(`REVOKE UPDATE (booking_slug,booking_issued_at) ON shops FROM "${role}"`);
      const fresh = await readyFixture(POLICY, roleDb);
      await expectProblem(await fresh.get(), "internal");
      expect(
        (await db.query("SELECT count(*)::int AS n FROM privacy_policies WHERE shop_id=$1", [fresh.shopId])).rows[0]?.n,
      ).toBe(0);
    } finally {
      await db.query(`DROP OWNED BY "${role}"`);
      await db.query(`DROP ROLE "${role}"`);
    }
  });
  it("여섯 조건이 채워지면 처리방침/링크를 한 번 만들고 동시에 여덟 번 불러도 같은 주소임", async () => {
    const h = await readyFixture();
    const responses = await Promise.all(Array.from({ length: 8 }, () => h.get()));
    const bodies: { url: string }[] = [];
    for (const r of responses) {
      expect(r.status, await r.clone().text()).toBe(200);
      const body = await r.json();
      expectSchema("BookingLink", body);
      bodies.push(body as { url: string });
    }
    expect(new Set(bodies.map((x) => x.url)).size).toBe(1);
    expect(bodies[0]).toMatchObject({ status: "issued", missing: [], recommended: ["pickup_address"] });
    expect(
      (await db.query("SELECT count(*)::int AS n FROM privacy_policies WHERE shop_id=$1", [h.shopId])).rows[0]?.n,
    ).toBe(1);
    const first = bodies[0];
    if (first === undefined) throw new Error("합성 발급 결과 없음");
    const slug = new URL(first.url).pathname.split("/").at(-1) as string;
    const response = await h.publicGet(slug);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const policy = (await response.json()) as { version: number; body: string; overseasTransfers: unknown[] };
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
