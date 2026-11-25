import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { DbConnector } from "../src/db";
import { deriveKakaoSkillKey } from "../src/kakao-skill-auth";
import { Secret } from "../src/settings";
import { describeDb, newUuid, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { singleKeyCrypto } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";
import { MemoryStore } from "./support/storage";

const NOW = new Date("2026-11-25T00:00:00Z");
const IMAGE = new Uint8Array(readFileSync(new URL("./fixtures/photos/metadata.png", import.meta.url)));
describeDb("사진 수신의 최소 서버 역할(TASK-065)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture, key: string;
  const role = `photo065_${newUuid().replaceAll("-", "")}`;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
    await isolated.db.query(`CREATE ROLE "${role}" NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await isolated.db.query(
      readFileSync(new URL("../../../tools/staging-login-callback-grants.sql", import.meta.url), "utf8").replaceAll(
        ':"runtime_role"',
        `"${role}"`,
      ),
    );
  }, 30000);
  afterAll(async () => {
    await isolated?.close();
    const admin = testDb();
    try {
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
    } finally {
      await admin.close();
    }
  });
  beforeEach(async () => {
    shop = await createShop(isolated.db, "합성 사진 권한");
    await isolated.db.query(
      "INSERT INTO business_calendars(shop_id,daily_capacity,order_cutoff_days,order_cutoff_time) VALUES($1,10,2,'18:00')",
      [shop.shopId],
    );
    await issueTestBookingLink(isolated.db, shop);
    await linkTestChannel(isolated.db, shop.channelId);
    key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), shop.channelId, 1);
  });
  const connect: DbConnector = () => {
    const conn = isolated.connect();
    const ready = conn.query(`SET ROLE "${role}"`);
    return {
      query: async <R>(sql: string, params?: readonly unknown[]) => {
        await ready;
        return conn.query<R>(sql, params);
      },
      transaction: async (work) => {
        await ready;
        return conn.transaction(work);
      },
      close: () => conn.close(),
      abort: () => conn.abort(),
    };
  };
  async function send(review: boolean | "text" = false) {
    const order = (
      await isolated.db.query<{ order_no: string }>("SELECT order_no FROM orders WHERE id=$1", [shop.orderId])
    ).rows[0];
    const photos = JSON.stringify({
      privacyAgreement: "Y",
      imageQuantity: "1",
      secureUrls: "List(https://t1.daumcdn.net/synthetic/review.png)",
      expire: new Date(NOW.getTime() + 300_000).toISOString(),
    });
    const network = vi.fn<typeof fetch>(async () => new Response(IMAGE));
    vi.stubGlobal("fetch", network);
    try {
      return await createApp({
        connect,
        services: { now: () => NOW, storage: new MemoryStore(), fieldCrypto: singleKeyCrypto().fc },
        logSink: () => {},
      }).request(
        `/api/kakao/skills/${review ? "review" : "message"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
          body: JSON.stringify({
            bot: { id: shop.botId },
            userRequest: {
              utterance: review ? "사진 후기" : "https://t1.daumcdn.net/synthetic/reference.png",
              user: { id: shop.userKey, type: "botUserKey" },
              block: { id: "synthetic" },
            },
            action: {
              id: "synthetic",
              params: review
                ? { review_text: "합성 후기", ...(review === "text" ? {} : { review_photos: photos }) }
                : {},
              clientExtra: review ? { orderNo: order?.order_no } : {},
            },
          }),
        },
        testEnv(),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  }
  it("최소 역할이 참고 사진 한 장을 초안에 붙인다", async () => {
    const response = await send();
    expect(response.headers.get("Siljang-Outcome")).toBe("photo_received");
    expect((await isolated.db.query("SELECT id FROM reference_photos WHERE shop_id=$1", [shop.shopId])).rowCount).toBe(
      1,
    );
  });
  async function markReceived() {
    const payment = newUuid();
    await isolated.db.transaction(async (tx) => {
      await tx.query(
        "UPDATE payment_requests SET status='paid',arrived_amount=amount,arrived_at=$2,paid_at=$2 WHERE id=$1",
        [shop.paymentRequestId, NOW],
      );
      await tx.query(
        "INSERT INTO payments(id,shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES($1,$2,$3,$4,35000,$5)",
        [payment, shop.shopId, shop.orderId, shop.paymentRequestId, NOW],
      );
      await tx.query(
        "UPDATE orders SET status='received',confirmed_at=$2,confirmed_payment_id=$3,finished_at=$2 WHERE id=$1",
        [shop.orderId, NOW, payment],
      );
      await tx.query(
        "INSERT INTO productions(shop_id,order_id,completed_at,handed_over_at,handover_kind) VALUES($1,$2,$3,$3,'pickup')",
        [shop.shopId, shop.orderId, NOW],
      );
    });
  }
  it("최소 역할이 받은 자기 주문의 후기 사진과 동의를 남긴다", async () => {
    await markReceived();
    const response = await send(true);
    expect(response.headers.get("Siljang-Outcome")).toBe("review_saved");
    expect((await isolated.db.query("SELECT id FROM review_photos WHERE shop_id=$1", [shop.shopId])).rowCount).toBe(1);
  });
  it("사진용 추가 후기 열 권한이 없어도 기존 글 후기는 처리한다", async () => {
    await markReceived();
    await isolated.db.query(`REVOKE SELECT(created_at),INSERT(superseded_at) ON reviews FROM "${role}"`);
    try {
      expect((await send("text")).headers.get("Siljang-Outcome")).toBe("review_saved");
    } finally {
      await isolated.db.query(`GRANT SELECT(created_at),INSERT(superseded_at) ON reviews TO "${role}"`);
    }
  });
  it("사진 연결 삭제·기존 후기 본문 수정 권한은 주지 않는다", async () => {
    const row = (
      await isolated.db.query(
        `SELECT has_table_privilege($1,'reference_photos','DELETE') AS reference_delete,
      has_table_privilege($1,'review_photos','DELETE') AS review_delete,
      has_column_privilege($1,'reviews','body','UPDATE') AS body_update,
      has_table_privilege($1,'file_deletions','DELETE') AS cleanup_delete`,
        [role],
      )
    ).rows[0];
    expect(row).toEqual({ reference_delete: false, review_delete: false, body_update: false, cleanup_delete: true });
  });
});
