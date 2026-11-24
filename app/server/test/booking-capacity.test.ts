import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import {
  assessPickupDay,
  closedDayNoticeTrace,
  recordClosedPickupDayInTransaction,
  requestClosedPickupDay,
} from "../src/booking-capacity";
import { eventKeys } from "../src/event-keys";
import { recordKakaoHandoff } from "../src/kakao-handoff";
import { createShopScope, shopDb, shopRequestDb } from "../src/shop-scope";
import { describeDb, newUuid } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-18T00:00:00Z"),
  DAY = "2026-11-22";
describeDb("날짜 판정·가까운 날과 마감 질문(TASK-068)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, shop: ShopFixture;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
  }, 30000);
  beforeEach(async () => {
    shop = await createShop(isolated.db, "합성 날짜 가게");
    await issueTestBookingLink(isolated.db, shop);
    await isolated.db.query(
      "UPDATE business_calendars SET closed_weekdays='{}',daily_capacity=1,order_cutoff_days=0,order_cutoff_time='23:59' WHERE shop_id=$1",
      [shop.shopId],
    );
  });
  afterAll(async () => {
    await isolated?.close();
  });
  const scoped = () => shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }), isolated.db);
  const ask = (day: string, now = NOW) => assessPickupDay(scoped(), day, now);
  async function fullDay() {
    await isolated.db.transaction(async (tx) => {
      await tx.query(
        "UPDATE orders SET pickup_day=$2::date,pickup_at=$2::date+time '06:00' AT TIME ZONE 'UTC' WHERE id=$1",
        [shop.orderId, DAY],
      );
      await tx.query("UPDATE order_details SET pickup_at=$2::date+time '06:00' AT TIME ZONE 'UTC' WHERE order_id=$1", [
        shop.orderId,
        DAY,
      ]);
      await tx.query("INSERT INTO calendar_days (shop_id,day) VALUES ($1,$2::date)", [shop.shopId, DAY]);
      await tx.query(
        "INSERT INTO slot_holds (shop_id,day,order_id,payment_request_id,hold_key,status) VALUES ($1,$2::date,$3,$4,$5,'held')",
        [shop.shopId, DAY, shop.orderId, shop.paymentRequestId, eventKeys.hold(shop.orderId, shop.paymentRequestId)],
      );
    });
  }
  async function notice(delivered = false, sourceMessageId = shop.messageId) {
    const id = newUuid();
    await isolated.db.query(
      "INSERT INTO messages (id,shop_id,consultation_id,direction,author,kind,trace_id,body_masked,delivery,sent_at,created_at) VALUES ($1,$2,$3,'outbound','system','text',$4,'그날은 마감됐어요.',$5,$6,$7)",
      [
        id,
        shop.shopId,
        shop.consultationId,
        closedDayNoticeTrace(sourceMessageId, DAY),
        delivered ? "callback" : "deferred",
        delivered ? NOW : null,
        NOW,
      ],
    );
    return id;
  }
  const request = (noticeMessageId: string, insist = true) =>
    requestClosedPickupDay(scoped(), {
      consultationId: shop.consultationId,
      sourceMessageId: shop.messageId,
      day: DAY,
      noticeMessageId,
      insist,
      now: NOW,
    });
  async function twice(input: Parameters<typeof requestClosedPickupDay>[1]) {
    const connections = [isolated.connect(), isolated.connect()];
    try {
      const results = await Promise.allSettled(
        connections.map((connection) =>
          requestClosedPickupDay(
            shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }), connection),
            input,
          ),
        ),
      );
      return results.map((result) => {
        if (result.status === "rejected") throw result.reason;
        return result.value;
      });
    } finally {
      await Promise.all(connections.map((connection) => connection.close()));
    }
  }
  it("휴무20일에는19/21일을 포함해 가까운 세 날만 권하고 자리/질문을 만들지 않는다", async () => {
    await isolated.db.query("INSERT INTO calendar_days (shop_id,day,closed) VALUES ($1,'2026-11-20',true)", [
      shop.shopId,
    ]);
    const result = await ask("2026-11-20");
    expect(result).toMatchObject({ day: "2026-11-20", status: "day_off" });
    expect(result.alternatives).toEqual(["2026-11-19", "2026-11-21", "2026-11-18"]);
    expect((await isolated.db.query("SELECT id FROM slot_holds WHERE shop_id=$1", [shop.shopId])).rows).toHaveLength(0);
    expect((await isolated.db.query("SELECT id FROM handoffs WHERE shop_id=$1", [shop.shopId])).rows).toHaveLength(0);
  });
  it("다 찬 날을 원해도 새 자리를 잡지 않고 안내 전달 뒤에만 사장님 할 일/알림을 만든다", async () => {
    await fullDay();
    const id = await notice();
    expect(await request(id)).toMatchObject({ kind: "waiting_for_notice", availability: { status: "closed" } });
    expect((await isolated.db.query("SELECT id FROM owner_tasks WHERE shop_id=$1", [shop.shopId])).rows).toHaveLength(
      0,
    );
    await isolated.db.query("UPDATE messages SET delivery='callback',sent_at=$2 WHERE id=$1", [id, NOW]);
    const result = await request(id);
    expect(result).toMatchObject({ kind: "handed_off", availability: { status: "closed" } });
    const handoffs = (
      await isolated.db.query("SELECT reason,requested_day::text FROM handoffs WHERE shop_id=$1", [shop.shopId])
    ).rows;
    expect(handoffs).toEqual([{ reason: "closed_day", requested_day: DAY }]);
    expect((await isolated.db.query("SELECT id FROM slot_holds WHERE shop_id=$1", [shop.shopId])).rows).toHaveLength(1);
    expect(
      (await isolated.db.query("SELECT kind,wait_status FROM owner_tasks WHERE shop_id=$1", [shop.shopId])).rows,
    ).toEqual([{ kind: "handoff", wait_status: "waiting" }]);
    expect((await isolated.db.query("SELECT kind FROM owner_alerts WHERE shop_id=$1", [shop.shopId])).rows).toEqual([
      { kind: "new_task" },
    ]);
    expect(await request(id)).toEqual(result);
    expect((await isolated.db.query("SELECT id FROM owner_alerts WHERE shop_id=$1", [shop.shopId])).rows).toHaveLength(
      1,
    );
  });
  it("마감된 날이어도 손님이 다시 원하지 않으면 넘기지 않는다", async () => {
    await fullDay();
    expect(await request(await notice(true), false)).toMatchObject({ kind: "not_requested" });
    expect((await isolated.db.query("SELECT id FROM handoffs WHERE shop_id=$1", [shop.shopId])).rows).toHaveLength(0);
  });
  it.each([
    ["2026-11-17", ["2026-11-18", "2026-11-19", "2026-11-20"]],
    ["2027-01-17", ["2027-01-16", "2027-01-15", "2027-01-14"]],
  ] as const)("기간 밖 날짜는 받지 않고 14일 안의 유효한 대안만 낸다(%s)", async (day, alternatives) => {
    expect(await ask(day)).toMatchObject({ status: "outside_window", alternatives });
  });
  it("가까운 날이 없으면 빈 목록과 사장님 확인을 요청할 수 있다는 안내를 낸다", async () => {
    await isolated.db.query("UPDATE business_calendars SET closed_weekdays=ARRAY[1,2,3,4,5,6,7] WHERE shop_id=$1", [
      shop.shopId,
    ]);
    const result = await ask("2026-11-20");
    expect(result.alternatives).toEqual([]);
    expect(result.message).toContain("가까운 날에 자리가 없어요");
    expect(Object.keys(result).sort()).toEqual(["alternatives", "day", "message", "status"]);
  });
  it("가게 시간대의 마감 시각 바로 전은 열리고 정각은 마감이다", async () => {
    await isolated.db.query(
      "UPDATE business_calendars SET order_cutoff_days=2,order_cutoff_time='09:00' WHERE shop_id=$1",
      [shop.shopId],
    );
    expect(await ask("2026-11-20", new Date(NOW.getTime() - 1))).toMatchObject({ status: "open" });
    expect(await ask("2026-11-20", NOW)).toMatchObject({ status: "closed" });
  });
  it("다른 가게의 상담/메시지로는 요청하지 못한다", async () => {
    const other = await createShop(isolated.db, "다른 날짜 가게");
    await fullDay();
    await expect(
      requestClosedPickupDay(scoped(), {
        consultationId: other.consultationId,
        sourceMessageId: other.messageId,
        day: DAY,
        noticeMessageId: await notice(true),
        insist: true,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("휴무일은 다시 원해도 질문이나 새 자리를 만들지 않는다", async () => {
    await isolated.db.query("INSERT INTO calendar_days(shop_id,day,closed) VALUES($1,$2::date,true)", [
      shop.shopId,
      DAY,
    ]);
    expect(await request(await notice(true))).toMatchObject({
      kind: "not_requested",
      availability: { status: "day_off" },
    });
    expect((await isolated.db.query("SELECT id FROM handoffs WHERE shop_id=$1", [shop.shopId])).rows).toHaveLength(0);
  });

  it("동시 중복과 같은 날짜의 추가 질문은 열린 질문과 할 일을 한 건만 만든다", async () => {
    await fullDay();
    const id = await notice(true);
    const duplicate = await twice({
      consultationId: shop.consultationId,
      sourceMessageId: shop.messageId,
      day: DAY,
      noticeMessageId: id,
      insist: true,
      now: NOW,
    });
    expect(duplicate[0]).toEqual(duplicate[1]);
    const sourceId = newUuid();
    await isolated.db.query(
      "INSERT INTO messages(id,shop_id,consultation_id,direction,author,kind,kakao_message_id,body_masked,created_at) VALUES($1,$2,$3,'inbound','customer','text',$4,'그날 꼭 부탁드려요',$5)",
      [sourceId, shop.shopId, shop.consultationId, `synthetic-repeat:${sourceId}`, NOW],
    );
    const extraNotice = await notice(true, sourceId);
    const input = {
      consultationId: shop.consultationId,
      sourceMessageId: sourceId,
      day: DAY,
      noticeMessageId: extraNotice,
      insist: true,
      now: NOW,
    };
    const results = await twice(input);
    expect(results[0]?.handoffId).toBe(duplicate[0]?.handoffId);
    expect(results[1]).toEqual(results[0]);
    expect((await isolated.db.query("SELECT id FROM handoffs WHERE shop_id=$1", [shop.shopId])).rows).toHaveLength(1);
    expect((await isolated.db.query("SELECT id FROM owner_tasks WHERE shop_id=$1", [shop.shopId])).rows).toHaveLength(
      1,
    );
    expect(
      (await isolated.db.query("SELECT message_id FROM handoff_questions WHERE shop_id=$1", [shop.shopId])).rows,
    ).toHaveLength(0);
    expect(
      (await isolated.db.query("SELECT kind FROM owner_alerts WHERE shop_id=$1 ORDER BY kind", [shop.shopId])).rows,
    ).toEqual([{ kind: "new_task" }]);
  });

  it("다른 수신 글에 묶인 안내를 전달 증거로 쓰지 못한다", async () => {
    await fullDay();
    const id = await notice(true);
    await isolated.db.query("UPDATE messages SET trace_id=$2 WHERE id=$1", [id, closedDayNoticeTrace(newUuid(), DAY)]);
    await expect(request(id)).rejects.toMatchObject({ code: "not_found" });
    expect((await isolated.db.query("SELECT id FROM handoffs WHERE shop_id=$1", [shop.shopId])).rows).toHaveLength(0);
  });
  it("15일 뒤만 가능하면 14일 밖 날짜를 권하지 않는다", async () => {
    await isolated.db.query(
      "INSERT INTO calendar_days(shop_id,day,closed) SELECT $1,d::date,true FROM generate_series('2026-11-18'::date,'2026-12-06'::date,'1 day'::interval) d",
      [shop.shopId],
    );
    expect(await ask("2026-12-07")).toMatchObject({ status: "open" });
    expect(await ask(DAY)).toMatchObject({ status: "day_off", alternatives: [] });
  });
  it("끝난 상담도 쓰기 없는 판정은 허용하되 새 확인 건을 요청하면 거절한다", async () => {
    await fullDay();
    await isolated.db.query("UPDATE consultations SET status='ended',ended_at=$2 WHERE id=$1", [
      shop.consultationId,
      NOW,
    ]);
    expect(await request(newUuid(), false)).toMatchObject({
      kind: "not_requested",
      availability: { status: "closed" },
    });
    await expect(request(newUuid(), true)).rejects.toMatchObject({ code: "not_found" });
    expect((await isolated.db.query("SELECT id FROM handoffs WHERE shop_id=$1", [shop.shopId])).rows).toHaveLength(0);
  });
  it("이미 기록한 결과는 상담이 끝난 뒤에도 첫 결과를 반환하고 새 건은 만들지 않는다", async () => {
    await fullDay();
    const id = await notice(true),
      first = await request(id);
    await isolated.db.query("UPDATE consultations SET status='ended',ended_at=$2 WHERE id=$1", [
      shop.consultationId,
      NOW,
    ]);
    expect(await request(id, false)).toEqual(first);
    expect(await request(id, true)).toEqual(first);
    expect((await isolated.db.query("SELECT id FROM handoffs WHERE shop_id=$1", [shop.shopId])).rows).toHaveLength(1);
  });
  it.each([
    [DAY, "day_off", "그날은 휴무예요."],
    ["2027-03-01", "outside_window", "오늘부터 60일 안의 날짜를 골라 주세요."],
  ])("%s의 대안이 없으면 다른 날짜를 묻고 사장님 확인을 제안하지 않는다", async (day, status, text) => {
    await isolated.db.query(
      "INSERT INTO calendar_days(shop_id,day,closed) SELECT $1,d::date,true FROM generate_series('2026-11-18'::date,'2026-11-18'::date+59,'1 day'::interval) d ON CONFLICT(shop_id,day) DO UPDATE SET closed=true",
      [shop.shopId],
    );
    expect(await ask(day)).toEqual({
      day,
      status,
      alternatives: [],
      message: `${text} 가까운 날에 자리가 없어요. 다른 날짜를 말씀해 주세요.`,
    });
    expect(
      await requestClosedPickupDay(scoped(), {
        consultationId: shop.consultationId,
        sourceMessageId: shop.messageId,
        day,
        noticeMessageId: newUuid(),
        insist: true,
        now: NOW,
      }),
    ).toMatchObject({ kind: "not_requested" });
    expect((await isolated.db.query("SELECT id FROM handoffs WHERE shop_id=$1", [shop.shopId])).rows).toHaveLength(0);
  });

  it("이미 넘긴 같은 요청은 날짜가 다시 열리거나 기간 밖이 되어도 첫 결과를 반환한다", async () => {
    await fullDay();
    const id = await notice(true),
      first = await request(id);
    await isolated.db.query("DELETE FROM slot_holds WHERE shop_id=$1", [shop.shopId]);
    expect(await ask(DAY)).toMatchObject({ status: "open" });
    expect(await request(id)).toEqual(first);
    expect(
      await requestClosedPickupDay(scoped(), {
        consultationId: shop.consultationId,
        sourceMessageId: shop.messageId,
        day: DAY,
        noticeMessageId: id,
        insist: true,
        now: new Date("2027-01-01T00:00:00Z"),
      }),
    ).toEqual(first);
  });

  it("같은 열린 날짜 건을 재사용한 새 수신 글도 건이 닫힌 뒤 재처리하면 새 건을 만들지 않는다", async () => {
    await fullDay();
    const first = await request(await notice(true)),
      sourceId = newUuid();
    await isolated.db.query(
      "INSERT INTO calendar_days(shop_id,day,closed) SELECT $1,d::date,d::date<>$2::date FROM generate_series('2026-11-18'::date,'2026-11-18'::date+59,'1 day'::interval) d ON CONFLICT(shop_id,day) DO UPDATE SET closed=EXCLUDED.closed",
      [shop.shopId, DAY],
    );
    await isolated.db.query(
      "INSERT INTO messages(id,shop_id,consultation_id,direction,author,kind,kakao_message_id,body_masked,created_at) VALUES($1,$2,$3,'inbound','customer','text',$4,'같은 날짜 합성 재요청',$5)",
      [sourceId, shop.shopId, shop.consultationId, `synthetic-closed:${sourceId}`, NOW],
    );
    const input = {
      consultationId: shop.consultationId,
      sourceMessageId: sourceId,
      day: DAY,
      noticeMessageId: await notice(true, sourceId),
      insist: true,
      now: NOW,
    };
    const reused = await requestClosedPickupDay(scoped(), input);
    expect(reused.handoffId).toBe(first.handoffId);
    expect(reused.availability).toEqual(first.availability);
    await isolated.db.transaction((tx) =>
      recordKakaoHandoff(
        shopDb(createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }), tx),
        shop.consultationId,
        sourceId,
        "callback_timeout",
        NOW,
      ),
    );
    expect((await isolated.db.query("SELECT id FROM handoffs WHERE shop_id=$1", [shop.shopId])).rows).toHaveLength(1);
    await isolated.db.query("UPDATE handoffs SET status='closed_no_answer',closed_at=$2 WHERE id=$1", [
      first.handoffId,
      NOW,
    ]);
    await isolated.db.query("UPDATE owner_tasks SET wait_status='closed_no_answer',closed_at=$2 WHERE handoff_id=$1", [
      first.handoffId,
      NOW,
    ]);
    expect(await requestClosedPickupDay(scoped(), input)).toEqual(reused);
    expect((await isolated.db.query("SELECT id FROM handoffs WHERE shop_id=$1", [shop.shopId])).rows).toHaveLength(1);
    expect((await isolated.db.query("SELECT id FROM owner_alerts WHERE shop_id=$1", [shop.shopId])).rows).toHaveLength(
      1,
    );
  });
  it("같은 글이 옛 일반 건과 같은 날짜 마감 건에 함께 묶였으면 마감 건을 먼저 반환한다", async () => {
    await fullDay();
    const first = await request(await notice(true)),
      source = newUuid();
    await isolated.db.query(
      "INSERT INTO messages(id,shop_id,consultation_id,direction,author,kind,kakao_message_id,body_masked) VALUES($1,$2,$3,'inbound','customer','text',$4,'이전 중복 연결 합성 글')",
      [source, shop.shopId, shop.consultationId, `synthetic-legacy:${source}`],
    );
    await isolated.db.query(
      "UPDATE owner_tasks SET detail=jsonb_set(detail,'{closedDaySourceIds}',coalesce(detail->'closedDaySourceIds','[]'::jsonb)||jsonb_build_array($3::text)) WHERE shop_id=$1 AND handoff_id=$2",
      [shop.shopId, first.handoffId, source],
    );
    await isolated.db.query(
      "INSERT INTO handoffs(shop_id,consultation_id,source_message_id,reason,created_at) VALUES($1,$2,$3,'cannot_answer',$4)",
      [shop.shopId, shop.consultationId, source, new Date(NOW.getTime() - 1000)],
    );
    expect(
      await requestClosedPickupDay(scoped(), {
        consultationId: shop.consultationId,
        sourceMessageId: source,
        day: DAY,
        noticeMessageId: newUuid(),
        insist: true,
        now: NOW,
      }),
    ).toMatchObject({ kind: "handed_off", handoffId: first.handoffId });
    expect((await isolated.db.query("SELECT id FROM handoffs WHERE shop_id=$1", [shop.shopId])).rows).toHaveLength(2);
  });

  it("다른 사유로 이미 넘긴 수신 글은 결과로 알리고 같은 트랜잭션의 안내 전달 표시를 되돌리지 않는다", async () => {
    await fullDay();
    const id = await notice();
    await isolated.db.query(
      "INSERT INTO handoffs(shop_id,consultation_id,source_message_id,reason) VALUES($1,$2,$3,'cannot_answer')",
      [shop.shopId, shop.consultationId, shop.messageId],
    );
    const result = await scoped().transaction(async (tx) => {
      await tx.run("UPDATE messages SET delivery='callback',sent_at=$3 WHERE shop_id=$1 AND id=$2", [id, NOW]);
      return recordClosedPickupDayInTransaction(tx, {
        consultationId: shop.consultationId,
        sourceMessageId: shop.messageId,
        day: DAY,
        noticeMessageId: id,
        insist: true,
        now: NOW,
      });
    });
    expect(result.kind).toBe("already_handed_off");
    expect((await isolated.db.query("SELECT delivery FROM messages WHERE id=$1", [id])).rows).toEqual([
      { delivery: "callback" },
    ]);
  });

  it("재요청하지 않는 조회는 다른 연결의 손님 잠금을 기다리지 않는다", async () => {
    await fullDay();
    const id = await notice(true),
      holder = isolated.connect(),
      reader = isolated.connect();
    try {
      await holder.transaction(async (held) => {
        await held.query("SELECT id FROM customers WHERE id=$1 FOR UPDATE", [shop.customerId]);
        const result = await reader.transaction(async (raw) => {
          await raw.query("SET LOCAL lock_timeout='250ms'");
          return recordClosedPickupDayInTransaction(
            shopDb(createShopScope(shop.shopId, { kind: "job", job: "kakao_callback" }), raw),
            {
              consultationId: shop.consultationId,
              sourceMessageId: shop.messageId,
              day: DAY,
              noticeMessageId: id,
              insist: false,
              now: NOW,
            },
          );
        });
        expect(result.kind).toBe("not_requested");
      });
    } finally {
      await Promise.all([holder.close(), reader.close()]);
    }
  });
});
