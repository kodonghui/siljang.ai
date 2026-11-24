import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { runDueJobs } from "../src/job-runner";
import type { KakaoOwnerEvents } from "../src/kakao-event";
import { createCustomOrderTask } from "../src/order-output";
import { createOwnerAlertHandler } from "../src/owner-alerts";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { describeDb, newUuid } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-24T00:00:00Z"),
  BOT = "b".repeat(24);
describeDb("사장님 알림 실행기(TASK-072)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture, now: Date, events: KakaoOwnerEvents;
  const request = vi.fn<KakaoOwnerEvents["requestAlert"]>(),
    check = vi.fn<KakaoOwnerEvents["checkDelivery"]>();
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    now = NOW;
    shop = await createShop(isolated.db, "합성 사장님 알림 가게");
    await issueTestBookingLink(isolated.db, shop);
    await isolated.db.query("UPDATE owners SET alert_channel_friend=true,alert_friend_checked_at=$2 WHERE id=$1", [
      shop.ownerId,
      new Date(NOW.getTime() - 1000),
    ]);
    request.mockReset().mockResolvedValue({ kind: "accepted", taskId: newUuid() });
    check.mockReset().mockResolvedValue({ kind: "delivered" });
    events = { requestAlert: request, checkDelivery: check };
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("합성 시험에서 실제 발신 금지"));
  });
  afterEach(async () => {
    expect(fetch).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    await isolated.db.query(
      "UPDATE owner_alerts SET status='failed',batched_into_id=NULL,next_attempt_at=NULL,sent_at=NULL WHERE shop_id=$1",
      [shop.shopId],
    );
  });
  afterAll(async () => {
    await isolated?.close();
  });
  const run = (enabled = true) =>
    runDueJobs({
      db: isolated.db,
      now,
      jobs: [
        {
          name: "owner_alert",
          every: "minute",
          sources: ["owner_alert_send", "owner_alert_check"],
          handler: createOwnerAlertHandler({ enabled, botId: BOT, events: () => events, now: () => now }),
        },
      ],
      log: () => {},
    });
  async function custom() {
    await isolated.db.query("UPDATE orders SET kind='custom',status='requested' WHERE id=$1", [shop.orderId]);
    return createCustomOrderTask(
      shopRequestDb(createShopScope(shop.shopId, { kind: "owner", ownerId: shop.ownerId }), isolated.db),
      shop.orderId,
      NOW,
    );
  }
  async function alert(kind: string, taskId: string | null = null, createdAt = NOW) {
    const id = newUuid();
    await isolated.db.query(
      "INSERT INTO owner_alerts(id,shop_id,owner_task_id,kind,event_key,next_attempt_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$6)",
      [id, shop.shopId, taskId, kind, `alert:${kind}:${id}`, createdAt],
    );
    return id;
  }
  it("맞춤 주문 할 일은 하나이고 우리 봇의 appUserId로 접수한 뒤 전달 확인 때만 보냄이다", async () => {
    await custom();
    await run();
    expect(request).not.toHaveBeenCalled();
    now = new Date(NOW.getTime() + 60000);
    await run();
    expect(request).toHaveBeenCalledOnce();
    const owner = (
      await isolated.db.query("SELECT kakao_account_id::text AS id FROM owners WHERE id=$1", [shop.ownerId])
    ).rows[0];
    expect(request.mock.calls[0]?.[0]).toMatchObject({ botId: BOT, appUserId: owner?.id });
    expect(
      (await isolated.db.query("SELECT status,sent_at FROM owner_alerts WHERE shop_id=$1", [shop.shopId])).rows,
    ).toEqual([{ status: "confirming", sent_at: null }]);
    now = new Date(now.getTime() + 60000);
    await run();
    expect(check).toHaveBeenCalledOnce();
    expect((await isolated.db.query("SELECT status FROM owner_alerts WHERE shop_id=$1", [shop.shopId])).rows).toEqual([
      { status: "sent" },
    ]);
    expect((await isolated.db.query("SELECT closed_at FROM owner_tasks WHERE shop_id=$1", [shop.shopId])).rows).toEqual(
      [{ closed_at: null }],
    );
  });
  it("계좌 변경 안내는 할 일 없이 한 번 보내고 계좌·손님 값은 전송 인자에 없다", async () => {
    await alert("payment_account_changed");
    now = new Date(NOW.getTime() + 60000);
    await run();
    await run();
    expect(request).toHaveBeenCalledOnce();
    expect((await isolated.db.query("SELECT id FROM owner_tasks WHERE shop_id=$1", [shop.shopId])).rows).toHaveLength(
      0,
    );
    const payload = JSON.stringify(request.mock.calls);
    for (const privateValue of ["010-0000-0000", "customerPhone", "allergy", "accountNumber"])
      expect(payload).not.toContain(privateValue);
  });
  it("상위 취소 업무가 남긴 환불 결정 할 일도 알림 한 건으로 전달한다", async () => {
    const taskId = newUuid();
    await isolated.db.query(
      "INSERT INTO owner_tasks(id,shop_id,order_id,kind,event_key,wait_status,wait_due_at,opened_at) VALUES($1,$2,$3,'refund_decision',$4,'waiting',$5,$6)",
      [
        taskId,
        shop.shopId,
        shop.orderId,
        `task:refund_decision:${shop.orderId}`,
        new Date(NOW.getTime() + 3600000),
        NOW,
      ],
    );
    await alert("new_task", taskId);
    now = new Date(NOW.getTime() + 60000);
    await run();
    expect(request).toHaveBeenCalledOnce();
    expect((await isolated.db.query("SELECT kind FROM owner_tasks WHERE shop_id=$1", [shop.shopId])).rows).toEqual([
      { kind: "refund_decision" },
    ]);
  });
  it("발송 결과101이면 친구 아님으로 고치고 할 일은 남긴다", async () => {
    await custom();
    now = new Date(NOW.getTime() + 60000);
    await run();
    check.mockResolvedValueOnce({
      kind: "failed",
      code: "not_friend",
      retryable: false,
      disableChannel: false,
      attention: null,
    });
    now = new Date(now.getTime() + 60000);
    await run();
    expect(
      (await isolated.db.query("SELECT status,fail_code FROM owner_alerts WHERE shop_id=$1", [shop.shopId])).rows,
    ).toEqual([{ status: "not_friend", fail_code: "not_friend" }]);
    expect(
      (await isolated.db.query("SELECT alert_channel_friend FROM owners WHERE id=$1", [shop.ownerId])).rows,
    ).toEqual([{ alert_channel_friend: false }]);
    expect((await isolated.db.query("SELECT closed_at FROM owner_tasks WHERE shop_id=$1", [shop.shopId])).rows).toEqual(
      [{ closed_at: null }],
    );
  });
  it("1분 안 같은 종류의 새 할 일은 하나로 묶고 다른 창의 것은 다음 발신으로 남긴다", async () => {
    for (const offset of [0, 30000, 61000]) {
      const taskId = newUuid(),
        at = new Date(NOW.getTime() + offset);
      await isolated.db.query(
        "INSERT INTO owner_tasks(id,shop_id,kind,event_key,opened_at) VALUES($1,$2,'ledger_relink',$3,$4)",
        [taskId, shop.shopId, `task:ledger_relink:${taskId}`, at],
      );
      await alert("new_task", taskId, at);
    }
    now = new Date(NOW.getTime() + 60000);
    await run();
    expect(request).toHaveBeenCalledOnce();
    expect(
      (
        await isolated.db.query(
          "SELECT status,count(*)::int AS n FROM owner_alerts WHERE shop_id=$1 GROUP BY status ORDER BY status",
          [shop.shopId],
        )
      ).rows,
    ).toEqual([
      { status: "batched", n: 1 },
      { status: "confirming", n: 1 },
      { status: "pending", n: 1 },
    ]);
  });
  it("MVP 발신 중단은 전송기를 만들지 않고 목록의 할 일을 유지한다", async () => {
    await custom();
    await run(false);
    expect(request).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
    expect(
      (await isolated.db.query("SELECT status,fail_code FROM owner_alerts WHERE shop_id=$1", [shop.shopId])).rows,
    ).toEqual([{ status: "failed", fail_code: "cannot_send" }]);
    expect((await isolated.db.query("SELECT closed_at FROM owner_tasks WHERE shop_id=$1", [shop.shopId])).rows).toEqual(
      [{ closed_at: null }],
    );
  });
});
