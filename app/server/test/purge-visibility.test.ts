import { afterAll, beforeAll, expect, it } from "vitest";
import { purgeOrder } from "../src/purge-order";
import { createShopScope, type ScopeVia, shopRequestDb } from "../src/shop-scope";
import { describeDb, newUuid, testDb } from "./support/db";
import { createShop, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-21T00:00:00Z");
type Viewer = "owner" | "customer" | "public" | "operator";

describeDb("보관 기록의 기본 접근 제한(TASK-158, A22)", () => {
  const db = testDb();
  let f: ShopFixture;
  const via = (kind: Viewer): ScopeVia => {
    if (kind === "owner") return { kind, ownerId: f.ownerId };
    if (kind === "customer") return { kind, channelId: f.channelId };
    if (kind === "public") return { kind };
    return { kind: "operator", operatorId: newUuid() };
  };
  const scoped = (source: ScopeVia) => shopRequestDb(createShopScope(f.shopId, source), db);
  beforeAll(async () => {
    f = await createShop(db, "보관 기록 접근 시험");
    const at = new Date(NOW.getTime() - 31 * 86_400_000);
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE payment_requests SET status = 'closed', closed_at = $2, close_reason = 'order_cancelled' WHERE order_id = $1",
        [f.orderId, at],
      );
      await tx.query(
        "UPDATE orders SET status = 'cancelled', cancelled_at = $2, cancel_kind = 'no_payment', finished_at = $2 WHERE id = $1",
        [f.orderId, at],
      );
    });
    expect(await scoped({ kind: "job", job: "purge" }).transaction((tx) => purgeOrder(tx, f.orderId, NOW))).toBe(1);
  });
  afterAll(() => db.close());

  it.each<Viewer>(["owner", "customer", "public", "operator"])(
    "%s의 보통 ID 조회는 보관 주문과 결제 안내를 없는 것으로 처리",
    async (kind) => {
      const s = scoped(via(kind));
      await expect(s.owned("orders", f.orderId)).rejects.toMatchObject({ code: "not_found" });
      await expect(s.owned("payment_requests", f.paymentRequestId)).rejects.toMatchObject({ code: "not_found" });
    },
  );
  it.each(["owner", "customer", "public", "other_job"] as const)(
    "%s는 이름을 담은 보관 기록을 직접 읽지 못함",
    async (kind) => {
      const source = kind === "other_job" ? { kind: "job" as const, job: "owner_alert" } : via(kind);
      await expect(
        scoped(source).run("SELECT customer_name FROM kept_records WHERE shop_id = $1 AND order_id = $2", [f.orderId]),
      ).rejects.toMatchObject({ code: "not_found" });
    },
  );
  it.each(["purge", "operator"] as const)("%s의 내부 보관 처리 범위는 별도로 읽을 수 있음", async (kind) => {
    const source = kind === "purge" ? { kind: "job" as const, job: "purge" } : via("operator");
    expect(
      (
        await scoped(source).run("SELECT customer_name FROM kept_records WHERE shop_id = $1 AND order_id = $2", [
          f.orderId,
        ])
      ).rows,
    ).toEqual([{ customer_name: "시험손님" }]);
  });
  it("새 명령의 참조 검사에서도 보관 주문과 결제 안내를 거절", async () => {
    const s = scoped(via("owner"));
    for (const [table, id] of [
      ["orders", f.orderId],
      ["payment_requests", f.paymentRequestId],
    ] as const) {
      await expect(s.references(table, [{ field: "/targetId", id }])).rejects.toMatchObject({
        code: "validation_failed",
        extras: { errors: [{ field: "/targetId", code: "reference_not_found" }] },
      });
    }
  });
  it("SQL의 문자열과 주석은 보관 기록 참조로 잘못 판단하지 않음", async () => {
    const rows = await scoped(via("owner")).run<{ label: string }>(
      "SELECT $1::uuid AS shop_id, 'kept_records' AS label /* kept_records */",
    );
    expect(rows.rows[0]?.label).toBe("kept_records");
  });
});
