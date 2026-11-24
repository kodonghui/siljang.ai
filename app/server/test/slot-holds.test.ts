import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { calendarBookingDays } from "../src/calendar";
import { shiftDate } from "../src/calendar-input";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { expireOrderSlot, holdOrderSlot } from "../src/slot-holds";
import { shopLocalToUtc, toShopLocal } from "../src/time";
import { describeDb, newUuid } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, type ShopFixture } from "./support/shops";

interface Order {
  orderId: string;
  paymentRequestId: string;
}
describeDb("가예약의 날짜 잠금·중복·추가 수락(TASK-082)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture, now: Date, day: string;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    shop = await createShop(isolated.db, "합성 자리 가게");
    await issueTestBookingLink(isolated.db, shop);
    now = new Date();
    day = shiftDate(toShopLocal(now, "Asia/Seoul").date, 2);
    await isolated.db.query(
      "UPDATE business_calendars SET closed_weekdays='{}',daily_capacity=5,order_cutoff_days=0,order_cutoff_time='23:59' WHERE shop_id=$1",
      [shop.shopId],
    );
    await isolated.db.query("INSERT INTO calendar_days(shop_id,day) VALUES($1,$2) ON CONFLICT DO NOTHING", [
      shop.shopId,
      day,
    ]);
    const pickup = shopLocalToUtc(day, "15:00", "Asia/Seoul");
    await isolated.db.transaction(async (tx) => {
      await tx.query("UPDATE orders SET pickup_day=$2,pickup_at=$3 WHERE id=$1", [shop.orderId, day, pickup]);
      await tx.query("UPDATE order_details SET pickup_at=$2 WHERE order_id=$1", [shop.orderId, pickup]);
      await tx.query("UPDATE payment_requests SET delivered_at=$2,due_at=$3,due_cap_at=$4 WHERE id=$1", [
        shop.paymentRequestId,
        now,
        new Date(now.getTime() + 2 * 3600000),
        pickup,
      ]);
    });
  });
  afterAll(async () => {
    await isolated?.close();
  });
  const scope = (db = isolated.db, owner = false) =>
    shopRequestDb(
      createShopScope(
        shop.shopId,
        owner ? { kind: "owner", ownerId: shop.ownerId } : { kind: "job", job: "slot_holds" },
      ),
      db,
    );
  async function sibling(): Promise<Order> {
    const draftId = newUuid(),
      quoteId = newUuid(),
      orderId = newUuid(),
      detailId = newUuid(),
      paymentRequestId = newUuid();
    await isolated.db.transaction(async (tx) => {
      await tx.query("SET CONSTRAINTS ALL DEFERRED");
      await tx.query(
        "INSERT INTO order_drafts SELECT(jsonb_populate_record(NULL::order_drafts,to_jsonb(d)||$2::jsonb)).* FROM order_drafts d WHERE d.id=$1",
        [shop.draftId, JSON.stringify({ id: draftId })],
      );
      await tx.query(
        "INSERT INTO quotes SELECT(jsonb_populate_record(NULL::quotes,to_jsonb(q)||$2::jsonb)).* FROM quotes q WHERE q.id=$1",
        [shop.quoteId, JSON.stringify({ id: quoteId, draft_id: draftId })],
      );
      await tx.query(
        "INSERT INTO orders SELECT(jsonb_populate_record(NULL::orders,to_jsonb(o)||$2::jsonb)).* FROM orders o WHERE o.id=$1",
        [
          shop.orderId,
          JSON.stringify({
            id: orderId,
            order_no: orderId.replaceAll("-", "").slice(0, 8).toUpperCase(),
            draft_id: draftId,
            lock_version: 1,
          }),
        ],
      );
      await tx.query(
        "INSERT INTO order_details SELECT(jsonb_populate_record(NULL::order_details,to_jsonb(d)||$2::jsonb)).* FROM order_details d WHERE d.order_id=$1 AND d.version=1",
        [shop.orderId, JSON.stringify({ id: detailId, order_id: orderId, quote_id: quoteId })],
      );
      await tx.query(
        "INSERT INTO payment_requests SELECT(jsonb_populate_record(NULL::payment_requests,to_jsonb(p)||$2::jsonb)).* FROM payment_requests p WHERE p.id=$1",
        [
          shop.paymentRequestId,
          JSON.stringify({ id: paymentRequestId, order_id: orderId, event_key: `pay:${orderId}:first` }),
        ],
      );
    });
    return { orderId, paymentRequestId };
  }
  it("마지막 자리에 별도 연결 두 요청이 오면 하나만 잡힘", async () => {
    const orders: Order[] = [shop];
    for (let n = 0; n < 5; n++) orders.push(await sibling());
    for (const order of orders.slice(0, 4))
      await isolated.db.query(
        "INSERT INTO slot_holds(shop_id,day,order_id,payment_request_id,hold_key,status) VALUES($1,$2,$3,$4,$5,'held')",
        [shop.shopId, day, order.orderId, order.paymentRequestId, `hold:${order.orderId}:${order.paymentRequestId}`],
      );
    const a = isolated.connect(),
      b = isolated.connect();
    try {
      const results = await Promise.all(
        [a, b].map((db, i) => holdOrderSlot(scope(db), { ...(orders[i + 4] as Order), now })),
      );
      expect(results.map((x) => x.kind).sort()).toEqual(["day_full", "held"]);
      expect(
        (
          await isolated.db.query(
            "SELECT count(*)::int AS n FROM slot_holds WHERE shop_id=$1 AND day=$2 AND status IN('held','fixed','done')",
            [shop.shopId, day],
          )
        ).rows,
      ).toEqual([{ n: 5 }]);
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  });
  it("같은 주문·결제 안내는 한 번만 잡고 같은 ID", async () => {
    const first = await holdOrderSlot(scope(), { orderId: shop.orderId, paymentRequestId: shop.paymentRequestId, now });
    const second = await holdOrderSlot(scope(), {
      orderId: shop.orderId,
      paymentRequestId: shop.paymentRequestId,
      now,
    });
    expect(first.kind).toBe("held");
    expect(second.kind).toBe("existing");
    expect(second.holdId).toBe(first.holdId);
    expect(
      (await isolated.db.query("SELECT count(*)::int AS n FROM slot_holds WHERE shop_id=$1", [shop.shopId])).rows,
    ).toEqual([{ n: 1 }]);
  });
  it("휴무일 맞춤 수락은 사장님 확인 뒤에만 추가 수락으로 잡힘", async () => {
    await isolated.db.query("UPDATE calendar_days SET closed=true WHERE shop_id=$1 AND day=$2", [shop.shopId, day]);
    await isolated.db.query("UPDATE orders SET kind='custom',accepted_at=$2,accepted_version=1 WHERE id=$1", [
      shop.orderId,
      now,
    ]);
    const revision = (
      await isolated.db.query<{ lock_version: number }>("SELECT lock_version FROM orders WHERE id=$1", [shop.orderId])
    ).rows[0];
    if (!revision) throw new Error("synthetic order missing");
    const input = {
      orderId: shop.orderId,
      paymentRequestId: shop.paymentRequestId,
      now,
      expectedOrderRevision: revision.lock_version,
    };
    expect((await holdOrderSlot(scope(isolated.db, true), input)).kind).toBe("confirmation_required");
    const result = await holdOrderSlot(scope(isolated.db, true), { ...input, ownerConfirmed: true });
    expect(result.kind).toBe("held");
    expect((await isolated.db.query("SELECT overbooked FROM slot_holds WHERE shop_id=$1", [shop.shopId])).rows).toEqual(
      [{ overbooked: true }],
    );
  });
  it("기본 디자인의 손님 요청은 확인 값을 보내도 휴무일 추가 수락을 못 함", async () => {
    await isolated.db.query("UPDATE calendar_days SET closed=true WHERE shop_id=$1 AND day=$2", [shop.shopId, day]);
    const result = await holdOrderSlot(scope(), {
      orderId: shop.orderId,
      paymentRequestId: shop.paymentRequestId,
      now,
      ownerConfirmed: true,
    });
    expect(result.kind).toBe("day_full");
    expect(
      (await isolated.db.query("SELECT count(*)::int AS n FROM slot_holds WHERE shop_id=$1", [shop.shopId])).rows,
    ).toEqual([{ n: 0 }]);
  });
  it("오래된 주문 잠금 번호로는 자리 쓰기0건", async () => {
    const before = (
      await isolated.db.query<{ lock_version: number }>("SELECT lock_version FROM orders WHERE id=$1", [shop.orderId])
    ).rows[0];
    if (!before) throw new Error("synthetic order missing");
    await isolated.db.query("UPDATE orders SET status='payment_overdue',lock_version=lock_version+1 WHERE id=$1", [
      shop.orderId,
    ]);
    const result = await holdOrderSlot(scope(), {
      orderId: shop.orderId,
      paymentRequestId: shop.paymentRequestId,
      now,
      expectedOrderRevision: before.lock_version,
    });
    expect(result.kind).toBe("stale");
    expect(
      (await isolated.db.query("SELECT count(*)::int AS n FROM slot_holds WHERE shop_id=$1", [shop.shopId])).rows,
    ).toEqual([{ n: 0 }]);
  });
  it("다른 가게의 주문이나 결제 안내는 같은 거절이며 자리 쓰기0건", async () => {
    const other = await createShop(isolated.db, "다른 합성 자리 가게");
    await expect(
      holdOrderSlot(scope(), { orderId: other.orderId, paymentRequestId: other.paymentRequestId, now }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      holdOrderSlot(scope(), { orderId: shop.orderId, paymentRequestId: other.paymentRequestId, now }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(
      (await isolated.db.query("SELECT count(*)::int AS n FROM slot_holds WHERE shop_id=$1", [shop.shopId])).rows,
    ).toEqual([{ n: 0 }]);
  });
  async function held() {
    return holdOrderSlot(scope(), { orderId: shop.orderId, paymentRequestId: shop.paymentRequestId, now });
  }
  async function expire(at: Date) {
    return expireOrderSlot(scope(), { orderId: shop.orderId, paymentRequestId: shop.paymentRequestId, now: at });
  }
  const bookingStatus = async (at: Date) =>
    scope().transaction(async (tx) => (await calendarBookingDays(tx, at)).find((x) => x.day === day)?.status);
  it("기한 정각에 잡힌 자리를 풀고 주문을 기한 지남으로 두며 마감이 다시 열림", async () => {
    await isolated.db.query("UPDATE business_calendars SET daily_capacity=1 WHERE shop_id=$1", [shop.shopId]);
    await held();
    expect(await bookingStatus(now)).toBe("closed");
    const at = new Date(now.getTime() + 2 * 3600000);
    expect((await expire(at)).kind).toBe("expired");
    expect(
      (await isolated.db.query("SELECT status,release_reason FROM slot_holds WHERE shop_id=$1", [shop.shopId])).rows,
    ).toEqual([{ status: "released", release_reason: "payment_overdue" }]);
    expect((await isolated.db.query("SELECT status FROM orders WHERE id=$1", [shop.orderId])).rows).toEqual([
      { status: "payment_overdue" },
    ]);
    expect(
      (await isolated.db.query("SELECT status FROM payment_requests WHERE id=$1", [shop.paymentRequestId])).rows,
    ).toEqual([{ status: "expired" }]);
    expect(await bookingStatus(at)).toBe("open");
    const revision = (await isolated.db.query("SELECT lock_version FROM orders WHERE id=$1", [shop.orderId])).rows;
    expect((await expire(at)).kind).toBe("unchanged");
    expect((await isolated.db.query("SELECT lock_version FROM orders WHERE id=$1", [shop.orderId])).rows).toEqual(
      revision,
    );
  });
  it("자리 기한이 지나도 사장님이 누른 마감은 그대로", async () => {
    await held();
    await isolated.db.query("UPDATE calendar_days SET manually_closed_at=$3 WHERE shop_id=$1 AND day=$2", [
      shop.shopId,
      day,
      now,
    ]);
    const at = new Date(now.getTime() + 2 * 3600000);
    expect((await expire(at)).kind).toBe("expired");
    expect(await bookingStatus(at)).toBe("closed");
  });
  it("기한 전에 입금을 알렸으면 상한 전에는 지키고 상한 정각에는 풂", async () => {
    await held();
    await isolated.db.query(
      "UPDATE payment_requests SET status='claimed',claimed_at=$2,version=version+1 WHERE id=$1",
      [shop.paymentRequestId, new Date(now.getTime() + 60000)],
    );
    expect((await expire(new Date(now.getTime() + 2 * 3600000))).kind).toBe("protected");
    expect((await isolated.db.query("SELECT status FROM slot_holds WHERE shop_id=$1", [shop.shopId])).rows).toEqual([
      { status: "held" },
    ]);
    const cap = (
      await isolated.db.query<{ due_cap_at: Date }>("SELECT due_cap_at FROM payment_requests WHERE id=$1", [
        shop.paymentRequestId,
      ])
    ).rows[0];
    if (!cap) throw new Error("synthetic payment missing");
    expect((await expire(cap.due_cap_at)).kind).toBe("expired");
    expect((await isolated.db.query("SELECT status FROM orders WHERE id=$1", [shop.orderId])).rows).toEqual([
      { status: "payment_overdue" },
    ]);
  });
  it("맞추는 중은 상한이 지나도 기한으로 풀지 않음", async () => {
    await held();
    await isolated.db.query(
      "UPDATE payment_requests SET status='mismatch',mismatch_amount=35001,mismatch_at=$2,arrived_amount=35001,arrived_at=$2,version=version+1 WHERE id=$1",
      [shop.paymentRequestId, now],
    );
    expect((await expire(shopLocalToUtc(shiftDate(day, 1), "16:00", "Asia/Seoul"))).kind).toBe("protected");
    expect((await isolated.db.query("SELECT status FROM slot_holds WHERE shop_id=$1", [shop.shopId])).rows).toEqual([
      { status: "held" },
    ]);
  });
  it("확정된 자리는 결제 기한으로 풀리지 않음", async () => {
    await held();
    const paymentId = newUuid();
    await isolated.db.transaction(async (tx) => {
      await tx.query(
        "UPDATE payment_requests SET status='paid',paid_at=$2,arrived_amount=amount,arrived_at=$2,version=version+1 WHERE id=$1",
        [shop.paymentRequestId, now],
      );
      await tx.query(
        "INSERT INTO payments(id,shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES($1,$2,$3,$4,35000,$5)",
        [paymentId, shop.shopId, shop.orderId, shop.paymentRequestId, now],
      );
      await tx.query(
        "UPDATE orders SET status='confirmed',confirmed_at=$2,confirmed_payment_id=$3,lock_version=lock_version+1 WHERE id=$1",
        [shop.orderId, now, paymentId],
      );
      await tx.query("UPDATE slot_holds SET status='fixed',fixed_at=$2 WHERE shop_id=$1", [shop.shopId, now]);
    });
    expect((await expire(new Date(now.getTime() + 3 * 3600000))).kind).toBe("protected");
    expect((await isolated.db.query("SELECT status FROM slot_holds WHERE shop_id=$1", [shop.shopId])).rows).toEqual([
      { status: "fixed" },
    ]);
  });
});
