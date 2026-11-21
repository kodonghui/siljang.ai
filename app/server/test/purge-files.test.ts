import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { deleteQueuedFile } from "../src/purge-files";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { describeDb, newUuid, testDb } from "./support/db";
import { createShop, type ShopFixture, snapshotShop } from "./support/shops";
import { MemoryStore } from "./support/storage";

const NOW = new Date("2026-11-21T00:00:00Z");
describeDb("사진 삭제 대기와 저장소 재시도(TASK-158, SPEC-065 #10)", () => {
  const db = testDb();
  let f: ShopFixture;
  let store: MemoryStore;
  beforeEach(async () => {
    f = await createShop(db, "파일 지우기");
    store = new MemoryStore();
  });
  afterAll(() => db.close());
  const scoped = (fixture = f, connection = db) =>
    shopRequestDb(createShopScope(fixture.shopId, { kind: "job", job: "purge" }), connection);
  async function seed(fixture = f, key = `shops/${fixture.shopId}/reference/${newUuid()}.webp`) {
    const id = newUuid();
    await db.query(
      "INSERT INTO file_deletions (id, shop_id, storage_key, source) VALUES ($1, $2, $3, 'reference_photo')",
      [id, fixture.shopId, key],
    );
    await store.put(key, new Uint8Array([1, 2, 3]), "image/webp");
    return { id, key };
  }
  const row = (id: string) => db.query("SELECT attempts, last_tried_at FROM file_deletions WHERE id = $1", [id]);
  it("저장소가 삭제를 확인한 파일의 대기 행만 지움", async () => {
    const item = await seed();
    expect(await deleteQueuedFile(scoped(), store, item.id, NOW)).toBe("deleted");
    expect(await store.head(item.key)).toBeNull();
    expect((await row(item.id)).rows).toEqual([]);
    expect(await deleteQueuedFile(scoped(), store, item.id, NOW)).toBe("gone");
  });
  it("실패한 행은 남기고 같은 날 반복하지 않으며 다음 날 성공 뒤 지움", async () => {
    const item = await seed();
    store.failOn.add("delete");
    expect(await deleteQueuedFile(scoped(), store, item.id, NOW)).toBe("failed");
    expect((await row(item.id)).rows).toEqual([{ attempts: 1, last_tried_at: NOW }]);
    expect(await deleteQueuedFile(scoped(), store, item.id, NOW)).toBe("busy");
    expect(store.calls.filter((op) => op === "delete")).toHaveLength(1);
    store.failOn.delete("delete");
    expect(await deleteQueuedFile(scoped(), store, item.id, new Date(NOW.getTime() + 86_400_000))).toBe("deleted");
    expect((await row(item.id)).rows).toEqual([]);
  });
  it("이미 없는 파일도 삭제 확인으로 처리", async () => {
    const item = await seed();
    store.objects.delete(item.key);
    expect(await deleteQueuedFile(scoped(), store, item.id, NOW)).toBe("deleted");
    expect((await row(item.id)).rows).toEqual([]);
  });
  it("다른 가게의 대기 ID는 저장소를 부르지 않음", async () => {
    const other = await createShop(db, "다른 파일 가게");
    const item = await seed(other);
    const before = await snapshotShop(db, other);
    expect(await deleteQueuedFile(scoped(), store, item.id, NOW)).toBe("gone");
    expect(await snapshotShop(db, other)).toEqual(before);
    expect(store.calls.filter((op) => op === "delete")).toEqual([]);
  });
  it("대기 행의 경로가 다른 가게를 가리켜도 그 파일을 지우지 않음", async () => {
    const key = `shops/${newUuid()}/reference/${newUuid()}.webp`;
    const item = await seed(f, key);
    expect(await deleteQueuedFile(scoped(), store, item.id, NOW)).toBe("failed");
    expect(await store.head(key)).not.toBeNull();
    expect(store.calls.filter((op) => op === "delete")).toEqual([]);
    expect((await row(item.id)).rows).toEqual([{ attempts: 1, last_tried_at: NOW }]);
  });
  it("저장소가 끝나지 않아도 기한 뒤 실패로 남기고 DB 행을 버리지 않음", async () => {
    const item = await seed();
    store.delete = vi.fn(() => new Promise<void>(() => {}));
    expect(await deleteQueuedFile(scoped(), store, item.id, NOW, { timeoutMs: 20 })).toBe("failed");
    expect((await row(item.id)).rows).toEqual([{ attempts: 1, last_tried_at: NOW }]);
    expect(store.delete).toHaveBeenCalledOnce();
  });
  it("잠긴 대기는 기다리지 않고 다음 실행에서 처리", async () => {
    const item = await seed();
    const locker = testDb();
    try {
      await locker.transaction(async (tx) => {
        await tx.query("SELECT id FROM file_deletions WHERE id = $1 FOR UPDATE", [item.id]);
        expect(await deleteQueuedFile(scoped(), store, item.id, NOW)).toBe("busy");
        expect(store.calls.filter((op) => op === "delete")).toEqual([]);
      });
      expect(await deleteQueuedFile(scoped(), store, item.id, NOW)).toBe("deleted");
    } finally {
      await locker.close();
    }
  });
  it("동시 실행은 커밋된 시도 표시를 보고 저장소를 한 번만 부름", async () => {
    const item = await seed();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const remove = store.delete.bind(store);
    store.delete = vi.fn(async (key) => {
      entered();
      await gate;
      await remove(key);
    });
    const first = deleteQueuedFile(scoped(), store, item.id, NOW);
    try {
      await started;
      expect(await deleteQueuedFile(scoped(), store, item.id, NOW)).toBe("busy");
      expect(store.delete).toHaveBeenCalledOnce();
    } finally {
      release();
    }
    expect(await first).toBe("deleted");
  });
  it("24시간 경과 대신 서울 날짜가 바뀐 뒤 재시도", async () => {
    const item = await seed();
    store.failOn.add("delete");
    expect(await deleteQueuedFile(scoped(), store, item.id, new Date("2026-11-21T14:59:59Z"))).toBe("failed");
    expect(await deleteQueuedFile(scoped(), store, item.id, new Date("2026-11-21T14:59:59.999Z"))).toBe("busy");
    store.failOn.delete("delete");
    expect(await deleteQueuedFile(scoped(), store, item.id, new Date("2026-11-21T15:00:00Z"))).toBe("deleted");
  });
  it("늦은 저장소 성공이 다음 날의 시도 기록을 지우지 않음", async () => {
    const item = await seed();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    store.delete = vi.fn(async () => {
      entered();
      await gate;
    });
    const first = deleteQueuedFile(scoped(), store, item.id, NOW);
    const tomorrow = new Date(NOW.getTime() + 86_400_000);
    try {
      await started;
      await db.query("UPDATE file_deletions SET attempts = attempts + 1, last_tried_at = $2 WHERE id = $1", [
        item.id,
        tomorrow,
      ]);
    } finally {
      release();
    }
    expect(await first).toBe("busy");
    expect((await row(item.id)).rows).toEqual([{ attempts: 2, last_tried_at: tomorrow }]);
  });
  it("오래 실패해도 시도 횟수 상한 때문에 대기 행을 잃지 않음", async () => {
    const item = await seed();
    await db.query("UPDATE file_deletions SET attempts = 10000, last_tried_at = $2 WHERE id = $1", [
      item.id,
      new Date(NOW.getTime() - 86_400_000),
    ]);
    store.failOn.add("delete");
    expect(await deleteQueuedFile(scoped(), store, item.id, NOW)).toBe("failed");
    expect((await row(item.id)).rows).toEqual([{ attempts: 10000, last_tried_at: NOW }]);
  });
});
