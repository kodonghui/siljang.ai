import { afterAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import { OWNER_COOKIE } from "../src/owner-oauth";
import { createOwnerScope } from "../src/owner-scope";
import { createOwnerSession } from "../src/owner-session";
import { newUploadId, tempKey } from "../src/uploads";
import { expectProblem, expectSchema } from "./support/contract";
import { describeDb, newRequestKey, TEST_HASH_KEY, testDb, testEnv } from "./support/db";
import { createShop } from "./support/shops";
import { MemoryStore } from "./support/storage";

const db = testDb(),
  NOW = new Date("2026-11-22T05:00:00Z"),
  ORIGIN = "https://siljang.example",
  env = testEnv({ FILE_URL_KEY: TEST_HASH_KEY });
interface Shop {
  revision: string;
  businessName: string;
  representativeName: string;
  businessRegNo: string;
  identityChange: { changeId: string; businessName: string; status: string; previous: { businessName: string } } | null;
}
async function fixture() {
  const shop = await createShop(db, "사업자 변경 합성 가게");
  await db.query("UPDATE shops SET business_reg_no='1234567891' WHERE id=$1", [shop.shopId]);
  const owner = (
    await db.query<{ kakao_account_id: string }>("SELECT kakao_account_id FROM owners WHERE id=$1", [shop.ownerId])
  ).rows[0];
  if (!owner) throw new Error("합성 사장님 없음");
  const session = await createOwnerSession(db, { accountId: owner.kakao_account_id, friend: false }, NOW, false),
    cookie = `${OWNER_COOKIE}=${session.token}`,
    store = new MemoryStore();
  const app = createApp({ services: { storage: store, now: () => NOW }, logSink: () => {} });
  const get = async () => {
    const response = await app.request(`${ORIGIN}/api/owner/shop`, { headers: { cookie } }, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Shop;
    expectSchema("Shop", body);
    return body;
  };
  const upload = async () => {
    const id = newUploadId("license_photo", NOW);
    await store.put(tempKey(createOwnerScope(shop.ownerId), id), new Uint8Array([1, 2, 3]), "image/jpeg");
    return id;
  };
  const post = (body: unknown, key = newRequestKey()) =>
    app.request(
      `${ORIGIN}/api/owner/shop/identity-changes`,
      {
        method: "POST",
        headers: { cookie, origin: ORIGIN, "content-type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(body),
      },
      env,
    );
  const input = async () => {
    const current = await get();
    return {
      baseRevision: current.revision,
      businessName: "새 합성 상호",
      representativeName: current.representativeName,
      businessRegNo: current.businessRegNo,
      evidencePhotoUploadId: await upload(),
    };
  };
  return { shop, cookie, store, app, get, upload, post, input };
}

describeDb("TASK-036 사장님 사업자 변경 요청", () => {
  afterAll(async () => db.close());
  it("사장님 변경 요청201은 지금 값을 보존하고 새 값/증빙/요청 때 값을 남김", async () => {
    const h = await fixture(),
      before = await h.get(),
      body = await h.input(),
      key = newRequestKey(),
      response = await h.post(body, key);
    expect(response.status, await response.clone().text()).toBe(201);
    const result = (await response.json()) as { outcome: string; shop: Shop };
    expectSchema("ShopResult", result);
    expect(result).toMatchObject({
      outcome: "done",
      shop: {
        businessName: before.businessName,
        identityChange: {
          status: "pending",
          businessName: body.businessName,
          previous: { businessName: before.businessName },
        },
      },
    });
    expect((await h.get()).businessName).toBe(before.businessName);
    const copies = h.store.calls.filter((x) => x === "copy").length;
    expect(copies).toBe(1);
    const replay = await h.post(body, key);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(h.store.calls.filter((x) => x === "copy")).toHaveLength(copies);
    await expectProblem(await h.post(body), "identity_change_pending");
    expect(
      (await db.query("SELECT count(*)::int AS n FROM shop_identity_changes WHERE shop_id=$1", [h.shop.shopId])).rows,
    ).toEqual([{ n: 1 }]);
  });
  it("같은 값의 사업자 변경 요청은200 unchanged이며 사진을 복사하지 않음", async () => {
    const h = await fixture(),
      current = await h.get(),
      response = await h.post({
        baseRevision: current.revision,
        businessName: current.businessName,
        representativeName: current.representativeName,
        businessRegNo: current.businessRegNo,
        evidencePhotoUploadId: await h.upload(),
      });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({ outcome: "unchanged", shop: { identityChange: null } });
    expect(h.store.calls).not.toContain("copy");
    expect(
      (await db.query("SELECT count(*)::int AS n FROM shop_identity_changes WHERE shop_id=$1", [h.shop.shopId])).rows,
    ).toEqual([{ n: 0 }]);
  });
});

it.each([
  ["POST", "/owner/shop/identity-changes"],
  ["GET", "/operator/identity-changes"],
  ["POST", "/operator/identity-changes/00000000-0000-4000-8000-000000000036/review"],
])("인증 없는 사업자 변경 %s %s는401이고 DB0", async (method, path) => {
  let calls = 0;
  const fail = async (): Promise<never> => {
    calls++;
    throw new Error("DB를 부르면 안 됨");
  };
  const app = createApp({
    connect: () => ({ query: fail, transaction: fail, abort: async () => {}, close: async () => {} }),
    logSink: () => {},
  });
  const response = await app.request(
    `https://siljang.example/api${path}`,
    {
      method,
      headers: {
        origin: "https://siljang.example",
        "Idempotency-Key": newRequestKey(),
        "content-type": "application/json",
      },
      ...(method === "POST" ? { body: "{}" } : {}),
    },
    testEnv(),
  );
  await expectProblem(response, "unauthenticated");
  expect(calls).toBe(0);
});
