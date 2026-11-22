import { afterAll, beforeAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { RequestDb } from "../src/db";
import { OWNER_COOKIE } from "../src/owner-oauth";
import { createOwnerScope } from "../src/owner-scope";
import { createOwnerSession } from "../src/owner-session";
import { newUploadId, tempKey } from "../src/uploads";
import { expectProblem, expectSchema } from "./support/contract";
import { describeDb, newRequestKey, TEST_HASH_KEY, testEnv } from "./support/db";
import { isolatedTestDb } from "./support/isolated-db";
import { seedOperatorSession } from "./support/operator";
import { createShop } from "./support/shops";
import { MemoryStore } from "./support/storage";

const ORIGIN = "https://siljang.example",
  NOW = new Date("2026-11-22T06:00:00Z"),
  env = testEnv({ FILE_URL_KEY: TEST_HASH_KEY });
let isolated: Awaited<ReturnType<typeof isolatedTestDb>> | undefined, db: RequestDb;
interface Shop {
  revision: string;
  licenseStatus: string;
  foodLicenseNo: string;
  foodBusinessType: string;
  licenseHoldReason: string | null;
  licensePhotoUrl: string;
}
async function fixture(status = "on_hold") {
  const f = await createShop(db, "영업 신고 다시 올리기");
  const op = await seedOperatorSession(db, NOW);
  await db.query(
    "UPDATE shops SET license_status=$2,license_hold_reason=CASE WHEN $2='on_hold' THEN '사진이 흐려요' ELSE NULL END,license_reviewed_by=CASE WHEN $2='pending' THEN NULL ELSE $3::uuid END,license_reviewed_at=CASE WHEN $2='pending' THEN NULL ELSE $4::timestamptz END WHERE id=$1",
    [f.shopId, status, op.operatorId, NOW],
  );
  const owner = (
    await db.query<{ kakao_account_id: string }>("SELECT kakao_account_id FROM owners WHERE id=$1", [f.ownerId])
  ).rows[0];
  if (!owner) throw new Error("사장님 없음");
  const session = await createOwnerSession(db, { accountId: owner.kakao_account_id, friend: false }, NOW, false),
    cookie = `${OWNER_COOKIE}=${session.token}`,
    store = new MemoryStore();
  const database = isolated;
  if (!database) throw new Error("시험 DB 없음");
  const app = createApp({
    connect: () => database.connect(),
    services: { storage: store, now: () => NOW },
    logSink: () => {},
  });
  const get = async () => {
    const response = await app.request(`${ORIGIN}/api/owner/shop`, { headers: { cookie } }, env);
    expect(response.status).toBe(200);
    return (await response.json()) as Shop;
  };
  const upload = async () => {
    const id = newUploadId("license_photo", NOW);
    await store.put(tempKey(createOwnerScope(f.ownerId), id), new Uint8Array([1, 2, 3]), "image/jpeg");
    return id;
  };
  const input = async () => ({
    baseRevision: (await get()).revision,
    foodLicenseNo: "2026-새신고-001",
    foodBusinessType: "instant_sale_manufacturing",
    licensePhotoUploadId: await upload(),
  });
  const put = (body: unknown, key = newRequestKey(), bindings = env) =>
    app.request(
      `${ORIGIN}/api/owner/shop/license`,
      {
        method: "PUT",
        headers: { cookie, origin: ORIGIN, "content-type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(body),
      },
      bindings,
    );
  return { f, op, cookie, store, app, get, input, put, upload };
}
describeDb("TASK-033 보류 영업 신고 재업로드", () => {
  beforeAll(async () => {
    isolated = await isolatedTestDb();
    db = isolated.db;
  }, 30_000);
  afterAll(async () => isolated?.close());
  it("보류된 영업 신고를 새 증빙/번호/종류로 다시 올리면 pending/이유 없음", async () => {
    const h = await fixture(),
      input = await h.input(),
      key = newRequestKey(),
      response = await h.put(input, key);
    expect(response.status, await response.clone().text()).toBe(200);
    const result = await response.json();
    expectSchema("ShopResult", result);
    expect(result).toMatchObject({
      outcome: "done",
      shop: {
        licenseStatus: "pending",
        licenseHoldReason: null,
        foodLicenseNo: input.foodLicenseNo,
        foodBusinessType: input.foodBusinessType,
      },
    });
    const replay = await h.put(input, key);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(h.store.calls.filter((x) => x === "copy")).toHaveLength(1);
  });
  it.each(["pending", "verified"])("보류가 아닌 %s는409이고 증빙 복사0", async (status) => {
    const h = await fixture(status);
    await expectProblem(await h.put(await h.input()), "invalid_state");
    expect(h.store.calls.filter((x) => x === "copy")).toHaveLength(0);
  });
  it("오래된 버전은409이며 신원/사진/이유는 보존", async () => {
    const h = await fixture(),
      input = await h.input(),
      before = await h.get();
    await expectProblem(await h.put({ ...input, baseRevision: "stale" }), "version_conflict");
    expect(await h.get()).toEqual(before);
  });
});
it("무인증 영업 신고 재업로드는401/데이터베이스0", async () => {
  let calls = 0;
  const fail = async (): Promise<never> => {
    calls++;
    throw new Error("데이터베이스 호출 금지");
  };
  const app = createApp({
    connect: () => ({ query: fail, transaction: fail, abort: async () => {}, close: async () => {} }),
    logSink: () => {},
  });
  const response = await app.request(
    `${ORIGIN}/api/owner/shop/license`,
    {
      method: "PUT",
      headers: { origin: ORIGIN, "content-type": "application/json", "Idempotency-Key": newRequestKey() },
      body: "{}",
    },
    testEnv(),
  );
  await expectProblem(response, "unauthenticated");
  expect(calls).toBe(0);
});
