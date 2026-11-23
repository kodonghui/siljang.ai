import { readFileSync } from "node:fs";
import { afterAll, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { Queryable, RequestDb } from "../src/db";
import { expectProblem, expectSchema } from "./support/contract";
import { collectLogs, describeDb, newUuid, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { MemoryLimiter } from "./support/rate-limit";
import { createShop, issueTestBookingLink, linkTestChannel } from "./support/shops";
import { MemoryStore } from "./support/storage";

const db = testDb();
const NOW = new Date("2026-11-23T02:00:00Z");
const ORIGIN = "https://siljang.example";

async function fixture(options: Parameters<typeof createApp>[0] = {}) {
  const shop = await createShop(db, "공개 예약 합성 가게");
  await linkTestChannel(db, shop.channelId);
  await issueTestBookingLink(db, shop);
  const row = (await db.query<{ booking_slug: string }>("SELECT booking_slug FROM shops WHERE id=$1", [shop.shopId]))
    .rows[0];
  if (!row) throw new Error("합성 예약 주소 없음");
  const pageLimit = new MemoryLimiter(60),
    privacyLimit = new MemoryLimiter(60);
  const limiters = {
    PUBLIC_BOOKING_RATE_LIMITER: pageLimit,
    PUBLIC_PRIVACY_RATE_LIMITER: privacyLimit,
    FILE_RATE_LIMITER: new MemoryLimiter(600),
  };
  const storage = new MemoryStore();
  const app = createApp({
    ...options,
    services: { now: () => NOW, publicAppOrigin: ORIGIN, storage, ...options.services, limiters },
  });
  const get = (slug = row.booking_slug, headers: Record<string, string> = {}, env: Record<string, string> = {}) =>
    app.request(`${ORIGIN}/api/public/shops/${slug}`, { headers }, testEnv({ FILE_URL_KEY: TEST_HASH_KEY, ...env }));
  return { shop, slug: row.booking_slug, app, get, pageLimit, privacyLimit, storage };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
interface Page {
  shop: Record<string, string | null>;
  priceList: { version: number; options: Record<string, unknown>[]; designs: { name: string; imageUrl: string }[] };
  days: { day: string; status: string }[];
  portfolio: { imageUrl: string }[];
  privacyPolicyUrl: string;
  inquiryUrl: string | null;
}
async function page(h: Fixture) {
  const response = await h.get();
  expect(response.status, await response.clone().text()).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = (await response.json()) as Page;
  expectSchema("BookingPage", body);
  return body;
}

async function received(h: Fixture) {
  const payment = newUuid(),
    production = newUuid(),
    review = newUuid();
  await db.transaction(async (tx) => {
    await tx.query(
      "UPDATE payment_requests SET status='paid',arrived_amount=amount,arrived_at=$2,paid_at=$2 WHERE id=$1",
      [h.shop.paymentRequestId, NOW],
    );
    await tx.query(
      "INSERT INTO payments (id,shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES ($1,$2,$3,$4,35000,$5)",
      [payment, h.shop.shopId, h.shop.orderId, h.shop.paymentRequestId, NOW],
    );
    await tx.query(
      "UPDATE orders SET status='received',confirmed_at=$2,confirmed_payment_id=$3,finished_at=$2 WHERE id=$1",
      [h.shop.orderId, NOW, payment],
    );
    await tx.query(
      "INSERT INTO productions (id,shop_id,order_id,completed_at,handed_over_at,handover_kind) VALUES ($1,$2,$3,$4,$4,'pickup')",
      [production, h.shop.shopId, h.shop.orderId, NOW],
    );
    await tx.query(
      "INSERT INTO reviews (id,shop_id,order_id,version,body) VALUES ($1,$2,$3,1,'이름·전화가 든 비공개 합성 후기')",
      [review, h.shop.shopId, h.shop.orderId],
    );
  });
  return { production, review };
}

async function photo(
  h: Fixture,
  parent: { production: string; review: string },
  kind: "completion" | "review",
  position: number,
  consented = true,
  published = true,
  at = NOW,
) {
  const id = newUuid(),
    consent = newUuid(),
    item = newUuid(),
    key = `shops/${h.shop.shopId}/${kind}/${id}.png`;
  const table = kind === "completion" ? "completion_photos" : "review_photos";
  const column = kind === "completion" ? "completion_photo_id" : "review_photo_id";
  const parentColumn = kind === "completion" ? "production_id" : "review_id";
  await db.query(
    `INSERT INTO ${table} (id,shop_id,${parentColumn},position,storage_key,content_type,byte_size) VALUES ($1,$2,$3,$4,$5,'image/png',3)`,
    [id, h.shop.shopId, kind === "completion" ? parent.production : parent.review, position, key],
  );
  await db.query(
    `INSERT INTO photo_consents (id,shop_id,order_id,scope,${column},consented,publishable) VALUES ($1,$2,$3,$4,$5,$6,$6)`,
    [
      consent,
      h.shop.shopId,
      h.shop.orderId,
      kind === "completion" ? "completion_photo" : "review_photo",
      id,
      consented,
    ],
  );
  if (published)
    await db.query(
      `INSERT INTO portfolio_items (id,shop_id,photo_consent_id,${column},published_at) VALUES ($1,$2,$3,$4,$5)`,
      [item, h.shop.shopId, consent, id, at],
    );
  await h.storage.put(key, new Uint8Array([position, 2, 3]), "image/png");
  return { id, consent, item, key };
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

  it.each(["ab", "BAD_slug", "a".repeat(41), "missing-slug"])("형식이 틀리거나 없는 주소 %s는404", async (slug) => {
    const h = await fixture();
    await expectProblem(await h.get(slug), "not_found");
  });
  it("발급 전 가게는404이며 부분 발급 상태는 데이터베이스도 거절함", async () => {
    const h = await fixture();
    await expect(
      db.query("UPDATE shops SET booking_issued_at=NULL WHERE id=$1", [h.shop.shopId]),
    ).rejects.toMatchObject({ code: "23514" });
    await db.query("UPDATE shops SET booking_slug=NULL,booking_issued_at=NULL WHERE id=$1", [h.shop.shopId]);
    await expectProblem(await h.get(), "not_found");
  });
  it("현재 가격표 버전4/새 도안만 보이며 기존 도안은 손님 게시 동의 없이 보임", async () => {
    const h = await fixture();
    const before = await page(h);
    expect(before.priceList.designs).toHaveLength(1);
    await db.transaction(async (tx) => {
      await tx.query("UPDATE price_lists SET superseded_at=$2 WHERE id=$1", [h.shop.priceListId, NOW]);
      const id = newUuid();
      await tx.query("INSERT INTO price_lists (id,shop_id,version) VALUES ($1,$2,4)", [id, h.shop.shopId]);
      await tx.query(
        "INSERT INTO price_options (shop_id,price_list_id,option_group,name,price_kind,amount,amount_max,in_standard,position) VALUES ($1,$2,'extra','새 추가','range',1000,2000,false,0)",
        [h.shop.shopId, id],
      );
      await tx.query(
        "INSERT INTO designs (shop_id,price_list_id,name,image_key,in_standard,position) VALUES ($1,$2,'새 도안','design/new.png',true,0)",
        [h.shop.shopId, id],
      );
    });
    const body = await page(h);
    expect(body.priceList.version).toBe(4);
    expect(body.priceList.options).toEqual([
      { group: "extra", name: "새 추가", priceKind: "range", amount: 1000, amountMax: 2000, inStandard: false },
    ]);
    expect(body.priceList.designs.map((x) => x.name)).toEqual(["새 도안"]);
    expect(JSON.stringify(body)).not.toContain("design/new.png");
  });
  it("공개 신원/신고 기관·처리방침 주소와 자기 채널 문의 주소를 정확히 돌려줌", async () => {
    const h = await fixture();
    await db.query(
      "UPDATE shops SET business_name='확인 상호',representative_name='확인 대표',business_address='서울 합성로2',contact_email='public@example.com',mail_order_exemption=NULL,mail_order_reg_no='합성 신고1',mail_order_authority='합성구청',pickup_address='서울 픽업로1' WHERE id=$1",
      [h.shop.shopId],
    );
    const body = await page(h);
    expect(body.shop).toMatchObject({
      businessName: "확인 상호",
      representativeName: "확인 대표",
      businessAddress: "서울 합성로2",
      contactPhone: "010-1234-5678",
      contactEmail: "public@example.com",
      businessRegNo: "1234567890",
      mailOrderRegNo: "합성 신고1",
      mailOrderAuthority: "합성구청",
      mailOrderExemption: null,
      pickupAddress: "서울 픽업로1",
    });
    const channel = (
      await db.query<{ channel_public_id: string }>("SELECT channel_public_id FROM kakao_channels WHERE id=$1", [
        h.shop.channelId,
      ])
    ).rows[0];
    expect(body.inquiryUrl).toBe(`https://pf.kakao.com/${channel?.channel_public_id}/chat`);
    expect(body.privacyPolicyUrl).toBe(`${ORIGIN}/s/${h.slug}/privacy`);
    await db.query("UPDATE kakao_channels SET status='failed',channel_public_id=NULL WHERE id=$1", [h.shop.channelId]);
    expect((await page(h)).inquiryUrl).toBeNull();
  });
  it("게시한 완성/후기 사진3장만 서명하고 동의 없음·게시 전·미래 게시·다른 가게 사진은 제외함", async () => {
    const h = await fixture(),
      parent = await received(h);
    const visible = [
      await photo(h, parent, "completion", 1),
      await photo(h, parent, "completion", 2),
      await photo(h, parent, "review", 1),
    ];
    await photo(h, parent, "completion", 3, false, false);
    await photo(h, parent, "completion", 4, true, false);
    await photo(h, parent, "review", 2, true, true, new Date(NOW.getTime() + 1));
    const other = await fixture();
    await photo(other, await received(other), "review", 1);
    const body = await page(h);
    expect(body.portfolio).toHaveLength(3);
    for (const image of body.portfolio) {
      const response = await h.app.request(image.imageUrl, {}, testEnv({ FILE_URL_KEY: TEST_HASH_KEY }));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect([1, 2]).toContain(new Uint8Array(await response.arrayBuffer())[0]);
    }
    for (const value of [
      ...visible.flatMap((p) => [p.id, p.consent, p.key]),
      h.shop.orderId,
      h.shop.customerId,
      "비공개 합성 후기",
    ])
      expect(JSON.stringify(body)).not.toContain(value);
    const withdrawn = visible[0];
    if (!withdrawn) throw new Error("철회할 합성 사진 없음");
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE portfolio_items SET unpublished_at=$2,unpublish_reason='consent_withdrawn',consent_live=NULL WHERE id=$1",
        [withdrawn.item, NOW],
      );
      await tx.query("UPDATE photo_consents SET withdrawn_at=$2,publishable=false WHERE id=$1", [
        withdrawn.consent,
        NOW,
      ]);
    });
    expect((await page(h)).portfolio).toHaveLength(2);
  });

  it.each(["full", "overbooked", "manual", "day_off"] as const)(
    "%s 날짜는 숫자 없이 마감/휴무로만 보임",
    async (kind) => {
      const h = await fixture(),
        day = "2026-11-26";
      await db.query(
        "INSERT INTO calendar_days (shop_id,day,capacity,manually_closed_at,closed) VALUES ($1,$2,$3,$4,$5)",
        [h.shop.shopId, day, kind === "full" ? 1 : null, kind === "manual" ? NOW : null, kind === "day_off"],
      );
      if (kind === "full" || kind === "overbooked")
        await db.query(
          "INSERT INTO slot_holds (shop_id,day,order_id,payment_request_id,hold_key,status,overbooked) VALUES ($1,$2,$3,$4,$5,'held',$6)",
          [h.shop.shopId, day, h.shop.orderId, h.shop.paymentRequestId, newUuid(), kind === "overbooked"],
        );
      expect((await page(h)).days.find((x) => x.day === day)).toEqual({
        day,
        status: kind === "day_off" ? "day_off" : "closed",
      });
    },
  );
  it("서울 기준 오늘부터60일이며 마감 시각 직전은 받음·같은 시각부터 마감", async () => {
    let at = new Date(NOW.getTime() - 1);
    const h = await fixture({ services: { now: () => at } });
    await db.query("UPDATE business_calendars SET order_cutoff_time='11:00',order_cutoff_days=2 WHERE shop_id=$1", [
      h.shop.shopId,
    ]);
    let body = await page(h);
    expect(body.days[0]?.day).toBe("2026-11-23");
    expect(body.days.at(-1)?.day).toBe("2027-01-21");
    expect(body.days.find((x) => x.day === "2026-11-25")?.status).toBe("open");
    at = NOW;
    body = await page(h);
    expect(body.days.find((x) => x.day === "2026-11-25")?.status).toBe("closed");
  });
  it("실제 IP별 한도를 따로 세고 원 IP·가게 주소를 한도 키에 넣지 않음", async () => {
    const h = await fixture();
    for (let i = 0; i < 60; i++) await h.get("missing-slug", { "cf-connecting-ip": "192.0.2.1" });
    const blocked = await h.get("missing-slug", { "cf-connecting-ip": "192.0.2.1" });
    await expectProblem(blocked, "rate_limited");
    expect(blocked.headers.get("retry-after")).toBe("60");
    await expectProblem(await h.get("missing-slug", { "cf-connecting-ip": "2001:db8::1" }), "not_found");
    for (const key of h.pageLimit.counts.keys()) {
      expect(key).toMatch(/^[a-f0-9]{64}$/);
      expect(key).not.toContain("192.0.2.1");
    }
  });
  it("같은 IPv6 /64에서 주소를 바꿔도 공개 한도를 피하지 못함", async () => {
    const h = await fixture();
    for (let i = 1; i <= 60; i++)
      await h.get("missing-slug", { "cf-connecting-ip": `2001:db8:abcd:1234::${i.toString(16)}` });
    await expectProblem(
      await h.get("missing-slug", { "cf-connecting-ip": "2001:0db8:abcd:1234::ffff" }),
      "rate_limited",
    );
    await expectProblem(await h.get("missing-slug", { "cf-connecting-ip": "2001:db8:abcd:1235::1" }), "not_found");
  });
  it("사진 서명은 달력 공유 잠금의 트랜잭션이 끝난 뒤 실행함", async () => {
    let active = false;
    const h = await fixture({
      connect: () => {
        const base = testDb();
        return {
          query: (sql, params) => base.query(sql, params),
          transaction: async (fn) => {
            active = true;
            try {
              return await base.transaction(fn);
            } finally {
              active = false;
            }
          },
          abort: () => base.abort(),
          close: () => base.close(),
        };
      },
    });
    const observations: boolean[] = [];
    const original = crypto.subtle.encrypt.bind(crypto.subtle);
    const spy = vi.spyOn(crypto.subtle, "encrypt").mockImplementation((...args) => {
      observations.push(active);
      return original(...args);
    });
    try {
      await page(h);
      expect(observations.length).toBeGreaterThan(0);
      expect(observations.every((value) => !value)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
  it("공개 예약 조회는 비공개 가격 조합 규칙을 읽지 않음", async () => {
    let rulesReads = 0;
    const observe = (base: Queryable): Queryable => ({
      query: (sql, params) => {
        if (/\bFROM price_option_rules\b/.test(sql)) rulesReads++;
        return base.query(sql, params);
      },
    });
    const h = await fixture({
      connect: () => {
        const base = testDb();
        return {
          query: observe(base).query,
          transaction: (fn) => base.transaction((tx) => fn(observe(tx))),
          abort: () => base.abort(),
          close: () => base.close(),
        };
      },
    });
    await page(h);
    expect(rulesReads).toBe(0);
  });
  it("필수 서명 설정 오류는500이며 응답/로그에 저장 위치·연결 문자열이 없음", async () => {
    const logs = collectLogs(),
      h = await fixture({ logSink: logs.sink });
    const response = await h.get(h.slug, {}, { FILE_URL_KEY: "" });
    const body = await expectProblem(response, "internal");
    for (const value of [h.shop.shopId, "design/test.jpg", "postgresql://"])
      expect(JSON.stringify(body) + logs.lines.join("\n")).not.toContain(value);
  });
  it("권한 파일의 기존 서버 역할에서 공개 조회하고 사진 게시·철회 쓰기는42501", async () => {
    const role = `public_booking_${newUuid().replaceAll("-", "")}`;
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
      const grants = readFileSync(new URL("../../../tools/staging-login-callback-grants.sql", import.meta.url), "utf8");
      await db.query(grants.replaceAll(':"runtime_role"', `"${role}"`));
      const h = await fixture({ connect: roleDb });
      await page(h);
      const limited = roleDb();
      try {
        for (const sql of [
          "UPDATE photo_consents SET consented=true WHERE shop_id=$1",
          "UPDATE portfolio_items SET unpublished_at=now() WHERE shop_id=$1",
          "DELETE FROM completion_photos WHERE shop_id=$1",
          "DELETE FROM review_photos WHERE shop_id=$1",
        ])
          await expect(limited.query(sql, [h.shop.shopId])).rejects.toMatchObject({ code: "42501" });
      } finally {
        await limited.close();
      }
    } finally {
      await db.query(`DROP OWNED BY "${role}"`);
      await db.query(`DROP ROLE "${role}"`);
    }
  });
});
