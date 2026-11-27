import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { RequestDb } from "../src/db";
import { runnableJobs } from "../src/jobs";
import { maskValue } from "../src/masked-values";
import { runScheduled } from "../src/scheduled";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { CLIENT_IP_HEADER, TEST_IPV4 } from "./support/access-log";
import { expectProblem } from "./support/contract";
import { collectLogs, describeDb, newRequestKey, newUuid, testDb, testEnv } from "./support/db";
import { singleKeyCrypto } from "./support/field-keys";
import { isolatedTestDb } from "./support/isolated-db";
import { seedOperatorSession } from "./support/operator";
import { createTestRole, roleConnection } from "./support/purge-role";
import { createShop, type ShopFixture } from "./support/shops";
import { MemoryStore } from "./support/storage";

const DAY = 86400000;
function latestSlot() {
  const time = new Date(),
    slot = new Date(Date.UTC(time.getUTCFullYear(), time.getUTCMonth(), time.getUTCDate(), 18));
  if (slot > time) slot.setUTCDate(slot.getUTCDate() - 1);
  return slot;
}
function trackClose(db: RequestDb, onClose: () => void): RequestDb {
  return {
    query: (sql, params) => db.query(sql, params),
    transaction: (fn) => db.transaction(fn),
    abort: () => db.abort(),
    close: async () => {
      onClose();
      await db.close();
    },
  };
}
describeDb("예약 실행부터 상담 삭제까지 실제 두 역할(TASK159 PR302)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture;
  const appRole = `app159_${newUuid().replaceAll("-", "")}`,
    purgeRole = `purge159_${newUuid().replaceAll("-", "")}`,
    { fc } = singleKeyCrypto();
  beforeAll(async () => {
    isolated = await isolatedTestDb();
    await createTestRole(isolated.db, appRole, "app");
    await createTestRole(isolated.db, purgeRole, "purge");
  }, 30000);
  afterAll(async () => {
    await isolated?.close();
    const admin = testDb();
    try {
      for (const role of [appRole, purgeRole]) await admin.query(`DROP ROLE IF EXISTS "${role}"`);
    } finally {
      await admin.close();
    }
  });
  beforeEach(async () => {
    shop = await createShop(isolated.db, "합성 예약 삭제 가게");
  });
  const normal = () => roleConnection(isolated.connect(), appRole),
    purge = () => roleConnection(isolated.connect(), purgeRole);
  it("DST 세션에서도 서울 03:00 직전에는 전날 서울 03:00이 기준이다", async () => {
    const id = newUuid();
    const rollback = new Error("rollback synthetic data");
    await expect(
      isolated.db.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO masked_value_erasures(shop_id,id,consultation_id,erased_at) VALUES($1,$2,$3,'2026-03-06T18:30:00Z')",
          [shop.shopId, id, shop.consultationId],
        );
        await tx.query("SET LOCAL TIME ZONE 'America/Denver'");
        const definition = (
          await tx.query<{ source: string }>(
            "SELECT pg_get_functiondef('public.purge_expired_masked_value_erasures(integer)'::regprocedure) AS source",
          )
        ).rows[0]?.source;
        if (!definition) throw new Error("함수 정의 없음");
        const controlled = definition
          .replace("public.purge_expired_masked_value_erasures", "pg_temp.test_expired_erasures")
          .replaceAll("statement_timestamp()", "'2026-03-08T17:30:00Z'::timestamptz");
        await tx.query(controlled);
        expect((await tx.query<{ n: number }>("SELECT pg_temp.test_expired_erasures(100) AS n")).rows[0]?.n).toBe(0);
        expect((await tx.query("SELECT id FROM masked_value_erasures WHERE id=$1", [id])).rowCount).toBe(1);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
  it("기본 EXECUTE 권한을 받는 세 공개 역할에서도 삭제 함수를 회수한다", async () => {
    const old = await isolatedTestDb({ lastMigration: 47 });
    const rollback = new Error("rollback synthetic roles");
    try {
      await expect(
        old.db.transaction(async (tx) => {
          for (const role of ["anon", "authenticated", "service_role"]) {
            await tx.query(
              `DO $role$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $role$`,
            );
            await tx.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${role}`);
          }
          await tx.query(
            readFileSync(
              new URL("../../../db/migrations/0048_masked_value_erasure_retention.sql", import.meta.url),
              "utf8",
            ),
          );
          for (const role of ["anon", "authenticated", "service_role"]) {
            const result = await tx.query<{ allowed: boolean }>(
              "SELECT has_function_privilege($1,'public.purge_expired_masked_value_erasures(integer)','EXECUTE') AS allowed",
              [role],
            );
            expect(result.rows[0]?.allowed).toBe(false);
          }
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    } finally {
      await old.close();
    }
  }, 30000);
  it("삭제 식별 정보는 24시간 전에는 남고 이후 정기 삭제에서 사라지며 앱 역할은 함수를 실행하지 못한다", async () => {
    const db = purge(),
      appDb = normal(),
      id = newUuid();
    try {
      await isolated.db.query(
        "INSERT INTO masked_value_erasures(shop_id,id,consultation_id,erased_at) VALUES($1,$2,$3,statement_timestamp() - interval '23 hours')",
        [shop.shopId, id, shop.consultationId],
      );
      await expect(appDb.query("SELECT purge_expired_masked_value_erasures($1)", [100])).rejects.toMatchObject({
        code: "42501",
      });
      expect(
        (await db.query<{ n: number }>("SELECT purge_expired_masked_value_erasures($1) AS n", [100])).rows[0]?.n,
      ).toBe(0);
      await isolated.db.query(
        "UPDATE masked_value_erasures SET erased_at=((date_trunc('day', statement_timestamp() AT TIME ZONE 'Asia/Seoul') + interval '3 hours') AT TIME ZONE 'Asia/Seoul') - CASE WHEN (statement_timestamp() AT TIME ZONE 'Asia/Seoul')::time < time '03:00' THEN interval '48 hours' ELSE interval '24 hours' END WHERE id=$1",
        [id],
      );
      expect(
        (await db.query<{ n: number }>("SELECT purge_expired_masked_value_erasures($1) AS n", [100])).rows[0]?.n,
      ).toBe(0);
      await isolated.db.query(
        "UPDATE masked_value_erasures SET erased_at=erased_at - interval '1 second' WHERE id=$1",
        [id],
      );
      expect(
        (await db.query<{ n: number }>("SELECT purge_expired_masked_value_erasures($1) AS n", [100])).rows[0]?.n,
      ).toBe(1);
      expect((await isolated.db.query("SELECT id FROM masked_value_erasures WHERE id=$1", [id])).rowCount).toBe(0);
    } finally {
      await db.close();
      await appDb.close();
    }
  });
  it.each(["42883", "42501"] as const)(
    "예약 삭제의 DB 오류 %s는 식별 정보를 남기고 감시 이벤트를 남긴다",
    async (code) => {
      const id = newUuid(),
        slot = latestSlot(),
        logs = collectLogs(),
        restricted = normal();
      await isolated.db.query(
        "INSERT INTO masked_value_erasures(shop_id,id,consultation_id,erased_at) VALUES($1,$2,$3,statement_timestamp() - interval '72 hours')",
        [shop.shopId, id, shop.consultationId],
      );
      const before = await isolated.db.query("SELECT * FROM masked_value_erasures WHERE id=$1", [id]);
      try {
        const result = await runScheduled(
          { scheduledTime: slot.getTime() - (code === "42883" ? 5 : 4) * DAY, cron: "* * * * *" },
          testEnv({ PURGE_DATABASE_URL: "postgresql://purge.fixture/db" }),
          {
            connect: normal,
            purgeConnect: () => {
              const base = purge();
              const failing: RequestDb = {
                ...base,
                query: (sql, params) =>
                  sql.includes("public.purge_expired_masked_value_erasures(")
                    ? code === "42501"
                      ? restricted.query(sql, params)
                      : base.query(
                          sql.replace("purge_expired_masked_value_erasures", "missing_retention_function"),
                          params,
                        )
                    : base.query(sql, params),
              };
              return failing;
            },
            jobs: runnableJobs().filter((job) => job.name === "purge"),
            storage: new MemoryStore(),
            logSink: logs.sink,
          },
        );
        expect(result?.jobs.purge?.failed).toBe(1);
        expect((await isolated.db.query("SELECT * FROM masked_value_erasures WHERE id=$1", [id])).rows).toEqual(
          before.rows,
        );
        expect(logs.lines.map((line) => JSON.parse(line))).toContainEqual({
          level: "error",
          event: "purge_failed",
          job: "purge",
          code: "masked_value_erasures",
          errorName: "DatabaseError",
          dbCode: code,
        });
      } finally {
        await restricted.close();
      }
    },
  );
  async function closed(ended: Date) {
    const id = newUuid();
    await isolated.db.query(
      "INSERT INTO consultations(id,shop_id,customer_id,status,opened_at,ended_at) VALUES($1,$2,$3,'ended',$4,$4)",
      [id, shop.shopId, shop.customerId, ended],
    );
    await isolated.db.query(
      "INSERT INTO messages(shop_id,consultation_id,direction,author,kind,kakao_message_id,body_masked,trace_id) VALUES($1,$2,'inbound','customer','text',$3,'합성 지울 대화','purge-role')",
      [shop.shopId, id, `purge-${newUuid()}`],
    );
    const scope = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "purge" }), isolated.db);
    await scope.transaction((tx) => maskValue(tx, fc, id, "phone", "01012345678"));
    const masked = (
      await isolated.db.query<{ id: string }>("SELECT id FROM masked_values WHERE shop_id=$1 AND consultation_id=$2", [
        shop.shopId,
        id,
      ])
    ).rows[0];
    if (!masked) throw new Error("합성 번호 없음");
    return { id, maskedId: masked.id };
  }
  it("전용 역할도 미래 시각으로30일 이내 상담/원문을 지우지 못한다", async () => {
    const now = (await isolated.db.query<{ now: Date }>("SELECT statement_timestamp() AS now")).rows[0]?.now;
    if (!now) throw new Error("DB 시계 없음");
    const target = await closed(new Date(now.getTime() - DAY)),
      db = purge();
    try {
      const result = await db.query<{ n: number }>("SELECT purge_closed_consultation($1,$2,$3) AS n", [
        shop.shopId,
        target.id,
        new Date(now.getTime() + 365 * DAY),
      ]);
      expect(result.rows[0]?.n).toBe(0);
    } finally {
      await db.close();
    }
    expect((await isolated.db.query("SELECT id FROM masked_values WHERE id=$1", [target.maskedId])).rowCount).toBe(1);
    expect(
      (
        await isolated.db.query("SELECT id FROM messages WHERE shop_id=$1 AND consultation_id=$2", [
          shop.shopId,
          target.id,
        ])
      ).rowCount,
    ).toBe(1);
  });
  it("공용 앱 역할은 삭제ID 직접 쓰기와 지우기 함수 실행이42501이다", async () => {
    const db = normal();
    try {
      await expect(
        db.query("INSERT INTO masked_value_erasures(shop_id,id,consultation_id,erased_at) VALUES($1,$2,$3,$4)", [
          shop.shopId,
          newUuid(),
          shop.consultationId,
          new Date(),
        ]),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        db.query("SELECT purge_closed_consultation($1,$2,$3)", [shop.shopId, shop.consultationId, new Date()]),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await db.close();
    }
  });
  it("예약 처리기/당일 시작/후보 찾기부터 전용 역할로 실제 삭제한 뒤 공용 API는409다", async () => {
    const slot = latestSlot();
    const target = await closed(new Date(slot.getTime() - 31 * DAY)),
      operator = await seedOperatorSession(isolated.db, slot),
      logs = collectLogs(),
      storage = new MemoryStore();
    const app = createApp({ connect: normal, services: { now: () => slot, fieldCrypto: fc } });
    const open = () =>
      app.request(
        `https://siljang.example/api/operator/shops/${shop.shopId}/originals`,
        {
          method: "POST",
          headers: {
            origin: "https://siljang.example",
            cookie: operator.cookie,
            [CLIENT_IP_HEADER]: TEST_IPV4,
            "content-type": "application/json",
            "Idempotency-Key": newRequestKey(),
          },
          body: JSON.stringify({
            targetKind: "masked_value",
            targetId: target.maskedId,
            reason: "실제 정기 삭제 전후 확인",
          }),
        },
        testEnv(),
      );
    expect((await open()).status).toBe(200);
    let purgeConnections = 0,
      purgeClosed = 0;
    const result = await runScheduled(
      { scheduledTime: slot.getTime() - DAY, cron: "* * * * *" },
      testEnv({ PURGE_DATABASE_URL: "postgresql://purge.fixture/db" }),
      {
        connect: normal,
        purgeConnect: () => {
          purgeConnections++;
          return trackClose(purge(), () => {
            purgeClosed++;
          });
        },
        jobs: runnableJobs().filter((job) => job.name === "purge"),
        storage,
        logSink: logs.sink,
      },
    );
    expect(result?.dailyStarted).toEqual(["purge"]);
    expect(result?.jobs.purge?.failed, logs.lines.join("\n")).toBe(0);
    expect(result?.jobs.purge?.done).toBeGreaterThan(0);
    expect(purgeConnections).toBe(1);
    expect(purgeClosed).toBe(1);
    expect(
      (await isolated.db.query("SELECT status FROM consultations WHERE shop_id=$1 AND id=$2", [shop.shopId, target.id]))
        .rows,
    ).toEqual([{ status: "deleted" }]);
    await expectProblem(await open(), "original_erased");
    const age = await isolated.db.query<{ seconds: number }>(
      "SELECT extract(epoch FROM (statement_timestamp()-erased_at))::int AS seconds FROM masked_value_erasures WHERE id=$1",
      [target.maskedId],
    );
    expect(age.rows[0]?.seconds).toBeLessThan(60);
    await isolated.db.query(
      "UPDATE masked_value_erasures SET erased_at=statement_timestamp() - interval '72 hours' WHERE id=$1",
      [target.maskedId],
    );
    const next = await runScheduled(
      { scheduledTime: slot.getTime(), cron: "* * * * *" },
      testEnv({ PURGE_DATABASE_URL: "postgresql://purge.fixture/db" }),
      {
        connect: normal,
        purgeConnect: purge,
        jobs: runnableJobs().filter((job) => job.name === "purge"),
        storage,
        logSink: logs.sink,
      },
    );
    expect(next?.dailyStarted).toEqual(["purge"]);
    expect(next?.jobs.purge?.failed, logs.lines.join("\n")).toBe(0);
    expect(
      (await isolated.db.query("SELECT id FROM masked_value_erasures WHERE id=$1", [target.maskedId])).rowCount,
    ).toBe(0);
    expect((await open()).status).toBe(404);
  });
  it.each(["missing", "same_role", "superuser"] as const)(
    "%s 설정은 시작 기록 전에 닫고 다른 분 단위 일은 계속한다",
    async (kind) => {
      const slot = latestSlot(),
        logs = collectLogs();
      const before = await isolated.db.query("SELECT count(*)::int AS n FROM ops_events");
      let regularClosed = 0,
        purgeClosed = 0,
        purgeConnections = 0;
      const result = await runScheduled(
        { scheduledTime: slot.getTime(), cron: "* * * * *" },
        testEnv(kind === "missing" ? {} : { PURGE_DATABASE_URL: "postgresql://purge.fixture/db" }),
        {
          connect: () => {
            return trackClose(normal(), () => {
              regularClosed++;
            });
          },
          purgeConnect: () => {
            purgeConnections++;
            const db = kind === "same_role" ? normal() : isolated.connect();
            return trackClose(db, () => {
              purgeClosed++;
            });
          },
          jobs: [
            ...runnableJobs().filter((job) => job.name === "purge"),
            { name: "healthy", every: "minute", sources: [], handler: { mode: "transaction", run: async () => {} } },
          ],
          logSink: logs.sink,
        },
      );
      expect(result?.dailyStarted).toEqual([]);
      expect(result?.jobs.purge).toEqual({ found: 0, done: 0, skipped: 0, failed: 1 });
      expect(result?.jobs.healthy).toEqual({ found: 0, done: 0, skipped: 0, failed: 0 });
      const failures = logs.lines.map((line) => JSON.parse(line)).filter((line) => line.level === "error");
      expect(failures).toEqual([
        {
          level: "error",
          event: "job_connection_failed",
          job: "purge",
          errorName: kind === "missing" ? "MissingSettingError" : "JobConfigError",
        },
      ]);
      expect((await isolated.db.query("SELECT count(*)::int AS n FROM ops_events")).rows).toEqual(before.rows);
      expect(regularClosed).toBe(1);
      expect(purgeConnections).toBe(kind === "missing" ? 0 : 1);
      expect(purgeClosed).toBe(purgeConnections);
    },
  );
});
