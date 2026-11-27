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
  it("삭제 식별 정보는 24시간 전에는 남고 이후 정기 삭제에서 사라지며 앱 역할은 함수를 실행하지 못한다", async () => {
    const db = purge(), appDb = normal(), id = newUuid();
    try {
      await isolated.db.query("INSERT INTO masked_value_erasures(shop_id,id,consultation_id,erased_at) VALUES($1,$2,$3,statement_timestamp() - interval '23 hours')", [shop.shopId, id, shop.consultationId]);
      await expect(appDb.query("SELECT purge_expired_masked_value_erasures($1)", [100])).rejects.toMatchObject({ code: "42501" });
      expect((await db.query<{ n: number }>("SELECT purge_expired_masked_value_erasures($1) AS n", [100])).rows[0]?.n).toBe(0);
      await isolated.db.query("UPDATE masked_value_erasures SET erased_at=statement_timestamp() - interval '25 hours' WHERE id=$1", [id]);
      expect((await db.query<{ n: number }>("SELECT purge_expired_masked_value_erasures($1) AS n", [100])).rows[0]?.n).toBe(1);
      expect((await isolated.db.query("SELECT id FROM masked_value_erasures WHERE id=$1", [id])).rowCount).toBe(0);
    } finally { await db.close(); await appDb.close(); }
  });
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
      { scheduledTime: slot.getTime(), cron: "* * * * *" },
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
