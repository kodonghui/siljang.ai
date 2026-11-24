import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { Queryable, RequestDb } from "../src/db";
import { fieldCrypto } from "../src/field-crypto";
import { kakaoCallback } from "../src/kakao-callback";
import { consumeKakaoCallback } from "../src/kakao-callback-queue";
import { publishStoredKakaoCallback, storeKakaoCallback } from "../src/kakao-callback-store";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { receiveKakaoMessage } from "../src/kakao-skill-store";
import { OWNER_COOKIE } from "../src/owner-oauth";
import { createOwnerScope } from "../src/owner-scope";
import { createOwnerSession, endOwnerSession, ownerProfile, renewOwnerSession } from "../src/owner-session";
import { runScheduled } from "../src/scheduled";
import { readSettings, Secret } from "../src/settings";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { newUploadId, tempKey } from "../src/uploads";
import { collectLogs, describeDb, newRequestKey, newUuid, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { newFieldKey, singleKeyCrypto } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { seedOperatorSession } from "./support/operator";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";
import { MemoryStore } from "./support/storage";

describeDb("실제 서버 역할의 로그인·콜백 권한(TASK-173)", () => {
  const role = `runtime_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = testDb();
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>> | undefined;
  let created = false;
  let shop: ShopFixture;
  const now = new Date("2026-11-21T00:00:00Z");

  function roleDb(): RequestDb {
    if (isolated === undefined) throw new Error("시험 DB 없음");
    const base = isolated.connect();
    async function transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      return base.transaction(async (tx) => {
        await tx.query(`SET LOCAL ROLE "${role}"`);
        return fn(tx);
      });
    }
    return {
      query: (sql, params) => transaction((tx) => tx.query(sql, params)),
      transaction,
      abort: () => base.abort(),
      close: () => base.close(),
    };
  }

  beforeAll(async () => {
    isolated = await isolatedTestDb();
    await admin.query(`CREATE ROLE "${role}" NOLOGIN NOINHERIT`);
    created = true;
    await isolated.db.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    // 기존 접속기록의 제한을 먼저 만들고 새 권한 파일이 넓히지 않는지 확인한다.
    await isolated.db.query(`GRANT INSERT, DELETE ON access_logs TO "${role}"`);
    await isolated.db.query(`GRANT SELECT (accessed_at) ON access_logs TO "${role}"`);
    // 실제 기존 서버 역할이 가진 운영 기록 조회·추가만 재현한다. 수정·삭제는 허용하지 않는다.
    await isolated.db.query(`GRANT SELECT, INSERT ON ops_events TO "${role}"`);
    const grants = readFileSync(new URL("../../../tools/staging-login-callback-grants.sql", import.meta.url), "utf8");
    await isolated.db.query(grants.replaceAll(':"runtime_role"', `"${role}"`));
    shop = await createShop(isolated.db, "서버 역할 시험 가게");
    await issueTestBookingLink(isolated.db, shop);
    await linkTestChannel(isolated.db, shop.channelId);
  }, 30_000);

  afterAll(async () => {
    try {
      await isolated?.close();
    } finally {
      try {
        if (created) await admin.query(`DROP ROLE "${role}"`);
      } finally {
        await admin.close();
      }
    }
  });

  it.each([false, true])(
    "채널 확인 %s의 사장님 생성·30일 연장·내 정보·로그아웃을 같은 제한 역할로 실행",
    async (channelEnabled) => {
      const db = roleDb();
      try {
        const accountId = BigInt(`0x${newUuid().replaceAll("-", "").slice(0, 14)}`).toString();
        const session = await createOwnerSession(db, { accountId, friend: false }, now, channelEnabled);
        const later = new Date(now.getTime() + 1_000);
        expect(await renewOwnerSession(db, session.token, later)).toBe(session.ownerId);
        expect((await ownerProfile(db, session.ownerId, channelEnabled)).profile.owner.ownerId).toBe(session.ownerId);
        await endOwnerSession(db, session.token, later);
        expect(await renewOwnerSession(db, session.token, later)).toBeNull();
      } finally {
        await db.close();
      }
    },
  );

  it("제한 역할로 가게 등록·요청 키 재전송·내 가게 조회를 실행하고 임의 승인/삭제는 막음", async () => {
    if (!isolated) throw new Error("시험 DB 없음");
    const session = await createOwnerSession(
      isolated.db,
      { accountId: BigInt(`0x${newUuid().replaceAll("-", "").slice(0, 14)}`).toString(), friend: false },
      now,
      false,
    );
    const store = new MemoryStore(),
      upload = newUploadId("license_photo", now);
    await store.put(tempKey(createOwnerScope(session.ownerId), upload), new Uint8Array([1]), "image/jpeg");
    const api = createApp({ connect: () => roleDb(), services: { storage: store, now: () => now }, logSink: () => {} });
    const origin = "https://siljang.example",
      cookie = `siljang_owner=${session.token}`,
      key = newRequestKey();
    const input = {
      name: "제한 역할 등록",
      contactPhone: "010-1234-5678",
      businessAddress: "서울 합성로 1",
      contactEmail: "runtime@example.com",
      businessName: "합성 제과",
      representativeName: "김합성",
      businessRegNo: "1234567891",
      mailOrderRegNo: null,
      mailOrderAuthority: null,
      mailOrderExemption: "합성 면제 사유",
      foodLicenseNo: "2026-1234567",
      foodBusinessType: "bakery",
      licensePhotoUploadId: upload,
      entrustmentTermsVersion: "2026.11",
      entrustmentConsent: true,
    };
    const env = testEnv({ FILE_URL_KEY: TEST_HASH_KEY });
    const post = () =>
      api.request(
        `${origin}/api/owner/shop`,
        {
          method: "POST",
          headers: { origin, cookie, "content-type": "application/json", "Idempotency-Key": key },
          body: JSON.stringify(input),
        },
        env,
      );
    const first = await post();
    expect(first.status, await first.clone().text()).toBe(201);
    const replay = await post();
    expect(replay.status).toBe(201);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    const read = await api.request(`${origin}/api/owner/shop`, { headers: { cookie } }, env);
    expect(read.status, await read.clone().text()).toBe(200);
    expect(await read.json()).toMatchObject({ licenseStatus: "pending", bookingUrl: null });
    const privileges = await isolated.db.query<{ approve: boolean; issue: boolean; remove: boolean }>(
      "SELECT has_column_privilege($1,'shops','license_status','UPDATE') AS approve, has_column_privilege($1,'shops','booking_slug','INSERT') AS issue, has_table_privilege($1,'shops','DELETE') AS remove",
      [role],
    );
    expect(privileges.rows).toEqual([{ approve: false, issue: false, remove: false }]);
  });

  it("제한 역할로 가격표 4개 API를 실행하고 이전 항목 수정·삭제는 막음", async () => {
    if (!isolated) throw new Error("시험 DB 없음");
    const store = new MemoryStore(),
      uploadId = newUploadId("design_image", now);
    await store.put(tempKey(createOwnerScope(shop.ownerId), uploadId), new Uint8Array([1, 2]), "image/png");
    const api = createApp({
      connect: () => roleDb(),
      scopes: { owner: async () => createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId }) },
      services: { storage: store, now: () => now },
      logSink: () => {},
    });
    const key = newRequestKey();
    const call = (method: string, path: string, body?: unknown) =>
      api.request(
        `https://siljang.example/api${path}`,
        {
          method,
          headers: { origin: "https://siljang.example", "content-type": "application/json", "Idempotency-Key": key },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        testEnv({ FILE_URL_KEY: TEST_HASH_KEY }),
      );
    const first = await call("GET", "/owner/price-list");
    expect(first.status, await first.clone().text()).toBe(200);
    const previous = (await first.json()) as { revision: string };
    const body = {
      baseRevision: previous.revision,
      options: [
        {
          key: "size",
          group: "size",
          name: "1호",
          priceKind: "fixed",
          amount: 35000,
          amountMax: null,
          inStandard: true,
          position: 0,
        },
        {
          key: "flower",
          group: "design",
          name: "꽃",
          priceKind: "fixed",
          amount: 5000,
          amountMax: null,
          inStandard: true,
          position: 0,
        },
      ],
      rules: [{ kind: "surcharge", optionA: "size", optionB: "flower", amount: 1000 }],
      designs: [{ name: "꽃 사진", uploadId, optionKey: "flower", inStandard: true, position: 0 }],
    };
    const save = await call("POST", "/owner/price-list/versions", body);
    expect(save.status, await save.clone().text()).toBe(201);
    expect(await save.json()).toMatchObject({
      outcome: "created",
      priceList: { version: 2, designs: [{ inStandard: true }], rules: [{ amount: 1000 }] },
    });
    const replay = await call("POST", "/owner/price-list/versions", body);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    for (const path of [
      "/owner/price-list",
      "/owner/price-list/versions",
      "/owner/price-list/versions/1",
      "/owner/price-list/versions/2",
    ])
      expect((await call("GET", path)).status).toBe(200);
    const permissions = await isolated.db.query(
      `SELECT has_column_privilege($1,'price_lists','superseded_at','UPDATE') AS supersede,
        has_column_privilege($1,'price_lists','version','UPDATE') AS rewrite_version,
        has_table_privilege($1,'price_lists','DELETE') AS remove_list,
        has_column_privilege($1,'price_options','in_standard','UPDATE') AS rewrite_option,
        has_column_privilege($1,'designs','in_standard','UPDATE') AS rewrite_design,
        has_table_privilege($1,'price_option_rules','DELETE') AS remove_rule`,
      [role],
    );
    expect(permissions.rows).toEqual([
      {
        supersede: true,
        rewrite_version: false,
        remove_list: false,
        rewrite_option: false,
        rewrite_design: false,
        remove_rule: false,
      },
    ]);
    const conn = roleDb();
    try {
      await expect(
        conn.query("UPDATE price_options SET in_standard=false WHERE shop_id=$1", [shop.shopId]),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(conn.query("DELETE FROM designs WHERE shop_id=$1", [shop.shopId])).rejects.toMatchObject({
        code: "42501",
      });
    } finally {
      await conn.close();
    }
  });

  it("제한 역할로 운영규정 4개 API를 실행하고 이전 조문/단계 수정·삭제는 막음", async () => {
    if (!isolated) throw new Error("시험 DB 없음");
    const api = createApp({
      connect: () => roleDb(),
      scopes: { owner: async () => createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId }) },
      services: { now: () => now },
      logSink: () => {},
    });
    const key = newRequestKey();
    const call = (method: string, path: string, body?: unknown) =>
      api.request(
        `https://siljang.example/api${path}`,
        {
          method,
          headers: { origin: "https://siljang.example", "content-type": "application/json", "Idempotency-Key": key },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        testEnv(),
      );
    const current = await call("GET", "/owner/operating-rules");
    expect(current.status, await current.clone().text()).toBe(200);
    const first = (await current.json()) as { revision: string };
    const body = {
      baseRevision: first.revision,
      quoteValidHours: 72,
      paymentDueHours: 24,
      issueReportHours: 24,
      changeDeadlineHours: 48,
      cancellationFeeKrw: 0,
      preProductionRefundPct: 100,
      dateChangeRefundBasis: "original_pickup",
      clauses: [
        {
          key: "pre_production_cancel",
          position: 1,
          title: "제작 전 취소",
          conditionText: "제작 전인 경우",
          effectText: "취소 수수료만 빼고 모두 돌려드립니다.",
        },
      ],
      refundTiers: [],
    };
    const save = await call("POST", "/owner/operating-rules/versions", body);
    expect(save.status, await save.clone().text()).toBe(201);
    expect(await save.json()).toMatchObject({
      outcome: "created",
      operatingRules: { version: 2, paymentDueHours: 24 },
    });
    const replay = await call("POST", "/owner/operating-rules/versions", body);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    for (const path of [
      "/owner/operating-rules",
      "/owner/operating-rules/versions",
      "/owner/operating-rules/versions/1",
      "/owner/operating-rules/versions/2",
    ])
      expect((await call("GET", path)).status).toBe(200);
    const flags = await isolated.db.query(
      `SELECT has_column_privilege($1,'operating_rules','superseded_at','UPDATE') AS supersede,
      has_column_privilege($1,'operating_rules','version','UPDATE') AS rewrite_version,
      has_column_privilege($1,'rule_clauses','effect_text','UPDATE') AS rewrite_clause,
      has_table_privilege($1,'refund_tiers','DELETE') AS remove_tier`,
      [role],
    );
    expect(flags.rows).toEqual([
      { supersede: true, rewrite_version: false, rewrite_clause: false, remove_tier: false },
    ]);
    const conn = roleDb();
    try {
      await expect(
        conn.query("UPDATE rule_clauses SET effect_text='합성 변경' WHERE shop_id=$1", [shop.shopId]),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(conn.query("DELETE FROM refund_tiers WHERE shop_id=$1", [shop.shopId])).rejects.toMatchObject({
        code: "42501",
      });
    } finally {
      await conn.close();
    }
  });

  it("제한 역할의 계좌 조회/교체·보류 해제는 되고 임의 승인·예금주 확인/삭제는 막음", async () => {
    if (!isolated) throw new Error("시험 DB 없음");
    const fixture = await createShop(isolated.db, "제한 역할 계좌 가게");
    const { fc } = singleKeyCrypto();
    const enc = await fc.seal("123456-01-234567", {
      shopId: fixture.shopId,
      purpose: "payment_accounts.account_number",
    });
    await isolated.db.query("UPDATE payment_accounts SET account_number_enc=$2 WHERE shop_id=$1", [
      fixture.shopId,
      enc,
    ]);
    const operator = await isolated.db.query<{ id: string }>(
      "INSERT INTO operators(email,display_name) VALUES ($1,'합성 운영자') RETURNING id",
      [`${newUuid()}@operator.example`],
    );
    await isolated.db.query(
      "UPDATE shops SET license_status='on_hold',license_hold_reason='합성 보류',license_reviewed_by=$2,license_reviewed_at=$3 WHERE id=$1",
      [fixture.shopId, operator.rows[0]?.id, now],
    );
    const app = createApp({
      connect: () => roleDb(),
      scopes: { owner: async () => createShopScope(fixture.shopId, { kind: "owner", ownerId: fixture.ownerId }) },
      services: { now: () => now, fieldCrypto: fc },
      logSink: () => {},
    });
    const call = (method: string, body?: unknown, key = newRequestKey()) =>
      app.request(
        "https://siljang.example/api/owner/payment-destination",
        {
          method,
          headers: { origin: "https://siljang.example", "content-type": "application/json", "Idempotency-Key": key },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        testEnv(),
      );
    const get = await call("GET");
    expect(get.status, await get.clone().text()).toBe(200);
    const read = (await get.json()) as { revision: string };
    const body = {
      baseRevision: read.revision,
      bankName: "합성은행",
      accountNumber: "111111-12-345678",
      holderName: "시험사장",
      cardPaymentUrl: null,
    };
    const key = newRequestKey();
    const saved = await call("PUT", body, key);
    expect(saved.status, await saved.clone().text()).toBe(200);
    const replay = await call("PUT", body, key);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(
      (
        await isolated.db.query(
          "SELECT license_status,license_hold_reason,license_reviewed_by FROM shops WHERE id=$1",
          [fixture.shopId],
        )
      ).rows,
    ).toEqual([{ license_status: "pending", license_hold_reason: null, license_reviewed_by: null }]);
    expect(
      (
        await isolated.db.query("SELECT id FROM owner_alerts WHERE shop_id=$1 AND kind='payment_account_changed'", [
          fixture.shopId,
        ])
      ).rowCount,
    ).toBe(1);
    const conn = roleDb();
    try {
      await expect(
        conn.query("UPDATE shops SET license_status='verified' WHERE id=$1", [fixture.shopId]),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        conn.query("UPDATE payment_accounts SET holder_checked_at=now() WHERE shop_id=$1", [fixture.shopId]),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(conn.query("DELETE FROM payment_accounts WHERE shop_id=$1", [fixture.shopId])).rejects.toMatchObject(
        { code: "42501" },
      );
    } finally {
      await conn.close();
    }
  });

  it("제한 역할의 채널 설정/키 교체는 되고 기존 봇 바꾸기·다른 가게 이동/삭제는 막음", async () => {
    if (!isolated) throw new Error("시험 DB 없음");
    const fixture = await createShop(isolated.db, "제한 역할 채널 가게");
    const api = createApp({
      connect: () => roleDb(),
      scopes: { owner: async () => createShopScope(fixture.shopId, { kind: "owner", ownerId: fixture.ownerId }) },
      services: { now: () => now },
      logSink: () => {},
    });
    const path = "/owner/kakao-channel";
    const call = (method: string, url = path, body?: unknown, key = newRequestKey()) =>
      api.request(
        `https://siljang.example/api${url}`,
        {
          method,
          headers: { origin: "https://siljang.example", "content-type": "application/json", "Idempotency-Key": key },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        testEnv(),
      );
    const read = await call("GET");
    expect(read.status).toBe(200);
    const current = (await read.json()) as { revision: string };
    const body = {
      baseRevision: current.revision,
      botId: newUuid().replaceAll("-", "").slice(0, 24),
      channelPublicId: "_synthetic",
      blockIds: {
        card: "card",
        ordererInfo: "orderer",
        allergyAnswer: "allergy",
        depositorName: "depositor",
        review: "review",
      },
    };
    const saved = await call("PUT", path, body);
    expect(saved.status, await saved.clone().text()).toBe(200);
    const created = (await saved.json()) as { kakaoChannel: { revision: string } };
    const key = newRequestKey(),
      rotate = { baseRevision: created.kakaoChannel.revision, previousKey: "keep_24h" };
    const response = await call("POST", `${path}/skill-key`, rotate, key);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({ skillKey: { keyVersion: 2 } });
    const replay = await call("POST", `${path}/skill-key`, rotate, key);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    const after = await call("GET");
    const fresh = (await after.json()) as { revision: string };
    const changed = await call("PUT", path, {
      ...body,
      baseRevision: fresh.revision,
      blockIds: { ...body.blockIds, review: "new-review" },
    });
    expect(changed.status, await changed.clone().text()).toBe(200);
    const conn = roleDb();
    try {
      await expect(
        conn.query("UPDATE kakao_channels SET bot_id='other' WHERE shop_id=$1", [fixture.shopId]),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        conn.query("UPDATE kakao_channels SET shop_id=$2 WHERE shop_id=$1", [fixture.shopId, shop.shopId]),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(conn.query("DELETE FROM kakao_channels WHERE shop_id=$1", [fixture.shopId])).rejects.toMatchObject({
        code: "42501",
      });
    } finally {
      await conn.close();
    }
  });

  it("제한 역할과 실제 사장님 세션으로 연결 문구/시험 버튼 다섯을 처리하고 상담/후기를 만들지 않음", async () => {
    if (!isolated) throw new Error("시험 DB 없음");
    const target = await createShop(isolated.db, "제한 역할 연결 확인 가게");
    await isolated.db.query(
      "UPDATE kakao_channels SET check_started_at=NULL,test_user_key=NULL,verified_blocks='{}',card_block_id='card',orderer_block_id='orderer',allergy_block_id='allergy',depositor_block_id='depositor',review_block_id='review' WHERE shop_id=$1",
      [target.shopId],
    );
    const owner = (
      await isolated.db.query<{ kakao_account_id: string }>("SELECT kakao_account_id FROM owners WHERE id=$1", [
        target.ownerId,
      ])
    ).rows[0];
    if (!owner) throw new Error("합성 사장님 없음");
    const session = await createOwnerSession(
      isolated.db,
      { accountId: owner.kakao_account_id, friend: false },
      now,
      false,
    );
    let eventCalls = 0;
    const forbiddenEvent = async (): Promise<never> => {
      eventCalls++;
      throw new Error("무료 MVP 발신 금지");
    };
    const api = createApp({
      connect: () => roleDb(),
      services: { now: () => now, kakaoEvents: { requestNotice: forbiddenEvent, checkDelivery: forbiddenEvent } },
      logSink: () => {},
    });
    const startKey = newRequestKey();
    const startCall = () =>
      api.request(
        "https://siljang.example/api/owner/kakao-channel/check",
        {
          method: "POST",
          headers: {
            origin: "https://siljang.example",
            cookie: `${OWNER_COOKIE}=${session.token}`,
            "Idempotency-Key": startKey,
          },
        },
        testEnv(),
      );
    try {
      await isolated.db.query(`REVOKE UPDATE (check_started_at) ON kakao_channels FROM "${role}"`);
      const failed = await startCall();
      expect(failed.status).toBe(500);
      expect(await failed.text()).not.toContain("permission denied");
      expect(
        (await isolated.db.query("SELECT check_started_at FROM kakao_channels WHERE shop_id=$1", [target.shopId])).rows,
      ).toEqual([{ check_started_at: null }]);
    } finally {
      await isolated.db.query(`GRANT UPDATE (check_started_at) ON kakao_channels TO "${role}"`);
    }
    const start = await startCall();
    expect(start.status, await start.clone().text()).toBe(200);
    const started = (await start.json()) as { kakaoChannel: { proofPhrase: string } };
    const skillKey = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), target.channelId, 1);
    const skill = (kind: string, utterance: string, blockId: string, extra: Record<string, string> = {}) =>
      api.request(
        `/api/kakao/skills/${kind}`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "Siljang-Skill-Key": skillKey },
          body: JSON.stringify({
            bot: { id: target.botId },
            userRequest: {
              utterance,
              block: { id: blockId },
              user: { id: "synthetic-role-trial-user", type: "botUserKey" },
            },
            action: { id: "synthetic-role-trial", params: {}, clientExtra: extra },
          }),
        },
        testEnv(),
      );
    const before = (
      await isolated.db.query(
        "SELECT (SELECT count(*) FROM messages WHERE shop_id=$1)::int AS messages,(SELECT count(*) FROM orders WHERE shop_id=$1)::int AS orders,(SELECT count(*) FROM reviews WHERE shop_id=$1)::int AS reviews",
        [target.shopId],
      )
    ).rows;
    let response = await skill("message", started.kakaoChannel.proofPhrase, "conversation");
    expect(response.headers.get("Siljang-Outcome")).toBe("channel_test_card");
    for (let i = 0; i < 5; i++) {
      const body = (await response.json()) as {
        template: { outputs: { textCard: { buttons: { blockId: string; extra: { check: string } }[] } }[] };
      };
      const button = body.template.outputs[0]?.textCard.buttons[0];
      if (!button) throw new Error("다음 시험 버튼 없음");
      response = await skill(button.extra.check === "review" ? "review" : "card", "시험", button.blockId, button.extra);
      expect(response.headers.get("Siljang-Outcome"), await response.clone().text()).toBe(
        i === 4 ? "channel_linked" : "block_verified",
      );
    }
    expect(
      (
        await isolated.db.query("SELECT status,verified_blocks,event_status FROM kakao_channels WHERE shop_id=$1", [
          target.shopId,
        ])
      ).rows,
    ).toEqual([
      {
        status: "linked",
        verified_blocks: ["card", "orderer_info", "allergy_answer", "depositor_name", "review"],
        event_status: "unchecked",
      },
    ]);
    expect(
      (
        await isolated.db.query(
          "SELECT (SELECT count(*) FROM messages WHERE shop_id=$1)::int AS messages,(SELECT count(*) FROM orders WHERE shop_id=$1)::int AS orders,(SELECT count(*) FROM reviews WHERE shop_id=$1)::int AS reviews",
          [target.shopId],
        )
      ).rows,
    ).toEqual(before);
    expect(eventCalls).toBe(0);
  });

  it("제한 역할의 사업자 요청/운영자 반영은 되고 직접 판정/신원/삭제는 막음", async () => {
    if (!isolated) throw new Error("시험 DB 없음");
    const db = isolated.db,
      target = await createShop(db, "제한 역할 사업자 변경");
    await db.query("UPDATE shops SET business_reg_no='1234567891' WHERE id=$1", [target.shopId]);
    const owner = (
      await db.query<{ kakao_account_id: string }>("SELECT kakao_account_id FROM owners WHERE id=$1", [target.ownerId])
    ).rows[0];
    if (!owner) throw new Error("사장님 없음");
    const ownerSession = await createOwnerSession(db, { accountId: owner.kakao_account_id, friend: false }, now, false),
      op = await seedOperatorSession(db, now),
      store = new MemoryStore(),
      uploadId = newUploadId("license_photo", now);
    await store.put(tempKey(createOwnerScope(target.ownerId), uploadId), new Uint8Array([1]), "image/jpeg");
    const api = createApp({ connect: () => roleDb(), services: { storage: store, now: () => now }, logSink: () => {} }),
      origin = "https://siljang.example",
      env = testEnv({ FILE_URL_KEY: TEST_HASH_KEY });
    const headers = {
      cookie: `${OWNER_COOKIE}=${ownerSession.token}`,
      origin,
      "content-type": "application/json",
      "Idempotency-Key": newRequestKey(),
    };
    const before = (await (await api.request(`${origin}/api/owner/shop`, { headers }, env)).json()) as {
      revision: string;
      businessName: string;
      representativeName: string;
      businessRegNo: string;
    };
    const body = {
      baseRevision: before.revision,
      businessName: "제한 역할 새 상호",
      representativeName: before.representativeName,
      businessRegNo: before.businessRegNo,
      evidencePhotoUploadId: uploadId,
    };
    const post = () =>
      api.request(
        `${origin}/api/owner/shop/identity-changes`,
        { method: "POST", headers, body: JSON.stringify(body) },
        env,
      );
    const created = await post();
    expect(created.status, await created.clone().text()).toBe(201);
    expect((await post()).headers.get("Idempotency-Replayed")).toBe("true");
    const detail = await api.request(
      `${origin}/api/operator/shops/${target.shopId}`,
      { headers: { cookie: op.cookie } },
      env,
    );
    expect(detail.status, await detail.clone().text()).toBe(200);
    const item = ((await detail.json()) as { pendingIdentityChange: { changeId: string; revision: string } })
      .pendingIdentityChange;
    const reviewBody = { baseRevision: item.revision, decision: "applied" },
      reviewHeaders = { ...headers, cookie: op.cookie, "Idempotency-Key": newRequestKey() };
    const review = () =>
      api.request(
        `${origin}/api/operator/identity-changes/${item.changeId}/review`,
        { method: "POST", headers: reviewHeaders, body: JSON.stringify(reviewBody) },
        env,
      );
    try {
      await db.query(
        `REVOKE EXECUTE ON FUNCTION review_shop_identity(uuid,uuid,uuid,text,timestamptz,text,uuid,text,text,text) FROM "${role}"`,
      );
      const failed = await review();
      expect(failed.status).toBe(500);
      expect(await failed.text()).not.toContain("permission denied");
      expect((await db.query("SELECT business_name FROM shops WHERE id=$1", [target.shopId])).rows).toEqual([
        { business_name: before.businessName },
      ]);
      expect((await db.query("SELECT id FROM owner_alerts WHERE shop_id=$1", [target.shopId])).rows).toHaveLength(0);
    } finally {
      await db.query(
        `GRANT EXECUTE ON FUNCTION review_shop_identity(uuid,uuid,uuid,text,timestamptz,text,uuid,text,text,text) TO "${role}"`,
      );
    }
    const done = await review();
    expect(done.status, await done.clone().text()).toBe(200);
    const replay = await review();
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(
      (await db.query("SELECT kind,owner_task_id FROM owner_alerts WHERE shop_id=$1", [target.shopId])).rows,
    ).toEqual([{ kind: "identity_change_applied", owner_task_id: null }]);
    const limited = roleDb();
    try {
      for (const [sql, params] of [
        ["UPDATE shops SET business_name='직접 신원' WHERE id=$1", [target.shopId]],
        ["UPDATE shop_identity_changes SET status='pending' WHERE shop_id=$1", [target.shopId]],
        ["DELETE FROM shop_identity_changes WHERE shop_id=$1", [target.shopId]],
        ["INSERT INTO shop_identity_changes (shop_id,status) VALUES ($1,'applied')", [target.shopId]],
      ] as const)
        await expect(limited.query(sql, params)).rejects.toMatchObject({ code: "42501" });
    } finally {
      await limited.close();
    }
  });

  it("제한 역할의 가게 설정 변경과 실제 세션은 되고 신원/승인/삭제는 막음", async () => {
    if (!isolated) throw new Error("시험 DB 없음");
    const target = await createShop(isolated.db, "제한 역할 설정 가게");
    const owner = (
      await isolated.db.query<{ kakao_account_id: string }>("SELECT kakao_account_id FROM owners WHERE id=$1", [
        target.ownerId,
      ])
    ).rows[0];
    if (!owner) throw new Error("합성 사장님 없음");
    const session = await createOwnerSession(
      isolated.db,
      { accountId: owner.kakao_account_id, friend: false },
      now,
      false,
    );
    const api = createApp({ connect: () => roleDb(), services: { now: () => now }, logSink: () => {} }),
      url = "https://siljang.example/api/owner/shop",
      headers = {
        cookie: `${OWNER_COOKIE}=${session.token}`,
        origin: "https://siljang.example",
        "content-type": "application/json",
        "Idempotency-Key": newRequestKey(),
      },
      env = testEnv({ FILE_URL_KEY: TEST_HASH_KEY });
    const initial = await api.request(url, { headers }, env);
    expect(initial.status).toBe(200);
    const before = (await initial.json()) as { revision: string };
    const changes = {
      baseRevision: before.revision,
      name: "제한 역할 설정 변경",
      contactPhone: "02-000-0000",
      businessAddress: "서울 합성로 3",
      contactEmail: "role-settings@example.com",
      pickupAddress: "합성 픽업",
      mailOrderRegNo: "합성 신고",
      mailOrderAuthority: "합성구청",
      mailOrderExemption: null,
      completionPhotoEnabled: true,
      idleCloseHours: 10,
      ownerWaitMinutes: 30,
      dailyAiCostLimitKrw: 3000,
      awaitingPaymentLimit: 1,
    };
    const patch = () => api.request(url, { method: "PATCH", headers, body: JSON.stringify(changes) }, env);
    const saved = await patch();
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect(await saved.json()).toMatchObject({
      outcome: "done",
      shop: { name: changes.name, ownerWaitMinutes: 30, dailyAiCostLimitKrw: 3000, awaitingPaymentLimit: 1 },
    });
    const replay = await patch();
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    const conn = roleDb();
    try {
      for (const statement of [
        "UPDATE shops SET business_name='forbidden' WHERE id=$1",
        "UPDATE shops SET representative_name='forbidden' WHERE id=$1",
        "UPDATE shops SET license_status='verified' WHERE id=$1",
        "DELETE FROM shops WHERE id=$1",
        "SELECT spreadsheet_id FROM ledger_links WHERE shop_id=$1",
        "SELECT credential_ref FROM ledger_links WHERE shop_id=$1",
        "SELECT unlinked_at FROM ledger_links WHERE shop_id=$1",
        "UPDATE ledger_links SET status='auth_lost' WHERE shop_id=$1",
      ])
        await expect(conn.query(statement, [target.shopId])).rejects.toMatchObject({ code: "42501" });
    } finally {
      await conn.close();
    }
  });

  it("가게·채널 공유 잠금과 손님·상담·수신 메시지 쓰기를 실제 역할로 실행", async () => {
    const conn = roleDb();
    const scope = createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" });
    try {
      const result = await receiveKakaoMessage(
        shopRequestDb(scope, conn),
        {
          scope,
          channelId: shop.channelId,
          status: "linked",
          receivedAt: now,
          requestKeySecret: new Secret(TEST_HASH_KEY),
          payload: {
            botId: shop.botId,
            blockId: "conversation",
            userId: newUuid(),
            utterance: "합성 권한 시험",
            callbackUrl: undefined,
            isFriend: true,
            params: {},
            action: { params: {}, clientExtra: {} },
          },
        },
        "text",
      );
      expect(result.kind).toBe("received");
    } finally {
      await conn.close();
    }
  });

  it("제한 역할로 캘린더 4개 API와 날짜 잠금을 실행하고 주문·자리 쓰기는 막음", async () => {
    const api = createApp({
      connect: () => roleDb(),
      scopes: { owner: async () => createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId }) },
      services: { now: () => now },
      logSink: () => {},
    });
    const call = (method: string, path: string, body?: unknown) =>
      api.request(
        `https://siljang.example/api${path}`,
        {
          method,
          headers: {
            origin: "https://siljang.example",
            "content-type": "application/json",
            "Idempotency-Key": newRequestKey(),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        testEnv(),
      );
    const current = await call("GET", "/owner/calendar");
    expect(current.status, await current.clone().text()).toBe(200);
    const { revision, updatedAt: _updated, ...settings } = (await current.json()) as Record<string, unknown>;
    const saved = await call("PUT", "/owner/calendar", {
      ...settings,
      baseRevision: revision,
      dailyCapacity: 8,
      reviewRequestTime: "12:30",
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const days = await call("GET", "/owner/calendar/days?from=2026-11-22&to=2026-11-22");
    expect(days.status, await days.clone().text()).toBe(200);
    const list = (await days.json()) as { items: { revision: string }[] };
    const closed = await call("PATCH", "/owner/calendar/days/2026-11-22", {
      baseRevision: list.items[0]?.revision,
      manuallyClosed: true,
    });
    expect(closed.status, await closed.clone().text()).toBe(200);
    expect(await closed.json()).toMatchObject({ day: { capacity: 8, manuallyClosed: true } });
    if (!isolated) throw new Error("시험 DB 없음");
    const privileges = await isolated.db.query(
      "SELECT has_table_privilege($1, 'slot_holds', 'INSERT') AS slot_write, has_column_privilege($1, 'orders', 'status', 'UPDATE') AS order_write, has_column_privilege($1, 'notifications', 'body', 'UPDATE') AS notice_body",
      [role],
    );
    expect(privileges.rows).toEqual([{ slot_write: false, order_write: false, notice_body: false }]);
  });

  it("내용 없는 ID 메시지도 콜백의 UPDATE·SELECT·만료 정리 경로를 실행", async () => {
    expect(
      await consumeKakaoCallback(
        { shopId: shop.shopId, messageId: newUuid() },
        { APP_ENV: "development" },
        { connect: () => roleDb(), now: () => now },
      ),
    ).toBe("done");
  });

  it("제한 역할의 기본 Cron은 예약 시각 밖에서 보관 기록을 쓰지 않고 알림도 오류 없이 점검", async () => {
    if (isolated === undefined) throw new Error("시험 DB 없음");
    const before = await isolated.db.query("SELECT count(*)::int AS n FROM ops_events");
    const logs = collectLogs();
    const result = await runScheduled({ scheduledTime: now.getTime(), cron: "* * * * *" }, testEnv(), {
      connect: () => roleDb(),
      logSink: logs.sink,
    });
    expect(result?.dailyStarted).toEqual([]);
    expect(result?.jobs.purge).toEqual({ found: 0, done: 0, skipped: 0, failed: 0 });
    expect(result?.jobs.owner_alert?.failed).toBe(0);
    const entries = logs.lines.map((line) => JSON.parse(line));
    expect(entries.some((entry) => entry.job === "owner_alert" && entry.level === "info")).toBe(true);
    expect(entries.filter((entry) => entry.level === "error")).toEqual([]);
    expect(entries.filter((entry) => entry.job !== "owner_alert")).toEqual([
      { level: "info", event: "job_polled", job: "purge" },
      { level: "info", event: "kakao_callback_recovery_polled", count: 0 },
    ]);
    expect((await isolated.db.query("SELECT count(*)::int AS n FROM ops_events")).rows).toEqual(before.rows);
  });

  it("제한 역할로 손님별 선점·이전 답 조회·콜백 성공 뒤 전달 표시까지 실행", async () => {
    const conn = roleDb();
    const scope = createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" });
    const scoped = shopRequestDb(scope, conn);
    const env = { APP_ENV: "development", FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: newFieldKey() };
    const keys = readSettings(env).fieldKeys;
    const callback = kakaoCallback("https://bot-api.kakao.com/v1/callback/synthetic_role", now);
    if (keys === null || callback === null) throw new Error("시험 설정 없음");
    try {
      const received = await receiveKakaoMessage(
        scoped,
        {
          scope,
          channelId: shop.channelId,
          status: "linked",
          receivedAt: now,
          requestKeySecret: new Secret(TEST_HASH_KEY),
          payload: {
            botId: shop.botId,
            blockId: "conversation",
            userId: shop.userKey,
            utterance: "제한 역할 콜백 시험",
            callbackUrl: callback.url.href,
            isFriend: false,
            params: {},
            action: { params: {}, clientExtra: {} },
          },
        },
        "text",
      );
      if (received.kind !== "received") throw new Error("시험 수신 실패");
      const previous = await scoped.run<{ id: string }>(
        `INSERT INTO messages (shop_id, consultation_id, direction, author, kind, body_masked, delivery, created_at)
          VALUES ($1, $2, 'outbound', 'system', 'text', '제한 역할 이전 안내', 'deferred', $3) RETURNING id`,
        [received.consultationId, new Date(now.getTime() - 1000)],
      );
      const envelope = await scoped.transaction((tx) =>
        storeKakaoCallback(tx, fieldCrypto(keys), received.messageId, callback, () => 3000),
      );
      if (envelope === null) throw new Error("시험 콜백 저장 실패");
      expect(
        await publishStoredKakaoCallback(
          scoped,
          { send: async () => {} },
          received,
          envelope,
          () => 3000,
          async () => {
            throw new Error("성공한 큐에서 거절 처리 금지");
          },
        ),
      ).toEqual({ kind: "callback" });
      let text: unknown;
      expect(
        await consumeKakaoCallback({ shopId: shop.shopId, messageId: received.messageId }, env, {
          connect: () => roleDb(),
          now: () => new Date(now.getTime() + 5000),
          fetch: async (_url, init) => {
            text = JSON.parse(String(init?.body));
            return Response.json({ status: "SUCCESS" });
          },
        }),
      ).toBe("done");
      expect(JSON.stringify(text)).toContain("제한 역할 이전 안내");
      expect(
        (
          await scoped.run<{ delivery: string }>("SELECT delivery FROM messages WHERE shop_id=$1 AND id=$2", [
            previous.rows[0]?.id,
          ])
        ).rows,
      ).toEqual([{ delivery: "delivered_later" }]);
    } finally {
      await conn.close();
    }
  });

  it("제한 역할의 운영자 목록/상세/판정은 전용 함수로만 되고 일반 승인/예금주 확인 UPDATE는42501임", async () => {
    if (!isolated) throw new Error("시험 DB 없음");
    const target = await createShop(isolated.db, "합성 운영자 권한 가게"),
      session = await seedOperatorSession(isolated.db, now);
    const app = createApp({ connect: () => roleDb(), services: { now: () => now }, logSink: () => {} });
    const call = (method: string, path: string, body?: unknown, key = newRequestKey()) =>
      app.request(
        `https://siljang.example/api${path}`,
        {
          method,
          headers: {
            origin: "https://siljang.example",
            cookie: session.cookie,
            "content-type": "application/json",
            "Idempotency-Key": key,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        testEnv({ FILE_URL_KEY: TEST_HASH_KEY }),
      );
    expect((await call("GET", "/operator/shops")).status).toBe(200);
    const path = `/operator/shops/${target.shopId}`,
      detail = await call("GET", path);
    expect(detail.status).toBe(200);
    const current = (await detail.json()) as { revision: string },
      body = { baseRevision: current.revision, decision: "verified" },
      key = newRequestKey();
    await isolated.db.query(
      `REVOKE EXECUTE ON FUNCTION review_shop_license(uuid,uuid,text,timestamptz,text,text,text) FROM "${role}"`,
    );
    expect((await call("POST", `${path}/license-review`, body, key)).status).toBe(500);
    await isolated.db.query(
      `GRANT EXECUTE ON FUNCTION review_shop_license(uuid,uuid,text,timestamptz,text,text,text) TO "${role}"`,
    );
    for (let i = 0; i < 2; i++) {
      const result = await call("POST", `${path}/license-review`, body, key);
      expect(result.status, await result.clone().text()).toBe(200);
      expect(((await result.json()) as { shop: { licenseStatus: string } }).shop.licenseStatus).toBe("verified");
    }
    const connection = roleDb();
    try {
      for (const sql of [
        "UPDATE shops SET license_status='verified' WHERE id=$1",
        "UPDATE payment_accounts SET holder_checked_at=$2 WHERE shop_id=$1",
        "UPDATE owner_tasks SET closed_at=$2 WHERE shop_id=$1",
        "SELECT close_license_on_hold_tasks($1,$2)",
      ])
        await expect(
          connection.query(sql, sql.includes("$2") ? [target.shopId, now] : [target.shopId]),
        ).rejects.toMatchObject({ code: "42501" });
      expect(
        (
          await connection.query("SELECT review_shop_license($1,$2,$3,$4,$5,'verified',NULL) AS result", [
            target.shopId,
            session.operatorId,
            "0".repeat(64),
            now,
            "stale",
          ])
        ).rows,
      ).toEqual([{ result: "unauthenticated" }]);
    } finally {
      await connection.close();
    }
  });

  it("보류 알림 INSERT가 실패하면 가게 판정/할 일도 되돌리고 같은 요청 키로 다시 처리함", async () => {
    if (!isolated) throw new Error("시험 DB 없음");
    const target = await createShop(isolated.db, "합성 보류 되돌림 가게"),
      session = await seedOperatorSession(isolated.db, now);
    const app = createApp({ connect: () => roleDb(), services: { now: () => now }, logSink: () => {} }),
      path = `https://siljang.example/api/operator/shops/${target.shopId}`;
    const headers = {
        origin: "https://siljang.example",
        cookie: session.cookie,
        "content-type": "application/json",
        "Idempotency-Key": newRequestKey(),
      },
      env = testEnv({ FILE_URL_KEY: TEST_HASH_KEY });
    const detail = (await (await app.request(path, { headers }, env)).json()) as { revision: string };
    const call = () =>
      app.request(
        `${path}/license-review`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            baseRevision: detail.revision,
            decision: "on_hold",
            holdReason: "합성 사진을 다시 올려 주세요",
          }),
        },
        env,
      );
    try {
      await isolated.db.query(`REVOKE INSERT ON owner_alerts FROM "${role}"`);
      expect((await call()).status).toBe(500);
      expect(
        (await isolated.db.query("SELECT license_status,license_hold_reason FROM shops WHERE id=$1", [target.shopId]))
          .rows,
      ).toEqual([{ license_status: "pending", license_hold_reason: null }]);
      expect(
        (await isolated.db.query("SELECT count(*)::int AS n FROM owner_tasks WHERE shop_id=$1", [target.shopId])).rows,
      ).toEqual([{ n: 0 }]);
    } finally {
      await isolated.db.query(`GRANT INSERT ON owner_alerts TO "${role}"`);
    }
    const saved = await call();
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect(
      (await isolated.db.query("SELECT count(*)::int AS n FROM owner_tasks WHERE shop_id=$1", [target.shopId])).rows,
    ).toEqual([{ n: 1 }]);
  });

  it("이전 보류가 있는 새 판정의 알림 실패는 옛 할 일/예약도 되돌림", async () => {
    if (!isolated) throw new Error("시험 DB 없음");
    const target = await createShop(isolated.db, "이전 보류 되돌림 합성 가게"),
      session = await seedOperatorSession(isolated.db, now);
    const app = createApp({ connect: () => roleDb(), services: { now: () => now }, logSink: () => {} }),
      url = `https://siljang.example/api/operator/shops/${target.shopId}`,
      env = testEnv({ FILE_URL_KEY: TEST_HASH_KEY }),
      headers = { origin: "https://siljang.example", cookie: session.cookie, "content-type": "application/json" };
    const review = async (reason: string, key = newRequestKey()) => {
      const current = (await (await app.request(url, { headers }, env)).json()) as { revision: string };
      return app.request(
        `${url}/license-review`,
        {
          method: "POST",
          headers: { ...headers, "Idempotency-Key": key },
          body: JSON.stringify({ baseRevision: current.revision, decision: "on_hold", holdReason: reason }),
        },
        env,
      );
    };
    expect((await review("옛 합성 보류")).status).toBe(200);
    const before = (await isolated.db.query("SELECT id,closed_at FROM owner_tasks WHERE shop_id=$1", [target.shopId]))
      .rows;
    try {
      await isolated.db.query(`REVOKE INSERT ON owner_alerts FROM "${role}"`);
      expect((await review("새 합성 보류")).status).toBe(500);
      expect(
        (await isolated.db.query("SELECT id,closed_at FROM owner_tasks WHERE shop_id=$1", [target.shopId])).rows,
      ).toEqual(before);
      expect(
        (await isolated.db.query("SELECT next_attempt_at FROM owner_alerts WHERE shop_id=$1", [target.shopId])).rows,
      ).toEqual([{ next_attempt_at: now }]);
      expect(
        (await isolated.db.query("SELECT license_hold_reason FROM shops WHERE id=$1", [target.shopId])).rows,
      ).toEqual([{ license_hold_reason: "옛 합성 보류" }]);
    } finally {
      await isolated.db.query(`GRANT INSERT ON owner_alerts TO "${role}"`);
    }
    expect((await review("새 합성 보류")).status).toBe(200);
    expect(
      (
        await isolated.db.query("SELECT count(*)::int AS n FROM owner_tasks WHERE shop_id=$1 AND closed_at IS NULL", [
          target.shopId,
        ])
      ).rows,
    ).toEqual([{ n: 1 }]);
  });

  it("접속기록 시각 조회만 유지하고 전체 조회·수정·비우기·DDL·사장님 삭제는 거절", async () => {
    const db = roleDb();
    try {
      expect((await db.query("SELECT accessed_at FROM access_logs WHERE false")).rowCount).toBe(0);
      for (const sql of [
        "SELECT * FROM access_logs WHERE false",
        "UPDATE access_logs SET accessed_at = accessed_at WHERE false",
        "TRUNCATE access_logs",
        "CREATE TABLE public.role_should_not_create (id int)",
        "DELETE FROM owners WHERE false",
      ]) {
        await expect(db.query(sql)).rejects.toMatchObject({ code: "42501" });
      }
    } finally {
      await db.close();
    }
  });
});
