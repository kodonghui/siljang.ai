import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createApp } from "../src/app";
import { type DbConnector, pgConnector } from "../src/db";
import { createCustomOrderTask } from "../src/order-output";
import { ApiError } from "../src/problem";
import { Secret } from "../src/settings";
import { createShopScope, shopRequestDb } from "../src/shop-scope";
import { failingAccessInsert } from "./support/access-log";
import { expectProblem, expectSchema } from "./support/contract";
import { describeDb, newUuid, TEST_DATABASE_URL, testEnv } from "./support/db";
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
  function app(failLog = false, connect: DbConnector = () => isolated.connect()) {
    return createApp({
      connect: failLog ? failingAccessInsert(connect) : connect,
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
    ).toEqual([{ api_id: "API-040", request_path: "/api/owner/tasks" }]);
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
  it("지연·기다림 기한·기한 없는 순서를 커서로 이어 읽고 다른 상태의 커서는 거절한다", async () => {
    const late = await custom(),
      waiting = newUuid(),
      plain = newUuid(),
      handoff = newUuid();
    await isolated.db.query("UPDATE owner_tasks SET wait_status='late',late_notice_at=$2,wait_due_at=$2 WHERE id=$1", [
      late.id,
      new Date(NOW.getTime() - 1000),
    ]);
    await isolated.db.query(
      "INSERT INTO handoffs(id,shop_id,consultation_id,source_message_id,reason) VALUES($1,$2,$3,$4,'edibility')",
      [handoff, shop.shopId, shop.consultationId, shop.messageId],
    );
    await isolated.db.query(
      "INSERT INTO owner_tasks(id,shop_id,kind,event_key,handoff_id,wait_status,wait_due_at,opened_at) VALUES($1,$2,'handoff',$3,$4,'waiting',$5,$6)",
      [waiting, shop.shopId, `task:handoff:${handoff}`, handoff, new Date(NOW.getTime() + 1000), NOW],
    );
    await isolated.db.query(
      "INSERT INTO owner_tasks(id,shop_id,kind,event_key,opened_at) VALUES($1,$2,'ledger_relink',$3,$4)",
      [plain, shop.shopId, `task:ledger_relink:${plain}`, new Date(NOW.getTime() - 10000)],
    );
    const ids: string[] = [];
    let next: string | null = null,
      firstCursor: string | null = null;
    for (let i = 0; i < 3; i++) {
      const response = await call(`?limit=1${next === null ? "" : `&cursor=${next}`}`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { items: { taskId: string }[]; nextCursor: string | null };
      expectSchema("OwnerTaskList", body);
      ids.push(...body.items.map((row) => row.taskId));
      next = body.nextCursor;
      if (i === 0) firstCursor = next;
      if (next !== null) expect(next.length).toBeLessThanOrEqual(200);
    }
    expect(ids).toEqual([late.id, waiting, plain]);
    expect(next).toBeNull();
    expect(firstCursor).not.toBeNull();
    await expectProblem(await call(`?status=closed&cursor=${firstCursor}`), "validation_failed");
  });
  it("같은 밀리초 안의 두 할 일도 PostgreSQL 마이크로초 순서로 빠짐없이 읽는다", async () => {
    const ids = [newUuid(), newUuid()];
    for (const [i, id] of ids.entries())
      await isolated.db.query(
        "INSERT INTO owner_tasks(id,shop_id,kind,event_key,opened_at) VALUES($1,$2,'ledger_relink',$3,$4::timestamptz+$5::integer*interval '1 microsecond')",
        [id, shop.shopId, `task:ledger_relink:${id}`, NOW, i + 1],
      );
    const first = (await (await call("?limit=1")).json()) as { items: { taskId: string }[]; nextCursor: string };
    expect(first.items.map((row) => row.taskId)).toEqual([ids[0]]);
    const second = (await (await call(`?limit=1&cursor=${first.nextCursor}`)).json()) as {
      items: { taskId: string }[];
      nextCursor: string | null;
    };
    expect(second.items.map((row) => row.taskId)).toEqual([ids[1]]);
    expect(second.nextCursor).toBeNull();
  });
  it("저장소 권한 파일의 제한 역할로 목록과 같은 트랜잭션의 접속기록을 처리한다", async () => {
    await custom();
    const role = `task072_${newUuid().replaceAll("-", "")}`;
    await isolated.db.query(`CREATE ROLE "${role}" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    const grants = readFileSync(new URL("../../../tools/staging-login-callback-grants.sql", import.meta.url), "utf8");
    const name = (await isolated.db.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name;
    if (!name) throw new Error("합성 시험 데이터베이스가 없어요");
    const url = new URL(TEST_DATABASE_URL);
    url.pathname = `/${name}`;
    url.username = role;
    url.password = "";
    const runtime = pgConnector(new Secret(url.toString()));
    try {
      await isolated.db.query(grants.replaceAll(':"runtime_role"', `"${role}"`));
      const response = await app(false, () => runtime).request(
        `${ORIGIN}/api/owner/tasks`,
        { headers: { "x-test-owner": shop.ownerId, "cf-connecting-ip": "203.0.113.24" } },
        testEnv(),
      );
      expect(response.status).toBe(200);
      expect((await listBody(response)).items).toHaveLength(1);
      expect((await isolated.db.query("SELECT api_id FROM access_logs WHERE shop_id=$1", [shop.shopId])).rows).toEqual([
        { api_id: "API-040" },
      ]);
    } finally {
      await runtime.close();
      await isolated.db.query(`DROP OWNED BY "${role}"`);
      await isolated.db.query(`DROP ROLE "${role}"`);
    }
  });
});

import { readFileSync } from "node:fs";
