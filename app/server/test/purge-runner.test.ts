import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import type { RequestDb } from "../src/db";
import { runPurge } from "../src/purge-runner";
import { runScheduled } from "../src/scheduled";
import { newUploadId } from "../src/uploads";
import { describeDb, newUuid } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, type ShopFixture, snapshotShop } from "./support/shops";
import { MemoryStore } from "./support/storage";

// 03:00 서울 시각. 접속기록의 실제 2년 보관은 DB의 시각으로 따로 제한된다.
const NOW = new Date("2026-11-21T18:00:00Z");
const DAY = 86_400_000;
const event = (now = NOW) => ({ scheduledTime: now.getTime(), cron: "* * * * *" });

describeDb("지난 기록 지우기 실행(TASK-158, SPEC-065 #1~#12)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>;
  let db: RequestDb;
  let store: MemoryStore;
  const logs: unknown[] = [];
  beforeAll(async () => {
    isolated = await isolatedTestDb();
    db = isolated.db;
  }, 30_000);
  afterAll(async () => {
    await isolated?.close();
  });
  beforeEach(async () => {
    store = new MemoryStore();
    logs.length = 0;
    await db.query("DELETE FROM ops_events WHERE kind = 'purge_run'");
  });
  const run = (now = NOW) =>
    runPurge(db, {
      now,
      storage: () => store,
      log: (_level, fields) => {
        logs.push(fields);
      },
    });
  const scheduled = (now = NOW) =>
    runScheduled(
      event(now),
      { APP_ENV: "development" },
      {
        connect: isolated.connect,
        storage: store,
        logSink: (line) => {
          logs.push(JSON.parse(line));
        },
      },
    );
  async function finished(name: string) {
    const f = await createShop(db, name);
    const ended = new Date(NOW.getTime() - 31 * DAY);
    const key = `shops/${f.shopId}/reference/${newUuid()}.webp`;
    await store.put(key, new Uint8Array([1, 2, 3]), "image/webp");
    await db.transaction(async (tx) => {
      // 고정 지우기 시각 뒤에 시험을 실행해도, 31일 전에 끝난 손님은 그 전에 만들어진 자료다.
      await tx.query("UPDATE customers SET created_at = $2 WHERE id = $1", [f.customerId, ended]);
      await tx.query(
        "UPDATE payment_requests SET status = 'closed', closed_at = $2, close_reason = 'order_cancelled' WHERE order_id = $1",
        [f.orderId, ended],
      );
      await tx.query(
        "UPDATE orders SET status = 'cancelled', cancelled_at = $2, cancel_kind = 'no_payment', finished_at = $2 WHERE id = $1",
        [f.orderId, ended],
      );
      await tx.query("UPDATE consultations SET status = 'ended', ended_at = $2 WHERE id = $1", [
        f.consultationId,
        ended,
      ]);
      await tx.query(
        "INSERT INTO reference_photos (shop_id, draft_id, message_id, storage_key, content_type, byte_size) VALUES ($1, $2, $3, $4, 'image/webp', 3)",
        [f.shopId, f.draftId, f.messageId, key],
      );
    });
    return { f, key };
  }
  async function personal(f: ShopFixture) {
    return (await db.query("SELECT personal_data_purged_at FROM orders WHERE id = $1", [f.orderId])).rows[0]
      ?.personal_data_purged_at;
  }
  it("주문·상담·손님 키의 차례로 처리하고 다른 가게를 바꾸지 않으며 사진과 임시 업로드를 지움", async () => {
    const { f, key } = await finished("실행 A");
    const other = await createShop(db, "아직 열린 가게 B");
    const before = await snapshotShop(db, other);
    const tmp = `tmp/${f.ownerId}/${newUploadId("design_image", new Date(NOW.getTime() - 3_600_001))}`;
    await store.put(tmp, new Uint8Array([4]), "image/webp");
    const result = await run();
    expect(result.failed).toBe(0);
    expect(await personal(f)).toEqual(NOW);
    expect((await db.query("SELECT status FROM consultations WHERE id = $1", [f.consultationId])).rows).toEqual([
      { status: "deleted" },
    ]);
    expect((await db.query("SELECT kakao_user_key FROM customers WHERE id = $1", [f.customerId])).rows).toEqual([
      { kakao_user_key: null },
    ]);
    expect(await snapshotShop(db, other)).toEqual(before);
    expect(await store.head(key)).toBeNull();
    expect(await store.head(tmp)).toBeNull();
    expect((await db.query("SELECT id FROM file_deletions WHERE shop_id = $1", [f.shopId])).rows).toEqual([]);
    const detail = (
      await db.query<{ detail: Record<string, number> }>(
        "SELECT detail FROM ops_events WHERE kind = 'purge_run' AND detail->>'phase' IS NOT NULL ORDER BY detail->>'phase'",
      )
    ).rows.map((r) => r.detail);
    expect(detail.map((d) => d.phase)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const record of detail) {
      expect(record.pending_files).toBeGreaterThanOrEqual(0);
      expect(Object.values(record).every((v) => typeof v === "number")).toBe(true);
    }
    expect(JSON.stringify(logs)).not.toContain(key);
    expect(JSON.stringify(logs)).not.toContain("시험손님");
  });
  it("사진 저장소 실패는 대기를 남기고 다음 날 나머지를 처리", async () => {
    const { f, key } = await finished("파일 재시도 가게");
    store.failOn.add("delete");
    expect((await run()).failed).toBeGreaterThan(0);
    expect(await personal(f)).toEqual(NOW);
    expect((await db.query("SELECT attempts FROM file_deletions WHERE shop_id = $1", [f.shopId])).rows).toEqual([
      { attempts: 1 },
    ]);
    expect(await store.head(key)).not.toBeNull();
    store.failOn.delete("delete");
    await run(new Date(NOW.getTime() + DAY));
    expect(await store.head(key)).toBeNull();
    expect((await db.query("SELECT id FROM file_deletions WHERE shop_id = $1", [f.shopId])).rows).toEqual([]);
  });
  it("03:00 전에는 시작하지 않고 같은 날 두 번째 실행은 값과 기록을 바꾸지 않음", async () => {
    const { f } = await finished("하루 한 번 가게");
    const early = await scheduled(new Date(NOW.getTime() - 60_000));
    expect(early?.dailyStarted).toEqual([]);
    expect(await personal(f)).toBeNull();
    const first = await scheduled();
    expect(first?.dailyStarted).toEqual(["purge"]);
    expect(await personal(f)).toEqual(NOW);
    const before = await snapshotShop(db, f);
    const records = (await db.query("SELECT count(*) FROM ops_events WHERE kind = 'purge_run'")).rows;
    const calls = store.calls.length;
    expect((await scheduled())?.dailyStarted).toEqual([]);
    expect(await snapshotShop(db, f)).toEqual(before);
    expect((await db.query("SELECT count(*) FROM ops_events WHERE kind = 'purge_run'")).rows).toEqual(records);
    expect(store.calls).toHaveLength(calls);
  });
  it("같은 03:00의 두 실행 가운데 하나만 시작하고 주문을 한 번 보관", async () => {
    const { f } = await finished("동시 실행 가게");
    const results = await Promise.all([scheduled(), scheduled()]);
    expect(results.flatMap((r) => r?.dailyStarted ?? [])).toEqual(["purge"]);
    expect(await personal(f)).toEqual(NOW);
    expect((await db.query("SELECT id FROM kept_records WHERE order_id = $1", [f.orderId])).rows).toHaveLength(1);
  });
  it("행 하나의 DB 실패는 되돌리고 다른 가게를 처리하며 다음 날 실패한 행부터 이어감", async () => {
    const bad = await finished("행 실패 가게");
    const good = await finished("계속 처리할 가게");
    const failing: RequestDb = {
      query: db.query.bind(db),
      abort: db.abort.bind(db),
      close: async () => {},
      transaction: (fn) =>
        db.transaction((tx) =>
          fn({
            query: (sql, params) => {
              if (sql.includes("SELECT draft_id FROM orders") && params?.[1] === bad.f.orderId)
                throw new Error("합성 개인정보 오류 글");
              return tx.query(sql, params);
            },
          }),
        ),
    };
    const result = await runPurge(failing, {
      now: NOW,
      storage: () => store,
      log: (_level, fields) => {
        logs.push(fields);
      },
    });
    expect(result.failed).toBe(1);
    expect(await personal(bad.f)).toBeNull();
    expect(await personal(good.f)).toEqual(NOW);
    expect(JSON.stringify(logs)).not.toContain("합성 개인정보 오류 글");
    await run(new Date(NOW.getTime() + DAY));
    expect(await personal(bad.f)).not.toBeNull();
  });
  it("배치가 한 행이어도 모든 차례를 돌며 새로 지울 수 있게 된 상담을 놓치지 않음", async () => {
    const a = await finished("한 행 배치 A");
    const b = await finished("한 행 배치 B");
    // 주문 순서와 상담 순서를 반대로 만들어 다음 바퀴에서 더 오래된 상담이 새로 후보가 되게 한다.
    await db.query("UPDATE orders SET finished_at = $2 WHERE id = $1", [
      a.f.orderId,
      new Date(NOW.getTime() - 32 * DAY),
    ]);
    await db.query("UPDATE consultations SET ended_at = $2 WHERE id = $1", [
      b.f.consultationId,
      new Date(NOW.getTime() - 33 * DAY),
    ]);
    const result = await runPurge(db, {
      now: NOW,
      storage: () => store,
      log: () => {},
      limits: { batch: 1, rounds: 10 },
    });
    expect(result.failed).toBe(0);
    for (const f of [a.f, b.f]) {
      expect(await personal(f)).toEqual(NOW);
      expect((await db.query("SELECT status FROM consultations WHERE id = $1", [f.consultationId])).rows).toEqual([
        { status: "deleted" },
      ]);
    }
  });
  it("시간 예산으로 주문 한 건 뒤 멈춰도 커밋한 변경과 파일 대기를 남기고 다음 날 계속", async () => {
    const { f, key } = await finished("예산 중단 가게");
    let halted = false;
    const limited: RequestDb = {
      query: db.query.bind(db),
      abort: db.abort.bind(db),
      close: async () => {},
      transaction: async (fn) => {
        const result = await db.transaction(fn);
        halted = true;
        return result;
      },
    };
    expect(
      (await runPurge(limited, { now: NOW, storage: () => store, log: () => {}, shouldStop: () => halted })).done,
    ).toBe(1);
    expect(await personal(f)).toEqual(NOW);
    expect((await db.query("SELECT status FROM consultations WHERE id = $1", [f.consultationId])).rows).toEqual([
      { status: "ended" },
    ]);
    expect((await db.query("SELECT attempts FROM file_deletions WHERE shop_id = $1", [f.shopId])).rows).toEqual([
      { attempts: 0 },
    ]);
    expect(await store.head(key)).not.toBeNull();
    await run(new Date(NOW.getTime() + DAY));
    expect((await db.query("SELECT status FROM consultations WHERE id = $1", [f.consultationId])).rows).toEqual([
      { status: "deleted" },
    ]);
    expect(await store.head(key)).toBeNull();
  });
  it("저장소 설정이 없어도 DB 처리는 끝내고 삭제 대기를 버리지 않음", async () => {
    const { f, key } = await finished("저장소 미설정 가게");
    const result = await runPurge(db, {
      now: NOW,
      storage: () => {
        throw new Error("합성 저장소 미설정");
      },
      log: () => {},
    });
    expect(result.failed).toBeGreaterThan(0);
    expect(await personal(f)).toEqual(NOW);
    expect((await db.query("SELECT attempts FROM file_deletions WHERE shop_id = $1", [f.shopId])).rows).toEqual([
      { attempts: 0 },
    ]);
    expect(await store.head(key)).not.toBeNull();
    await run(new Date(NOW.getTime() + DAY));
    expect(await store.head(key)).toBeNull();
  });
});
