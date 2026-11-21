import { afterAll, beforeEach, expect, it } from "vitest";
import { purgeKeptContract, purgeKeptIssue } from "../src/purge-kept";
import { purgeOrder } from "../src/purge-order";
import { createShopScope, type ShopDb, shopRequestDb } from "../src/shop-scope";
import { describeDb, newUuid, testDb } from "./support/db";
import { createShop, type ShopFixture, snapshotShop } from "./support/shops";

const NOW = new Date("2026-11-21T00:00:00Z");
type Fixture = { shop: ShopFixture; keptId: string; files: string[] };

describeDb("3·5년 보관 기록 지우기(TASK-158, SPEC-065 #5·#11)", () => {
  const db = testDb();
  let f: Fixture;
  const scoped = (fixture = f, connection = db) =>
    shopRequestDb(createShopScope(fixture.shop.shopId, { kind: "job", job: "purge" }), connection);
  const run = (kind: "issue" | "contract", fixture = f, id = fixture.keptId, connection = db) =>
    scoped(fixture, connection).transaction((tx) =>
      kind === "issue" ? purgeKeptIssue(tx, id, NOW) : purgeKeptContract(tx, id, NOW),
    );
  async function fixture(years = 3, days = 1): Promise<Fixture> {
    const shop = await createShop(db, "보관 기간 신고");
    const finished = (
      await db.query<{ at: Date }>("SELECT $1::timestamptz - make_interval(years => $2, days => $3) AS at", [
        NOW,
        years,
        days,
      ])
    ).rows[0]?.at;
    if (finished === undefined) throw new Error("fixture date missing");
    const files: string[] = [];
    await db.transaction(async (tx) => {
      for (const compensation of ["none", "other_compensation"]) {
        const detailsId = newUuid();
        const key = `shops/${shop.shopId}/issues/${newUuid()}.webp`;
        files.push(key);
        await tx.query(
          "INSERT INTO issue_details (id, shop_id, consultation_id, order_id, description, status) VALUES ($1, $2, $3, $4, '합성 신고 설명', 'reported')",
          [detailsId, shop.shopId, shop.consultationId, shop.orderId],
        );
        await tx.query(
          `INSERT INTO issue_reports (shop_id, order_id, issue_details_id, late, status, compensation, decided_at, closed_at, problem_kind, no_compensation_reason, other_compensation_note, other_compensation_amount, reported_by)
          VALUES ($1, $2, $3, false, 'closed', $4, $5, $5, $6, $7, $8, $9, 'owner_from_handoff')`,
          [
            shop.shopId,
            shop.orderId,
            detailsId,
            compensation,
            finished,
            compensation === "none" ? "spoiled" : "other",
            compensation === "none" ? "합성 보상 없음 사유" : null,
            compensation === "other_compensation" ? "합성 보상 기록" : null,
            compensation === "other_compensation" ? 500 : null,
          ],
        );
        await tx.query(
          "INSERT INTO issue_photos (shop_id, issue_details_id, position, storage_key, content_type, byte_size) VALUES ($1, $2, 1, $3, 'image/webp', 10)",
          [shop.shopId, detailsId, key],
        );
      }
      await tx.query(
        "UPDATE payment_requests SET status = 'closed', closed_at = $2, close_reason = 'order_cancelled' WHERE order_id = $1",
        [shop.orderId, finished],
      );
      await tx.query(
        "UPDATE orders SET status = 'cancelled', cancelled_at = $2, cancel_kind = 'no_payment', finished_at = $2 WHERE id = $1",
        [shop.orderId, finished],
      );
    });
    const s = shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "purge" }), db);
    expect(await s.transaction((tx) => purgeOrder(tx, shop.orderId, NOW))).toBe(1);
    const id = (await db.query<{ id: string }>("SELECT id FROM kept_records WHERE order_id = $1", [shop.orderId]))
      .rows[0]?.id;
    if (id === undefined) throw new Error("kept fixture missing");
    return { shop, keptId: id, files };
  }
  beforeEach(async () => {
    f = await fixture();
  });
  afterAll(() => db.close());
  const amounts = (x = f) =>
    db.query(
      "SELECT id, status, compensation, problem_kind, other_compensation_amount FROM issue_reports WHERE shop_id = $1 ORDER BY id",
      [x.shop.shopId],
    );

  it("3년 지난 신고 설명·사진·보상 사유를 지우고 신고·보상 금액·주문자 이름은 유지", async () => {
    const before = (await amounts()).rows;
    expect(await run("issue")).toBe(1);
    expect(
      (await db.query("SELECT description, content_purged_at FROM issue_details WHERE shop_id = $1", [f.shop.shopId]))
        .rows,
    ).toEqual([
      { description: null, content_purged_at: NOW },
      { description: null, content_purged_at: NOW },
    ]);
    expect(
      (
        await db.query(
          "SELECT no_compensation_reason, other_compensation_note, notes_purged_at FROM issue_reports WHERE shop_id = $1",
          [f.shop.shopId],
        )
      ).rows,
    ).toEqual([
      { no_compensation_reason: null, other_compensation_note: null, notes_purged_at: NOW },
      { no_compensation_reason: null, other_compensation_note: null, notes_purged_at: NOW },
    ]);
    expect((await amounts()).rows).toEqual(before);
    expect((await db.query("SELECT id FROM issue_photos WHERE shop_id = $1", [f.shop.shopId])).rows).toEqual([]);
    expect(
      (
        await db.query<{ storage_key: string }>(
          "SELECT storage_key FROM file_deletions WHERE shop_id = $1 ORDER BY storage_key",
          [f.shop.shopId],
        )
      ).rows.map((r) => r.storage_key),
    ).toEqual([...f.files].sort());
    expect(
      (await db.query("SELECT customer_name, issue_purged_at FROM kept_records WHERE id = $1", [f.keptId])).rows,
    ).toEqual([{ customer_name: "시험손님", issue_purged_at: NOW }]);
    const after = await snapshotShop(db, f.shop);
    expect(await run("issue")).toBe(0);
    expect(await snapshotShop(db, f.shop)).toEqual(after);
  });
  it("3년이 되기 전의 신고는 지우지 않음", async () => {
    const recent = await fixture(3, -1);
    const before = await snapshotShop(db, recent.shop);
    expect(await run("issue", recent)).toBe(0);
    expect(await snapshotShop(db, recent.shop)).toEqual(before);
  });
  it("5년 지난 보관 이름은 신고 내용을 먼저 지운 뒤 없애고 주문·금액은 유지", async () => {
    const old = await fixture(5, 1);
    const before = (
      await db.query("SELECT id, amount, personal_data_purged_at FROM orders WHERE id = $1", [old.shop.orderId])
    ).rows;
    expect(await run("contract", old)).toBe(0);
    expect(await run("issue", old)).toBe(1);
    expect(await run("contract", old)).toBe(1);
    expect((await db.query("SELECT id FROM kept_records WHERE id = $1", [old.keptId])).rows).toEqual([]);
    expect(
      (await db.query("SELECT id, amount, personal_data_purged_at FROM orders WHERE id = $1", [old.shop.orderId])).rows,
    ).toEqual(before);
    expect(await run("contract", old)).toBe(0);
  });
  it("5년이 되기 전에는 이름을 보존", async () => {
    const before = await snapshotShop(db, f.shop);
    expect(await run("contract")).toBe(0);
    expect(await snapshotShop(db, f.shop)).toEqual(before);
  });
  it("다른 가게의 보관 기록은 어느 처리에서도 바꾸지 않음", async () => {
    const other = await fixture(5, 1);
    const before = await snapshotShop(db, other.shop);
    expect(await run("issue", f, other.keptId)).toBe(0);
    expect(await run("contract", f, other.keptId)).toBe(0);
    expect(await snapshotShop(db, other.shop)).toEqual(before);
  });
  it("동시 실행은 신고 내용과 사진 삭제 대기를 한 번만 처리", async () => {
    const other = testDb();
    try {
      expect((await Promise.all([run("issue"), run("issue", f, f.keptId, other)])).sort()).toEqual([0, 1]);
    } finally {
      await other.close();
    }
    expect((await db.query("SELECT id FROM file_deletions WHERE shop_id = $1", [f.shop.shopId])).rows).toHaveLength(2);
  });
  it("중간 오류는 사진·설명·보상 사유와 삭제 대기를 되돌림", async () => {
    const before = await snapshotShop(db, f.shop);
    await expect(
      scoped().transaction((tx) => {
        const failingRun: ShopDb["run"] = <R>(sql: string, params?: readonly unknown[]) =>
          tx.run<R>(sql.replace(/UPDATE kept_records SET/, "UPDATE purge_missing_kept SET"), params);
        return purgeKeptIssue(
          {
            scope: tx.scope,
            run: failingRun,
            found: tx.found.bind(tx),
            owned: tx.owned.bind(tx),
            references: tx.references.bind(tx),
          },
          f.keptId,
          NOW,
        );
      }),
    ).rejects.toThrow();
    expect(await snapshotShop(db, f.shop)).toEqual(before);
  });
});
