import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { closeIdleConsultation } from "../src/consultation-idle";
import type { RequestDb } from "../src/db";
import { DUE_SOURCES } from "../src/due-sources";
import { runDueJobs } from "../src/job-runner";
import { runnableJobs } from "../src/jobs";
import { receiveKakaoMessage } from "../src/kakao-skill-store";
import { Secret } from "../src/settings";
import { createShopScope, shopDb, shopRequestDb } from "../src/shop-scope";
import { scopeViolations } from "../src/sql-scope";
import { describeDb, newUuid, TEST_HASH_KEY } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-24T06:00:00Z"),
  HOUR = 3600000;
describeDb("문의 끊김과 상담 끝남(TASK-076, SPEC-025)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, db: RequestDb, shop: ShopFixture;
  let customerId: string, consultationId: string, draftId: string;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
    db = isolated.db;
  }, 30000);
  afterAll(async () => {
    await isolated?.close();
  });
  beforeEach(async () => {
    shop = await createShop(db, "합성 문의 끊김 가게");
    await issueTestBookingLink(db, shop);
    await linkTestChannel(db, shop.channelId);
    customerId = newUuid();
    consultationId = newUuid();
    draftId = newUuid();
    await db.query("INSERT INTO customers(id,shop_id,kakao_channel_id,kakao_user_key) VALUES($1,$2,$3,$4)", [
      customerId,
      shop.shopId,
      shop.channelId,
      `idle-${customerId}`,
    ]);
    await db.query("INSERT INTO consultations(id,shop_id,customer_id,last_customer_message_at) VALUES($1,$2,$3,$4)", [
      consultationId,
      shop.shopId,
      customerId,
      new Date(NOW.getTime() - 24 * HOUR),
    ]);
    await db.query(
      "INSERT INTO order_drafts(id,shop_id,consultation_id,pickup_day,lettering) VALUES($1,$2,$3,'2026-12-01','생일 축하')",
      [draftId, shop.shopId, consultationId],
    );
  });
  async function tick(at = NOW) {
    const jobs = runnableJobs().filter((j) => j.name === "consultation_idle");
    expect(jobs).toHaveLength(1);
    for (const job of jobs)
      for (const source of job.sources) expect(scopeViolations(DUE_SOURCES[source].claim), source).toEqual([]);
    const logs: { event?: string }[] = [];
    const result = await runDueJobs({
      db,
      now: at,
      jobs,
      log: (_level, fields) => {
        logs.push(fields);
      },
    });
    expect(
      logs.filter((x) => x.event?.endsWith("_failed")),
      JSON.stringify(logs),
    ).toEqual([]);
    return result;
  }
  async function state() {
    return (
      await db.query<{ status: string; dropped_at: Date | null; ended_at: Date | null }>(
        "SELECT status,dropped_at,ended_at FROM consultations WHERE id=$1",
        [consultationId],
      )
    ).rows[0];
  }
  it("공통 닫기는 가게 범위 안에서만 처리", async () => {
    const other = await createShop(db, "합성 다른 가게");
    await db.transaction((tx) =>
      closeIdleConsultation(
        shopDb(createShopScope(other.shopId, { kind: "job", job: "consultation_idle" }), tx),
        consultationId,
        NOW,
      ),
    );
    expect((await state())?.status).toBe("open");
    await db.transaction((tx) =>
      closeIdleConsultation(
        shopDb(createShopScope(shop.shopId, { kind: "job", job: "consultation_idle" }), tx),
        consultationId,
        NOW,
      ),
    );
    expect((await state())?.status).toBe("dropped");
  });
  it("24시간 직전에는 열려 있고 정각에 한 번 닫으며 초안·안내 없음 유지", async () => {
    await tick(new Date(NOW.getTime() - 1));
    expect((await state())?.status).toBe("open");
    await tick();
    expect(await state()).toMatchObject({ status: "dropped", dropped_at: NOW, ended_at: null });
    await tick(new Date(NOW.getTime() + HOUR));
    expect((await state())?.dropped_at).toEqual(NOW);
    expect((await db.query("SELECT pickup_day::text,lettering FROM order_drafts WHERE id=$1", [draftId])).rows).toEqual(
      [{ pickup_day: "2026-12-01", lettering: "생일 축하" }],
    );
    expect(
      (await db.query("SELECT count(*)::int AS n FROM notifications WHERE consultation_id=$1", [consultationId])).rows,
    ).toEqual([{ n: 0 }]);
  });
  it("마지막 메시지 뒤 기다림은 지금 가게 설정을 적용", async () => {
    await db.query("UPDATE consultations SET last_customer_message_at=$2 WHERE id=$1", [
      consultationId,
      new Date(NOW.getTime() - 12 * HOUR),
    ]);
    await tick();
    expect((await state())?.status).toBe("open");
    await db.query("UPDATE shops SET idle_close_hours=12 WHERE id=$1", [shop.shopId]);
    await tick();
    expect((await state())?.status).toBe("dropped");
  });
  it("상담 상태가 답 기다림이어도 열린 건과 주문이 없으면 닫음", async () => {
    await db.query("UPDATE consultations SET status='awaiting_owner' WHERE id=$1", [consultationId]);
    await tick();
    expect((await state())?.status).toBe("dropped");
  });
  async function useOrderConsultation() {
    consultationId = shop.consultationId;
    draftId = shop.draftId;
    customerId = shop.customerId;
    await db.query("UPDATE consultations SET status='open',last_customer_message_at=$2 WHERE id=$1", [
      consultationId,
      new Date(NOW.getTime() - 24 * HOUR),
    ]);
  }
  async function cancelledWithoutPayment() {
    await useOrderConsultation();
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE payment_requests SET status='closed',closed_at=$2,close_reason='order_cancelled' WHERE id=$1",
        [shop.paymentRequestId, NOW],
      );
      await tx.query(
        "UPDATE orders SET status='cancelled',cancelled_at=$2,cancel_kind='no_payment',finished_at=NULL WHERE id=$1",
        [shop.orderId, NOW],
      );
    });
  }
  it("결제를 기다리는 다룬 주문은 ordered로 두고 주문과 안내를 바꾸지 않음", async () => {
    await useOrderConsultation();
    const before = (await db.query("SELECT row_to_json(o) AS row FROM orders o WHERE id=$1", [shop.orderId])).rows;
    await tick();
    expect((await state())?.status).toBe("ordered");
    expect((await db.query("SELECT row_to_json(o) AS row FROM orders o WHERE id=$1", [shop.orderId])).rows).toEqual(
      before,
    );
    expect(
      (await db.query("SELECT count(*)::int AS n FROM notifications WHERE consultation_id=$1", [consultationId])).rows,
    ).toEqual([{ n: 0 }]);
  });
  it("결제 없이 취소되어 다른 열린 일이 없는 주문은 ended로 닫음", async () => {
    await cancelledWithoutPayment();
    await tick();
    expect(await state()).toMatchObject({ status: "ended", ended_at: NOW, dropped_at: null });
    await tick(new Date(NOW.getTime() + HOUR));
    expect((await state())?.ended_at).toEqual(NOW);
  });
  it("열린 에스컬레이션 건은 닫지 않고 답 없이 닫힌 뒤에야 문의를 닫음", async () => {
    const message = newUuid(),
      handoff = newUuid();
    await db.query(
      "INSERT INTO messages(id,shop_id,consultation_id,direction,author,kind,kakao_message_id) VALUES($1,$2,$3,'inbound','customer','text',$4)",
      [message, shop.shopId, consultationId, `idle-${message}`],
    );
    await db.query(
      "INSERT INTO handoffs(id,shop_id,consultation_id,source_message_id,reason) VALUES($1,$2,$3,$4,'cannot_answer')",
      [handoff, shop.shopId, consultationId, message],
    );
    await db.query("UPDATE consultations SET status='awaiting_owner' WHERE id=$1", [consultationId]);
    await tick();
    expect((await state())?.status).toBe("awaiting_owner");
    await db.query("UPDATE handoffs SET status='closed_no_answer',closed_at=$2 WHERE id=$1", [handoff, NOW]);
    await tick();
    expect((await state())?.status).toBe("dropped");
  });
  it("취소 주문에도 아직 닫히지 않은 할 일이 있으면 끝남으로 닫지 않음", async () => {
    await cancelledWithoutPayment();
    const task = newUuid();
    await db.query(
      "INSERT INTO owner_tasks(id,shop_id,kind,event_key,order_id,wait_status,wait_due_at) VALUES($1,$2,'refund_decision',$3,$4,'waiting',$5)",
      [task, shop.shopId, `task:refund_decision:${shop.orderId}`, shop.orderId, NOW],
    );
    await tick();
    expect((await state())?.status).toBe("ordered");
    await db.query("UPDATE owner_tasks SET wait_status='answered',closed_at=$2 WHERE id=$1", [task, NOW]);
    await tick();
    expect((await state())?.status).toBe("ended");
  });
  async function incoming(at: Date, text = "합성 이어가기") {
    const connection = isolated.connect();
    const scope = createShopScope(shop.shopId, { kind: "customer", channelId: shop.channelId });
    try {
      return await receiveKakaoMessage(
        shopRequestDb(scope, connection),
        {
          scope,
          channelId: shop.channelId,
          status: "linked",
          receivedAt: at,
          requestKeySecret: new Secret(TEST_HASH_KEY),
          payload: {
            botId: shop.botId,
            blockId: "test",
            userId: customerId === shop.customerId ? shop.userKey : `idle-${customerId}`,
            utterance: text,
            callbackUrl: undefined,
            isFriend: true,
            params: {},
            action: { params: {}, clientExtra: {} },
          },
        },
        "text",
      );
    } finally {
      await connection.close();
    }
  }
  it("문의 끊김 뒤 새 메시지는 같은 상담·초안을 열고 마지막 시각을 갱신", async () => {
    await tick();
    expect((await state())?.status).toBe("dropped");
    const at = new Date(NOW.getTime() + HOUR),
      receipt = await incoming(at);
    expect(receipt).toMatchObject({ kind: "received", consultationId });
    expect(await state()).toMatchObject({ status: "open", dropped_at: null, ended_at: null });
    expect(
      (await db.query("SELECT last_customer_message_at FROM consultations WHERE id=$1", [consultationId])).rows,
    ).toEqual([{ last_customer_message_at: at }]);
    expect(
      (
        await db.query("SELECT id,pickup_day::text,lettering FROM order_drafts WHERE consultation_id=$1", [
          consultationId,
        ])
      ).rows,
    ).toEqual([{ id: draftId, pickup_day: "2026-12-01", lettering: "생일 축하" }]);
  });
  it("열린 상담의 최신 수신 시각은 늘고 늦게 온 옛 수신으로 되돌아가지 않음", async () => {
    await incoming(NOW, "합성 최신 수신");
    await incoming(new Date(NOW.getTime() - 60000), "합성 늦게 온 옛 수신");
    expect(
      (await db.query("SELECT last_customer_message_at FROM consultations WHERE id=$1", [consultationId])).rows,
    ).toEqual([{ last_customer_message_at: NOW }]);
    await tick();
    expect((await state())?.status).toBe("open");
  });
  it("상담 끝남 뒤의 메시지는 새 상담에 저장하고 옛 상담·초안을 열지 않음", async () => {
    await cancelledWithoutPayment();
    await tick();
    expect((await state())?.status).toBe("ended");
    const receipt = await incoming(new Date(NOW.getTime() + HOUR));
    expect(receipt.kind).toBe("received");
    if (receipt.kind !== "received") throw new Error("시험 수신 실패");
    expect(receipt.consultationId).not.toBe(consultationId);
    expect((await state())?.status).toBe("ended");
    expect((await db.query("SELECT consultation_id FROM messages WHERE id=$1", [receipt.messageId])).rows).toEqual([
      { consultation_id: receipt.consultationId },
    ]);
  });
});
