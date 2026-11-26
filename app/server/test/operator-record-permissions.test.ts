/** 로컬 최소 실행 역할로 실제 HTTP·좁은 함수·원문 열 권한을 검사한다. */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { Queryable, RequestDb } from "../src/db";
import { maskValue } from "../src/masked-values";
import { purgeConsultation } from "../src/purge-consultation";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { CLIENT_IP_HEADER, TEST_IPV4 } from "./support/access-log";
import { describeDb, newRequestKey, newUuid, testDb, testEnv } from "./support/db";
import { singleKeyCrypto } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { seedOperatorSession } from "./support/operator";
import { createTestRole, roleConnection } from "./support/purge-role";
import { createShop, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-21T06:00:00Z"),
  ORIGIN = "https://siljang.example";
const FUNCTIONS = [
  "read_operator_order(uuid,uuid,uuid)",
  "read_operator_record_list(uuid,uuid,text,jsonb,integer,timestamptz)",
  "read_operator_consultation(uuid,uuid,uuid)",
  "read_operator_messages(uuid,uuid,uuid,jsonb,integer)",
  "read_operator_original(uuid,uuid,text,uuid,jsonb,timestamptz)",
  "purge_closed_consultation(uuid,uuid,timestamptz)",
];
describeDb("운영자 기록의 최소 실행 권한(TASK-159)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>,
    shop: ShopFixture,
    session: Awaited<ReturnType<typeof seedOperatorSession>>;
  const role = `records159_${newUuid().replaceAll("-", "")}`,
    purgeRole = `purge159_${newUuid().replaceAll("-", "")}`,
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
    await createTestRole(isolated.db, purgeRole, "purge");
  }, 30000);
  afterAll(async () => {
    await isolated?.close();
    const admin = testDb();
    try {
      for (const name of [role, purgeRole]) await admin.query(`DROP ROLE IF EXISTS "${name}"`);
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
  it("새 함수6개는 PUBLIC 실행0·고정 search_path이고 원문 SELECT 권한을 더하지 않는다", async () => {
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
        callable: !signature.startsWith("purge_closed_consultation("),
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
  it("공용 역할의 일반 수정/삭제·신고 본문 읽기와 지우기 실행은 막는다", async () => {
    const raw = connect();
    try {
      for (const sql of [
        "UPDATE owner_alerts SET owner_task_id=NULL",
        "DELETE FROM owner_tasks",
        "DELETE FROM messages",
        "SELECT description FROM issue_details",
        "SELECT status FROM issue_details",
      ])
        await expect(raw.query(sql)).rejects.toMatchObject({ code: "42501" });
    } finally {
      await raw.close();
    }
    await expect(
      isolated.db.transaction(async (tx) => {
        await tx.query(`REVOKE EXECUTE ON FUNCTION purge_closed_consultation(uuid,uuid,timestamptz) FROM "${role}"`);
        await tx.query(`SET LOCAL ROLE "${role}"`);
        await tx.query("SELECT purge_closed_consultation($1,$2,$3)", [shop.shopId, shop.consultationId, NOW]);
      }),
    ).rejects.toMatchObject({ code: "42501" });
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
  it("공용 역할에는 삭제ID의 직접 읽기/쓰기/수정/삭제 권한이 없다", async () => {
    expect(
      (
        await isolated.db.query(
          "SELECT has_table_privilege($1,'masked_value_erasures','SELECT') AS read,has_any_column_privilege($1,'masked_value_erasures','INSERT') AS insert,has_table_privilege($1,'masked_value_erasures','UPDATE') AS update,has_table_privilege($1,'masked_value_erasures','DELETE') AS delete",
          [role],
        )
      ).rows[0],
    ).toEqual({ read: false, insert: false, update: false, delete: false });
    const raw = connect(),
      id = newUuid();
    try {
      await expect(
        raw.query("INSERT INTO masked_value_erasures(shop_id,id,consultation_id,erased_at) VALUES($1,$2,$3,$4)", [
          shop.shopId,
          id,
          shop.consultationId,
          NOW,
        ]),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(raw.query("SELECT id FROM masked_value_erasures")).rejects.toMatchObject({ code: "42501" });
      await expect(raw.query("UPDATE masked_value_erasures SET erased_at=$1", [NOW])).rejects.toMatchObject({
        code: "42501",
      });
      await expect(raw.query("DELETE FROM masked_value_erasures")).rejects.toMatchObject({ code: "42501" });
    } finally {
      await raw.close();
    }
  });
  it("기존 표/열 INSERT와 지우기 실행 권한도 권한 파일을 다시 적용하면 회수한다", async () => {
    const grants = readFileSync(
      new URL("../../../tools/staging-login-callback-grants.sql", import.meta.url),
      "utf8",
    ).replaceAll(':"runtime_role"', `"${role}"`);
    await expect(
      isolated.db.transaction(async (tx) => {
        await tx.query(`GRANT INSERT ON masked_value_erasures TO "${role}"`);
        await tx.query(`GRANT INSERT (shop_id,id,consultation_id,erased_at) ON masked_value_erasures TO "${role}"`);
        await tx.query(`GRANT EXECUTE ON FUNCTION purge_closed_consultation(uuid,uuid,timestamptz) TO "${role}"`);
        const privileges = () =>
          tx.query(
            "SELECT has_table_privilege($1,'masked_value_erasures','INSERT') AS table_insert,has_any_column_privilege($1,'masked_value_erasures','INSERT') AS column_insert,has_function_privilege($1,'purge_closed_consultation(uuid,uuid,timestamptz)','EXECUTE') AS execute",
            [role],
          );
        expect((await privileges()).rows).toEqual([{ table_insert: true, column_insert: true, execute: true }]);
        await tx.query(grants);
        expect((await privileges()).rows).toEqual([{ table_insert: false, column_insert: false, execute: false }]);
        await tx.query(`SET LOCAL ROLE "${role}"`);
        await tx.query("INSERT INTO masked_value_erasures(shop_id,id,consultation_id,erased_at) VALUES($1,$2,$3,$4)", [
          shop.shopId,
          newUuid(),
          shop.consultationId,
          NOW,
        ]);
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it.each([false, true])(
    "최소 역할로 상담 전체를 지우고 같은 번호ID를200→409로 안내한다(삭제ID 충돌=%s)",
    async (conflict) => {
      const consultationId = newUuid(),
        messageId = newUuid(),
        old = new Date(NOW.getTime() - 31 * 86400000);
      await isolated.db.query(
        "INSERT INTO consultations(id,shop_id,customer_id,status,opened_at,ended_at) VALUES($1,$2,$3,'ended',$4,$4)",
        [consultationId, shop.shopId, shop.customerId, old],
      );
      await isolated.db.query(
        "INSERT INTO messages(id,shop_id,consultation_id,direction,author,kind,kakao_message_id,body_masked,trace_id) VALUES($1,$2,$3,'inbound','customer','text',$4,'합성 대화','purge-runtime-test')",
        [messageId, shop.shopId, consultationId, `purge-${newUuid()}`],
      );
      const adminScope = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "purge" }), isolated.db);
      await adminScope.transaction((tx) => maskValue(tx, fc, consultationId, "phone", "01012345678"));
      const masked = (
        await isolated.db.query<{ id: string }>(
          "SELECT id FROM masked_values WHERE shop_id=$1 AND consultation_id=$2",
          [shop.shopId, consultationId],
        )
      ).rows[0];
      if (!masked) throw new Error("합성 번호 없음");
      if (conflict)
        await isolated.db.query(
          "INSERT INTO masked_value_erasures(shop_id,id,consultation_id,erased_at) VALUES($1,$2,$3,$4)",
          [shop.shopId, masked.id, consultationId, NOW],
        );
      const app = createApp({ connect, services: { now: () => NOW, fieldCrypto: fc } });
      const open = () =>
        app.request(
          `${ORIGIN}/api/operator/shops/${shop.shopId}/originals`,
          {
            method: "POST",
            headers: {
              origin: ORIGIN,
              cookie: session.cookie,
              [CLIENT_IP_HEADER]: TEST_IPV4,
              "content-type": "application/json",
              "Idempotency-Key": newRequestKey(),
            },
            body: JSON.stringify({
              targetKind: "masked_value",
              targetId: masked.id,
              reason: "손님 문의: 삭제 뒤 상태 확인",
            }),
          },
          testEnv(),
        );
      const before = await open();
      expect(before.status, await before.clone().text()).toBe(200);
      expect(((await before.json()) as { maskedValue: { value: string } }).maskedValue.value).toBe("01012345678");
      const raw = roleConnection(isolated.connect(), purgeRole);
      try {
        const scoped = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "purge" }), raw);
        expect(await scoped.transaction((tx) => purgeConsultation(tx, consultationId, NOW))).toBe(1);
        expect(await scoped.transaction((tx) => purgeConsultation(tx, consultationId, NOW))).toBe(0);
        await expect(raw.query("SELECT id FROM masked_value_erasures")).rejects.toMatchObject({ code: "42501" });
      } finally {
        await raw.close();
      }
      expect(
        (
          await isolated.db.query("SELECT status,deleted_at FROM consultations WHERE shop_id=$1 AND id=$2", [
            shop.shopId,
            consultationId,
          ])
        ).rows,
      ).toEqual([{ status: "deleted", deleted_at: NOW }]);
      for (const table of ["messages", "masked_values"])
        expect(
          (
            await isolated.db.query(`SELECT id FROM ${table} WHERE shop_id=$1 AND consultation_id=$2`, [
              shop.shopId,
              consultationId,
            ])
          ).rows,
        ).toEqual([]);
      expect(
        (
          await isolated.db.query("SELECT * FROM masked_value_erasures WHERE shop_id=$1 AND consultation_id=$2", [
            shop.shopId,
            consultationId,
          ])
        ).rows,
      ).toEqual([{ id: masked.id, shop_id: shop.shopId, consultation_id: consultationId, erased_at: NOW }]);
      const after = await open();
      expect(after.status, await after.clone().text()).toBe(409);
      expect(((await after.json()) as { code: string }).code).toBe("original_erased");
    },
  );
});
