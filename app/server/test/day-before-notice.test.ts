import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { createDayBeforeNotice } from "../src/day-before-notice";
import { DUE_SOURCES } from "../src/due-sources";
import { deferredKakaoBatch } from "../src/kakao-deferred";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { runScheduled } from "../src/scheduled";
import { Secret } from "../src/settings";
import { createShopScope, shopDb, shopRequestDb } from "../src/shop-scope";
import { expectSchema } from "./support/contract";
import { describeDb, newUuid, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { singleKeyCrypto } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-27T09:00:00Z");
const CONFIRMED = new Date(NOW.getTime() - 86400000);
const PICKUP = new Date("2026-11-28T06:00:00Z");
describeDb("전날 안내의 기본 일 실행기 연결(TASK-134, SPEC-052)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture;
  const role = `day134_${newUuid().replaceAll("-", "")}`;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
    await isolated.db.query(`CREATE ROLE "${role}" NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    // 고침 전 역할에 남아 있던 넓은 열 권한도 같은 적용 SQL로 거둬야 한다.
    await isolated.db.query(`GRANT UPDATE(body,template_key) ON notifications TO "${role}"`);
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
      expect(
        (await raw.query<{ id: string }>(DUE_SOURCES.order_day_before.find, [NOW, 100])).rows.map((r) => r.id),
      ).toContain(shop.orderId);
      expect((await scoped.run(DUE_SOURCES.order_day_before.claim, [other.orderId, NOW])).rowCount).toBe(0);
      expect((await scoped.run(DUE_SOURCES.order_day_before.claim, [shop.orderId, NOW])).rowCount).toBe(1);
      expect(await createDayBeforeNotice(scoped, other.orderId, NOW)).toBe(false);
      expect(await createDayBeforeNotice(scoped, shop.orderId, NOW)).toBe(true);
      expect(
        (await raw.query<{ id: string }>(DUE_SOURCES.order_day_before.find, [NOW, 100])).rows.map((r) => r.id),
      ).not.toContain(shop.orderId);
      expect((await scoped.run(DUE_SOURCES.order_day_before.claim, [shop.orderId, NOW])).rowCount).toBe(0);
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
  it("일반 본문 수정 대신 소유자가 아닌 제한 역할에 전날 안내 함수 실행만 연다", async () => {
    const rights = (
      await isolated.db.query(
        `SELECT has_column_privilege($1,'public.notifications','body','UPDATE') AS body,
          has_column_privilege($1,'public.notifications','template_key','UPDATE') AS template`,
        [role],
      )
    ).rows[0];
    expect(rights).toEqual({ body: false, template: false });
    for (const column of ["body", "template_key"]) {
      await expect(
        isolated.db.transaction(async (tx) => {
          await tx.query(`SET LOCAL ROLE "${role}"`);
          await tx.query(`UPDATE notifications SET ${column}='허용하지 않는 합성 수정' WHERE false`);
        }),
      ).rejects.toMatchObject({ code: "42501" });
    }
    const routine = (
      await isolated.db.query(
        `SELECT p.prosecdef AS definer,p.proconfig AS settings,p.proowner=r.oid AS owned,
          has_function_privilege($1,p.oid,'EXECUTE') AS callable,
          EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
            WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
        FROM pg_proc p JOIN pg_roles r ON r.rolname=$1
        WHERE p.oid='public.refresh_pending_day_before_notice(uuid,uuid,timestamptz)'::regprocedure`,
        [role],
      )
    ).rows[0];
    expect(routine).toEqual({
      definer: true,
      settings: ["search_path=pg_catalog"],
      owned: false,
      callable: true,
      public_execute: false,
    });
    // 실행 권한을 거둔 일반 역할은 함수 소유자의 권한을 빌릴 수 없다.
    await expect(
      isolated.db.transaction(async (tx) => {
        await tx.query(
          `REVOKE EXECUTE ON FUNCTION public.refresh_pending_day_before_notice(uuid,uuid,timestamptz) FROM "${role}"`,
        );
        await tx.query(`SET LOCAL ROLE "${role}"`);
        await tx.query("SELECT public.refresh_pending_day_before_notice($1,$2,$3)", [shop.shopId, shop.orderId, NOW]);
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it.each([
    {
      label: "줄바꿈과 공백",
      address: "\u00a0\t새 합성 장소\r\n두 번째 줄\r세 번째 줄\u3000",
      normalized: "새 합성 장소\n두 번째 줄\n세 번째 줄",
    },
    { label: "영문 v 보존", address: "v합성 장소v", normalized: "v합성 장소v" },
    { label: "세로 탭 제거", address: "\u000b새 합성 장소\u000b", normalized: "새 합성 장소" },
    { label: "공백뿐인 장소", address: "\u000b \t\u3000", normalized: "" },
  ])("제한 역할로 공개 정보만 새로 읽어 같은 미전달 안내를 갱신한다($label)", async ({ address, normalized }) => {
    const create = () =>
      isolated.db.transaction(async (tx) => {
        await tx.query(`SET LOCAL ROLE "${role}"`);
        return createDayBeforeNotice(
          shopDb(createShopScope(shop.shopId, { kind: "job", job: "day_before_notice" }), tx),
          shop.orderId,
          NOW,
        );
      });
    expect(await create()).toBe(true);
    const before = (
      await isolated.db.query<{ id: string; body: string }>("SELECT id,body FROM notifications WHERE shop_id=$1", [
        shop.shopId,
      ])
    ).rows[0];
    if (before === undefined) throw new Error("합성 전날 안내 없음");
    await isolated.db.query("UPDATE shops SET pickup_address=$2 WHERE id=$1", [shop.shopId, address]);
    expect(await create()).toBe(true);
    expect(await create()).toBe(false);
    const after = (
      await isolated.db.query("SELECT id,body,status,attempts FROM notifications WHERE shop_id=$1", [shop.shopId])
    ).rows;
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: before.id, status: "deferred", attempts: 0 });
    expect(after[0]?.body).toBe(
      before.body.replace("\n픽업 장소: 합성 픽업 장소", normalized ? `\n픽업 장소: ${normalized}` : ""),
    );
  });
  it.each([
    "other-kind",
    "attempted",
    "delivered",
    "other-shop",
    "other-order",
    "other-recipient",
    "other-consultation",
    "cancelled",
    "deleted-consultation",
    "purged-customer",
    "too-early",
    "infinite",
  ] as const)("전날 안내 함수가 현재 갱신 대상 밖의 행을 바꾸지 않는다(%s)", async (reason) => {
    const scoped = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "day_before_notice" }), isolated.db);
    expect(await scoped.transaction((tx) => createDayBeforeNotice(tx, shop.orderId, NOW))).toBe(true);
    let shopId = shop.shopId,
      orderId = shop.orderId;
    let at: Date | string = NOW;
    if (reason === "other-kind")
      await isolated.db.query("UPDATE notifications SET kind='owner_reply' WHERE shop_id=$1", [shop.shopId]);
    if (reason === "attempted")
      await isolated.db.query("UPDATE notifications SET attempts=1 WHERE shop_id=$1", [shop.shopId]);
    if (reason === "delivered")
      await isolated.db.query("UPDATE notifications SET status='delivered_on_reply',sent_at=$2 WHERE shop_id=$1", [
        shop.shopId,
        NOW,
      ]);
    if (reason === "other-shop") shopId = newUuid();
    if (reason === "other-order") orderId = newUuid();
    if (reason === "other-recipient") {
      const customerId = newUuid(),
        consultationId = newUuid();
      await isolated.db.query("INSERT INTO customers(id,shop_id,kakao_channel_id,kakao_user_key) VALUES($1,$2,$3,$4)", [
        customerId,
        shop.shopId,
        shop.channelId,
        `synthetic-${newUuid()}`,
      ]);
      await isolated.db.query("INSERT INTO consultations(id,shop_id,customer_id) VALUES($1,$2,$3)", [
        consultationId,
        shop.shopId,
        customerId,
      ]);
      await isolated.db.query("UPDATE notifications SET customer_id=$2,consultation_id=$3 WHERE shop_id=$1", [
        shop.shopId,
        customerId,
        consultationId,
      ]);
    }
    if (reason === "other-consultation") {
      const consultationId = newUuid();
      await isolated.db.query(
        "INSERT INTO consultations(id,shop_id,customer_id,status,ended_at) VALUES($1,$2,$3,'ended',$4)",
        [consultationId, shop.shopId, shop.customerId, NOW],
      );
      await isolated.db.query("UPDATE notifications SET consultation_id=$2 WHERE shop_id=$1", [
        shop.shopId,
        consultationId,
      ]);
    }
    if (reason === "cancelled")
      await isolated.db.query(
        "UPDATE orders SET status='cancelled',cancelled_at=$2,cancel_kind='customer' WHERE id=$1",
        [shop.orderId, NOW],
      );
    if (reason === "deleted-consultation")
      await isolated.db.query("UPDATE consultations SET status='deleted',deleted_at=$2 WHERE id=$1", [
        shop.consultationId,
        NOW,
      ]);
    if (reason === "purged-customer")
      await isolated.db.query("UPDATE customers SET kakao_user_key=NULL,purged_at=$2 WHERE id=$1", [
        shop.customerId,
        NOW,
      ]);
    if (reason === "too-early") at = new Date(NOW.getTime() - 60000);
    if (reason === "infinite") at = "infinity";
    await isolated.db.query("UPDATE shops SET pickup_address='갱신 거절용 합성 장소' WHERE id=$1", [shop.shopId]);
    const before = (await isolated.db.query("SELECT * FROM notifications WHERE shop_id=$1", [shop.shopId])).rows;
    const refreshed = await isolated.db.transaction(async (tx) => {
      await tx.query(`SET LOCAL ROLE "${role}"`);
      return (
        await tx.query("SELECT public.refresh_pending_day_before_notice($1,$2,$3) AS refreshed", [shopId, orderId, at])
      ).rows[0]?.refreshed;
    });
    expect(refreshed).toBe(false);
    expect((await isolated.db.query("SELECT * FROM notifications WHERE shop_id=$1", [shop.shopId])).rows).toEqual(
      before,
    );
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
  it("날짜가 옮겨지는 시간대에서도 현재 픽업 날짜의 전날에 찾고 생성하고 전달한다", async () => {
    await isolated.db.query("UPDATE shops SET time_zone='Pacific/Honolulu' WHERE id=$1", [shop.shopId]);
    const at = new Date("2026-11-27T04:00:00Z"); // 현지11/26 18시, 픽업은 현지11/27 20시.
    expect(
      (await isolated.db.query<{ id: string }>(DUE_SOURCES.order_day_before.find, [at, 100])).rows.map((r) => r.id),
    ).toContain(shop.orderId);
    const scoped = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "day_before_notice" }), isolated.db);
    expect(await scoped.transaction((tx) => createDayBeforeNotice(tx, shop.orderId, at))).toBe(true);
    const notice = (
      await isolated.db.query<{ id: string; body: string; scheduled_for: Date }>(
        "SELECT id,body,scheduled_for FROM notifications WHERE shop_id=$1",
        [shop.shopId],
      )
    ).rows[0];
    expect(notice?.scheduled_for).toEqual(at);
    expect(notice?.body).toContain("픽업: 2026-11-27 20:00");
    expect(
      (await scoped.transaction((tx) => deferredKakaoBatch(tx, shop.customerId, { now: at }))).messages.map(
        (r) => r.id,
      ),
    ).toEqual([notice?.id]);
  });
  it("시간대 변경 뒤 현지 픽업 당일을 전날 안내 대상으로 고르지 않는다", async () => {
    await isolated.db.query("UPDATE shops SET time_zone='Pacific/Honolulu' WHERE id=$1", [shop.shopId]);
    const at = new Date("2026-11-28T04:00:00Z"); // 현지11/27 18시, 당일20시 픽업.
    expect(
      (await isolated.db.query<{ id: string }>(DUE_SOURCES.order_day_before.find, [at, 100])).rows.map((r) => r.id),
    ).not.toContain(shop.orderId);
    const scoped = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "day_before_notice" }), isolated.db);
    expect(await scoped.transaction((tx) => createDayBeforeNotice(tx, shop.orderId, at))).toBe(false);
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
      await issueTestBookingLink(isolated.db, shop);
      const key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
      const app = createApp({
        connect: () => isolated.connect(),
        services: { now: () => new Date(NOW.getTime() + 120000) },
        logSink: () => {},
      });
      for (const [index, utterance] of ["전날 안내 첫 확인", "전날 안내 둘째 확인"].entries()) {
        const response = await app.request(
          "/api/kakao/skills/message",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
            body: JSON.stringify({
              bot: { id: shop.botId },
              userRequest: { utterance, block: { id: "conversation" }, user: { id: shop.userKey, type: "botUserKey" } },
              action: { id: "synthetic-action", params: {} },
            }),
          },
          env,
        );
        expect(response.status).toBe(200);
        const body = (await response.json()) as { template: { outputs: { simpleText?: { text: string } }[] } };
        expectSchema("SkillTemplateResponse", body);
        const text = body.template.outputs.map((output) => output.simpleText?.text ?? "").join("\n");
        expect(text.includes(notice.body)).toBe(index === 0);
        if (index === 0) {
          expect(text).not.toMatch(/할인|이벤트|다른 상품/u);
          if (empty) expect(text).not.toContain("픽업 장소");
        }
      }
      expect(
        (
          await isolated.db.query("SELECT status FROM notifications WHERE shop_id=$1 AND kind='day_before'", [
            shop.shopId,
          ])
        ).rows[0]?.status,
      ).toBe("delivered_on_reply");
    },
  );
  it.each([
    ["07:59", "08:00", false],
    ["08:00", "08:00", true],
    ["17:59", "18:00", false],
    ["18:00", null, true],
    ["20:50", "20:50", true],
    ["20:51", "20:50", false],
    ["23:59", "18:00", false],
  ] as const)("실제 기본 실행기가 가게 시각과 기본값/전달 시간을 따른다(%s/%s)", async (time, configured, expected) => {
    if (configured === null) await isolated.db.query("DELETE FROM business_calendars WHERE shop_id=$1", [shop.shopId]);
    else
      await isolated.db.query("UPDATE business_calendars SET day_before_notice_time=$2 WHERE shop_id=$1", [
        shop.shopId,
        configured,
      ]);
    const now = new Date(`2026-11-27T${time}:00+09:00`);
    const { keys } = singleKeyCrypto();
    const fieldKey = keys.get(1);
    if (fieldKey === undefined) throw new Error("합성 암호화 키 없음");
    const result = await runScheduled(
      { scheduledTime: now.getTime(), cron: "* * * * *" },
      testEnv({ FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: fieldKey }),
      { connect: () => isolated.connect(), logSink: () => {}, now: () => now },
    );
    expect(result?.jobs.day_before_notice?.failed).toBe(0);
    expect(
      (
        await isolated.db.query("SELECT count(*)::int AS n FROM notifications WHERE shop_id=$1 AND kind='day_before'", [
          shop.shopId,
        ])
      ).rows[0]?.n,
    ).toBe(expected ? 1 : 0);
  });
  it.each(["cancelled", "next-day"] as const)(
    "취소하거나 픽업 날짜를 바꾼 주문의 옛 안내를 전하지 않는다(%s)",
    async (change) => {
      const scoped = shopRequestDb(
        createShopScope(shop.shopId, { kind: "job", job: "day_before_notice" }),
        isolated.db,
      );
      expect(await scoped.transaction((tx) => createDayBeforeNotice(tx, shop.orderId, NOW))).toBe(true);
      if (change === "cancelled")
        await isolated.db.query(
          "UPDATE orders SET status='cancelled',cancelled_at=$2,cancel_kind='customer',finished_at=$2 WHERE id=$1",
          [shop.orderId, NOW],
        );
      else
        await isolated.db.transaction(async (tx) => {
          const at = new Date(PICKUP.getTime() + 86400000);
          await tx.query("UPDATE order_details SET pickup_at=$2 WHERE order_id=$1 AND version=1", [shop.orderId, at]);
          await tx.query("UPDATE orders SET pickup_at=$2,pickup_day='2026-11-29' WHERE id=$1", [shop.orderId, at]);
        });
      expect(
        (await isolated.db.query<{ id: string }>(DUE_SOURCES.order_day_before.find, [NOW, 100])).rows.map((r) => r.id),
      ).not.toContain(shop.orderId);
      expect(await scoped.transaction((tx) => createDayBeforeNotice(tx, shop.orderId, NOW))).toBe(false);
      expect(
        (await scoped.transaction((tx) => deferredKakaoBatch(tx, shop.customerId, { now: NOW }))).messages,
      ).toHaveLength(0);
    },
  );
  it("시작한 시도는 픽업 내용이 바뀌어도 다시 만들거나 고치지 않는다", async () => {
    const scoped = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "day_before_notice" }), isolated.db);
    expect(await scoped.transaction((tx) => createDayBeforeNotice(tx, shop.orderId, NOW))).toBe(true);
    await isolated.db.query(
      "UPDATE notifications SET attempts=1,status='retrying',next_attempt_at=$2 WHERE shop_id=$1 AND kind='day_before'",
      [shop.shopId, NOW],
    );
    const before = (
      await isolated.db.query(
        "SELECT body,scheduled_for,attempts,status FROM notifications WHERE shop_id=$1 AND kind='day_before'",
        [shop.shopId],
      )
    ).rows;
    await isolated.db.transaction(async (tx) => {
      const at = new Date(PICKUP.getTime() + 3600000);
      await tx.query("UPDATE order_details SET pickup_at=$2 WHERE order_id=$1 AND version=1", [shop.orderId, at]);
      await tx.query("UPDATE orders SET pickup_at=$2 WHERE id=$1", [shop.orderId, at]);
    });
    expect(
      (await isolated.db.query<{ id: string }>(DUE_SOURCES.order_day_before.find, [NOW, 100])).rows.map((r) => r.id),
    ).not.toContain(shop.orderId);
    expect(await scoped.transaction((tx) => createDayBeforeNotice(tx, shop.orderId, NOW))).toBe(false);
    expect(
      (
        await isolated.db.query(
          "SELECT body,scheduled_for,attempts,status FROM notifications WHERE shop_id=$1 AND kind='day_before'",
          [shop.shopId],
        )
      ).rows,
    ).toEqual(before);
  });
  it.each(["pickup", "address", "phone", "time-zone", "notice-time"] as const)(
    "미전달 안내를 만든 뒤 현재 정보가 바뀌면 옛 내용을 대화로 전하지 않는다(%s)",
    async (change) => {
      const scoped = shopRequestDb(
        createShopScope(shop.shopId, { kind: "job", job: "day_before_notice" }),
        isolated.db,
      );
      expect(await scoped.transaction((tx) => createDayBeforeNotice(tx, shop.orderId, NOW))).toBe(true);
      const original = (
        await isolated.db.query<{ id: string }>("SELECT id FROM notifications WHERE shop_id=$1 AND kind='day_before'", [
          shop.shopId,
        ])
      ).rows[0];
      if (original === undefined) throw new Error("합성 전날 안내 없음");
      if (change === "pickup")
        await isolated.db.transaction(async (tx) => {
          const at = new Date(PICKUP.getTime() + 3600000);
          await tx.query("UPDATE order_details SET pickup_at=$2 WHERE order_id=$1 AND version=1", [shop.orderId, at]);
          await tx.query("UPDATE orders SET pickup_at=$2 WHERE id=$1", [shop.orderId, at]);
        });
      else if (change === "address")
        await isolated.db.query("UPDATE shops SET pickup_address='바뀐 합성 픽업 장소' WHERE id=$1", [shop.shopId]);
      else if (change === "phone")
        await isolated.db.query("UPDATE shops SET contact_phone='02-000-0001' WHERE id=$1", [shop.shopId]);
      else if (change === "time-zone")
        await isolated.db.query("UPDATE shops SET time_zone='Europe/London' WHERE id=$1", [shop.shopId]);
      else
        await isolated.db.query("UPDATE business_calendars SET day_before_notice_time='19:00' WHERE shop_id=$1", [
          shop.shopId,
        ]);
      const batch = await scoped.transaction((tx) => deferredKakaoBatch(tx, shop.customerId, { now: NOW }));
      expect(batch.messages).toHaveLength(0);
      expect(
        (
          await isolated.db.query("SELECT status FROM notifications WHERE shop_id=$1 AND kind='day_before'", [
            shop.shopId,
          ])
        ).rows[0]?.status,
      ).toBe("dropped");
      const readyAt = change === "time-zone" ? new Date("2026-11-27T18:00:00Z") : NOW;
      if (change === "notice-time") {
        expect(await scoped.transaction((tx) => createDayBeforeNotice(tx, shop.orderId, NOW))).toBe(false);
        // 원래 시각으로 되돌리면 내용/예약이 같아도 닫힌 상태를 복구한다.
        await isolated.db.query("UPDATE business_calendars SET day_before_notice_time='18:00' WHERE shop_id=$1", [
          shop.shopId,
        ]);
      }
      expect(
        (await isolated.db.query<{ id: string }>(DUE_SOURCES.order_day_before.find, [readyAt, 100])).rows.map(
          (r) => r.id,
        ),
      ).toContain(shop.orderId);
      expect(await scoped.transaction((tx) => createDayBeforeNotice(tx, shop.orderId, readyAt))).toBe(true);
      const restored = await scoped.transaction((tx) => deferredKakaoBatch(tx, shop.customerId, { now: readyAt }));
      expect(restored.messages.map((message) => message.id)).toEqual([original.id]);
      if (change === "pickup") expect(restored.messages[0]?.text).toContain("16:00");
      if (change === "address") expect(restored.messages[0]?.text).toContain("바뀐 합성 픽업 장소");
      if (change === "phone") expect(restored.messages[0]?.text).toContain("02-000-0001");
      if (change === "time-zone") expect(restored.messages[0]?.text).toContain("06:00");
    },
  );
});
