import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { closeIdleConsultation } from "../src/consultation-idle";
import type { RequestDb } from "../src/db";
import { DUE_SOURCES } from "../src/due-sources";
import { runDueJobs } from "../src/job-runner";
import { runnableJobs } from "../src/jobs";
import { receiveKakaoMessage } from "../src/kakao-skill-store";
import { quoteDraft } from "../src/quotes";
import { Secret } from "../src/settings";
import { createShopScope, shopDb, shopRequestDb } from "../src/shop-scope";
import { scopeViolations } from "../src/sql-scope";
import { describeDb, newUuid, TEST_HASH_KEY, testDb } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, issueTestBookingLink, linkTestChannel, type ShopFixture } from "./support/shops";

const NOW = new Date("2026-11-24T06:00:00Z"),
  HOUR = 3600000;
function latch() {
  let release!: () => void, fail!: (error: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  return { promise, release, fail };
}
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("필요한 합성 시험 행이 없어요");
  return value;
}
describeDb("문의 끊김과 상담 끝남(TASK-076, SPEC-025)", () => {
  let isolated: Awaited<ReturnType<typeof isolatedTestDb>>, db: RequestDb, shop: ShopFixture;
  let customerId: string, consultationId: string, draftId: string;
  const runtimeRole = `idle076_${newUuid().replaceAll("-", "")}`;
  beforeAll(async () => {
    isolated = await isolatedTestDb();
    db = isolated.db;
    await db.query(`CREATE ROLE "${runtimeRole}" NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await db.query(
      readFileSync(new URL("../../../tools/staging-login-callback-grants.sql", import.meta.url), "utf8").replaceAll(
        ':"runtime_role"',
        `"${runtimeRole}"`,
      ),
    );
  }, 30000);
  afterAll(async () => {
    await isolated?.close();
    const admin = testDb();
    try {
      await admin.query(`DROP ROLE IF EXISTS "${runtimeRole}"`);
    } finally {
      await admin.close();
    }
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
  async function receivedOrder(status: "received" | "no_pickup" = "received") {
    await useOrderConsultation();
    const payment = newUuid();
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE payment_requests SET status='paid',arrived_amount=amount,arrived_at=$2,paid_at=$2 WHERE id=$1",
        [shop.paymentRequestId, NOW],
      );
      await tx.query(
        "INSERT INTO payments(id,shop_id,order_id,payment_request_id,amount,confirmed_at) VALUES($1,$2,$3,$4,35000,$5)",
        [payment, shop.shopId, shop.orderId, shop.paymentRequestId, NOW],
      );
      await tx.query("UPDATE orders SET status=$2,confirmed_at=$3,confirmed_payment_id=$4 WHERE id=$1", [
        shop.orderId,
        status,
        NOW,
        payment,
      ]);
      await tx.query(
        "INSERT INTO productions(shop_id,order_id,completed_at,handed_over_at,handover_kind,no_pickup_at) VALUES($1,$2,$3,$4,$5,$6)",
        [
          shop.shopId,
          shop.orderId,
          NOW,
          status === "received" ? NOW : null,
          status === "received" ? "pickup" : null,
          status === "no_pickup" ? NOW : null,
        ],
      );
    });
  }
  it.each(["received", "no_pickup", "rejected", "cancelled"] as const)(
    "열린 일이 없는 %s 주문 상담만 끝내며 주문 종료 시각을 대신 쓰지 않음",
    async (status) => {
      if (status === "received" || status === "no_pickup") await receivedOrder(status);
      else {
        await cancelledWithoutPayment();
        if (status === "rejected")
          await db.query(
            "UPDATE orders SET kind='custom',status='rejected',rejected_at=$2,cancelled_at=NULL,cancel_kind=NULL WHERE id=$1",
            [shop.orderId, NOW],
          );
      }
      await tick();
      expect((await state())?.status).toBe("ended");
      expect((await db.query("SELECT finished_at FROM orders WHERE id=$1", [shop.orderId])).rows).toEqual([
        { finished_at: null },
      ]);
    },
  );
  it.each(["dropped", "ended"] as const)(
    "최소 서버 역할도 상담을 %s으로 닫고 고지 없는 옛 AI 답만 실패로 남김",
    async (status) => {
      if (status === "ended") await receivedOrder();
      await db.query("UPDATE consultations SET ai_disclosed_at=NULL,ai_disclosed_policy_version=NULL WHERE id=$1", [
        consultationId,
      ]);
      const message = newUuid();
      await db.query(
        "INSERT INTO messages(id,shop_id,consultation_id,direction,author,kind,body_masked,delivery) VALUES($1,$2,$3,'outbound','ai','text','합성 미전달 AI 답','deferred')",
        [message, shop.shopId, consultationId],
      );
      await db.transaction(async (tx) => {
        await tx.query(`SET LOCAL ROLE "${runtimeRole}"`);
        await closeIdleConsultation(
          shopDb(createShopScope(shop.shopId, { kind: "job", job: "consultation_idle" }), tx),
          consultationId,
          NOW,
        );
      });
      expect((await state())?.status).toBe(status);
      expect((await db.query("SELECT delivery,body_masked FROM messages WHERE id=$1", [message])).rows).toEqual([
        { delivery: "failed", body_masked: "합성 미전달 AI 답" },
      ]);
    },
  );
  it.each([
    "SELECT description FROM issue_details LIMIT 1",
    "SELECT refund_account_enc FROM refunds LIMIT 1",
    "UPDATE issue_details SET description=NULL WHERE false",
  ])("상담 종료용 읽기 권한이 민감한 본문/계좌와 쓰기를 열지 않음(%s)", async (sql) => {
    await expect(
      db.transaction(async (tx) => {
        await tx.query(`SET LOCAL ROLE "${runtimeRole}"`);
        await tx.query(sql);
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it.each(["change_request", "issue_report", "refund"] as const)(
    "인도된 주문도 열린 %s 처리가 끝나기 전에는 상담을 끝내지 않음",
    async (kind) => {
      await receivedOrder();
      const task = await indirectTask(kind === "change_request" ? "change_request" : "issue_report");
      const subject = required(
        (
          await db.query<{ change_request_id: string; issue_report_id: string }>(
            "SELECT change_request_id,issue_report_id FROM owner_tasks WHERE id=$1",
            [task],
          )
        ).rows[0],
      );
      await db.query("UPDATE owner_tasks SET wait_status='answered',closed_at=$2 WHERE id=$1", [task, NOW]);
      let refund: string | undefined;
      if (kind === "change_request")
        await db.query("UPDATE change_requests SET status='requested',closed_at=NULL WHERE id=$1", [
          subject.change_request_id,
        ]);
      else if (kind === "issue_report")
        await db.query(
          "UPDATE issue_reports SET status='reported',compensation=NULL,decided_at=NULL,closed_at=NULL,problem_kind=NULL WHERE id=$1",
          [subject.issue_report_id],
        );
      else {
        refund = newUuid();
        await db.query("UPDATE issue_reports SET compensation='partial_refund' WHERE id=$1", [subject.issue_report_id]);
        await db.query(
          "INSERT INTO refunds(id,shop_id,order_id,cause,issue_report_id,event_key,decision,amount,calculated_amount,calc_basis) VALUES($1,$2,$3,'compensation',$4,$5,'partial',500,500,'{}')",
          [refund, shop.shopId, shop.orderId, subject.issue_report_id, `refund:${refund}`],
        );
      }
      await tick();
      expect((await state())?.status).toBe("ordered");
      if (kind === "change_request")
        await db.query("UPDATE change_requests SET status='closed_no_difference',closed_at=$2 WHERE id=$1", [
          subject.change_request_id,
          NOW,
        ]);
      else if (kind === "issue_report")
        await db.query(
          "UPDATE issue_reports SET status='closed',compensation='none',decided_at=$2,closed_at=$2,problem_kind='other' WHERE id=$1",
          [subject.issue_report_id, NOW],
        );
      else await db.query("UPDATE refunds SET method='bank_transfer',sent_at=$2 WHERE id=$1", [refund, NOW]);
      await tick();
      expect((await state())?.status).toBe("ended");
    },
  );
  it("다른 상담에서 만든 주문을 카드로 다뤄도 열린 재제작이 끝나야 상담을 닫음", async () => {
    await receivedOrder();
    const originalConsultation = consultationId,
      followup = newUuid(),
      remake = newUuid();
    await db.query("UPDATE consultations SET status='ended',ended_at=$2 WHERE id=$1", [originalConsultation, NOW]);
    await db.query("INSERT INTO consultations(id,shop_id,customer_id,last_customer_message_at) VALUES($1,$2,$3,$4)", [
      followup,
      shop.shopId,
      customerId,
      new Date(NOW.getTime() - 24 * HOUR),
    ]);
    consultationId = followup;
    await db.query(
      "INSERT INTO confirm_cards(shop_id,consultation_id,customer_id,card_key,kind,order_id,order_version,payload,expires_at) VALUES($1,$2,$3,$4,'cancel',$5,1,'{}',now()+interval '20 minutes')",
      [shop.shopId, followup, customerId, newUuid(), shop.orderId],
    );
    await db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO orders SELECT(jsonb_populate_record(NULL::orders,to_jsonb(o)||$2::jsonb)).* FROM orders o WHERE o.id=$1",
        [
          shop.orderId,
          JSON.stringify({
            id: remake,
            order_no: remake.replaceAll("-", "").slice(0, 8).toUpperCase(),
            draft_id: null,
            amount: 0,
            remake_of_order_id: shop.orderId,
            status: "confirmed",
            confirmed_payment_id: null,
            finished_at: null,
          }),
        ],
      );
      await tx.query(
        "INSERT INTO order_details SELECT(jsonb_populate_record(NULL::order_details,to_jsonb(d)||$2::jsonb)).* FROM order_details d WHERE d.order_id=$1 AND d.version=1",
        [
          shop.orderId,
          JSON.stringify({ id: newUuid(), order_id: remake, amount: 0, source: "remake", quote_id: null }),
        ],
      );
    });
    await tick();
    expect((await state())?.status).toBe("ordered");
    await db.transaction(async (tx) => {
      await tx.query("UPDATE orders SET status='received',finished_at=$2 WHERE id=$1", [remake, NOW]);
      await tx.query(
        "INSERT INTO productions(shop_id,order_id,completed_at,handed_over_at,handover_kind) VALUES($1,$2,$3,$3,'pickup')",
        [shop.shopId, remake, NOW],
      );
    });
    await tick();
    expect((await state())?.status).toBe("ended");
    expect((await db.query("SELECT status FROM consultations WHERE id=$1", [originalConsultation])).rows).toEqual([
      { status: "ended" },
    ]);
  });
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
  it("오래된 미완료 주문 상담이 한 건 배치에서 끝낼 상담을 막지 않음", async () => {
    await cancelledWithoutPayment();
    await db.query("UPDATE consultations SET status='ordered',last_customer_message_at=$2 WHERE id=$1", [
      consultationId,
      new Date(NOW.getTime() - 48 * HOUR),
    ]);
    const waiting = await createShop(db, "합성 오래 기다린 주문 가게");
    await db.query("UPDATE consultations SET status='ordered',last_customer_message_at=$2 WHERE id=$1", [
      waiting.consultationId,
      new Date(NOW.getTime() - 72 * HOUR),
    ]);
    const found = await db.query<{ id: string }>(DUE_SOURCES.consultation_ordered.find, [NOW, 1]);
    expect(found.rows.map((row) => row.id)).toEqual([consultationId]);
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
  it("주문 ID 없이 결제 안내만 참조한 열린 할 일도 상담 끝남을 막음", async () => {
    await cancelledWithoutPayment();
    const task = newUuid();
    await db.query(
      "INSERT INTO owner_tasks(id,shop_id,kind,event_key,payment_request_id,wait_status,wait_due_at) VALUES($1,$2,'payment_claim',$3,$4,'waiting',$5)",
      [task, shop.shopId, `task:payment_claim:${shop.paymentRequestId}`, shop.paymentRequestId, NOW],
    );
    await tick();
    expect((await state())?.status).toBe("ordered");
    await db.query("UPDATE owner_tasks SET wait_status='answered',closed_at=$2 WHERE id=$1", [task, NOW]);
    await tick();
    expect((await state())?.status).toBe("ended");
  });
  it("주문 쓰기와 겹친 종료는 기다리거나 오래된 열린 일 판단으로 끝내지 않음", async () => {
    await cancelledWithoutPayment();
    await db.query("UPDATE consultations SET status='ordered' WHERE id=$1", [consultationId]);
    const writer = isolated.connect(),
      closer = isolated.connect();
    const locked = latch(),
      releaseWriter = latch(),
      task = newUuid();
    const writing = writer
      .transaction(async (tx) => {
        await tx.query("SELECT id FROM orders WHERE id=$1 FOR UPDATE", [shop.orderId]);
        locked.release();
        await releaseWriter.promise;
        await tx.query(
          "INSERT INTO owner_tasks(id,shop_id,kind,event_key,order_id,wait_status,wait_due_at) VALUES($1,$2,'refund_decision',$3,$4,'waiting',$5)",
          [task, shop.shopId, `task:refund_decision:${shop.orderId}`, shop.orderId, NOW],
        );
      })
      .catch((error) => {
        locked.fail(error);
        throw error;
      });
    try {
      await locked.promise;
      await closer.transaction(async (tx) => {
        await tx.query("SELECT set_config('statement_timeout','1000',true)");
        await closeIdleConsultation(
          shopDb(createShopScope(shop.shopId, { kind: "job", job: "consultation_idle" }), tx),
          consultationId,
          NOW,
        );
      });
      expect((await state())?.status).toBe("ordered");
    } finally {
      releaseWriter.release();
      await Promise.allSettled([writing]);
      await writer.close();
      await closer.close();
    }
    await tick();
    expect((await state())?.status).toBe("ordered");
    await db.query("UPDATE owner_tasks SET wait_status='answered',closed_at=$2 WHERE id=$1", [task, NOW]);
    await tick();
    expect((await state())?.status).toBe("ended");
  });
  it("결제 안내로 참조한 오래된 할 일이 한 건 배치의 다음 상담을 막지 않음", async () => {
    await cancelledWithoutPayment();
    await db.query("UPDATE consultations SET status='ordered',last_customer_message_at=$2 WHERE id=$1", [
      consultationId,
      new Date(NOW.getTime() - 72 * HOUR),
    ]);
    await db.query(
      "INSERT INTO owner_tasks(shop_id,kind,event_key,payment_request_id,wait_status,wait_due_at) VALUES($1,'payment_claim',$2,$3,'waiting',$4)",
      [shop.shopId, `task:payment_claim:${shop.paymentRequestId}`, shop.paymentRequestId, NOW],
    );
    const ready = await createShop(db, "합성 뒤에 끝낼 상담 가게");
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE payment_requests SET status='closed',closed_at=$2,close_reason='order_cancelled' WHERE id=$1",
        [ready.paymentRequestId, NOW],
      );
      await tx.query(
        "UPDATE orders SET status='cancelled',cancelled_at=$2,cancel_kind='no_payment',finished_at=NULL WHERE id=$1",
        [ready.orderId, NOW],
      );
      await tx.query("UPDATE consultations SET status='ordered',last_customer_message_at=$2 WHERE id=$1", [
        ready.consultationId,
        new Date(NOW.getTime() - 48 * HOUR),
      ]);
    });
    const found = await db.query<{ id: string }>(DUE_SOURCES.consultation_ordered.find, [NOW, 1]);
    expect(found.rows.map((row) => row.id)).toEqual([ready.consultationId]);
  });
  async function indirectTask(kind: "change_request" | "issue_report" | "handoff") {
    const subject = newUuid(),
      task = newUuid();
    if (kind === "change_request") {
      const card = newUuid();
      await db.query(
        "INSERT INTO confirm_cards(id,shop_id,consultation_id,customer_id,card_key,kind,order_id,order_version,payload,expires_at) VALUES($1,$2,$3,$4,$5,'change_request',$6,1,'{}',now()+interval '20 minutes')",
        [card, shop.shopId, consultationId, customerId, newUuid(), shop.orderId],
      );
      await db.query(
        "INSERT INTO change_requests(id,shop_id,order_id,card_id,base_version,changes,status,closed_at) VALUES($1,$2,$3,$4,1,'{}','closed_by_cancel',$5)",
        [subject, shop.shopId, shop.orderId, card, NOW],
      );
    } else if (kind === "issue_report") {
      const details = newUuid();
      await db.query(
        "INSERT INTO issue_details(id,shop_id,consultation_id,order_id,description,status) VALUES($1,$2,$3,$4,'합성 문제 신고','reported')",
        [details, shop.shopId, consultationId, shop.orderId],
      );
      await db.query(
        "INSERT INTO issue_reports(id,shop_id,order_id,issue_details_id,late,reported_by,status,compensation,decided_at,closed_at,problem_kind) VALUES($1,$2,$3,$4,false,'owner_from_handoff','closed','none',$5,$5,'other')",
        [subject, shop.shopId, shop.orderId, details, NOW],
      );
    } else {
      await db.query(
        "INSERT INTO handoffs(id,shop_id,consultation_id,source_message_id,order_id,reason,status,closed_at) VALUES($1,$2,$3,$4,$5,'cannot_answer','closed_no_answer',$6)",
        [subject, shop.shopId, consultationId, shop.messageId, shop.orderId, NOW],
      );
    }
    const column = { change_request: "change_request_id", issue_report: "issue_report_id", handoff: "handoff_id" }[
      kind
    ];
    await db.query(
      `INSERT INTO owner_tasks(id,shop_id,kind,event_key,${column},wait_status,wait_due_at) VALUES($1,$2,$3,$4,$5,'waiting',$6)`,
      [task, shop.shopId, kind, `task:${kind}:${subject}`, subject, NOW],
    );
    return task;
  }
  it.each([
    ["change_request", "handler"],
    ["issue_report", "handler"],
    ["handoff", "handler"],
    ["change_request", "candidate"],
    ["issue_report", "candidate"],
    ["handoff", "candidate"],
  ] as const)("간접 %s 할 일이 열린 동안 %s가 상담을 끝내지 않음", async (kind, path) => {
    await cancelledWithoutPayment();
    await db.query("UPDATE consultations SET status='ordered' WHERE id=$1", [consultationId]);
    const task = await indirectTask(kind);
    if (path === "candidate") {
      const found = await db.query<{ id: string }>(DUE_SOURCES.consultation_ordered.find, [NOW, 1000]);
      expect(found.rows.map((row) => row.id)).not.toContain(consultationId);
      expect((await db.query(DUE_SOURCES.consultation_ordered.claim, [shop.shopId, consultationId, NOW])).rows).toEqual(
        [],
      );
    } else {
      await db.transaction((tx) =>
        closeIdleConsultation(
          shopDb(createShopScope(shop.shopId, { kind: "job", job: "consultation_idle" }), tx),
          consultationId,
          NOW,
        ),
      );
      expect((await state())?.status).toBe("ordered");
    }
    await db.query("UPDATE owner_tasks SET wait_status='answered',closed_at=$2 WHERE id=$1", [task, NOW]);
    await tick();
    expect((await state())?.status).toBe("ended");
  });
  async function incoming(at: Date, text = "합성 이어가기", connection = isolated.connect()) {
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
  it("재개 때 이미 만료된 견적은 쓰지 않고 남은 초안에서 새 금액과 기한을 계산", async () => {
    const message = newUuid(),
      beforeIdle = new Date(NOW.getTime() - 24 * HOUR);
    await db.query(
      "UPDATE order_drafts d SET price_list_id=s.price_list_id,size_option_id=s.size_option_id,flavor_option_id=s.flavor_option_id FROM order_drafts s WHERE d.id=$1 AND s.id=$2",
      [draftId, shop.draftId],
    );
    await db.query(
      "INSERT INTO messages(id,shop_id,consultation_id,direction,author,kind,kakao_message_id,body_masked,created_at) VALUES($1,$2,$3,'inbound','customer','text',$4,'합성 견적 질문',$5)",
      [message, shop.shopId, consultationId, `idle-quote-${message}`, beforeIdle],
    );
    const scoped = () => shopRequestDb(createShopScope(shop.shopId, { kind: "job", job: "quote" }), db);
    const first = await quoteDraft(scoped(), { draftId, sourceMessageId: message, now: beforeIdle });
    if (first.kind !== "quoted") throw new Error("첫 합성 견적이 없어요");
    await tick();
    expect((await state())?.status).toBe("dropped");
    await expect(quoteDraft(scoped(), { draftId, sourceMessageId: message, now: NOW })).rejects.toMatchObject({
      code: "not_found",
    });
    const resumedAt = new Date(new Date(first.quote.validUntil).getTime() + 1);
    const receipt = await incoming(resumedAt, "합성 만료 견적 뒤 재개");
    if (receipt.kind !== "received") throw new Error("합성 재개 수신이 없어요");
    const fresh = await quoteDraft(scoped(), { draftId, sourceMessageId: receipt.messageId, now: resumedAt });
    if (fresh.kind !== "quoted") throw new Error("새 합성 견적이 없어요");
    expect(fresh.quote.id).not.toBe(first.quote.id);
    expect(fresh.quote.amount).toBe(35000);
    expect(new Date(fresh.quote.validUntil).getTime()).toBe(resumedAt.getTime() + 72 * HOUR);
    expect((await db.query("SELECT lettering FROM order_drafts WHERE id=$1", [draftId])).rows).toEqual([
      { lettering: "생일 축하" },
    ]);
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
  async function waitForBlockedBy(pid: number) {
    await expect
      .poll(
        async () =>
          (
            await db.query<{ blocked: boolean }>(
              "SELECT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE $1::int=ANY(pg_blocking_pids(a.pid))) AS blocked",
              [pid],
            )
          ).rows[0]?.blocked,
        { timeout: 3000, interval: 20 },
      )
      .toBe(true);
  }
  it("종료가 먼저 잠근 실제 두 연결에서도 새 메시지는 같은 문의 상담을 다시 엶", async () => {
    const closer = isolated.connect(),
      receiver = isolated.connect();
    const pid = required((await closer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]).pid;
    const closed = latch(),
      releaseCloser = latch();
    const closing = closer
      .transaction(async (tx) => {
        await closeIdleConsultation(
          shopDb(createShopScope(shop.shopId, { kind: "job", job: "consultation_idle" }), tx),
          consultationId,
          NOW,
        );
        closed.release();
        await releaseCloser.promise;
      })
      .catch((error) => {
        closed.fail(error);
        throw error;
      });
    let receiving: ReturnType<typeof incoming> | undefined;
    try {
      await closed.promise;
      receiving = incoming(NOW, "합성 종료 중 수신", receiver);
      await waitForBlockedBy(pid);
      releaseCloser.release();
      await closing;
      expect(await receiving).toMatchObject({ kind: "received", consultationId });
      expect(await state()).toMatchObject({ status: "open", dropped_at: null, ended_at: null });
    } finally {
      releaseCloser.release();
      await Promise.allSettled([closing, ...(receiving ? [receiving] : [])]);
      await closer.close();
      await receiver.close();
    }
  });
  it("수신이 먼저 잠근 실제 두 연결에서는 종료가 새 수신 시각을 다시 확인함", async () => {
    const receiver = isolated.connect(),
      closer = isolated.connect();
    const pid = required((await receiver.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]).pid;
    const saved = latch(),
      releaseReceiver = latch();
    const gated: RequestDb = {
      query: receiver.query.bind(receiver),
      transaction: (fn) =>
        receiver.transaction(async (tx) => {
          const result = await fn(tx);
          saved.release();
          await releaseReceiver.promise;
          return result;
        }),
      close: receiver.close.bind(receiver),
      abort: receiver.abort.bind(receiver),
    };
    const receiving = incoming(NOW, "합성 수신 중 종료", gated).catch((error) => {
      saved.fail(error);
      throw error;
    });
    let closing: Promise<void> | undefined;
    try {
      await saved.promise;
      closing = closer.transaction((tx) =>
        closeIdleConsultation(
          shopDb(createShopScope(shop.shopId, { kind: "job", job: "consultation_idle" }), tx),
          consultationId,
          NOW,
        ),
      );
      await waitForBlockedBy(pid);
      releaseReceiver.release();
      expect(await receiving).toMatchObject({ kind: "received", consultationId });
      await closing;
      expect(await state()).toMatchObject({ status: "open", dropped_at: null, ended_at: null });
      expect(
        (await db.query("SELECT last_customer_message_at FROM consultations WHERE id=$1", [consultationId])).rows,
      ).toEqual([{ last_customer_message_at: NOW }]);
    } finally {
      releaseReceiver.release();
      await Promise.allSettled([receiving, ...(closing ? [closing] : [])]);
      await receiver.close();
      await closer.close();
    }
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
