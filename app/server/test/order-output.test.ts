import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createCustomOrderTask, ownerProductionOrder, writeOrderLedgerData } from "../src/order-output";
import { createShopScope, type ScopeVia, shopRequestDb } from "../src/shop-scope";
import { describeDb } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-24T00:00:00Z");
describeDb("요약·알림·장부에서 알레르기 제외(TASK-066)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    shop = await createShop(isolated.db, "합성 출력 가게");
    await issueTestBookingLink(isolated.db, shop);
    await isolated.db.query("UPDATE orders SET kind='custom',status='requested' WHERE id=$1", [shop.orderId]);
    await isolated.db.query(
      "UPDATE order_details SET allergy_consent='agreed',allergy_consent_version='allergy-v1',allergy_answer='땅콩' WHERE order_id=$1",
      [shop.orderId],
    );
  });
  afterAll(async () => {
    await isolated?.close();
  });
  const owner = (target = shop) =>
    shopRequestDb(createShopScope(target.shopId, { kind: "owner", ownerId: target.ownerId }), isolated.db);
  it("주문 요청의 할 일·알림·장부에는 알레르기가 없고 사장님 상세/제작 자료에는 보인다", async () => {
    const scoped = owner(),
      task = await createCustomOrderTask(scoped, shop.orderId, NOW);
    const tasks = (await isolated.db.query("SELECT detail FROM owner_tasks WHERE id=$1", [task.id])).rows;
    const alerts = (
      await isolated.db.query("SELECT kind,event_key FROM owner_alerts WHERE owner_task_id=$1", [task.id])
    ).rows;
    expect(tasks).toHaveLength(1);
    expect(alerts).toHaveLength(1);
    expect(JSON.stringify({ tasks, alerts })).not.toContain("땅콩");
    const write = vi.fn(async (_row: Readonly<Record<string, unknown>>) => {});
    await writeOrderLedgerData(scoped, shop.orderId, write);
    expect(write).toHaveBeenCalledOnce();
    expect(JSON.stringify(write.mock.calls)).not.toContain("땅콩");
    expect(write.mock.calls[0]?.[0]).toMatchObject({
      customerName: "시험손님",
      customerPhone: "010-0000-0000",
      amount: 35000,
    });
    expect(await ownerProductionOrder(scoped, shop.orderId)).toMatchObject({
      allergyAnswer: "땅콩",
      customerName: "시험손님",
    });
    expect(await createCustomOrderTask(scoped, shop.orderId, NOW)).toEqual(task);
    expect(
      (await isolated.db.query("SELECT count(*)::int AS n FROM owner_alerts WHERE owner_task_id=$1", [task.id])).rows[0]
        ?.n,
    ).toBe(1);
  });
  it("다른 가게에는 요약·장부·제작 자료를 주지 않는다", async () => {
    const other = await createShop(isolated.db, "다른 합성 가게"),
      write = vi.fn(async () => {});
    await expect(createCustomOrderTask(owner(other), shop.orderId, NOW)).rejects.toMatchObject({ code: "not_found" });
    await expect(writeOrderLedgerData(owner(other), shop.orderId, write)).rejects.toMatchObject({ code: "not_found" });
    await expect(ownerProductionOrder(owner(other), shop.orderId)).rejects.toMatchObject({ code: "not_found" });
    expect(write).not.toHaveBeenCalled();
  });
  it.each(["customer", "job", "operator"] as const)(
    "사장님 외 범위에서는 장부·알레르기 조회 SQL을 실행하지 않는다(%s)",
    async (kind) => {
      const via: ScopeVia =
        kind === "customer"
          ? { kind, channelId: shop.channelId }
          : kind === "job"
            ? { kind, job: "output_privacy" }
            : { kind, operatorId: shop.ownerId };
      const customer = shopRequestDb(createShopScope(shop.shopId, via), isolated.db),
        write = vi.fn(async () => {});
      await expect(createCustomOrderTask(customer, shop.orderId, NOW)).rejects.toMatchObject({ code: "not_found" });
      const found = vi.spyOn(customer, "found"),
        run = vi.spyOn(customer, "run");
      await expect(writeOrderLedgerData(customer, shop.orderId, write)).rejects.toMatchObject({ code: "not_found" });
      await expect(ownerProductionOrder(customer, shop.orderId)).rejects.toMatchObject({ code: "not_found" });
      expect(found).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    },
  );
});
