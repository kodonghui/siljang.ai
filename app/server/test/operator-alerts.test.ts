import { afterAll, beforeAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { RequestDb } from "../src/db";
import { expectProblem, expectSchema } from "./support/contract";
import { describeDb, testEnv } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { seedOperatorSession } from "./support/operator";
import { createShop } from "./support/shops";

const ORIGIN = "https://siljang.example",
  NOW = new Date("2026-11-22T06:00:00Z");
let db: RequestDb, isolated: Awaited<ReturnType<typeof isolatedTestDb>> | undefined;
describeDb("TASK-035 운영자 알림", () => {
  beforeAll(async () => {
    isolated = await isolatedTestDb();
    db = isolated.db;
  }, 30_000);
  afterAll(async () => isolated?.close());
  it("운영자에게 세 종류/가게 요약/건수만 최신순으로 돌려주고 내용은 읽지 않음", async () => {
    const f = await createShop(db, "알림 합성 가게"),
      op = await seedOperatorSession(db, NOW),
      ids = Array.from({ length: 4 }, () => crypto.randomUUID());
    for (const [i, kind] of [
      "channel_already_linked",
      "privacy_transfer_missing",
      "ai_failure_burst",
      "purge_run",
    ].entries())
      await db.query("INSERT INTO ops_events(id,shop_id,kind,count,detail,created_at) VALUES ($1,$2,$3,$4,$5,$6)", [
        ids[i],
        i === 1 ? null : f.shopId,
        kind,
        i + 1,
        { content: "합성 비공개 내용" },
        new Date(NOW.getTime() + i * 1000),
      ]);
    const database = isolated;
    if (!database) throw new Error("시험 DB 없음");
    const app = createApp({ connect: () => database.connect(), services: { now: () => NOW }, logSink: () => {} });
    const response = await app.request(`${ORIGIN}/api/operator/alerts`, { headers: { cookie: op.cookie } }, testEnv());
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      items: { alertId: string; kind: string; shop: unknown; count: number }[];
      nextCursor: string | null;
    };
    expectSchema("OperatorAlertList", body);
    expect(body.items.map((x) => x.alertId)).toEqual([ids[2], ids[1], ids[0]]);
    expect(body.items[1]?.shop).toBe(null);
    expect(body.items[0]).toMatchObject({
      kind: "ai_failure_burst",
      count: 3,
      shop: { shopId: f.shopId, name: "알림 합성 가게" },
    });
    expect(JSON.stringify(body)).not.toContain("합성 비공개 내용");
    expect(JSON.stringify(body)).not.toContain("detail");
  });
});
it("운영자 알림 무인증은401/데이터베이스0", async () => {
  let calls = 0;
  const fail = async (): Promise<never> => {
    calls++;
    throw new Error("데이터베이스 호출 금지");
  };
  const app = createApp({
    connect: () => ({ query: fail, transaction: fail, abort: async () => {}, close: async () => {} }),
    logSink: () => {},
  });
  await expectProblem(await app.request(`${ORIGIN}/api/operator/alerts`, {}, testEnv()), "unauthenticated");
  expect(calls).toBe(0);
});
