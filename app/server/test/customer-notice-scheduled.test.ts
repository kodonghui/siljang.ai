import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createApp } from "../src/app";
import { rescheduleCalendarNotices } from "../src/calendar-notices";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { expectSchema } from "./support/contract";
import { describeDb, newUuid, TEST_HASH_KEY, testEnv } from "./support/db";
import { newFieldKey } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-25T00:00:00Z");
const BODY = "합성 예약 안내를 전해요";
describeDb("예약 안내의 스킬 읽기와 다음 대화 전달", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture, key: string;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    shop = await createShop(isolated.db, "합성 예약 안내 가게");
    await issueTestBookingLink(isolated.db, shop);
    await linkTestChannel(isolated.db, shop.channelId);
    key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
  });
  afterAll(async () => {
    await isolated?.close();
  });
  const cases = ["day_before", "review_request"] as const;
  for (const kind of cases)
    for (const mode of ["event", "message"] as const)
      it.each(["valid", "future", "outside", "stale", "rescheduled"] as const)(
        `${kind}/${mode}: %s의 의미와 보낼 시간을 다시 확인한다`,
        async (condition) => {
          const id = newUuid(),
            paid = newUuid();
          const now =
            condition === "outside"
              ? new Date("2026-11-25T12:00:00Z")
              : condition === "stale" && kind === "day_before"
                ? new Date("2026-11-26T00:00:00Z")
                : condition === "rescheduled"
                  ? new Date(NOW.getTime() + 3600000)
                  : NOW;
          await isolated.db.transaction(async (tx) => {
            await tx.query(
              "UPDATE payment_requests SET status='paid',paid_at=$2,arrived_amount=amount,arrived_at=$2 WHERE id=$1",
              [shop.paymentRequestId, NOW],
            );
            await tx.query(
              "INSERT INTO payments(id,shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES($1,$2,$3,$4,35000,$5)",
              [paid, shop.shopId, shop.orderId, shop.paymentRequestId, NOW],
            );
            await tx.query("UPDATE order_details SET pickup_at=$2 WHERE order_id=$1", [
              shop.orderId,
              new Date("2026-11-26T06:00:00Z"),
            ]);
            await tx.query(
              "UPDATE orders SET status=$2,confirmed_at=$3,confirmed_payment_id=$4,pickup_at=$5,pickup_day='2026-11-26' WHERE id=$1",
              [
                shop.orderId,
                kind === "review_request" && condition !== "stale" ? "received" : "confirmed",
                NOW,
                paid,
                new Date("2026-11-26T06:00:00Z"),
              ],
            );
            if (kind === "review_request" && condition !== "stale")
              await tx.query(
                "INSERT INTO productions(shop_id,order_id,handed_over_at,handover_kind) VALUES($1,$2,$3,'pickup')",
                [shop.shopId, shop.orderId, condition === "rescheduled" ? new Date(NOW.getTime() - 86400000) : NOW],
              );
            await tx.query(
              "INSERT INTO notifications(id,shop_id,customer_id,consultation_id,order_id,kind,event_key,template_key,body,status,scheduled_for,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$6,$8,'deferred',$9,$10)",
              [
                id,
                shop.shopId,
                shop.customerId,
                shop.consultationId,
                shop.orderId,
                kind,
                `notice:${id}:${kind}`,
                BODY,
                condition === "future" ? new Date(NOW.getTime() + 3600000) : NOW,
                new Date(NOW.getTime() - 1000),
              ],
            );
          });
          if (condition === "rescheduled") {
            await shopRequestDb(
              createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }),
              isolated.db,
            ).transaction((tx) =>
              rescheduleCalendarNotices(
                tx,
                "Asia/Seoul",
                { dayBefore: "09:00", review: "09:00" },
                { dayBefore: "18:00", review: "18:00" },
              ),
            );
            expect(
              (await isolated.db.query("SELECT scheduled_for,next_attempt_at FROM notifications WHERE id=$1", [id]))
                .rows[0],
            ).toEqual({
              scheduled_for: new Date("2026-11-25T09:00:00Z"),
              next_attempt_at: null,
            });
          }
          const app = createApp({ connect: () => isolated.connect(), services: { now: () => now }, logSink: () => {} });
          const response = await app.request(
            `/api/kakao/skills/${mode}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
              body: JSON.stringify({
                bot: { id: shop.botId },
                userRequest: {
                  utterance: "합성 예약 안내 질문",
                  params: mode === "event" ? { noticeKey: id } : {},
                  block: { id: "conversation" },
                  user: { id: shop.userKey, type: "botUserKey" },
                },
                action: { id: "synthetic-scheduled-notice", params: {} },
              }),
            },
            testEnv({ FIELD_KEY_CURRENT: "1", FIELD_KEY_V1: newFieldKey() }),
          );
          const body = await response.json();
          expectSchema("SkillTemplateResponse", body);
          if (condition === "valid") expect(JSON.stringify(body)).toContain(BODY);
          else expect(JSON.stringify(body)).not.toContain(BODY);
          if (mode === "event")
            expect(response.headers.get("Siljang-Outcome")).toBe(
              condition === "valid" ? "notice_shown" : "notice_gone",
            );
          const row = (await isolated.db.query("SELECT status,sent_at FROM notifications WHERE id=$1", [id])).rows[0];
          expect(row).toEqual({
            status:
              mode === "message" && condition === "valid"
                ? "delivered_on_reply"
                : mode === "message" && condition === "stale"
                  ? "dropped"
                  : "deferred",
            sent_at: mode === "message" && condition === "valid" ? now : null,
          });
        },
      );
});
