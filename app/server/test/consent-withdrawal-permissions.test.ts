import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { readPreparedConsentWithdrawalCard } from "../src/consent-withdrawal-card-presentation";
import { CustomerNoticeTemporarilyUnavailable } from "../src/customer-notice-content";
import type { RequestDb } from "../src/db";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { createConsentWithdrawalFixture } from "./support/consent-withdrawal-fixture";
import { describeDb, newUuid, testDb } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop } from "./support/shops";

const NOW = new Date("2026-11-28T06:00:00Z");
const FUNCTION = "read_prepared_consent_withdrawal_card(uuid,uuid,uuid,uuid)";
describeDb("철회 카드의 좁은 조회 권한과 오류 복구(TASK-149)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>;
  let fixture: Awaited<ReturnType<typeof createConsentWithdrawalFixture>>;
  const role = `withdrawal149_${newUuid().replaceAll("-", "")}`;
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
    fixture = await createConsentWithdrawalFixture(isolated.db, NOW);
  });
  async function minimumRole<T>(work: (db: RequestDb) => Promise<T>): Promise<T> {
    const conn = isolated.connect();
    try {
      await conn.query(`SET ROLE "${role}"`);
      return await work(conn);
    } finally {
      await conn.close();
    }
  }
  const target = () => ({
    customerId: fixture.shop.customerId,
    consultationId: fixture.shop.consultationId,
    orderId: fixture.shop.orderId,
  });
  it("최소 역할은 현재 손님에게 필요한 사진 수와 게시 여부만 표시한다", async () => {
    await minimumRole(async (raw) => {
      const db = shopRequestDb(createShopScope(fixture.shop.shopId, { kind: "job", job: "kakao_callback" }), raw);
      const source = await db.transaction((tx) => readPreparedConsentWithdrawalCard(tx, target()));
      expect(source).toMatchObject({
        available: true,
        presentation: { completionPhotoCount: 1, reviewPhotoCount: 1, publishedCount: 1 },
      });
      expect(JSON.stringify(source)).not.toMatch(/synthetic\/(?:completion|review)|합성 후기|consentIds|storage_key/);
    });
  });
  it("다른 가게·손님·상담·주문 네 범위에는 자료가 0행이다", async () => {
    const own = fixture.shop,
      other = await createShop(isolated.db, "다른 합성 권한 가게");
    await minimumRole(async (db) => {
      for (const args of [
        [other.shopId, own.customerId, own.consultationId, own.orderId],
        [own.shopId, other.customerId, own.consultationId, own.orderId],
        [own.shopId, own.customerId, other.consultationId, own.orderId],
        [own.shopId, own.customerId, own.consultationId, other.orderId],
      ])
        expect(
          (await db.query("SELECT * FROM read_prepared_consent_withdrawal_card($1,$2,$3,$4)", args)).rowCount,
        ).toBe(0);
    });
  });
  it("함수는 PUBLIC 실행을 닫고 고정 search_path를 쓰며 원문·철회 쓰기 권한을 열지 않는다", async () => {
    const privileges = (
      await isolated.db.query(
        `SELECT has_function_privilege($1,$2,'EXECUTE') AS callable,
       has_column_privilege($1,'reviews','body','SELECT') AS review_body,
       has_column_privilege($1,'photo_consents','order_id','SELECT') AS consent_order,
       has_column_privilege($1,'photo_consents','withdrawn_at','UPDATE') AS withdrawal_write,
       has_table_privilege($1,'portfolio_items','UPDATE') AS publication_write,
       has_table_privilege($1,'completion_photos','DELETE') AS photo_delete`,
        [role, FUNCTION],
      )
    ).rows[0];
    expect(privileges).toEqual({
      callable: true,
      review_body: false,
      consent_order: false,
      withdrawal_write: false,
      publication_write: false,
      photo_delete: false,
    });
    const policy = (
      await isolated.db.query<{ prosecdef: boolean; proconfig: string[]; public_execute: string }>(
        "SELECT p.prosecdef,p.proconfig,(SELECT count(*)::text FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute FROM pg_proc p WHERE p.oid=$1::regprocedure",
        [FUNCTION],
      )
    ).rows[0];
    expect(policy).toMatchObject({ prosecdef: true, public_execute: "0" });
    expect(policy?.proconfig).toContain("search_path=pg_catalog");
  });
  it("권한 오류를 되돌린 뒤 같은 트랜잭션의 일반 조회를 계속하고 복구 뒤 자료를 다시 읽는다", async () => {
    await isolated.db.query(`REVOKE EXECUTE ON FUNCTION ${FUNCTION} FROM "${role}"`);
    try {
      await minimumRole(async (raw) => {
        const db = shopRequestDb(createShopScope(fixture.shop.shopId, { kind: "job", job: "kakao_callback" }), raw);
        await db.transaction(async (tx) => {
          await expect(readPreparedConsentWithdrawalCard(tx, target())).rejects.toBeInstanceOf(
            CustomerNoticeTemporarilyUnavailable,
          );
          expect(
            (await tx.run("SELECT id FROM customers WHERE shop_id=$1 AND id=$2", [fixture.shop.customerId])).rowCount,
          ).toBe(1);
        });
      });
    } finally {
      await isolated.db.query(`GRANT EXECUTE ON FUNCTION ${FUNCTION} TO "${role}"`);
    }
    await minimumRole(async (raw) => {
      const db = shopRequestDb(createShopScope(fixture.shop.shopId, { kind: "job", job: "kakao_callback" }), raw);
      expect(await db.transaction((tx) => readPreparedConsentWithdrawalCard(tx, target()))).toMatchObject({
        available: true,
      });
    });
  });
});
