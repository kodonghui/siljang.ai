import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { calendarBookingDays } from "../src/calendar";
import { shiftDate } from "../src/calendar-input";
import { pgConnector } from "../src/db";
import { Secret } from "../src/settings";
import { createShopScope, shopDb, shopRequestDb } from "../src/shop-scope";
import {
  applyDifferenceSlotInTransaction,
  expireOrderSlot,
  finishOrderSlot,
  fixPaidOrderSlot,
  holdOrderSlot,
  holdOrderSlotInTransaction,
  moveOrderSlotInTransaction,
  releaseCancelledOrderSlots,
  releaseClosedChangeSlot,
  reserveRemakeSlot,
} from "../src/slot-holds";
import { shopLocalToUtc, toShopLocal } from "../src/time";
import { describeDb, newUuid, TEST_DATABASE_URL, testDb } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, type ShopFixture } from "./support/shops";

interface Order {
  orderId: string;
  paymentRequestId: string;
}
describeDb("가예약의 날짜 잠금·중복·추가 수락(TASK-082)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture, now: Date, day: string;
  const role = `slot082_${newUuid().replaceAll("-", "")}`;
  let runtimeUrl: string;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
    await isolated.db.query(`CREATE ROLE "${role}" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    const grants = readFileSync(new URL("../../../tools/staging-login-callback-grants.sql", import.meta.url), "utf8");
    await isolated.db.query(grants.replaceAll(':"runtime_role"', `"${role}"`));
    const name = (await isolated.db.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name;
    const url = new URL(TEST_DATABASE_URL);
    url.pathname = `/${name}`;
    url.username = role;
    url.password = "";
    runtimeUrl = url.toString();
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
    const admin = testDb();
    try {
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
    } finally {
      await admin.close();
    }
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
  it("제한 역할에서도 첫 자리 확보와 기한 해제가 한 트랜잭션으로 됨", async () => {
    const runtime = pgConnector(new Secret(runtimeUrl));
    try {
      expect((await holdOrderSlot(scope(runtime), { ...shop, now })).kind).toBe("held");
      expect((await expireOrderSlot(scope(runtime), { ...shop, now: new Date(now.getTime() + 7200000) })).kind).toBe(
        "expired",
      );
    } finally {
      await runtime.close();
    }
  });
  it("제한 역할에서도 차액 자리만 잡고 기한에 풀 수 있음", async () => {
    const change = await differenceDate(),
      runtime = pgConnector(new Secret(runtimeUrl));
    try {
      const input = { orderId: shop.orderId, paymentRequestId: change.paymentRequestId, now };
      expect((await holdOrderSlot(scope(runtime), input)).kind).toBe("held");
      expect((await expireOrderSlot(scope(runtime), { ...input, now: new Date(now.getTime() + 7200000) })).kind).toBe(
        "expired",
      );
    } finally {
      await runtime.close();
    }
  });
  it("제한 역할에서도 확정·종료와 저장된 추가 수락 사용이 됨", async () => {
    await isolated.db.query("UPDATE calendar_days SET closed=true WHERE shop_id=$1 AND day=$2", [shop.shopId, day]);
    await dayApproval();
    const runtime = pgConnector(new Secret(runtimeUrl));
    try {
      expect((await holdOrderSlot(scope(runtime), { ...shop, now })).kind).toBe("held");
      await markPaid();
      expect((await fixPaidOrderSlot(scope(runtime), { ...shop, now })).kind).toBe("fixed");
      expect(
        (
          await finishOrderSlot(scope(runtime), {
            orderId: shop.orderId,
            now: shopLocalToUtc(day, "15:00", "Asia/Seoul"),
          })
        ).kind,
      ).toBe("done");
    } finally {
      await runtime.close();
    }
  });
  it("자리·주문·결제·변경·추가 수락의 식별자·기한·삭제 권한을 열지 않음", async () => {
    const checks = [
      ["slot_holds", "shop_id"],
      ["slot_holds", "day"],
      ["slot_holds", "order_id"],
      ["slot_holds", "hold_key"],
      ["payment_requests", "order_id"],
      ["payment_requests", "due_at"],
      ["payment_requests", "amount"],
      ["orders", "amount"],
      ["orders", "version"],
      ["change_requests", "changes"],
      ["handoffs", "day_decision"],
      ["handoffs", "day_accept_expires_at"],
    ];
    for (const [table, column] of checks)
      expect(
        (
          await isolated.db.query<{ allowed: boolean }>("SELECT has_column_privilege($1,$2,$3,'UPDATE') AS allowed", [
            role,
            `public.${table}`,
            column,
          ])
        ).rows,
      ).toEqual([{ allowed: false }]);
    for (const table of ["slot_holds", "payment_requests", "orders", "change_requests", "handoffs"])
      expect(
        (
          await isolated.db.query<{ allowed: boolean }>("SELECT has_table_privilege($1,$2,'DELETE') AS allowed", [
            role,
            `public.${table}`,
          ])
        ).rows,
      ).toEqual([{ allowed: false }]);
  });
  it("결제 안내 대기를 남기기 전에 같은 트랜잭션 안에서 자리부터 잡힘", async () => {
    await isolated.db.transaction(async (raw) => {
      const tx = shopDb(scope().scope, raw);
      expect((await holdOrderSlotInTransaction(tx, { ...shop, now })).kind).toBe("held");
      expect(
        (await tx.run("SELECT status FROM slot_holds WHERE shop_id=$1 AND order_id=$2", [shop.orderId])).rows,
      ).toEqual([{ status: "held" }]);
      await raw.query(
        "INSERT INTO notifications(shop_id,customer_id,consultation_id,order_id,kind,event_key,template_key,body) VALUES($1,$2,$3,$4,'payment_request',$5,'synthetic_payment','합성 결제 안내')",
        [
          shop.shopId,
          shop.customerId,
          shop.consultationId,
          shop.orderId,
          `notice:${shop.paymentRequestId}:payment_request`,
        ],
      );
    });
    expect((await isolated.db.query("SELECT status FROM notifications WHERE shop_id=$1", [shop.shopId])).rows).toEqual([
      { status: "pending" },
    ]);
  });
  async function expire(at: Date) {
    return expireOrderSlot(scope(), { orderId: shop.orderId, paymentRequestId: shop.paymentRequestId, now: at });
  }
  const bookingStatus = async (at: Date) =>
    scope().transaction(async (tx) => (await calendarBookingDays(tx, at)).find((x) => x.day === day)?.status);
  async function markPaid(order: Order = shop) {
    const paymentId = newUuid();
    await isolated.db.transaction(async (tx) => {
      await tx.query(
        "UPDATE payment_requests SET status='paid',paid_at=$2,arrived_amount=amount,arrived_at=$2,version=version+1 WHERE id=$1",
        [order.paymentRequestId, now],
      );
      await tx.query(
        "INSERT INTO payments(id,shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES($1,$2,$3,$4,35000,$5)",
        [paymentId, shop.shopId, order.orderId, order.paymentRequestId, now],
      );
      await tx.query(
        "UPDATE orders SET status='confirmed',confirmed_at=$2,confirmed_payment_id=$3,lock_version=lock_version+1 WHERE id=$1",
        [order.orderId, now, paymentId],
      );
    });
  }
  async function changedDate(amountDelta = 0) {
    const changeId = newUuid(),
      cardId = newUuid(),
      newDay = shiftDate(day, 1);
    const pickup = shopLocalToUtc(newDay, "15:00", "Asia/Seoul");
    await isolated.db.query(
      "INSERT INTO confirm_cards(id,shop_id,consultation_id,customer_id,card_key,kind,order_id,order_version,payload,created_at,expires_at) VALUES($1,$2,$3,$4,$5,'change_request',$6,1,'{}',$7,$8)",
      [
        cardId,
        shop.shopId,
        shop.consultationId,
        shop.customerId,
        `ck_${cardId}`,
        shop.orderId,
        now,
        new Date(now.getTime() + 1800000),
      ],
    );
    await isolated.db.query(
      "INSERT INTO change_requests(id,shop_id,order_id,card_id,base_version,changes,new_pickup_at,amount_delta,decided_at) VALUES($1,$2,$3,$4,1,'{}',$5,$6,$7)",
      [changeId, shop.shopId, shop.orderId, cardId, pickup, amountDelta, now],
    );
    return { changeId, newDay, pickup };
  }
  async function differenceDate() {
    await held();
    await markPaid();
    await fixPaidOrderSlot(scope(), { ...shop, now });
    const change = await changedDate(1000),
      paymentRequestId = newUuid();
    await isolated.db.query(
      "UPDATE change_requests SET status='awaiting_difference',lock_version=lock_version+1 WHERE id=$1",
      [change.changeId],
    );
    await isolated.db.query(
      "INSERT INTO payment_requests SELECT(jsonb_populate_record(NULL::payment_requests,to_jsonb(p)||$2::jsonb)).* FROM payment_requests p WHERE p.id=$1",
      [
        shop.paymentRequestId,
        JSON.stringify({
          id: paymentRequestId,
          kind: "difference",
          change_request_id: change.changeId,
          event_key: `pay:${change.changeId}:difference`,
          status: "open",
          version: 1,
          amount: 1000,
          requested_amount: null,
          needs_amount_confirm: true,
          amount_confirmed_at: now.toISOString(),
          delivered_at: now.toISOString(),
          due_at: new Date(now.getTime() + 7200000).toISOString(),
          due_cap_at: new Date(now.getTime() + 14400000).toISOString(),
          paid_at: null,
          arrived_at: null,
          arrived_amount: null,
        }),
      ],
    );
    return { ...change, paymentRequestId };
  }
  it("차액을 기다리는 새날은 잡힘이고 옛날 확정 자리와 주문 내용은 그대로", async () => {
    const change = await differenceDate();
    const input = { orderId: shop.orderId, paymentRequestId: change.paymentRequestId, now };
    const result = await holdOrderSlot(scope(), input);
    expect(result.kind).toBe("held");
    expect((await holdOrderSlot(scope(), input)).holdId).toBe(result.holdId);
    expect(
      (
        await isolated.db.query("SELECT day::text,status,hold_key FROM slot_holds WHERE shop_id=$1 ORDER BY day", [
          shop.shopId,
        ])
      ).rows,
    ).toEqual([
      { day, status: "fixed", hold_key: `hold:${shop.orderId}:${shop.paymentRequestId}` },
      { day: change.newDay, status: "held", hold_key: `hold:${shop.orderId}:${change.changeId}` },
    ]);
    expect(
      (await isolated.db.query("SELECT version,pickup_day::text,status FROM orders WHERE id=$1", [shop.orderId])).rows,
    ).toEqual([{ version: 1, pickup_day: day, status: "confirmed" }]);
  });
  it("차액 결제 기한에는 새날만 풀고 원래 주문·확정 자리는 유지함", async () => {
    const change = await differenceDate();
    const input = { orderId: shop.orderId, paymentRequestId: change.paymentRequestId, now };
    expect((await holdOrderSlot(scope(), input)).kind).toBe("held");
    expect((await expireOrderSlot(scope(), { ...input, now: new Date(now.getTime() + 7200000) })).kind).toBe("expired");
    expect(
      (
        await isolated.db.query(
          "SELECT day::text,status,release_reason FROM slot_holds WHERE shop_id=$1 ORDER BY day",
          [shop.shopId],
        )
      ).rows,
    ).toEqual([
      { day, status: "fixed", release_reason: null },
      { day: change.newDay, status: "released", release_reason: "change_closed" },
    ]);
    expect(
      (await isolated.db.query("SELECT status,version,pickup_day::text FROM orders WHERE id=$1", [shop.orderId])).rows,
    ).toEqual([{ status: "confirmed", version: 1, pickup_day: day }]);
    expect(
      (await isolated.db.query("SELECT status,closed_at FROM change_requests WHERE id=$1", [change.changeId])).rows,
    ).toEqual([{ status: "closed_no_difference", closed_at: new Date(now.getTime() + 7200000) }]);
    expect((await expireOrderSlot(scope(), { ...input, now: new Date(now.getTime() + 14400000) })).kind).toBe(
      "unchanged",
    );
  });
  it("변경 닫기는 차액 안내가 닫힌 뒤 새날 잡힌 자리만 풀며 반복은 그대로", async () => {
    const change = await differenceDate(),
      input = {
        orderId: shop.orderId,
        changeRequestId: change.changeId,
        paymentRequestId: change.paymentRequestId,
        now,
      };
    await holdOrderSlot(scope(), input);
    expect((await releaseClosedChangeSlot(scope(), input)).kind).toBe("not_applicable");
    await isolated.db.transaction(async (tx) => {
      await tx.query(
        "UPDATE payment_requests SET status='closed',closed_at=$2,close_reason='change_closed',version=version+1 WHERE id=$1",
        [change.paymentRequestId, now],
      );
      await tx.query(
        "UPDATE change_requests SET status='closed_no_difference',closed_at=$2,lock_version=lock_version+1 WHERE id=$1",
        [change.changeId, now],
      );
    });
    const runtime = pgConnector(new Secret(runtimeUrl));
    try {
      expect((await releaseClosedChangeSlot(scope(runtime), input)).kind).toBe("released");
      expect((await releaseClosedChangeSlot(scope(runtime), input)).kind).toBe("unchanged");
    } finally {
      await runtime.close();
    }
    expect(
      (
        await isolated.db.query(
          "SELECT day::text,status,release_reason FROM slot_holds WHERE shop_id=$1 ORDER BY day",
          [shop.shopId],
        )
      ).rows,
    ).toEqual([
      { day, status: "fixed", release_reason: null },
      { day: change.newDay, status: "released", release_reason: "change_closed" },
    ]);
  });
  it("차액을 기다리던 주문을 취소하면 옛 확정 자리와 새 잡힌 자리를 함께 풂", async () => {
    const change = await differenceDate();
    await holdOrderSlot(scope(), { orderId: shop.orderId, paymentRequestId: change.paymentRequestId, now });
    await isolated.db.transaction(async (tx) => {
      await tx.query(
        "UPDATE orders SET status='cancelled',cancelled_at=$2,cancel_kind='customer',lock_version=lock_version+1 WHERE id=$1",
        [shop.orderId, now],
      );
      await tx.query(
        "UPDATE payment_requests SET status='closed',closed_at=$2,close_reason='order_cancelled',version=version+1 WHERE id=$1",
        [change.paymentRequestId, now],
      );
      await tx.query(
        "UPDATE change_requests SET status='closed_by_cancel',closed_at=$2,lock_version=lock_version+1 WHERE id=$1",
        [change.changeId, now],
      );
    });
    const runtime = pgConnector(new Secret(runtimeUrl));
    try {
      expect((await releaseCancelledOrderSlots(scope(runtime), { orderId: shop.orderId, now })).kind).toBe("released");
    } finally {
      await runtime.close();
    }
    expect(
      (
        await isolated.db.query("SELECT status,release_reason FROM slot_holds WHERE shop_id=$1 ORDER BY day", [
          shop.shopId,
        ])
      ).rows,
    ).toEqual([
      { status: "released", release_reason: "order_cancelled" },
      { status: "released", release_reason: "order_cancelled" },
    ]);
  });
  it("변경 요청의 오래된 잠금 번호로는 자리를 옮기지 않음", async () => {
    await held();
    await markPaid();
    await fixPaidOrderSlot(scope(), { ...shop, now });
    const change = await changedDate();
    await isolated.db.query("UPDATE change_requests SET lock_version=lock_version+1 WHERE id=$1", [change.changeId]);
    expect(
      (
        await scope().transaction((tx) =>
          moveOrderSlotInTransaction(tx, {
            orderId: shop.orderId,
            changeRequestId: change.changeId,
            expectedChangeRevision: 1,
            now,
          }),
        )
      ).kind,
    ).toBe("stale");
    expect(
      (await isolated.db.query("SELECT day::text,status FROM slot_holds WHERE shop_id=$1", [shop.shopId])).rows,
    ).toEqual([{ day, status: "fixed" }]);
  });
  async function moveDate(
    change: Awaited<ReturnType<typeof changedDate>> & { paymentRequestId?: string },
    ownerConfirmed = false,
  ) {
    return isolated.db.transaction(async (raw) => {
      const tx = shopDb(scope(isolated.db, true).scope, raw);
      const revision = await tx.found<{ lock_version: number }>(
        "SELECT lock_version FROM orders WHERE shop_id=$1 AND id=$2",
        [shop.orderId],
      );
      const input = {
        orderId: shop.orderId,
        changeRequestId: change.changeId,
        now,
        expectedOrderRevision: revision.lock_version,
        expectedChangeRevision: change.paymentRequestId ? 2 : 1,
        ownerConfirmed,
      };
      const result = change.paymentRequestId
        ? await applyDifferenceSlotInTransaction(tx, { ...input, paymentRequestId: change.paymentRequestId })
        : await moveOrderSlotInTransaction(tx, input);
      if (result.kind !== "fixed" && result.kind !== "existing") return result;
      await raw.query(
        "INSERT INTO order_details SELECT(jsonb_populate_record(NULL::order_details,to_jsonb(d)||$3::jsonb)).* FROM order_details d WHERE d.shop_id=$1 AND d.order_id=$2 AND d.version=1",
        [
          shop.shopId,
          shop.orderId,
          JSON.stringify({
            id: newUuid(),
            version: 2,
            source: "change_request",
            change_request_id: change.changeId,
            amount: change.paymentRequestId ? 36000 : 35000,
            pickup_at: change.pickup.toISOString(),
          }),
        ],
      );
      await tx.run(
        "UPDATE orders SET version=2,pickup_at=$3,pickup_day=$4,amount=$5,lock_version=lock_version+1 WHERE shop_id=$1 AND id=$2",
        [shop.orderId, change.pickup, change.newDay, change.paymentRequestId ? 36000 : 35000],
      );
      await tx.run(
        "UPDATE change_requests SET status='applied',applied_version=2,applied_at=$3,lock_version=lock_version+1 WHERE shop_id=$1 AND id=$2",
        [change.changeId, now],
      );
      return result;
    });
  }
  it("차액 결제 확인 뒤 옛 자리를 풀고 새 잡힌 자리만 확정함", async () => {
    const change = await differenceDate();
    expect(
      (await holdOrderSlot(scope(), { orderId: shop.orderId, paymentRequestId: change.paymentRequestId, now })).kind,
    ).toBe("held");
    await isolated.db.transaction(async (tx) => {
      await tx.query(
        "UPDATE payment_requests SET status='paid',paid_at=$2,arrived_amount=amount,arrived_at=$2,version=version+1 WHERE id=$1",
        [change.paymentRequestId, now],
      );
      await tx.query(
        "INSERT INTO payments(shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES($1,$2,$3,1000,$4)",
        [shop.shopId, shop.orderId, change.paymentRequestId, now],
      );
    });
    expect((await moveDate(change)).kind).toBe("fixed");
    expect(
      (
        await isolated.db.query(
          "SELECT day::text,status,release_reason FROM slot_holds WHERE shop_id=$1 ORDER BY day",
          [shop.shopId],
        )
      ).rows,
    ).toEqual([
      { day, status: "released", release_reason: "date_changed" },
      { day: change.newDay, status: "fixed", release_reason: null },
    ]);
    expect(
      (await isolated.db.query("SELECT version,amount,pickup_day::text FROM orders WHERE id=$1", [shop.orderId])).rows,
    ).toEqual([{ version: 2, amount: 36000, pickup_day: change.newDay }]);
  });
  it("자리 이동 뒤 주문 내용 저장이 실패하면 옛 자리를 되살리고 새 자리를 없앰", async () => {
    await held();
    await markPaid();
    await fixPaidOrderSlot(scope(), { ...shop, now });
    const change = await changedDate();
    await expect(
      scope().transaction(async (tx) => {
        expect(
          (await moveOrderSlotInTransaction(tx, { orderId: shop.orderId, changeRequestId: change.changeId, now })).kind,
        ).toBe("fixed");
        throw new Error("synthetic details failure");
      }),
    ).rejects.toThrow("synthetic details failure");
    expect(
      (await isolated.db.query("SELECT day::text,status FROM slot_holds WHERE shop_id=$1", [shop.shopId])).rows,
    ).toEqual([{ day, status: "fixed" }]);
    expect((await isolated.db.query("SELECT version FROM orders WHERE id=$1", [shop.orderId])).rows).toEqual([
      { version: 1 },
    ]);
  });
  it("차액 없는 날짜 변경은 옛날을 풀고 새날에 확정 자리를 만듦", async () => {
    await held();
    await markPaid();
    await fixPaidOrderSlot(scope(), { ...shop, now });
    const change = await changedDate();
    expect((await moveDate(change)).kind).toBe("fixed");
    expect(
      (
        await isolated.db.query(
          "SELECT day::text,status,release_reason FROM slot_holds WHERE shop_id=$1 ORDER BY day",
          [shop.shopId],
        )
      ).rows,
    ).toEqual([
      { day, status: "released", release_reason: "date_changed" },
      { day: change.newDay, status: "fixed", release_reason: null },
    ]);
    expect(
      (await isolated.db.query("SELECT count(*)::int AS n FROM payment_requests WHERE shop_id=$1", [shop.shopId])).rows,
    ).toEqual([{ n: 1 }]);
  });
  it("휴무일 날짜 변경은 확인 전 쓰기0건이고 확인 뒤 추가 수락", async () => {
    await held();
    await markPaid();
    await fixPaidOrderSlot(scope(), { ...shop, now });
    const change = await changedDate();
    await isolated.db.query("INSERT INTO calendar_days(shop_id,day,closed) VALUES($1,$2,true)", [
      shop.shopId,
      change.newDay,
    ]);
    expect((await moveDate(change)).kind).toBe("confirmation_required");
    expect((await isolated.db.query("SELECT status FROM slot_holds WHERE shop_id=$1", [shop.shopId])).rows).toEqual([
      { status: "fixed" },
    ]);
    expect((await moveDate(change, true)).kind).toBe("fixed");
    expect(
      (await isolated.db.query("SELECT overbooked FROM slot_holds WHERE shop_id=$1 AND status='fixed'", [shop.shopId]))
        .rows,
    ).toEqual([{ overbooked: true }]);
  });
  async function remake() {
    const orderId = newUuid(),
      newDay = shiftDate(day, 1),
      pickup = shopLocalToUtc(newDay, "15:00", "Asia/Seoul");
    await isolated.db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO orders SELECT(jsonb_populate_record(NULL::orders,to_jsonb(o)||$2::jsonb)).* FROM orders o WHERE o.id=$1",
        [
          shop.orderId,
          JSON.stringify({
            id: orderId,
            order_no: orderId.replaceAll("-", "").slice(0, 8).toUpperCase(),
            draft_id: null,
            remake_of_order_id: shop.orderId,
            status: "confirmed",
            confirmed_at: now.toISOString(),
            confirmed_payment_id: null,
            amount: 0,
            pickup_day: newDay,
            pickup_at: pickup.toISOString(),
          }),
        ],
      );
      await tx.query(
        "INSERT INTO order_details SELECT(jsonb_populate_record(NULL::order_details,to_jsonb(d)||$2::jsonb)).* FROM order_details d WHERE d.order_id=$1 AND d.version=1",
        [
          shop.orderId,
          JSON.stringify({
            id: newUuid(),
            order_id: orderId,
            source: "remake",
            quote_id: null,
            amount: 0,
            pickup_at: pickup.toISOString(),
          }),
        ],
      );
    });
    return { orderId, newDay };
  }
  it("재제작은 새날의 확정 자리만 한 번 만들고 결제 안내를 만들지 않음", async () => {
    const order = await remake();
    const input = { orderId: order.orderId, now };
    const result = await reserveRemakeSlot(scope(), input);
    expect(result.kind).toBe("fixed");
    expect((await reserveRemakeSlot(scope(), input)).holdId).toBe(result.holdId);
    expect(
      (
        await isolated.db.query(
          "SELECT day::text,status,payment_request_id,hold_key FROM slot_holds WHERE shop_id=$1",
          [shop.shopId],
        )
      ).rows,
    ).toEqual([
      { day: order.newDay, status: "fixed", payment_request_id: null, hold_key: `hold:${order.orderId}:remake` },
    ]);
    expect(
      (await isolated.db.query("SELECT count(*)::int AS n FROM payment_requests WHERE order_id=$1", [order.orderId]))
        .rows,
    ).toEqual([{ n: 0 }]);
  });
  it("휴무일 재제작도 실제 사장님의 명시 확인 뒤에만 추가 수락", async () => {
    const order = await remake();
    await isolated.db.query("INSERT INTO calendar_days(shop_id,day,closed) VALUES($1,$2,true)", [
      shop.shopId,
      order.newDay,
    ]);
    const input = { orderId: order.orderId, now, expectedOrderRevision: 1 };
    expect((await reserveRemakeSlot(scope(), { ...input, ownerConfirmed: true })).kind).toBe("day_full");
    expect((await reserveRemakeSlot(scope(isolated.db, true), input)).kind).toBe("confirmation_required");
    expect((await reserveRemakeSlot(scope(isolated.db, true), { ...input, ownerConfirmed: true })).kind).toBe("fixed");
    expect((await isolated.db.query("SELECT overbooked FROM slot_holds WHERE shop_id=$1", [shop.shopId])).rows).toEqual(
      [{ overbooked: true }],
    );
  });
  async function dayApproval(expires = new Date(now.getTime() + 86400000)) {
    return (
      await isolated.db.query<{ id: string }>(
        "INSERT INTO handoffs(shop_id,consultation_id,source_message_id,reason,requested_day,status,day_decision,day_accept_expires_at,answered_at) VALUES($1,$2,$3,'closed_day',$4,'answered','accepted',$5,$6) RETURNING id",
        [shop.shopId, shop.consultationId, shop.messageId, day, expires, now],
      )
    ).rows[0]?.id;
  }
  it("같은 상담·날짜의 저장된 추가 수락은 두 주문 중 하나만 사용함", async () => {
    const next = await sibling();
    await isolated.db.query("UPDATE calendar_days SET closed=true WHERE shop_id=$1 AND day=$2", [shop.shopId, day]);
    const approval = await dayApproval();
    const a = isolated.connect(),
      b = isolated.connect();
    try {
      const results = await Promise.all(
        [a, b].map((db, i) => holdOrderSlot(scope(db), { ...(i === 0 ? shop : next), now })),
      );
      expect(results.map((x) => x.kind).sort()).toEqual(["day_full", "held"]);
      const saved = (await isolated.db.query("SELECT day_used_order_id FROM handoffs WHERE id=$1", [approval])).rows[0];
      expect([shop.orderId, next.orderId]).toContain(saved?.day_used_order_id);
      expect(
        (await isolated.db.query("SELECT overbooked FROM slot_holds WHERE shop_id=$1", [shop.shopId])).rows,
      ).toEqual([{ overbooked: true }]);
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  });
  it("기한 지난 추가 수락은 손님 값으로 되살리지 못함", async () => {
    await isolated.db.query("UPDATE calendar_days SET closed=true WHERE shop_id=$1 AND day=$2", [shop.shopId, day]);
    await dayApproval(now);
    expect((await holdOrderSlot(scope(), { ...shop, now, ownerConfirmed: true })).kind).toBe("day_full");
    expect(
      (await isolated.db.query("SELECT day_used_order_id FROM handoffs WHERE shop_id=$1", [shop.shopId])).rows,
    ).toEqual([{ day_used_order_id: null }]);
  });
  it("확정된 결제의 잡힌 자리를 한 번만 확정하며 개수를 유지함", async () => {
    await held();
    expect((await fixPaidOrderSlot(scope(), { ...shop, now })).kind).toBe("not_applicable");
    await markPaid();
    const result = await fixPaidOrderSlot(scope(), { ...shop, now });
    expect(result.kind).toBe("fixed");
    expect((await fixPaidOrderSlot(scope(), { ...shop, now })).kind).toBe("unchanged");
    expect(
      (await isolated.db.query("SELECT status,fixed_at FROM slot_holds WHERE shop_id=$1", [shop.shopId])).rows,
    ).toEqual([{ status: "fixed", fixed_at: now }]);
  });
  it("픽업 일시가 지나 종료된 자리도 하루 최대 개수에 포함함", async () => {
    const orders: Order[] = [shop, await sibling(), await sibling(), await sibling()];
    await isolated.db.query("UPDATE business_calendars SET daily_capacity=3 WHERE shop_id=$1", [shop.shopId]);
    for (const order of orders.slice(0, 3)) {
      expect((await holdOrderSlot(scope(), { ...order, now })).kind).toBe("held");
      await markPaid(order);
      expect((await fixPaidOrderSlot(scope(), { ...order, now })).kind).toBe("fixed");
    }
    expect((await finishOrderSlot(scope(), { orderId: shop.orderId, now })).kind).toBe("not_applicable");
    const at = shopLocalToUtc(day, "15:00", "Asia/Seoul");
    expect((await finishOrderSlot(scope(), { orderId: shop.orderId, now: at })).kind).toBe("done");
    expect((await finishOrderSlot(scope(), { orderId: shop.orderId, now: at })).kind).toBe("unchanged");
    const next = orders[3] as Order;
    expect((await holdOrderSlot(scope(), { ...next, now })).kind).toBe("day_full");
    expect(
      (
        await isolated.db.query(
          "SELECT status,count(*)::int AS n FROM slot_holds WHERE shop_id=$1 GROUP BY status ORDER BY status",
          [shop.shopId],
        )
      ).rows,
    ).toEqual([
      { status: "done", n: 1 },
      { status: "fixed", n: 2 },
    ]);
  });
  it("취소되지 않은 주문의 자리는 풀지 않고 취소 뒤 한 번만 해제함", async () => {
    await held();
    expect((await releaseCancelledOrderSlots(scope(), { orderId: shop.orderId, now })).kind).toBe("not_applicable");
    await isolated.db.query(
      "UPDATE orders SET status='cancelled',cancelled_at=$2,cancel_kind='customer',lock_version=lock_version+1 WHERE id=$1",
      [shop.orderId, now],
    );
    expect((await releaseCancelledOrderSlots(scope(), { orderId: shop.orderId, now })).kind).toBe("released");
    expect((await releaseCancelledOrderSlots(scope(), { orderId: shop.orderId, now })).kind).toBe("unchanged");
    expect(
      (await isolated.db.query("SELECT status,release_reason FROM slot_holds WHERE shop_id=$1", [shop.shopId])).rows,
    ).toEqual([{ status: "released", release_reason: "order_cancelled" }]);
  });
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
    const cutoff = shopLocalToUtc(shiftDate(day, -1), "18:00", "Asia/Seoul");
    await isolated.db.query(
      "UPDATE business_calendars SET order_cutoff_days=1,order_cutoff_time='18:00' WHERE shop_id=$1",
      [shop.shopId],
    );
    await isolated.db.query(
      "UPDATE payment_requests SET status='claimed',claimed_at=$2,due_cap_at=$3,version=version+1 WHERE id=$1",
      [shop.paymentRequestId, new Date(now.getTime() + 60000), cutoff],
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
    expect(cap.due_cap_at).toEqual(cutoff);
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
