import { afterAll, beforeEach, expect, it } from "vitest";
import { purgeExpiredAccessLogs } from "../src/purge-access-logs";
import { createShopScope, shopDb } from "../src/shop-scope";
import { describeDb, newUuid, testDb } from "./support/db";
import { createShop, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-21T00:00:00Z");

describeDb("2년 지난 접속기록 지우기(TASK-158, SPEC-065 #7·A24)", () => {
  const db = testDb();
  let a: ShopFixture;
  let b: ShopFixture;
  beforeEach(async () => {
    a = await createShop(db, "접속기록 보관 A");
    b = await createShop(db, "접속기록 보관 B");
  });
  afterAll(() => db.close());
  const scoped = (f: ShopFixture, connection = db) =>
    shopDb(createShopScope(f.shopId, { kind: "job", job: "purge" }), connection);
  async function seed(f: ShopFixture, years: number, days = 0) {
    const id = newUuid();
    await db.query(
      `INSERT INTO access_logs (id, shop_id, actor_kind, owner_id, action, api_id, request_path, client_ip, accessed_at)
       VALUES ($1, $2, 'owner', $3, 'read', 'API-040', '/owner/handoffs', '192.0.2.1',
               $4::timestamptz - make_interval(years => $5, days => $6))`,
      [id, f.shopId, f.ownerId, NOW, years, days],
    );
    return id;
  }
  async function ids(f: ShopFixture) {
    return (
      await db.query<{ id: string }>("SELECT id FROM access_logs WHERE shop_id = $1 ORDER BY id", [f.shopId])
    ).rows.map((r) => r.id);
  }
  it("2년 경계와 그보다 오래된 행을 지우고 1년 전의 행은 보존", async () => {
    await seed(a, 2, 1);
    await seed(a, 2);
    const recent = await seed(a, 1);
    expect(await purgeExpiredAccessLogs(scoped(a), NOW)).toBe(2);
    expect(await ids(a)).toEqual([recent]);
    expect(await purgeExpiredAccessLogs(scoped(a), NOW)).toBe(0);
  });
  it("미래 기준 시각을 주어도 실제 2년이 지나지 않은 행은 지우지 않음", async () => {
    await seed(a, 2, 1);
    const recent = await seed(a, 1);
    expect(await purgeExpiredAccessLogs(scoped(a), new Date("2100-01-01T00:00:00Z"))).toBe(1);
    expect(await ids(a)).toEqual([recent]);
  });
  it("가게 A는 B의 같은 나이 접속기록을 건드리지 않음", async () => {
    await seed(a, 2, 1);
    const other = await seed(b, 2, 1);
    expect(await purgeExpiredAccessLogs(scoped(a), NOW)).toBe(1);
    expect(await ids(b)).toEqual([other]);
  });
  it("다른 트랜잭션이 잠근 행은 기다리지 않고 뒤의 실행에서 지움", async () => {
    const id = await seed(a, 2, 1);
    const locker = testDb();
    try {
      await locker.transaction(async (tx) => {
        await tx.query("SELECT id FROM access_logs WHERE id = $1 FOR UPDATE", [id]);
        expect(await purgeExpiredAccessLogs(scoped(a), NOW)).toBe(0);
        expect(await ids(a)).toEqual([id]);
      });
      expect(await purgeExpiredAccessLogs(scoped(a), NOW)).toBe(1);
    } finally {
      await locker.close();
    }
  });
  it("동시 배치는 다른 행을 하나씩 지우고 두 번 세지 않음", async () => {
    await seed(a, 2, 2);
    await seed(a, 2, 1);
    const other = testDb();
    try {
      expect(
        await Promise.all([
          purgeExpiredAccessLogs(scoped(a), NOW, 1),
          purgeExpiredAccessLogs(scoped(a, other), NOW, 1),
        ]),
      ).toEqual([1, 1]);
      expect(await ids(a)).toEqual([]);
    } finally {
      await other.close();
    }
  });
});
