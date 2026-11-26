/** 로컬 최소 실행 역할로 실제 HTTP·좁은 함수·원문 열 권한을 검사한다. */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { Queryable, RequestDb } from "../src/db";
import { maskValue } from "../src/masked-values";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { CLIENT_IP_HEADER, TEST_IPV4 } from "./support/access-log";
import { describeDb, newRequestKey, newUuid, testDb, testEnv } from "./support/db";
import { singleKeyCrypto } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { seedOperatorSession } from "./support/operator";
import { createShop, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-28T06:00:00Z"),
  ORIGIN = "https://siljang.example";
const FUNCTIONS = [
  "read_operator_order(uuid,uuid,uuid)",
  "read_operator_record_list(uuid,uuid,text,jsonb,integer,timestamptz)",
  "read_operator_consultation(uuid,uuid,uuid)",
  "read_operator_messages(uuid,uuid,uuid,jsonb,integer)",
  "read_operator_original(uuid,uuid,text,uuid,jsonb,timestamptz)",
];
describeDb("운영자 기록의 최소 실행 권한(TASK-159)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>,
    shop: ShopFixture,
    session: Awaited<ReturnType<typeof seedOperatorSession>>;
  const role = `records159_${newUuid().replaceAll("-", "")}`,
    { fc } = singleKeyCrypto();
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
    shop = await createShop(isolated.db, "합성 최소 권한 가게");
    session = await seedOperatorSession(isolated.db, NOW);
  });
  function connect(): RequestDb {
    const raw = isolated.connect();
    const transaction = <T>(fn: (tx: Queryable) => Promise<T>) =>
      raw.transaction(async (tx) => {
        await tx.query(`SET LOCAL ROLE "${role}"`);
        return fn(tx);
      });
    return {
      query: (sql, params) => transaction((tx) => tx.query(sql, params)),
      transaction,
      abort: () => raw.abort(),
      close: () => raw.close(),
    };
  }
  it("실제 운영자 세션으로 네 API와 번호 복호화·접속기록을 최소 역할에서 수행한다", async () => {
    const scoped = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }), isolated.db);
    await scoped.transaction((tx) => maskValue(tx, fc, shop.consultationId, "phone", "01012345678"));
    const masked = (
      await isolated.db.query<{ id: string }>("SELECT id FROM masked_values WHERE shop_id=$1 AND consultation_id=$2", [
        shop.shopId,
        shop.consultationId,
      ])
    ).rows[0];
    if (!masked) throw new Error("합성 번호 없음");
    const app = createApp({ connect, services: { now: () => NOW, fieldCrypto: fc } });
    let textCursor: string | undefined;
    for (const [path, kind, id] of [
      ["/records", null, null],
      [`/orders/${shop.orderId}`, null, null],
      [`/consultations/${shop.consultationId}`, null, null],
      ["/originals", "order_contact", shop.orderId],
      ["/originals", "consultation_text", shop.consultationId],
      ["/originals", "masked_value", masked.id],
    ] as const) {
      const response = await app.request(
        `${ORIGIN}/api/operator/shops/${shop.shopId}${path}`,
        {
          method: kind ? "POST" : "GET",
          headers: {
            origin: ORIGIN,
            cookie: session.cookie,
            [CLIENT_IP_HEADER]: TEST_IPV4,
            "content-type": "application/json",
            "Idempotency-Key": newRequestKey(),
          },
          ...(kind
            ? {
                body: JSON.stringify({
                  targetKind: kind,
                  targetId: id,
                  reason: "손님 문의: 원문 확인",
                  ...(kind === "consultation_text" ? { cursor: textCursor } : {}),
                }),
              }
            : {}),
        },
        testEnv(),
      );
      const text = await response.text();
      expect(response.status, text).toBe(200);
      if (path.startsWith("/consultations/")) textCursor = JSON.parse(text).textCursor;
      if (kind === "masked_value") expect(JSON.parse(text).maskedValue.value).toBe("01012345678");
    }
    expect((await isolated.db.query("SELECT 1 FROM access_logs WHERE shop_id=$1", [shop.shopId])).rowCount).toBe(6);
  });
  it("새 함수5개는 PUBLIC 실행0·고정 search_path이고 원문 SELECT 권한을 더하지 않는다", async () => {
    for (const signature of FUNCTIONS) {
      const result = (
        await isolated.db.query(
          "SELECT p.prosecdef,p.proconfig,has_function_privilege($1,p.oid,'EXECUTE') AS callable,(SELECT count(*)::int FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute FROM pg_proc p WHERE p.oid=$2::regprocedure",
          [role, signature],
        )
      ).rows[0];
      expect(result).toEqual({
        prosecdef: true,
        proconfig: ["search_path=pg_catalog"],
        callable: true,
        public_execute: 0,
      });
    }
    for (const [table, column] of [
      ["messages", "body_masked"],
      ["masked_values", "original_enc"],
      ["order_details", "customer_name"],
      ["order_details", "customer_phone"],
      ["order_details", "allergy_answer"],
      ["refunds", "refund_account_enc"],
      ["kept_records", "customer_name"],
    ]) {
      expect(
        (await isolated.db.query("SELECT has_column_privilege($1,$2,$3,'SELECT') AS allowed", [role, table, column]))
          .rows[0],
      ).toEqual({ allowed: table !== "refunds" && table !== "kept_records" });
    }
  });
  it("원문 함수는 다른 가게와 없는 운영자·비활성 운영자·MFA 없는 운영자에0행이다", async () => {
    const other = await createShop(isolated.db, "다른 최소 권한 가게"),
      raw = connect();
    try {
      const call = (shopId: string, operatorId: string) =>
        raw.query("SELECT * FROM read_operator_original($1,$2,'order_contact',$3,'{}',$4)", [
          shopId,
          operatorId,
          shop.orderId,
          NOW,
        ]);
      expect((await call(other.shopId, session.operatorId)).rowCount).toBe(0);
      expect((await call(shop.shopId, newUuid())).rowCount).toBe(0);
      await isolated.db.query("UPDATE operators SET disabled_at=$2 WHERE id=$1", [session.operatorId, NOW]);
      expect((await call(shop.shopId, session.operatorId)).rowCount).toBe(0);
      await isolated.db.query(
        "UPDATE operators SET disabled_at=NULL,mfa_enrolled_at=NULL,mfa_factor_id=NULL WHERE id=$1",
        [session.operatorId],
      );
      expect((await call(shop.shopId, session.operatorId)).rowCount).toBe(0);
    } finally {
      await raw.close();
    }
  });
  it("이전에 열지 않은 환불·보관 원문 직접 읽기는 계속42501로 막힌다", async () => {
    const raw = connect();
    try {
      for (const sql of ["SELECT refund_account_enc FROM refunds", "SELECT customer_name FROM kept_records"])
        await expect(raw.query(sql)).rejects.toMatchObject({ code: "42501" });
    } finally {
      await raw.close();
    }
  });
  it("삭제ID 표는 INSERT만 열고 원문과 추가 읽기/수정/삭제 권한은 주지 않는다", async () => {
    expect(
      (
        await isolated.db.query(
          "SELECT has_table_privilege($1,'masked_value_erasures','SELECT') AS read,has_any_column_privilege($1,'masked_value_erasures','INSERT') AS insert,has_table_privilege($1,'masked_value_erasures','UPDATE') AS update,has_table_privilege($1,'masked_value_erasures','DELETE') AS delete",
          [role],
        )
      ).rows[0],
    ).toEqual({ read: false, insert: true, update: false, delete: false });
    const raw = connect(),
      id = newUuid();
    try {
      expect(
        (
          await raw.query(
            "INSERT INTO masked_value_erasures(shop_id,id,consultation_id,erased_at) VALUES($1,$2,$3,$4)",
            [shop.shopId, id, shop.consultationId, NOW],
          )
        ).rowCount,
      ).toBe(1);
      await expect(raw.query("SELECT id FROM masked_value_erasures")).rejects.toMatchObject({ code: "42501" });
      await expect(raw.query("UPDATE masked_value_erasures SET erased_at=$1", [NOW])).rejects.toMatchObject({
        code: "42501",
      });
      await expect(raw.query("DELETE FROM masked_value_erasures")).rejects.toMatchObject({ code: "42501" });
    } finally {
      await raw.close();
    }
  });
});
