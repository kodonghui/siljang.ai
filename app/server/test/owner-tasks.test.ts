import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createCustomOrderTask } from "../src/order-output";
import { ApiError } from "../src/problem";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { failingAccessInsert } from "./support/access-log";
import { expectProblem, expectSchema } from "./support/contract";
import { describeDb, newUuid, testEnv } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-24T01:00:00Z"),
  ORIGIN = "https://siljang.example";
describeDb("사장님 할 일 목록 API-040(TASK-072)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    shop = await createShop(isolated.db, "합성 할 일 가게");
    await issueTestBookingLink(isolated.db, shop);
  });
  afterAll(async () => {
    await isolated?.close();
  });
  function app(failLog = false) {
    return createApp({
      connect: failLog ? failingAccessInsert(() => isolated.connect()) : () => isolated.connect(),
      scopes: {
        owner: async (c) => {
          if (c.req.header("x-test-owner") !== shop.ownerId) throw new ApiError("unauthenticated");
          if (c.req.header("x-test-no-shop") === "true") throw new ApiError("not_found");
          return createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId });
        },
      },
      services: { now: () => NOW },
      logSink: () => {},
    });
  }
  const call = (query = "", headers: Record<string, string> = {}, failLog = false) =>
    app(failLog).request(
      `${ORIGIN}/api/owner/tasks${query}`,
      { headers: { "x-test-owner": shop.ownerId, "CF-Connecting-IP": "203.0.113.24", ...headers } },
      testEnv(),
    );
  async function listBody(response: Response): Promise<{ items: { taskId: string }[] }> {
    const body = await response.json();
    expectSchema("OwnerTaskList", body);
    return body as { items: { taskId: string }[] };
  }
  async function custom() {
    await isolated.db.query("UPDATE orders SET kind='custom',status='requested' WHERE id=$1", [shop.orderId]);
    return createCustomOrderTask(
      shopRequestDb(createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId }), isolated.db),
      shop.orderId,
      NOW,
    );
  }
  it("빈 목록과 친구 아님 표시를 반환하고 접속기록을 남긴다", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    const body = await listBody(response);
    expectSchema("OwnerTaskList", body);
    expect(body).toEqual({ items: [], nextCursor: null, alertChannelFriend: false });
    expect(
      (await isolated.db.query("SELECT api_id,request_path FROM access_logs WHERE shop_id=$1", [shop.shopId])).rows,
    ).toEqual([{ api_id: "API-040", request_path: "/owner/tasks" }]);
  });
  it("맞춤 주문 한 건과 새 알림은 한 건이고 요약에 연락처·계좌·알레르기가 없다", async () => {
    const task = await custom();
    await isolated.db.query("UPDATE owner_tasks SET detail=detail||$2::jsonb WHERE id=$1", [
      task.id,
      JSON.stringify({ customerPhone: "010-0000-5678", allergyAnswer: "땅콩", accountNumber: "1234567890123" }),
    ]);
    const response = await call();
    expect(response.status).toBe(200);
    const body = await listBody(response);
    expectSchema("OwnerTaskList", body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      taskId: task.id,
      kind: "custom_order",
      subject: { type: "order", id: shop.orderId },
      order: { orderId: shop.orderId, orderNo: expect.any(String) },
    });
    for (const secret of ["010-0000-5678", "땅콩", "1234567890123"]) expect(JSON.stringify(body)).not.toContain(secret);
    expect((await isolated.db.query("SELECT kind FROM owner_alerts WHERE owner_task_id=$1", [task.id])).rows).toEqual([
      { kind: "new_task" },
    ]);
  });
  it.each(["?status=all", "?limit=0", "?limit=101", "?cursor=bad!"])("잘못된 목록 조건은422다(%s)", async (query) => {
    await expectProblem(await call(query), "validation_failed");
  });
  it("로그인이 없으면401이다", async () => {
    await expectProblem(await call("", { "x-test-owner": "" }), "unauthenticated");
  });
  it("자기 가게가 없으면404다", async () => {
    await expectProblem(await call("", { "x-test-no-shop": "true" }), "not_found");
  });
  it("접속기록을 남길 수 없으면 목록을 돌려주지 않는다", async () => {
    await custom();
    const response = await call("", {}, true);
    await expectProblem(response, "internal");
    expect((await isolated.db.query("SELECT id FROM access_logs WHERE shop_id=$1", [shop.shopId])).rows).toHaveLength(
      0,
    );
  });
  it("닫힌 목록은 열린 할 일과 분리된다", async () => {
    const task = await custom();
    await isolated.db.query("UPDATE owner_tasks SET wait_status='answered',closed_at=$2 WHERE id=$1", [task.id, NOW]);
    expect((await listBody(await call())).items).toHaveLength(0);
    const closed = await listBody(await call("?status=closed"));
    expectSchema("OwnerTaskList", closed);
    expect(closed.items).toHaveLength(1);
    expect(closed.items[0]?.taskId).toBe(task.id);
  });
  it("다른 가게의 할 일은 목록에 없다", async () => {
    const other = await createShop(isolated.db, "다른 할 일 가게");
    await issueTestBookingLink(isolated.db, other);
    await isolated.db.query(
      "INSERT INTO owner_tasks(shop_id,event_key,kind,detail) VALUES($1,$2,'ledger_relink',$3::jsonb)",
      [other.shopId, `task:ledger_relink:${newUuid()}`, JSON.stringify({ summary: "다른 가게 비공개" })],
    );
    const response = await call();
    expect(response.status).toBe(200);
    expect((await listBody(response)).items).toHaveLength(0);
  });
});
