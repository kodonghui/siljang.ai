import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import type { RequestDb } from "../src/db";
import { runDueJobs } from "../src/job-runner";
import { runnableJobs } from "../src/jobs";
import { describeDb, newUuid } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { createShop, type ShopFixture } from "./support/shops";

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
    return runDueJobs({ db, now: at, jobs, log: () => {} });
  }
  async function state() {
    return (
      await db.query<{ status: string; dropped_at: Date | null; ended_at: Date | null }>(
        "SELECT status,dropped_at,ended_at FROM consultations WHERE id=$1",
        [consultationId],
      )
    ).rows[0];
  }
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
});
