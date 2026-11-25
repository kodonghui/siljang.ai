import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { sealAccountNumber } from "../src/account-number";
import { createApp } from "../src/app";
import { customerNoticeContents } from "../src/customer-notice-content";
import { createPaymentRequestNotice } from "../src/customer-notice-store";
import { pgConnector } from "../src/db";
import { consumeKakaoCallback } from "../src/kakao-callback-queue";
import type { KakaoCallbackJob } from "../src/kakao-callback-store";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { expectSchema } from "./support/contract";
import { describeDb, newUuid, TEST_DATABASE_URL, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { singleKeyCrypto } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-26T00:00:00Z");
const { fc, keys } = singleKeyCrypto();
const FIELD_KEY = keys.get(1);
if (FIELD_KEY === undefined) throw new Error("합성 암호화 키 없음");
const grants = readFileSync(new URL("../../../tools/staging-login-callback-grants.sql", import.meta.url), "utf8");
describeDb("저장된 차액의 새 금액 확인 표시(TASK-106)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture, key: string;
  const role = `task106_${newUuid().replaceAll("-", "")}`;
  let databaseUrl: string;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
    await isolated.db.query(`CREATE ROLE "${role}" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await isolated.db.query(grants.replaceAll(':"runtime_role"', `"${role}"`));
    const url = new URL(TEST_DATABASE_URL);
    url.pathname = `/${(await isolated.db.query<{ name: string }>("SELECT current_database() AS name")).rows[0].name}`;
    url.username = role;
    url.password = "";
    databaseUrl = url.toString();
  }, 30000);
  beforeEach(async () => {
    await isolated.db.query(`REVOKE SELECT (changes, base_version, amount_delta) ON change_requests FROM "${role}"`);
    shop = await createShop(isolated.db, "합성 차액 표시 가게");
    await issueTestBookingLink(isolated.db, shop);
    await linkTestChannel(isolated.db, shop.channelId);
    const sealed = await sealAccountNumber(fc, "123456789012", "payment_accounts.account_number", shop.shopId);
    await isolated.db.query("UPDATE payment_accounts SET account_number_enc=$2,account_last4=$3 WHERE id=$1", [
      shop.paymentAccountId,
      sealed.enc,
      sealed.last4,
    ]);
    key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
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
  it.each([
    ["event", "short"],
    ["message", "short"],
    ["event", "long"],
    ["message", "long"],
    ["callback", "short"],
    ["callback", "long"],
    ["event", "cap"],
    ["message", "cap"],
    ["event", "lower-date"],
    ["message", "lower-date"],
    ["legacy-event", "short"],
    ["legacy-message", "short"],
  ] as const)("실제 저장 행의 변경 내용/금액/마감과 두 버튼을 보인다(%s/%s)", async (runtimeMode, length) => {
    const limited = runtimeMode.startsWith("legacy-");
    const mode = runtimeMode.replace("legacy-", "");
    const changeId = newUuid(),
      changeCard = newUuid(),
      amountCard = newUuid(),
      paymentId = newUuid(),
      paid = newUuid();
    const cardKey = `ck_${amountCard}`;
    const changes =
      length !== "long"
        ? {
            lettering: "합성 바꾼 문구",
            colors: "합성 분홍",
            ...(length === "lower-date" ? { pickupAt: "2026-11-27t01:00:00z" } : {}),
          }
        : {
            size: "크".repeat(30),
            flavor: "맛".repeat(30),
            design: "도".repeat(30),
            designNotes: "가".repeat(500),
            lettering: "나".repeat(50),
            colors: "다".repeat(100),
            extras: Array.from({ length: 20 }, (_, i) => `${i}`.padStart(2, "0") + "라".repeat(28)),
            courierPickup: false,
          };
    await isolated.db.transaction(async (tx) => {
      await tx.query(
        "UPDATE payment_requests SET status='paid',paid_at=$2,arrived_at=$2,arrived_amount=amount WHERE id=$1",
        [shop.paymentRequestId, NOW],
      );
      await tx.query(
        "INSERT INTO payments(id,shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES($1,$2,$3,$4,35000,$5)",
        [paid, shop.shopId, shop.orderId, shop.paymentRequestId, NOW],
      );
      await tx.query("UPDATE orders SET status='confirmed',confirmed_at=$2,confirmed_payment_id=$3 WHERE id=$1", [
        shop.orderId,
        NOW,
        paid,
      ]);
      for (const [id, kind] of [
        [changeCard, "change_request"],
        [amountCard, "amount_confirm"],
      ]) {
        await tx.query(
          "INSERT INTO confirm_cards(id,shop_id,consultation_id,customer_id,card_key,kind,order_id,order_version,payload,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,1,'{}',$8,$9)",
          [
            id,
            shop.shopId,
            shop.consultationId,
            shop.customerId,
            `ck_${id}`,
            kind,
            shop.orderId,
            NOW,
            new Date(NOW.getTime() + 1800000),
          ],
        );
      }
      await tx.query(
        "INSERT INTO change_requests(id,shop_id,order_id,card_id,base_version,changes,status,amount_delta,decided_at) VALUES($1,$2,$3,$4,1,$5::jsonb,'awaiting_difference',20000,$6)",
        [changeId, shop.shopId, shop.orderId, changeCard, JSON.stringify(changes), NOW],
      );
      await tx.query(
        "INSERT INTO payment_requests SELECT(jsonb_populate_record(NULL::payment_requests,to_jsonb(p)||$2::jsonb)).* FROM payment_requests p WHERE p.id=$1",
        [
          shop.paymentRequestId,
          JSON.stringify({
            id: paymentId,
            kind: "difference",
            change_request_id: changeId,
            event_key: `pay:${changeId}:difference`,
            status: "open",
            amount: 20000,
            requested_amount: null,
            needs_amount_confirm: true,
            amount_confirmed_at: null,
            amount_card_id: amountCard,
            delivered_at: null,
            issued_at: NOW.toISOString(),
            due_at: new Date(NOW.getTime() + (length === "cap" ? 600000 : 86400000)).toISOString(),
            due_cap_at: new Date(NOW.getTime() + (length === "cap" ? 600000 : 86400000)).toISOString(),
            paid_at: null,
            arrived_at: null,
            arrived_amount: null,
          }),
        ],
      );
    });
    const scoped = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "payment_notice" }), isolated.db);
    const notice = await scoped.transaction((tx) => createPaymentRequestNotice(tx, paymentId, NOW));
    if (!notice) throw new Error("합성 차액 안내 없음");
    await isolated.db.query("UPDATE notifications SET status='deferred' WHERE id=$1", [notice.id]);
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("합성 표시 시험에서 실제 발신 금지"));
    try {
      const jobs: KakaoCallbackJob[] = [];
      const env = testEnv({ FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: FIELD_KEY });
      const app = createApp({
        connect: () => (limited ? pgConnector(new Secret(databaseUrl)) : isolated.connect()),
        services: {
          now: () => NOW,
          kakaoCallbackQueue: {
            send: async (job) => {
              jobs.push(job);
            },
          },
        },
        logSink: () => {},
      });
      let attempt = 0;
      const call = () =>
        app.request(
          `/api/kakao/skills/${mode === "callback" ? "message" : mode}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
            body: JSON.stringify({
              bot: { id: shop.botId },
              userRequest: {
                utterance: mode !== "event" ? `합성 차액 안내 확인 ${attempt++}` : "",
                ...(mode === "callback"
                  ? { callbackUrl: "https://bot-api.kakao.com/v1/callback/synthetic_difference" }
                  : {}),
                params: mode === "event" ? { noticeKey: notice.id } : {},
                block: { id: "conversation" },
                user: { id: shop.userKey, type: "botUserKey" },
              },
              action: { id: "synthetic-difference-display", params: {} },
            }),
          },
          env,
        );
      let response = await call();
      if (limited) {
        expect(response.status).toBe(mode === "event" ? 500 : 200);
        const blocked = JSON.stringify(await response.json());
        expect(blocked).not.toContain(cardKey);
        expect(blocked).not.toContain("123456789012");
        expect(
          (await isolated.db.query("SELECT status,sent_at FROM notifications WHERE id=$1", [notice.id])).rows,
        ).toEqual([{ status: "deferred", sent_at: null }]);
        const runtime = pgConnector(new Secret(databaseUrl));
        try {
          const restricted = shopRequestDb(
            createShopScope(shop.shopId, { kind: "job", job: "payment_notice" }),
            runtime,
          );
          await restricted.transaction(async (tx) => {
            await expect(
              customerNoticeContents(
                tx,
                { id: notice.id, customerId: shop.customerId, kind: "payment_request", body: "합성" },
                NOW,
              ),
            ).rejects.toThrow("customer notice temporarily unavailable");
            expect((await tx.run("SELECT id FROM shops WHERE id=$1")).rows).toHaveLength(1);
          });
        } finally {
          await runtime.close();
        }
        await isolated.db.query(`GRANT SELECT (changes, base_version, amount_delta) ON change_requests TO "${role}"`);
        response = await call();
      }
      expect(response.status).toBe(200);
      let body = await response.json();
      if (mode === "callback") {
        const send = vi.fn<typeof fetch>(async (_url, init) => {
          body = JSON.parse(String(init?.body));
          return Response.json({ status: "SUCCESS" });
        });
        expect(jobs).toHaveLength(1);
        expect(
          await consumeKakaoCallback(jobs[0], env, {
            connect: () => isolated.connect(),
            now: () => new Date(NOW.getTime() + 1000),
            fetch: send,
          }),
        ).toBe("done");
        expect(send).toHaveBeenCalledTimes(1);
      }
      expectSchema("SkillTemplateResponse", body);
      const shown = JSON.stringify(body);
      const renderedText = (
        body as { template: { outputs: ({ simpleText: { text: string } } | { textCard: { description: string } })[] } }
      ).template.outputs
        .map((output) => ("simpleText" in output ? output.simpleText.text : output.textCard.description))
        .join("");
      for (const text of [
        "지금 35,000원",
        "새 금액 55,000원",
        "차액 20,000원",
        "변경 마감",
        "바꿀게요",
        "그대로 둘래요",
        cardKey,
        changes.lettering,
        changes.colors,
      ])
        expect(shown).toContain(text);
      if (length === "cap") {
        expect(renderedText).toContain("09:10까지 눌러 주세요");
        expect(renderedText).not.toContain("09:30까지 눌러 주세요");
        expect(
          (await isolated.db.query("SELECT expires_at FROM confirm_cards WHERE id=$1", [amountCard])).rows[0]
            .expires_at,
        ).toEqual(new Date(NOW.getTime() + 1800000));
      }
      if (length === "lower-date") expect(renderedText).toContain("픽업 2026-11-27 10:00");
      if (length === "long") {
        expect(renderedText).toContain(changes.designNotes);
        for (const extra of changes.extras ?? []) expect(renderedText).toContain(extra);
      }
      for (const text of ["이 금액으로 할게요", "계좌번호", "010-0000-0000", shop.customerId, changeId, paymentId])
        expect(shown).not.toContain(text);
      expect(
        (
          await isolated.db.query("SELECT delivered_at,amount_confirmed_at FROM payment_requests WHERE id=$1", [
            paymentId,
          ])
        ).rows,
      ).toEqual([{ delivered_at: null, amount_confirmed_at: null }]);
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  });

  it.each(["first", "reissue"] as const)(
    "추가 열 권한 없이도 기존 %s 결제 안내를 두 수신 경로에서 읽는다",
    async (kind) => {
      await isolated.db.query(
        "UPDATE payment_requests SET kind=$2,delivered_at=NULL,issued_at=$3,due_at=$4,due_cap_at=$4 WHERE id=$1",
        [shop.paymentRequestId, kind, NOW, new Date(NOW.getTime() + 86400000)],
      );
      const scoped = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "payment_notice" }), isolated.db);
      const notice = await scoped.transaction((tx) => createPaymentRequestNotice(tx, shop.paymentRequestId, NOW));
      if (!notice) throw new Error("합성 결제 안내 없음");
      await isolated.db.query("UPDATE notifications SET status='deferred' WHERE id=$1", [notice.id]);
      const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("실제 발신 금지"));
      try {
        const app = createApp({
          connect: () => pgConnector(new Secret(databaseUrl)),
          services: { now: () => NOW, fieldCrypto: fc },
          logSink: () => {},
        });
        for (const mode of ["event", "message"]) {
          const response = await app.request(
            `/api/kakao/skills/${mode}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
              body: JSON.stringify({
                bot: { id: shop.botId },
                userRequest: {
                  utterance: mode === "event" ? "" : "합성 이전 권한 결제 안내",
                  params: mode === "event" ? { noticeKey: notice.id } : {},
                  block: { id: "conversation" },
                  user: { id: shop.userKey, type: "botUserKey" },
                },
                action: { id: "legacy-payment", params: {} },
              }),
            },
            testEnv({ DATABASE_URL: databaseUrl }),
          );
          expect(response.status).toBe(200);
          const body = await response.json();
          expectSchema("SkillTemplateResponse", body);
          expect(JSON.stringify(body)).toContain("123456789012");
        }
        expect(network).not.toHaveBeenCalled();
      } finally {
        network.mockRestore();
      }
    },
  );
});
